// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as Units from 'thingtalk-units';
import assert from 'assert';
import * as I18n from '../../lib/i18n';

const DEBUG = true;

const UnitsToBaseUnit = {
    // time
    'ms': 'ms', // base unit for time is milliseconds, because +new Date gives milliseconds
    's': 'ms',
    'min': 'ms',
    'h': 'ms',
    'day': 'ms',
    'week': 'ms',
    'mon': 'ms', // business month, aka exactly 30 days
    'year': 'ms', // business year (365 days exactly, no leap years)

    // FIXME
    //'decade': 'ms',
    //'century': 'ms', // hundred years
    // length
    'm': 'm',
    'km': 'm',
    'mm': 'm',
    'cm': 'm',
    'mi': 'm',
    'in': 'm',
    'ft': 'm',
    // FIXME
    //'ly': 'm', // light-year
    // area
    'm2': 'm2',
    'km2': 'm2',
    'mm2': 'm2',
    'cm2': 'm2',
    'mi2': 'm2',
    'in2': 'm2',
    'ft2': 'm2',
    // volume
    'm3': 'm3',
    'km3': 'm3',
    'mm3': 'm3',
    'cm3': 'm3',
    'mi3': 'm3',
    'in3': 'm3',
    'ft3': 'm3',
    'gal': 'm3',
    'galuk': 'm3',
    'qt': 'm3',
    'qtuk': 'm3',
    'pint': 'm3',
    'pintuk': 'm3',
    'l': 'm3',
    'hl': 'm3',
    'cl': 'm3',
    'ml': 'm3',
    'tsp': 'm3',
    'tbsp': 'm3',
    'cup': 'm3',
    'floz': 'm3',
    // speed
    'mps': 'mps', // meters per second, usually written as m/s but m/s is not an identifier
    'kmph': 'mps',
    'mph': 'mps',
    // weight
    'kg': 'kg',
    'g': 'kg',
    'mg': 'kg',
    'lb': 'kg',
    'oz': 'kg',
    // pressure (for weather or blood)
    'Pa': 'Pa',
    'bar': 'Pa',
    'psi': 'Pa',
    'mmHg': 'Pa',
    'inHg': 'Pa',
    'atm': 'Pa',
    // temperature
    'C': 'C',
    'F': 'C',
    'K': 'C',
    // energy
    'kcal': 'kcal',
    'kJ': 'kcal',
    // file and memory sizes
    'byte': 'byte',
    'KB': 'byte',
    'KiB': 'byte',
    'MB': 'byte',
    'MiB': 'byte',
    'GB': 'byte',
    'GiB': 'byte',
    'TB': 'byte',
    'TiB': 'byte',
    // power
    'W': 'W',
    'kW': 'W',
    // luminous flux, luminous power
    'lm': 'lm',
    // luminous emittance (luminous flux emitted from a surface)
    'lx': 'lx',
    // decibel
    'dB': 'dB',
    // decibel-milliwatts
    'dBm': 'dBm'
};

function testUnit(value, unit) {
    const langPack = I18n.get('en-US');
    const formatted = langPack._measureToString(Units.transformToBaseUnit(value, unit), unit);
    assert(typeof formatted === 'string' && formatted);
    if (DEBUG)
        console.log(`${value} ${unit} : ${formatted}`);
}

export default function main() {
    for (const unit in UnitsToBaseUnit) {
        testUnit(1, unit);
        testUnit(42, unit);
        testUnit(123.45, unit);
    }
}
if (!module.parent)
    main();
