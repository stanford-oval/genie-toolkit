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
const { lookupLocation } = require('./entity_lookup');
const { tryGetCurrentLocation } = require('../utils');

function valueFromJs(category, value) {
    if (category.isLocation)
        return new Ast.Value.Location(new Ast.Location.Absolute(value.y, value.x, value.display||null));
    else if (category.isTime)
        return new Ast.Value.Time(new Ast.Time.Absolute(value.hour, value.minute, value.second||0));
    else
        return null; // FIXME handle other types when we have more context values
}

function tryGetStored(dlg, category, variable) {
    var platform = dlg.manager.platform;
    var sharedPrefs = platform.getSharedPreferences();

    var value = sharedPrefs.get('context-' + variable);
    if (value !== undefined)
        return valueFromJs(category, value);
    else
        return null;
}

module.exports = async function resolveUserContext(dlg, variable) {
    let value;
    switch (variable) {
        case '$context.location.current_location':
            value = await tryGetCurrentLocation(dlg);
            break;
        case '$context.location.home':
        case '$context.location.work':
            value = tryGetStored(dlg, ValueCategory.Location, variable);
            break;
        case '$context.time.morning':
        case '$context.time.evening':
            value = tryGetStored(dlg, ValueCategory.Time, variable);
            break;
        default:
            throw new TypeError('Invalid variable ' + variable);
    }
    if (value !== null)
        return value;

    let saveToContext = false;
    let question, type;
    switch (variable) {
    case '$context.location.current_location':
        question = dlg._("Where are you now?");
        type = ValueCategory.Location;
        break;
    case '$context.location.home':
        question = dlg._("What is your home address?");
        type = ValueCategory.Location;
        saveToContext = true;
        break;
    case '$context.location.work':
        question = dlg._("What is your work address?");
        type = ValueCategory.Location;
        saveToContext = true;
        break;
    case '$context.time.morning':
        question = dlg._("What time does your morning begin?");
        type = ValueCategory.Time;
        saveToContext = true;
        break;
    case '$context.time.evening':
        question = dlg._("What time does your evening begin?");
        type = ValueCategory.Time;
        saveToContext = true;
        break;
    }

    let answer = await dlg.ask(type, question);
    if (type === ValueCategory.Location && answer.value.isRelative)
         answer = await resolveUserContext(dlg, '$context.location.' + answer.value.relativeTag);

    if (saveToContext) {
        const platform = dlg.manager.platform;
        const sharedPrefs = platform.getSharedPreferences();

        if (type === ValueCategory.Location && answer.value.isUnresolved) {
            const resolved = await lookupLocation(dlg, answer.value.name);
            if (resolved === null)
                return false;
            answer = new Ast.Value.Location(resolved);
        }
        sharedPrefs.set('context-' + variable, answer.toJS());
    }
    return answer;
};
