// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

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
    // length
    'm': 'm',
    'km': 'm',
    'mm': 'm',
    'cm': 'm',
    'mi': 'm',
    'in': 'm',
    'ft': 'm',
    // speed
    'mps': 'mps', // meters per second, usually written as m/s but m/s is not an identifier
    'kmph': 'mps',
    'mph': 'mps',
    // weight
    'kg': 'kg',
    'g': 'kg',
    'lb': 'kg',
    'oz': 'kg',
    // pressure (for weather or blood)
    'Pa': 'mmHg',
    'bar': 'mmHg',
    'psi': 'mmHg',
    'mmHg': 'mmHg',
    'inHg': 'mmHg',
    'atm': 'mmHg',
    // temperature
    'C': 'C',
    'F': 'C',
    'K': 'C',
    'kcal': 'kcal',
    'kJ': 'kcal',
    // heart rate
    'bpm': 'bpm',
};

const UnitsTransformToBaseUnit = {
    'ms': 1,
    's': 1000,
    'min': 60 * 1000,
    'h': 3600 * 1000,
    'day': 86400 * 1000,
    'week': 86400 * 7 * 1000,
    'mon': 86400 * 30 * 1000,
    'year': 86400 * 365 * 1000,
    'm': 1,
    'km': 1000,
    'mm': 1/1000,
    'cm': 1/100,
    'mi': 1609.344,
    'in': 0.0254,
    'ft': 0.3048,
    'mps': 1,
    'kmph': 0.27777778,
    'mph': 0.44704,
    'kg': 1,
    'g': 1/1000,
    'lb': 0.45359237,
    'oz': 0.028349523,
    'Pa': 0.0075006158,
    'bar': 750.06158,
    'psi': 51.714925,
    'mmHg': 1,
    'inHg': 25.4,
    'atm': 759.99989,
    'C': 1,
    'F': function(x) { return (x - 32)/1.8; },
    'K': function(x) { return x - 273.15; },
    'kcal': 1,
    'kJ': 0.239006,
    'bpm': 1,
};

module.exports = function normalize(number, unit) {
    var baseUnit = UnitsToBaseUnit[unit];
    if (baseUnit === undefined)
        throw new Error('Invalid unit ' + unit);

    var factor = UnitsTransformToBaseUnit[unit];
    if (typeof factor === 'function')
        return [factor(number), baseUnit];

    return [number * factor, baseUnit];
}
