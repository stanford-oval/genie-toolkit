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

const Helpers = require('../helpers');

const { contactSearch } = require('./contact_search');
const resolveUserContext = require('./user_context');
const { chooseDevice } = require('./device_choice');
const { lookupEntity, lookupLocation } = require('./entity_lookup');

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

    const contactApi = dlg.manager.platform.getCapability('contacts');
    if (contactApi === null)
        return;

    const addressBookContact = await contactApi.lookupPrincipal(principal);
    if (addressBookContact)
        contact.display = addressBookContact.displayName;
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

function concretizeTemperature(platform) {
    let preferredUnit = 'C'; // Below code checks if we are in US
    if (platform.type !== 'cloud' && platform.type !== 'android') {
        const realLocale = process.env.LC_ALL || process.env.LC_MEASUREMENT || process.env.LANG;
        if (realLocale.indexOf('en_US') !== -1)
            preferredUnit = 'F';
    } else if (platform.type === 'cloud') {
        const realLocale = process.env.TZ;
        // timezones obtained from http://efele.net/maps/tz/us/
        const usTimeZones = [
            'America/New_York',
            'America/Chicago',
            'America/Denver',
            'America/Los_Angeles',
            'America/Adak',
            'America/Yakutat',
            'America/Juneau',
            'America/Sitka',
            'America/Metlakatla',
            'America/Anchrorage',
            'America/Nome',
            'America/Phoenix',
            'America/Honolulu',
            'America/Boise',
            'America/Indiana/Marengo',
            'America/Indiana/Vincennes',
            'America/Indiana/Tell_City',
            'America/Indiana/Petersburg',
            'America/Indiana/Knox',
            'America/Indiana/Winamac',
            'America/Indiana/Vevay',
            'America/Kentucky/Louisville',
            'America/Indiana/Indianapolis',
            'America/Kentucky/Monticello',
            'America/Menominee',
            'America/North_Dakota/Center',
            'America/North_Dakota/New_Salem',
            'America/North_Dakota/Beulah',
            'America/Boise',
            'America/Puerto_Rico',
            'America/St_Thomas',
            'America/Shiprock',
        ];
        if (usTimeZones.indexof(realLocale) !== -1)
            preferredUnit = 'F';
    }
    return preferredUnit;
}

async function concretizeValue(dlg, slot, hints = {}) {
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

    // default units (e.g. defaultTemperature) will be concretized
    // according to the user's preferences or locale
    // since dlg.locale is overwritten to be en-US, we infer the locale
    // via other environment variables like LANG (language) or TZ (timezone)
    if (value.isMeasure && value.unit.startsWith('default')) {
        // const locale = dlg.locale; // this is not useful
        const platform = dlg.manager.platform;
        const pref = platform.getSharedPreferences();
        let preferredUnit = pref.get('preferred-' + value.unit.substring('default'.length).toLowerCase());
        // e.g. defaultTemperature will get from preferred-temperature
        if (preferredUnit === undefined) {
            switch (value.unit) {
                case 'defaultTemperature':
                    preferredUnit = concretizeTemperature(platform);
                    break;
                default:
                    throw new Error('Invalid default unit');
            }
        }
        value.unit = preferredUnit;
    }

    if (value.isLocation && value.value.isUnresolved) {
        const resolved = await lookupLocation(dlg, value.value.name, hints.previousLocations || []);
        if (resolved === null)
            return false;
        value.value = resolved;
    } else if (value.isLocation && value.value.isRelative) {
        const resolved = await resolveUserContext(dlg, '$context.location.' + value.value.relativeTag);
        if (resolved)
            slot.set(resolved);
        else
            return false;
    } else if (value.isTime && value.value !== undefined && value.value.isRelative) {
        slot.set(await resolveUserContext(dlg, '$context.time.' + value.value.relativeTag));
    } else if (value.isEntity && value.value === null) {
        const resolved = await lookupEntity(dlg, value.type, value.display, hints.idEntities || new Map);
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

module.exports = {
    chooseDevice,
    concretizeValue,
};
