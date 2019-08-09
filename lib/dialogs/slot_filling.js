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
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const { contactSearch } = require('./contact_search');
const resolveUserContext = require('./user_context');
const { chooseDevice } = require('./device_choice');
const { lookupEntity, lookupLocation } = require('./entity_lookup');

const MESSAGING_ACCOUNT_REGEX = /^[A-Za-z.0-9]+-account:/;

async function addDisplayToContact(dlg, contact) {
    const principal = contact.value;

    if (dlg.platformData.contacts) {
        for (let platformContact of dlg.platformData.contacts) {
            if (platformContact.principal === principal) {
                contact.display = platformContact.display;
                return;
            }
        }
    }

    if (MESSAGING_ACCOUNT_REGEX.test(principal)) {
        if (dlg.manager.messaging.isSelf(principal)) {
            contact.display = dlg._("me");
            return;
        }

        try {
            const user = await dlg.manager.messaging.getUserByAccount(principal);
            contact.display = user.name;
        } catch (e) {
            console.log('Failed to lookup account ' + principal + ': ' + e.message);
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

async function addDisplayToDevice(dlg, value) {
    // FIXME there should be a better API than this...
    let factories = await dlg.manager.thingpedia.getDeviceSetup([value.value]);
    let factory = factories[value.value];

    if (factory && factory.type !== 'multiple')
        value.display = factory.text;
    else
        value.display = Helpers.cleanKind(value.value);
}

async function maybeAddDisplayToValue(dlg, value) {
    switch (value.type) {
    case 'tt:contact':
        await addDisplayToContact(dlg, value);
        break;

    case 'tt:device':
        await addDisplayToDevice(dlg, value);
        break;
    }
}

async function lookupContact(dlg, contact) {
    let principal = contact.value;
    if (MESSAGING_ACCOUNT_REGEX.test(principal))
        return true;
    if (principal.startsWith('speaker:'))
        return true;

    try {
        const account = await dlg.manager.messaging.getAccountForIdentity(principal);
        if (account) {
            console.log('Converted ' + contact.value + ' to ' + account);
            contact.value = account;
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

async function concretizeValue(dlg, slot) {
    let value = slot.get();
    const ptype = slot.type;

    if (value.isEntity && (value.type === 'tt:username' || value.type === 'tt:contact_name')
        && ptype.isEntity && ptype.type !== value.type) {
        value = await contactSearch(dlg, ptype, value.value);
        if (value === null)
            return false;
        slot.set(value);
        // continue resolving in case the new type is tt:contact
    }

    if (value.isEntity && value.type === 'tt:contact') {
        let ok = await lookupContact(dlg, value);
        if (!ok)
            return false;
    } else if (value.isLocation && value.value.isUnresolved) {
        const resolved = await lookupLocation(dlg, value.value.name);
        if (resolved === null)
            return false;
        value.value = new Ast.Location.Absolute(resolved.latitude, resolved.longitude, resolved.display);
    } else if (value.isLocation && value.value.isRelative) {
        slot.set(await resolveUserContext(dlg, '$context.location.' + value.value.relativeTag));
    } else if (value.isTime && value.value !== undefined && value.value.isRelative) {
        slot.set(await resolveUserContext(dlg, '$context.time.' + value.value.relativeTag));
    } else if (value.isEntity && value.value === null) {
        const resolved = await lookupEntity(dlg, value.type, value.display);
        if (resolved === null)
            return false;
        value.value = resolved.value;
        value.display = resolved.name;
    }

    if (value.isEntity && !value.display)
        await maybeAddDisplayToValue(dlg, value);

    if (slot.get() === null)
        return false;

    return true;
}

async function slotFillSingle(dlg, slot, context) {
    await dlg.setContext(context);

    const value = slot.get();
    if (value.isUndefined && value.local) {
        const question = slot.getPrompt(dlg.locale);
        const slotType = slot.type;

        let options = slot.options;
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
                slot.set(options[choice].value);
                return true;
            }
        }

        slot.set(await slotFillCustom(dlg, slotType, question));
    }

    return concretizeValue(dlg, slot);
}

async function doOneSlot(dlg, slot, isSetupProgram, context) {
    if (slot instanceof Ast.Selector) {
        if (isSetupProgram)
            return true;
        await dlg.setContext(context);
        let ok = await chooseDevice(dlg, slot);
        if (!ok)
            return false;
    } else {
        dlg.icon = Helpers.getIcon(slot.primitive);

        let ok = await slotFillSingle(dlg, slot, context);
        if (!ok)
            return false;
    }
    return true;
}

async function slotFillProgram(dlg, program) {
    const isSetupProgram = program instanceof Ast.Program && program.principal !== null;
    for (let slot of program.iterateSlots2()) {
        let ok = await doOneSlot(dlg, slot, isSetupProgram, program);
        if (!ok)
            return false;
    }
    return true;
}

module.exports = {
    slotFillCustom,
    slotFillSingle,
    slotFillProgram,
    concretizeValue,
    addDisplayToContact
};
