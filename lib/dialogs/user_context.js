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

function tryGetCurrentLocation(dlg) {
    var phone = dlg.manager.devices.getDevice('org.thingpedia.builtin.thingengine.phone');
    if (phone === null) {
        console.log('Phone is not setup, cannot find current location');
        return null;
    }

    return phone.invokeQuery('get_gps').then(([[location]]) => {
        if (location === null) {
            console.log('GPS location not available');
            return null;
        } else {
            return Ast.Value.Location(Ast.Location.Absolute(location.y, location.x, null));
        }
    });
}

function valueFromJs(category, value) {
    if (category.isLocation)
        return Ast.Value.Location(Ast.Location.Absolute(value.y, value.x, value.display||null));
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

module.exports = function* resolveUserContext(dlg, variable) {
    let value;
    switch (variable) {
        case '$context.location.current_location':
            value = yield tryGetCurrentLocation(dlg);
        case '$context.location.home':
        case '$context.location.work':
            value = tryGetStored(dlg, ValueCategory.Location, variable);
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
    }

    let answer = yield dlg.ask(type, question);
    if (saveToContext) {
        var platform = dlg.manager.platform;
        var sharedPrefs = platform.getSharedPreferences();

        sharedPrefs.set('context-' + variable, answer.toJS());
    }
    return answer;
}
