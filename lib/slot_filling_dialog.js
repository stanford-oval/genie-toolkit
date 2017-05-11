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
const Type = ThingTalk.Type;

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');
const ContactSearchDialog = require('./contact_search_dialog');
const UserContextDialog = require('./user_context_dialog');
const Helpers = require('./helpers');

module.exports = class SlotFillingDialog extends Dialog {
    constructor(slots, prefilled, fillAll, mustFill, scope, icon, options) {
        super();

        this.slots = slots;
        this.values = new Array(slots.length);
        this.comparisons = [];
        this.toFill = [];
        this.toConcretize = [];
        this.options = options || null;
        this.idx = null;

        this.icon = icon;
        this._resolving = null;
        this._paring = false;
        this._aux = null;

        ThingTalk.Generate.assignSlots(slots, prefilled, this.values, this.comparisons, fillAll, mustFill, scope, this.toFill);

        for (var i = 0; i < this.values.length; i++) {
            if (this.values[i] !== undefined &&
                (this.values[i].isVarRef ||
                (this.values[i].isEntity && this.values[i].type === 'tt:contact' && !this.values[i].display)))
                this.toConcretize.push(i);
        }
    }

    static slotFill(parent, obj, fillAll, mustFill, scope, options) {
        if (obj.resolved_args !== null)
            return Q(false);

        // if we get here, either we never pushed the SlotFillingDialog,
        // or the SlotFillingDialog returned false from .handle(), which
        // implies it is done
        if (parent.subdialog === null) {
            // make up slots
            var slots = obj.schema.schema.map(function(type, i) {
                return { name: obj.schema.args[i],
                         canonical: obj.schema.argcanonicals[i],
                         type: type,
                         question: obj.schema.questions[i],
                         required: (obj.schema.required[i] || false) };
            });
            delete obj.schema.options;
            var icon = Helpers.getIcon(obj);
            parent.push(new SlotFillingDialog(slots, obj.args, fillAll, mustFill, scope, icon, options));
            return Q(parent.subdialog.continue()).then((waiting) => {
                if (waiting) {
                    return waiting;
                } else {
                    obj.resolved_args = parent.subdialog.values;
                    obj.resolved_conditions = parent.subdialog.comparisons;
                    parent.pop();
                    return false;
                }
            });
        } else {
            obj.resolved_args = parent.subdialog.values;
            obj.resolved_conditions = parent.subdialog.comparisons;
            parent.pop();
            return Q(false);
        }
    }

    _lookupContactByAccount(contact, account) {
        return this.manager.messaging.getUserByAccount(account).then((user) => {
            contact.display = user.name;
        }).catch((e) => {
            console.log('Failed to lookup account ' + account + ': ' + e.message);
        }).then(() => false);
    }

    _addDisplayToContact(contact) {
        if (contact.display)
            return Q();

        var contactApi = this.manager.platform.getCapability('contacts');
        if (contactApi === null)
            return Q();

        var principal = contact.value;
        return contactApi.lookupPrincipal(principal).then((addressBookContact) => {
            contact.display = addressBookContact.displayName;
        });
    }

    _lookupContact(contact) {
        var principal = contact.value;
        if (principal.startsWith(this.manager.messaging.type + '-account:'))
            return this._lookupContactByAccount(contact, principal.substr((this.manager.messaging.type + '-account:').length));

        return this._addDisplayToContact(contact).then(() => {
            return this.manager.messaging.getAccountForIdentity(principal);
        }).then((account) => {
            if (account) {
                var accountPrincipal = this.manager.messaging.type + '-account:' + account;
                console.log('Converted ' + contact.value + ' to ' + accountPrincipal);
                contact.value = accountPrincipal;
            }
            return false;
        }).catch((e) => {
            console.log('Failed to concretize contact: ' + e.message);
            return false;
        });
    }

    _concretize(index) {
        var value = this.values[index];
        if (value === undefined)
            return Q(false);
        if (value.isEntity && value.type === 'tt:contact')
            return this._lookupContact(value);
        if (!value.isVarRef)
            return Q(false);

        var name = value.name;
        if (name.startsWith('$contact('))
            return ContactSearchDialog.resolve(this, this.slots[index].type, this.values, index);
        else if (name.startsWith('$context'))
            return UserContextDialog.resolve(this, this.values, index);
        else
            return Q(false);
    }

    _askEnum(entries, question) {
        this._aux = entries.map((e) => Ast.Value.Enum(e));
        this.ask(ValueCategory.MultipleChoice, question);
        entries.forEach((e, i) => {
            this.replyChoice(i, "choice", e);
        });
        return true;
    }

    continue() {
        if (this.toConcretize.length > 0) {
            var idx = this.toConcretize.shift();
            this._resolving = idx;

            return this._concretize(idx).then((waiting) => {
                if (waiting)
                    return waiting;
                else
                    return this.continue();
            });
        }

        if (this.idx !== null || this.toFill.length > 0) {
            if (this.idx !== null)
                var idx = this.idx;
            else
                var idx = this.toFill.shift();
            this._resolving = idx;

            var param = this.slots[idx];
            var question = param.question || (this._("What is the value of %s?").format(param.name));

            var option = null;
            if (this._paring === false && this.options !== null && idx < this.options.length) {
                this._paring = true;
                this.idx = idx;
                option = this.options[idx];
                if (option.length > 0) {
                    this.ask(ValueCategory.MultipleChoice, question);
                    for (var i = 0; i < option.length; i++) {
                        this.replyChoice(i, "arg", option[i].text);
                    }
                    this.replyChoice(i, "arg", "None of above");
                    return true;
                }
            }

            this._paring = false;
            this.idx = null;

            if (param.type.isEntity && param.type.type === 'tt:phone_number')
                return this.ask(ValueCategory.PhoneNumber, question);
            else if (param.type.isEntity && param.type.type === 'tt:email_address')
                return this.ask(ValueCategory.EmailAddress, question);
            else if (param.type.isEntity && param.type.type === 'tt:picture')
                return this.ask(ValueCategory.Picture, question);
            else if (param.type.isEntity && param.type.type === 'tt:contact')
                return this.ask(ValueCategory.PhoneNumber, question);
            else if (param.type.isString || param.type.isEntity)
                return this.ask(ValueCategory.RawString, question);
            else if (param.type.isMeasure)
                return this.ask(ValueCategory.Measure(param.type.unit), question);
            else if (param.type.isNumber)
                return this.ask(ValueCategory.Number, question);
            else if (param.type.isBoolean)
                return this.ask(ValueCategory.YesNo, question);
            else if (param.type.isDate)
                return this.ask(ValueCategory.Date, question);
            else if (param.type.isTime)
                return this.ask(ValueCategory.Time, question);
            else if (param.type.isLocation)
                return this.ask(ValueCategory.Location, question);
            else if (param.type.isEnum)
                return this._askEnum(param.type.entries, question);
            else
                throw new TypeError(); // can't handle it
        } else {
            return false;
        }
    }

    handleRaw(raw) {
        if (this._resolving !== null &&
            this.expecting === ValueCategory.RawString) {
            this.values[this._resolving] = Ast.Value.String(raw);
            this._resolving = null;
            return this.continue();
        } else {
            return super.handleRaw(raw);
        }
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this._resolving !== null) {
                if (this.expecting === ValueCategory.YesNo) {
                    if (command.isYes)
                        this.values[this._resolving] = Ast.Value.Boolean(true);
                    else
                        this.values[this._resolving] = Ast.Value.Boolean(false);
                    this._resolving = null;
                    return this.continue();
                } else {
                    if (this.expecting !== null) {
                        var value;
                        if (this._paring === true) {
                            var index = command.value;
                            if (index !== Math.floor(index) ||
                                index < 0 ||
                                index > this.options[this.idx].length) {
                                this.reply(this._("Please click on one of the provided choices."));
                                this._paring = false;
                                return this.continue();
                            } else if (index === this.options[this.idx].length) {
                                return this.continue();
                            } else {


                                this.values[this._resolving] = Ast.Value.VarRef(this.options[this.idx][index].value);
                                this.idx = null;
                                this._paring = false;
                                return this.continue();
                            }
                        } else {
                            if (this.expecting === ValueCategory.MultipleChoice) {
                                var index = command.value;
                                if (index !== Math.floor(index) ||
                                    index < 0 ||
                                    index >= this._aux.length) {
                                    this.reply(this._("Please click on one of the provided choices."));
                                    return true;
                                } else {
                                    value = this._aux[index];
                                }
                            } else {
                                value = command.value;
                                if (this.slots[this._resolving].type.isEntity && this.slots[this._resolving].type.type === 'tt:contact') {
                                    value = Ast.Value.Entity('phone:' + value.value, 'tt:contact');
                                    value.display = command.value.display;
                                }
                            }
                            var givenType = Ast.typeForValue(value);
                            Type.typeUnify(this.slots[this._resolving].type, givenType);
                            this.values[this._resolving] = value;
                        }
                        this._aux = null;
                    }

                    return this._concretize(this._resolving).then((waiting) => {
                        if (waiting) {
                            return waiting;
                        } else {
                            this._resolving = null;
                            return this.continue();
                        }
                    });
                }
            } else {
                return this.continue();
            }
        });
    }
}
