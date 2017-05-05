// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
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
        if (type) {
            if (!type.isEntity)
                throw new TypeError('Invalid contact type ' + type);
            this.category = type.type === 'tt:phone_number' ? ValueCategory.PhoneNumber : ValueCategory.EmailAddress;
        } else {
            this.category = ValueCategory.Contact;
        }
        this.resolved = null;
        this.choices = null;

        this._model = null;
    }

    static resolve(parent, type, values, index) {
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

    _lookupMessaging() {
        return this.manager.messaging.searchAccountByName(this.contact).then((accounts) => {
            return accounts.map((a) => {
                return {
                    value: this.manager.messaging.type + '-account:' + a.account,
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

    _lookupContact() {
        var contactApi = this.manager.platform.getCapability('contacts');
        if (contactApi === null) {
            if (this.category !== ValueCategory.Contact)
                return null;
            var messaging = this.manager.messaging;
            if (!messaging.isAvailable)
                return null;

            return this._lookupMessaging();
        }

        var what;
        if (this.category === ValueCategory.PhoneNumber)
            what = 'phone_number';
        else if (this.category === ValueCategory.EmailAddress)
            what = 'email_address';
        else
            what = 'contact';
        return contactApi.lookup(what, this.contact);
    }

    _makeValue(choice) {
        return Q.try(() => {
            if (this.category === ValueCategory.Contact) {
                var messaging = this.manager.messaging;
                if (!messaging.isAvailable || choice.value.startsWith(messaging.type + '-account:'))
                    return Q(Ast.Value.Entity(choice.value, 'tt:contact'));

                return messaging.getAccountForIdentity(choice.value).then((account) => {
                    if (account) {
                        var accountPrincipal = messaging.type + '-account:' + account;
                        console.log('Converted ' + choice.value + ' to ' + accountPrincipal);
                        return Q(Ast.Value.Entity(accountPrincipal, 'tt:contact'));
                    } else {
                        return Q(Ast.Value.Entity(choice.value, 'tt:contact'));
                    }
                });
            }

            if (this.category === ValueCategory.PhoneNumber)
                return Ast.Value.Entity(choice.value, 'tt:phone_number');
            else if (this.category === ValueCategory.EmailAddress)
                return Ast.Value.Entity(choice.value, 'tt:email_address');
            else
                return Ast.Value.Entity(choice.value, 'tt:contact');
        }).then((value) => {
            value.display = choice.displayName;
            return value;
        });
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
                return this.ask(this.category === ValueCategory.Contact ? ValueCategory.PhoneNumber : this.category,
                    this._("Who do you want to contact?"));
            }

            if (result.length === 1) {
                return this._makeValue(result[0]).then((value) => {
                    this.resolved = value;
                    return false;
                });
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
                return this._makeValue(choice).then((value) => {
                    this.resolved = value;
                    return false;
                });
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
                    return this._makeValue(this.choices[index]).then((value) => {
                        this.resolved = value;
                        return false;
                    });
                }
            } else {
                var contact = {
                    value: command.value.value,
                    displayName: command.value.display
                };
                // FIXME this._learn(contact);

                if (this.category === ValueCategory.Contact)
                    contact.value = 'phone:' + contact.value;
                return this._makeValue(contact).then((value) => {
                    this.resolved = value;
                    return false;
                });
            }

            return false;
        });
    }
}
