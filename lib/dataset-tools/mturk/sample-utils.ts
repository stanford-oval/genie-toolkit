// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import { Type } from 'thingtalk';

const TYPES : Record<string, Type> = {
    QUOTED_STRING: Type.String,
    NUMBER: Type.Number,
    CURRENCY: Type.Currency,
    DURATION: new Type.Measure('ms'),
    LOCATION: Type.Location,
    DATE: Type.Date,
    TIME: Type.Time,

    EMAIL_ADDRESS: new Type.Entity('tt:email_address'),
    PHONE_NUMBER: new Type.Entity('tt:phone_number'),
    HASHTAG: new Type.Entity('tt:hashtag'),
    USERNAME: new Type.Entity('tt:username'),
    URL: new Type.Entity('tt:url'),
    PATH_NAME: new Type.Entity('tt:path_name'),
};

export function entityTypeToTTType(entityType : string, unit : string|undefined|null) : Type {
    if (entityType === 'NUMBER' && !!unit)
        return new Type.Measure(unit);
    else if (entityType.startsWith('GENERIC_ENTITY_'))
        return new Type.Entity(entityType.substring('GENERIC_ENTITY_'.length));
    else if (entityType.startsWith('MEASURE_'))
        return new Type.Measure(entityType.substring('MEASURE_'.length));
    else
        return TYPES[entityType];
}

export function makeLookupKeys(deviceFunctionName : string|undefined|null, param : string|undefined|null, type : Type) : string[] {
    const keys : string[] = [];
    if (type instanceof Type.Array)
        type = type.elem as Type;
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
