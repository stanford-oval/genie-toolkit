// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const ValueCategory = require('../semantic').ValueCategory;

// scoring heuristics:
// prefer full matches, allow prefix matches
// slighty prefer primary values for a contact, ignore everything else
const SCORING_MODEL = {
    exactMatch: 10,
    match: 10,
    startsWith: 3,
    substring: 2,

    isPrimary: 1,

    timesContacted: 0.0005
};

function dotProduct(a, b) {
    var score = 0;
    for (var name in b)
        score += (a[name] || 0) * (b[name] || 0);
    return score;
}

function expNormalize(scores) {
    let prob = [];
    let max = -Infinity;
    let sum = 0;
    for (let i = 0; i < scores.length; i++)
        max = Math.max(max, scores[i]);
    if (max === Infinity || max === -Infinity)
        return null;
    for (let i = 0; i < scores.length; i++) {
        prob[i] = Math.exp(scores[i] - max);
        sum += prob[i];
    }
    for (let i = 0; i < scores.length; i++)
        prob[i] /= sum;
    return prob;
}

class SimpleClassifier {
    constructor(featureExtractor, params) {
        this.extractor = featureExtractor;
        this.params = params;
    }

    score(example) {
        return dotProduct(this.extractor(example), this.params);
    }

    scoreAll(examples) {
        var scores = new Array(examples.length);
        examples.forEach(function(ex, i) {
            scores[i] = this.score(ex);
        }, this);
        var probs = expNormalize(scores);
        var mapped = examples.map((ex, i) => {
            return {
                ex: ex,
                score: scores[i],
                prob: probs ? probs[i] : NaN
            };
        });
        mapped.sort((a, b) => {
            return b.score - a.score;
        });
        return mapped;
    }
}

function featurizeContact(contact, candidate) {
    let features = {
        // search features
        exactMatch: 0,
        match: 0,
        startsWith: 0,
        substring: 0,

        // candidate features
        isPrimary: 0,
        starred: 0,
        timesContacted: 0,
        age: 0
    };
    function computeMatches(candidate, search) {
        if (candidate === search) {
            features.exactMatch++;
        } else {
            let lowerCaseCandidate = candidate.toLowerCase().trim();
            let lowerCaseSearch = search.toLowerCase().trim();

            if (lowerCaseCandidate === lowerCaseSearch)
                features.match++;
            else if (lowerCaseCandidate.startsWith(lowerCaseSearch))
                features.startsWith++;
            else if (lowerCaseCandidate.indexOf(lowerCaseSearch) >= 0)
                features.substring++;
        }
    }
    computeMatches(candidate.displayName, contact);
    computeMatches(candidate.alternativeDisplayName, contact);

    if (candidate.isPrimary)
        features.isPrimary ++;
    if (candidate.starred)
        features.starred = 1;
    features['type=' + candidate.type] = 1;
    features.timesContacted = candidate.timesContacted;

    // add overfitting features for things like "mom" and "dad"
    let tokens = contact.toLowerCase().trim().split(/\s+/);
    for (let t of tokens)
        features['align --- ' + t + '=' + candidate.value] = 1;

    return features;
}

function lookupMessaging(dlg, name) {
    const messaging = dlg.manager.messaging;
    return messaging.searchAccountByName(name).then((accounts) => {
        return accounts.map((a) => {
            return {
                value: messaging.type + '-account:' + a.account,
                displayName: a.name,
                alternativeDisplayName: a.name,
                isPrimary: false,
                starred: false,
                type: 'other',
                timesContacted: 0
            };
        });
    });
}

function lookupContact(dlg, category, name) {
    let contactApi = dlg.manager.platform.getCapability('contacts');
    if (contactApi === null) {
        if (category !== ValueCategory.Contact)
            return null;
        let messaging = dlg.manager.messaging;
        if (!messaging.isAvailable)
            return null;

        return lookupMessaging(dlg, name);
    }

    let what;
    if (category === ValueCategory.PhoneNumber)
        what = 'phone_number';
    else if (category === ValueCategory.EmailAddress)
        what = 'email_address';
    else
        what = 'contact';
    return contactApi.lookup(what, name);
}

function makeValue(dlg, category, choice) {
    if (category === ValueCategory.PhoneNumber)
        return Ast.Value.Entity(choice.value, 'tt:phone_number', choice.displayName);
    else if (category === ValueCategory.EmailAddress)
        return Ast.Value.Entity(choice.value, 'tt:email_address', choice.displayName);
    else
        return Ast.Value.Entity(choice.value, 'tt:contact', choice.displayName);
}

module.exports.makeContact = makeValue;
module.exports.contactSearch = async function (dlg, type, name) {
    if (!type.isEntity)
        throw new TypeError('Invalid contact type ' + type);
    let category;
    switch (type.type) {
        case 'tt:phone_number':
            category = ValueCategory.PhoneNumber;
            break;
        case 'tt:email_address':
            category = ValueCategory.EmailAddress;
            break;
        case 'tt:contact':
            category = ValueCategory.Contact;
            break;
        default:
            throw new TypeError('Invalid contact type ' + type);
    }

    let choices = name === null ? [] : await lookupContact(dlg, category, name);
    if (choices === null) {
        dlg.reply(dlg._("You don't have a valid address book available."));
        dlg.manager.stats.hit('sabrina-fail-noaddressbook');
        return null;
    }
    if (choices.length === 0) {
        dlg.reply(dlg._("No contact matches your search."));

        // straight up ask for the target category
        // this ensures we show a contact picker, which is better than
        // repeatedly asking the user
        let answer = await dlg.ask(category === ValueCategory.Contact ? ValueCategory.PhoneNumber : category,
            dlg._("Who do you want to contact?"));
        let contact = {
            value: answer.value,
            displayName: answer.display
        };
        if (category === ValueCategory.Contact)
            contact.value = 'phone:' + contact.value;
        return await makeValue(dlg, category, contact);
    }

    if (choices.length === 1)
        return await makeValue(dlg, category, choices[0]);

    let model = new SimpleClassifier(featurizeContact.bind(null, name), SCORING_MODEL);
    let scored = model.scoreAll(choices);

    // apply the usual scoring heuristics
    let prob = scored[0].prob;
    let top = scored[0].ex;
    let choice = null;
    let fallbacks = null;

    if (prob > 0.9) {
        choice = top;
    } else if (prob > 0.5 && scored[0].score >= 0) {
        choice = top;
    } else {
        fallbacks = [];
        for (var candidate of scored) {
            if (candidate.prob < 0.15 || candidate.score < -10)
                break;
            fallbacks.push(candidate.ex);
        }
    }

    if (choice !== null)
        return await makeValue(dlg, category, choice);

    let idx = await dlg.askChoices(dlg._("Multiple contacts match “%s”. Who do you mean?").format(name),
        fallbacks.map((c) => c.displayName));
    return await makeValue(dlg, category, fallbacks[idx]);
};
