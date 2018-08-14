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
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const { contactSearch } = require('./contact_search');
const resolveUserContext = require('./user_context');
const { chooseDevice } = require('./device_choice');
const { lookupEntity } = require('./entity_lookup');

async function addDisplayToContact(dlg, contact) {
    if (contact.display)
        return;

    const principal = contact.value;
    if (principal.startsWith(dlg.manager.messaging.type + '-account:')) {
        if (principal === dlg.manager.messaging.type + '-account:' + dlg.manager.messaging.account) {
            contact.display = dlg._("me");
            return;
        }

        const account = principal.substr((dlg.manager.messaging.type + '-account:').length);
        try {
            const user = await dlg.manager.messaging.getUserByAccount(account);
            contact.display = user.name;
        } catch (e) {
            console.log('Failed to lookup account ' + account + ': ' + e.message);
        }
    } else {
        const contactApi = dlg.manager.platform.getCapability('contacts');
        if (contactApi === null)
            return;

        const addressBookContact = await contactApi.lookupPrincipal(principal);
        if (addressBookContact)
            contact.display = addressBookContact.displayName;
    }
}

async function lookupContact(dlg, contact) {
    await addDisplayToContact(dlg, contact);

    let principal = contact.value;
    if (principal.startsWith(dlg.manager.messaging.type + '-account:'))
        return true;

    try {
        const account = await dlg.manager.messaging.getAccountForIdentity(principal);
        if (account) {
            var accountPrincipal = dlg.manager.messaging.type + '-account:' + account;
            console.log('Converted ' + contact.value + ' to ' + accountPrincipal);
            contact.value = accountPrincipal;
            return true;
        } else {
            dlg.reply(dlg._("Cannot find a messaging account for %s.").format(contact.display || principal));
            return false;
        }
    } catch(e) {
        console.log('Failed to concretize contact: ' + e.message);
        // bubble the error up so it is shown to the user
        throw e;
    }
}

async function slotFillArray(dlg, elementType, question) {
    const values = [];
    do {
        values.push(await slotFillCustom(dlg, elementType, question));

        dlg.reply(dlg._("You chose %s.").format(
            values.map((v) => Describe.describeArg(dlg.manager.gettext, v)).join(', ')));
    } while (await dlg.ask(ValueCategory.YesNo, dlg._("Would you like to add more elements to the list?")));

    return Ast.Value.Array(values);
}

function convertToSlotType(value, slotType) {
    if (value.isVarRef)
        return value;

    if (slotType.equals(value.getType()))
        return value;

    if (slotType.isEntity && value.isString)
        return new Ast.Value.Entity(value.value, slotType.type, null);

    return value;
}

async function slotFillCustomRaw(dlg, slotType, question) {
    if (slotType.isArray)
        return await slotFillArray(dlg, slotType.elem, question);
    else if (slotType.isEntity && slotType.type === 'tt:phone_number')
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

async function slotFillCustom(dlg, slotType, question) {
    return convertToSlotType(await slotFillCustomRaw(dlg, slotType, question), slotType);
}

async function concretizeValue(dlg, slot, ptype) {
    let value = slot.value;

    if (value.isEntity && (value.type === 'tt:username' || value.type === 'tt:contact_name')
        && ptype.isEntity && ptype.type !== value.type) {
        slot.value = await contactSearch(dlg, ptype, value.value);
        value = slot.value;
        if (value === null)
            return false;
    }
    if (value.isEntity && value.type === 'tt:contact') {
        let ok = await lookupContact(dlg, value);
        if (!ok)
            return false;
    } else if (value.isLocation && value.value.isRelative) {
        slot.value = await resolveUserContext(dlg, '$context.location.' + value.value.relativeTag);
    } else if (value.isEntity && value.value === null) {
        const resolved = await lookupEntity(dlg, value.type, value.display);
        if (resolved === null)
            return false;
        value.value = resolved.value;
        value.display = resolved.name;
    }

    if (slot.value === null)
        return false;

    return true;
}

async function slotFillSingle(dlg, kind, schema, slot, scope) {
    function getOptions(slot, slotType) {
        let options = [];
        for (var vname in scope) {
            let option = scope[vname];
            if (Type.isAssignable(option.type, slotType)) {
                if (option.value.isVarRef && option.value.name === slot.name &&
                    option.kind === kind)
                    continue;
                options.push(option);
            }
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
    return concretizeValue(dlg, slot, slotType);
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

    return concretizeValue(dlg, slot, getType(slot));
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

        let kind;
        if (prim && prim.selector)
            kind = prim.selector.kind;
        else if (prim && prim.kind)
            kind = prim.kind;
        else
            kind = null;

        let ok = true;
        if (slot.value.isUndefined && slot.value.local)
            ok = await slotFillSingle(dlg, kind, schema, slot, scope);
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
        if (program.principal !== null) {
            let holder = { value: program.principal };
            let ok = await concretizeValue(dlg, holder, Type.Entity('tt:contact'));
            if (!ok)
                return false;
            program.principal = holder.value;
        }

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
                let ok = await concretizeValue(dlg, slot, Type.Entity('tt:contact'));
                if (!ok)
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
    slotFillProgram,
    concretizeValue,
    addDisplayToContact
};