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


import assert from 'assert';

const LOCATION_TYPE = {
    display: { isArray: false, type: 'tt:String' },
    latitude: { isArray: false, type: 'tt:Number' },
    longitude: { isArray: false, type: 'tt:Number' }
};

function makeMetadata(className, args) {
    const meta = {};

    for (let arg of args) {
        const type = arg.type;
        const name = arg.name;
        if (name === 'id')
            continue;
        if (name.indexOf('.') >= 0)
            continue;

        let ptype = type;
        if (type.isArray)
            ptype = type.elem;
        assert(!ptype.isArray);

        let typemeta;
        if (ptype.isEntity && ptype.type.startsWith(`${className}:`))
            typemeta = ptype.type.substring(ptype.type.indexOf(':') + 1);
        else if (ptype.isEntity && ptype.type === 'tt:country')
            typemeta = 'tt:EntityLower';
        else if (ptype.isEntity)
            typemeta = 'tt:Entity';
        else if (ptype.isMeasure && ptype.unit === 'ms')
            typemeta = 'tt:Duration';
        else if (ptype.isMeasure)
            typemeta = 'tt:Measure';
        else if (ptype.isCompound)
            typemeta = makeMetadata(className, Object.values(ptype.fields));
        else if (ptype.isLocation)
            typemeta = LOCATION_TYPE;
        else
            typemeta = 'tt:' + ptype;

        meta[name] = {
            isArray: type.isArray,
            type: typemeta
        };
    }

    return meta;
}

export {
    makeMetadata
};
