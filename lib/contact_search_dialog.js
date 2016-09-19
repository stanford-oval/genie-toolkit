// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const Dialog = require('./dialog');
const ValueCategory = require('./semantic').ValueCategory;
const Helpers = require('./helpers');

// scoring heuristics to use in absence of data:
// prefer full matches, allow prefix matches
// slighty prefer primary values for a contact, ignore everything else
const INITIAL_SCORING_MODEL = {
    exactMatch: 10,
    match: 10,
    startsWith: 3,
    substring: 2,

    isPrimary: 1,
};

// A dialog to search a contact by name
//
// This dialog is pushed as a subdialog of SlotFillingDialog
// when a slot is filled with a reference to a contact
// instead of a phone number or email address
// (eg the user says "call mom" instead of "call +1-555-555-5555")
module.exports = class ContactSearchDialog extends Dialog {
    constructor(contact, type) {
        super();

        this.contact = contact;
        this.category = type.isPhoneNumber ? ValueCategory.PhoneNumber : ValueCategory.EmailAddress;
        this.resolved = null;
        this.choices = null;

        this._model = null;
    }

    static resolve(parent, type, values, index) {
        if (!values[index].isVarRef || !values[index].name.startsWith('$contact('))
            return Q(false);

        // if we get here, either we never pushed the ContactSearchDialog,
        // or the ContactSearchDialog returned false from .handle(), which
        // implies it is done
        if (parent.subdialog === null) {
            parent.push(new ContactSearchDialog(values[index].name.substring('$contact('.length, values[index].name.length-1), type));
            return parent.subdialog.continue().then((waiting) => {
                if (waiting) {
                    return waiting;
                } else {
                    values[index] = parent.subdialog.resolved;
                    parent.pop();
                    return false;
                }
            });
        } else {
            values[index] = parent.subdialog.resolved;
            parent.pop();
            return Q(false);
        }
    }

    _featurizeContact(candidate) {
        var features = {
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
                var lowerCaseCandidate = candidate.toLowerCase().trim();
                var lowerCaseSearch = search.toLowerCase().trim();

                if (lowerCaseCandidate === lowerCaseSearch)
                    features.match++;
                else if (lowerCaseCandidate.startsWith(lowerCaseSearch))
                    features.startsWith++;
                else if (lowerCaseCandidate.indexOf(lowerCaseSearch) >= 0)
                    features.substring++;
            }
        }
        computeMatches(candidate.displayName, this.contact);
        computeMatches(candidate.alternativeDisplayName, this.contact);

        if (candidate.isPrimary)
            features.isPrimary ++;
        if (candidate.starred)
            features.starred = 1;
        features['type=' + candidate.type] = 1;
        features.timesContacted = candidate.timesContacted;

        // add overfitting features for things like "mom" and "dad"
        var tokens = this.contact.toLowerCase().trim().split(/\s+/);
        for (var t of tokens)
            features['align --- ' + t + '=' + candidate.value] = 1;

        return features;
    }

    _lookupContact() {
        var contactApi = this.manager.platform.getCapability('contacts');
        if (contactApi === null)
            return null;

        var what = this.category === ValueCategory.PhoneNumber ? 'phone_number' : 'email_address';
        return contactApi.lookup(what, this.contact);
    }

    _makeValue(choice) {
        var value;
        if (this.category === ValueCategory.PhoneNumber)
            value = Ast.Value.PhoneNumber(choice.value);
        else
            value = Ast.Value.EmailAddress(choice.value);
        value.display = choice.displayName;
        return value;
    }

    continue() {
        if (this.resolved !== null)
            return false;

        return this._lookupContact().then((result) => {
            if (result === null) {
                this.reply(this._("You don't have a valid address book available."));
                // fail miserably and abort whatever we were doing
                this.manager.stats.hit('sabrina-fail-noaddressbook');
                return this.switchToDefault();
            }
            if (result.length === 0) {
                this.reply(this._("No contact matches your search."));
                // straight up ask for the target category
                // this ensures we show a contact picker, which is better than
                // repeatedly asking the user
                return this.ask(this.category, this._("Who do you want to contact?"));
            }

            if (result.length === 1) {
                this.resolved = this._makeValue(result[0].value);
                return false;
            }

            this._model = this.manager.ml.getModel('choose-contact', 'softmax', this._featurizeContact.bind(this), INITIAL_SCORING_MODEL);
            var scored = this._model.scoreAll(result);

            // apply the usual scoring heuristics
            var prob = scored[0].prob;
            var top = scored[0].ex;
            var choice = null;
            var fallbacks = null;

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

            if (choice !== null) {
                this.resolved = this._makeValue(choice);
                return false;
            }

            this.ask(ValueCategory.MultipleChoice, this._("Multiple contacts match “%s”. Who do you mean?").format(this.contact));
            this.choices = fallbacks;
            fallbacks.forEach(function(c, i) {
                this.replyChoice(i, 'contact', c.displayName, c.value);
            }, this);
            return true;
        });
    }

    _learn(chosen) {
        if (!this._model)
            return;

        this._model.learn(this.choices, chosen);
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.expecting === ValueCategory.MultipleChoice) {
                var index = command.value;
                if (index !== Math.floor(index) ||
                    index < 0 ||
                    index >= this.choices.length) {
                    this.reply(this._("Please click on one of the provided choices."));
                    return true;
                } else {
                    this._learn(this.choices[index]);
                    this.resolved = this._makeValue(this.choices[index]);
                    return false;
                }
            }

            return false;
        });
    }
}
