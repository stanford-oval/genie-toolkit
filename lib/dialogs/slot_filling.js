// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const Generate = ThingTalk.Generate;
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const contactSearch = require('./contact_search');
const resolveUserContext = require('./user_context');

function lookupContactByAccount(dlg, contact, account) {
    return dlg.manager.messaging.getUserByAccount(account).then((user) => {
        contact.display = user.name;
    }).catch((e) => {
        console.log('Failed to lookup account ' + account + ': ' + e.message);
    }).then(() => false);
}

function addDisplayToContact(dlg, contact) {
    if (contact.display)
        return Q();

    var contactApi = dlg.manager.platform.getCapability('contacts');
    if (contactApi === null)
        return Q();

    var principal = contact.value;
    return contactApi.lookupPrincipal(principal).then((addressBookContact) => {
        if (addressBookContact)
            contact.display = addressBookContact.displayName;
    });
}

function lookupContact(dlg, contact) {
    let principal = contact.value;
    if (principal.startsWith(dlg.manager.messaging.type + '-account:')) {
        if (principal === dlg.manager.messaging.type + '-account:' + dlg.manager.messaging.account)
            return contact.display = dlg._("me");

        return lookupContactByAccount(dlg, contact, principal.substr((dlg.manager.messaging.type + '-account:').length));
    }

    return addDisplayToContact(dlg, contact).then(() => {
        return dlg.manager.messaging.getAccountForIdentity(principal);
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

function* slotFillSingle(dlg, slotType, question) {
    if (slotType.isEntity && slotType.type === 'tt:phone_number')
        return yield dlg.ask(ValueCategory.PhoneNumber, question);
    else if (slotType.isEntity && slotType.type === 'tt:email_address')
        return yield dlg.ask(ValueCategory.EmailAddress, question);
    else if (slotType.isEntity && slotType.type === 'tt:picture')
        return yield dlg.ask(ValueCategory.Picture, question);
    else if (slotType.isEntity && slotType.type === 'tt:contact')
        return yield dlg.ask(ValueCategory.PhoneNumber, question);
    else if (slotType.isString || slotType.isEntity)
        return yield dlg.ask(ValueCategory.RawString, question);
    else if (slotType.isMeasure)
        return yield dlg.ask(ValueCategory.Measure(slotType.unit), question);
    else if (slotType.isNumber)
        return yield dlg.ask(ValueCategory.Number, question);
    else if (slotType.isBoolean)
        return Ast.Value.Boolean(yield dlg.ask(ValueCategory.YesNo, question));
    else if (slotType.isDate)
        return yield dlg.ask(ValueCategory.Date, question);
    else if (slotType.isTime)
        return yield dlg.ask(ValueCategory.Time, question);
    else if (slotType.isLocation)
        return yield dlg.ask(ValueCategory.Location, question);
    else if (slotType.isEnum)
        return Ast.Value.Enum(slotType.entries[yield dlg.askChoices(question, slotType.entries)]);
    else
        throw new TypeError('Unhandled slot type ' + slotType);
}

const HAS_SCOPE = false; // TODO

function* slotFillPrimitive(dlg, prim, scope) {
    dlg.icon = Helpers.getIcon(prim);

    let [toFill, toConcretize] = ThingTalk.Generate.computeSlots(prim);

    function getType(slot) {
        let argname = slot.name;
        let schema = prim.schema;
        let type = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];
        if (slot instanceof Ast.Filter && slot.operator === 'contains')
            return type.elem;
        else
            return type;
    }
    function getQuestion(slot) {
        let question;
        let argname = slot.name;
        let schema = prim.schema;
        let index = schema.index[argname];
        if (slot instanceof Ast.InputParam ||
            (slot instanceof Ast.Filter && slot.operator === '='))
            question = schema.questions[index];
        let argcanonical = schema.argcanonicals[index];
        if (!question)
            return dlg._("What is the value of %s?").format(argcanonical);
        else
            return question;
    }
    function getOptions(slot, slotType) {
        let options = [];
        for (var vname in scope) {
            let option = scope[vname];
            if (Type.isAssignable(option.type, slotType))
                options.push(option);
        }
        return options;
    }

    for (let slot of toConcretize) {
        var value = slot.value;
        if (value.isEntity && value.type === 'tt:contact' && !value.display)
            yield lookupContact(dlg, value);
        if (value.isEntity && value.type === 'tt:contact_name')
            slot.value = yield* contactSearch(dlg, getType(slot), value.value);
        if (value.isLocation && value.value.isRelative)
            slot.value = yield* resolveUserContext(dlg, '$context.location.' + value.value.relativeTag);
        if (slot.value === null)
            return false;
    }

    for (let slot of toFill) {
        let question = getQuestion(slot);
        let slotType = getType(slot);

        let options = getOptions(slot, slotType);
        if (options.length > 0) {
            let choice = yield dlg.askChoices(question,
                options.map((o) => o.text).concat(dlg._("None of above")));

            if (choice !== options.length) {
                slot.value = options[choice].value;
                continue;
            }
        }

        slot.value = yield* slotFillSingle(dlg, slotType, question);
        let value = slot.value;
        if (value.isEntity && value.type === 'tt:contact' && !value.display)
            yield lookupContact(dlg, value);
        if (value.isEntity && value.type === 'tt:contact_name')
            slot.value = yield* contactSearch(dlg, getType(slot), value.value);
        if (value.isLocation && value.value.isRelative)
            slot.value = yield* resolveUserContext(dlg, '$context.location.' + value.value.relativeTag);
        if (slot.value === null)
            return false;
    }

    if (HAS_SCOPE) {
        // make out parameters available in the "scope", which puts
        // them as possible options for a later slot fill
        for (let outParam of prim.out_params) {
            let argname = outParam.value;
            let schema = prim.schema;
            let index = schema.index[argname];
            let argcanonical = schema.argcanonicals[index] || argname;
            scope[outParam.name] = {
                value: Ast.Value.VarRef(outParam.name),
                type: schema.out[argname],
                text: dlg._("Use the %s from %s").format(argcanonical, prim.selector.kind)
            };
        }
        scope['$event'] = {
            value: Ast.Value.Event(null),
            type: Type.String,
            text: dlg._("A description of the result")
        };
    }

    return true;
}

module.exports = {
    slotFillPrimitive,
    slotFillSingle
} 
