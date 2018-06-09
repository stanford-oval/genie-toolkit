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

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const { contactSearch } = require('./contact_search');
const resolveUserContext = require('./user_context');
const { chooseDevice } = require('./device_choice');

function lookupContactByAccount(dlg, contact, account) {
    return dlg.manager.messaging.getUserByAccount(account).then((user) => {
        contact.display = user.name;
    }).catch((e) => {
        console.log('Failed to lookup account ' + account + ': ' + e.message);
    }).then(() => false);
}

function addDisplayToContact(dlg, contact) {
    if (contact.display)
        return Promise.resolve();

    var contactApi = dlg.manager.platform.getCapability('contacts');
    if (contactApi === null)
        return Promise.resolve();

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

async function slotFillCustom(dlg, slotType, question) {
    if (slotType.isEntity && slotType.type === 'tt:phone_number')
        return await dlg.ask(ValueCategory.PhoneNumber, question);
    else if (slotType.isEntity && slotType.type === 'tt:email_address')
        return await dlg.ask(ValueCategory.EmailAddress, question);
    else if (slotType.isEntity && slotType.type === 'tt:picture')
        return await dlg.ask(ValueCategory.Picture, question);
    else if (slotType.isEntity && slotType.type === 'tt:contact')
        return await dlg.ask(ValueCategory.PhoneNumber, question);
    else if (slotType.isString || slotType.isEntity)
        return await dlg.ask(ValueCategory.RawString, question);
    else if (slotType.isMeasure)
        return await dlg.ask(ValueCategory.Measure(slotType.unit), question);
    else if (slotType.isNumber)
        return await dlg.ask(ValueCategory.Number, question);
    else if (slotType.isBoolean)
        return Ast.Value.Boolean(await dlg.ask(ValueCategory.YesNo, question));
    else if (slotType.isDate)
        return await dlg.ask(ValueCategory.Date, question);
    else if (slotType.isTime)
        return await dlg.ask(ValueCategory.Time, question);
    else if (slotType.isLocation)
        return await dlg.ask(ValueCategory.Location, question);
    else if (slotType.isEnum)
        return Ast.Value.Enum(slotType.entries[await dlg.askChoices(question, slotType.entries)]);
    else
        throw new TypeError('Unhandled slot type ' + slotType);
}

async function slotFillSingle(dlg, schema, slot, scope) {
    function getOptions(slot, slotType) {
        let options = [];
        for (var vname in scope) {
            let option = scope[vname];
            if (Type.isAssignable(option.type, slotType))
                options.push(option);
        }
        return options;
    }
    function getType(slot) {
        let argname = slot.name;
        let type = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];
        if (slot instanceof Ast.BooleanExpression && slot.operator === 'contains')
            return type.elem;
        else
            return type;
    }
    function getQuestion(slot) {
        let question;
        let argname = slot.name;
        let index = schema.index[argname];
        if (slot instanceof Ast.InputParam ||
            (slot instanceof Ast.BooleanExpression && slot.operator === '=='))
            question = schema.questions[index];
        let argcanonical = schema.argcanonicals[index];
        if (!question)
            return dlg._("What is the value of the filter on the %s?").format(argcanonical);
        else
            return question;
    }

    let question = getQuestion(slot);
    let slotType = getType(slot);

    let options = getOptions(slot, slotType);
    if (options.length > 0) {
        let choices = options.map((o) => {
            if (o.value.isEvent)
                return dlg._("A description of the result");
            else
                return dlg._("Use the %s from %s").format(o.argcanonical, Helpers.cleanKind(o.kind));
        });
        choices.push(dlg._("None of above"));

        let choice = await dlg.askChoices(question, choices);

        if (choice !== options.length) {
            slot.value = options[choice].value;
            return true;
        }
    }

    slot.value = await slotFillCustom(dlg, slotType, question);
    let value = slot.value;
    if (value.isEntity && value.type === 'tt:contact' && !value.display)
        await lookupContact(dlg, value);
    if (value.isEntity && value.type === 'tt:contact_name')
        slot.value = await contactSearch(dlg, getType(slot), value.value);
    if (value.isLocation && value.value.isRelative)
        slot.value = await resolveUserContext(dlg, '$context.location.' + value.value.relativeTag);
    if (slot.value === null)
        return false;

    return true;
}

async function concretizeSingleSlot(dlg, schema, slot) {
    function getType(slot) {
        let argname = slot.name;
        let type = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];
        if (slot instanceof Ast.BooleanExpression && slot.operator === 'contains')
            return type.elem;
        else
            return type;
    }

    var value = slot.value;
    if (value.isEntity && value.type === 'tt:contact' && !value.display)
        await lookupContact(dlg, value);
    let ptype = getType(slot);
    if (value.isEntity && value.type === 'tt:username' && ptype.type !== value.type)
        slot.value = await contactSearch(dlg, ptype, value.value);
    if (value.isLocation && value.value.isRelative)
        slot.value = await resolveUserContext(dlg, '$context.location.' + value.value.relativeTag);
    if (slot.value === null)
        return false;
    return true;
}

async function doOneSlot(dlg, schema, slot, prim, scope, setupProgram) {
    if (slot instanceof Ast.Selector) {
        if (setupProgram)
            return true;
        let ok = await chooseDevice(dlg, prim.selector);
        if (!ok)
            return false;
    } else {
        dlg.icon = Helpers.getIcon(prim);

        let ok = true;
        if (slot.value.isUndefined && slot.value.local)
            ok = await slotFillSingle(dlg, schema, slot, scope);
        else
            ok = await concretizeSingleSlot(dlg, schema, slot);
        if (!ok)
            return false;
    }
    return true;
}

async function slotFillProgram(dlg, program) {
    if (program instanceof Ast.Program) {
        const setupProgram = program.principal !== null;

        for (let [schema, slot, prim, scope] of program.iterateSlots()) {
            let ok = await doOneSlot(dlg, schema, slot, prim, scope, setupProgram);
            if (!ok)
                return false;
        }
    } else {
        assert(program.isPermissionRule);

        for (let [schema, slot, prim, scope] of program.principal.iterateSlots(null, null, {})) {
            if (prim) {
                let ok = await doOneSlot(dlg, schema, slot, prim, scope);
                if (!ok)
                    return false;
            } else {
                if (slot.value.isEntity && slot.value.type === 'tt:username')
                    slot.value = await contactSearch(dlg, Type.Entity('tt:contact'), slot.value.value);
                if (!slot.value)
                    return false;
            }
        }
        for (let what of [program.query, program.action]) {
            if (!what.isSpecified)
                continue;
            for (let [schema, slot, prim, scope] of what.filter.iterateSlots(what.schema, what, {})) {
                let ok = await doOneSlot(dlg, schema, slot, prim, scope);
                if (!ok)
                    return false;
            }
        }
    }

    return true;
}

module.exports = {
    slotFillCustom,
    slotFillProgram
};