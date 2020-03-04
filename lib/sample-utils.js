// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

"use strict";

const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;

const TYPES = {
    QUOTED_STRING: Type.String,
    NUMBER: Type.Number,
    CURRENCY: Type.Currency,
    DURATION: Type.Measure('ms'),
    LOCATION: Type.Location,
    DATE: Type.Date,
    TIME: Type.Time,

    EMAIL_ADDRESS: Type.Entity('tt:email_address'),
    PHONE_NUMBER: Type.Entity('tt:phone_number'),
    HASHTAG: Type.Entity('tt:hashtag'),
    USERNAME: Type.Entity('tt:username'),
    URL: Type.Entity('tt:url'),
    PATH_NAME: Type.Entity('tt:path_name'),
};

module.exports = {
    entityTypeToTTType(entityType, unit) {
        if (entityType === 'NUMBER' && !!unit)
            return Type.Measure(unit);
        else if (entityType.startsWith('GENERIC_ENTITY_'))
            return Type.Entity(entityType.substring('GENERIC_ENTITY_'.length));
        else if (entityType.startsWith('MEASURE_'))
            return Type.Measure(entityType.substring('MEASURE_'.length));
        else
            return TYPES[entityType];
    },

    makeLookupKeys(deviceFunctionName, param, type) {
        const keys = [];
        keys.push(String(type));
        if (param)
            keys.push(`param:${param}:${type}`);
        if (param && deviceFunctionName) {
            const dot = deviceFunctionName.lastIndexOf('.');
            const deviceName = deviceFunctionName.substring(0, dot);
            const functionName = deviceFunctionName.substring(dot+1);

            keys.push(`param:${deviceName}.*:${param}:${type}`);
            keys.push(`param:${deviceName}.${functionName}:${param}:${type}`);
        }
        keys.reverse();
        return keys;
    }
};
