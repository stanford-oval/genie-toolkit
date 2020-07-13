// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const ValueCategory = require('../value-category');
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
    if (type === ValueCategory.Location) {
        if (answer.value.isRelative) {
            answer = await resolveUserContext(dlg, '$context.location.' + answer.value.relativeTag);
        } else if (answer.value.isUnresolved) {
            const resolved = await lookupLocation(dlg, answer.value.name, []);
            if (resolved === null)
                return false;
            answer = new Ast.Value.Location(resolved);
        }

    }

    if (saveToContext) {
        const platform = dlg.manager.platform;
        const sharedPrefs = platform.getSharedPreferences();
        sharedPrefs.set('context-' + variable, answer.toJS());
    }
    return answer;
};
