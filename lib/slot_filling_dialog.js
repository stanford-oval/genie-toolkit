// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const assert = require('assert');
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
    constructor(prim, scope) {
        super();

        this.prim = prim;
        this._scope = scope;
        this.toFill = [];
        this.toConcretize = [];

        this.icon = Helpers.getIcon(prim);
        this._resolving = null;
        this._paring = false;
        this._options = null;
        this._aux = null;

        for (let inParam of prim.in_params.concat(prim.filters)) {
            if (inParam.value.isUndefined && inParam.value.local)
                this.toFill.push(inParam);
            if (inParam.value.isEntity &&
                (inParam.value.type === 'tt:contact' && !inParam.value.display) ||
                inParam.value.type === 'tt:contact_name')
                this.toConcretize.push(inParam);
            if (inParam.value.isLocation && inParam.value.value.isRelative)
                this.toConcretize.push(inParam);
        }
    }

    _complete() {
        // make out parameters available in the "scope", which puts
        // them as possible options for a later slot fill
        for (let outParam of this.prim.out_params) {
            let argname = outParam.value;
            let schema = this.prim.schema;
            let index = schema.index[argname];
            let argcanonical = schema.argcanonicals[index] || argname;
            this._scope[outParam.name] = {
                value: Ast.Value.VarRef(outParam.name),
                type: schema.out[argname],
                text: this._("Use the %s from %s").format(argcanonical, this.prim.selector.kind)
            };
        }
        this._scope['$event'] = {
            value: Ast.Value.Event(null),
            type: Type.String,
            text: this._("A description of the result")
        };
    }

    static slotFill(parent, prim, scope) {
        // if we get here, either we never pushed the SlotFillingDialog,
        // or the SlotFillingDialog returned false from .handle(), which
        // implies it is done
        if (parent.subdialog === null) {
            parent.push(new SlotFillingDialog(prim, scope));
            return Q(parent.subdialog.continue()).then((waiting) => {
                if (waiting) {
                    return waiting;
                } else {
                    parent.subdialog._complete();
                    parent.pop();
                    return false;
                }
            });
        } else {
            parent.subdialog._complete();
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
            if (addressBookContact)
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

    _getType(slot) {
        let argname = slot.name;
        let schema = this.prim.schema;
        if (schema.inReq[argname])
            return schema.inReq[argname];
        if (schema.inOpt[argname])
            return schema.inOpt[argname];
        var type = schema.out[argname];
        if (slot instanceof Ast.Filter && slot.operator === 'contains')
            return type.elem;
        else
            return type;
    }

    _getQuestion(slot) {
        let question;
        let argname = slot.name;
        let schema = this.prim.schema;
        let index = schema.index[argname];
        if (slot instanceof Ast.InputParam ||
            (slot instanceof Ast.Filter && slot.operator === '='))
            question = schema.questions[index];
        let argcanonical = schema.argcanonicals[index];
        if (!question)
            return this._("What is the value of %s?").format(argcanonical);
        else
            return question;
    }

    _concretize(slot) {
        var value = slot.value;
        if (value.isEntity && value.type === 'tt:contact' && !value.display)
            return this._lookupContact(value);
        if (value.isEntity && value.type === 'tt:contact_name')
            return ContactSearchDialog.resolve(this, this._getType(slot), slot);
        if (value.isLocation && value.value.isRelative)
            return UserContextDialog.resolve(this, slot, '$context.location.' + value.value.relativeTag);
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

    _getOptions(slot, slotType) {
        let options = [];
        for (var vname in this._scope) {
            let option = this._scope[vname];
            if (Type.isAssignable(option.type, slotType))
                options.push(option);
        }
        return options;
    }

    continue() {
        if (this.toConcretize.length > 0) {
            this._resolving = this.toConcretize.shift();

            return this._concretize(this._resolving).then((waiting) => {
                if (waiting)
                    return waiting;
                else
                    this._resolving = null;
                    return this.continue();
            });
        }

        if (this._resolving === null && this.toFill.length > 0)
            this._resolving = this.toFill.shift();
        if (this._resolving === null)
            return false;

        let slot = this._resolving;
        let question = this._getQuestion(slot);
        let slotType = this._getType(slot);

        let options = this._getOptions(slot, slotType);
        if (!this._paring && options.length > 0) {
            this._paring = true;
            this._options = options;
            if (options.length > 0) {
                this.ask(ValueCategory.MultipleChoice, question);
                for (var i = 0; i < options.length; i++) {
                    this.replyChoice(i, "arg", options[i].text);
                }
                this.replyChoice(i, "arg", this._("None of above"));
                return true;
            }
        }

        this._paring = false;

        if (slotType.isEntity && slotType.type === 'tt:phone_number')
            return this.ask(ValueCategory.PhoneNumber, question);
        else if (slotType.isEntity && slotType.type === 'tt:email_address')
            return this.ask(ValueCategory.EmailAddress, question);
        else if (slotType.isEntity && slotType.type === 'tt:picture')
            return this.ask(ValueCategory.Picture, question);
        else if (slotType.isEntity && slotType.type === 'tt:contact')
            return this.ask(ValueCategory.PhoneNumber, question);
        else if (slotType.isString || slotType.isEntity)
            return this.ask(ValueCategory.RawString, question);
        else if (slotType.isMeasure)
            return this.ask(ValueCategory.Measure(slotType.unit), question);
        else if (slotType.isNumber)
            return this.ask(ValueCategory.Number, question);
        else if (slotType.isBoolean)
            return this.ask(ValueCategory.YesNo, question);
        else if (slotType.isDate)
            return this.ask(ValueCategory.Date, question);
        else if (slotType.isTime)
            return this.ask(ValueCategory.Time, question);
        else if (slotType.isLocation)
            return this.ask(ValueCategory.Location, question);
        else if (slotType.isEnum)
            return this._askEnum(slotType.entries, question);
        else
            throw new TypeError('Unhandled slot type ' + slotType); // can't handle it
    }

    handleRaw(raw) {
        if (this._resolving !== null &&
            this.expecting === ValueCategory.RawString) {
            var slotType = this._getType(this._resolving);
            if (slotType.isEntity)
                this._resolving.value = Ast.Value.Entity(raw, slotType.type, null);
            else
                this._resolving.value = Ast.Value.String(raw);
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

            if (this._resolving === null)
                return this.continue();

            if (this.expecting === ValueCategory.YesNo) {
                if (command.isYes)
                    this._resolving.value = Ast.Value.Boolean(true);
                else
                    this._resolving.value = Ast.Value.Boolean(false);
            } else if (this.expecting !== null) {
                if (this._paring === true) {
                    var index = command.value;
                    if (index !== Math.floor(index) ||
                        index < 0 ||
                        index > this._options.length) {
                        this.reply(this._("Please click on one of the provided choices."));
                        this.manager.resendChoices();
                        return true;
                    }

                    if (index === this._options.length) {
                        return this.continue();
                    } else {
                        this._resolving.value = this._options[index].value;
                        this._options = null;
                        this._paring = false;
                    }
                } else {
                    let value;
                    if (this.expecting === ValueCategory.MultipleChoice) {
                        var index = command.value;
                        if (index !== Math.floor(index) ||
                            index < 0 ||
                            index >= this._aux.length) {
                            this.reply(this._("Please click on one of the provided choices."));
                            this.manager.resendChoices();
                            return true;
                        }

                        value = this._aux[index];
                        this._aux = null;
                    } else {
                        value = command.value;

                        // for a tt:contact entity we ask for a phone number
                        // convert it back to tt:contact before we type check
                        // or we'll explode
                        if (value.isEntity && value.type === 'tt:contact') {
                            value = Ast.Value.Entity('phone:' + value.value, 'tt:contact', command.value.display);
                        }
                    }
                    var givenType = Ast.typeForValue(value);
                    assert(Type.isAssignable(givenType, this._getType(this._resolving)));
                    this._resolving.value = value;
                }
            }

            return this._concretize(this._resolving).then((waiting) => {
                if (waiting) {
                    return waiting;
                } else {
                    this._resolving = null;
                    return this.continue();
                }
            });
        });
    }
}
