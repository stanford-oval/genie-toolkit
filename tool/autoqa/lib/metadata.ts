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
//         Silei Xu <silei@cs.stanford.edu>

import assert from 'assert';
import { Ast, Type } from 'thingtalk';

interface ArgMeta {
    isArray : boolean,
    type : string | Record<string, ArgMeta>
}

const LOCATION_TYPE = {
    display: { isArray: false, type: 'tt:String' },
    latitude: { isArray: false, type: 'tt:Number' },
    longitude: { isArray: false, type: 'tt:Number' }
};

function makeMetadata(className : string, args : Ast.ArgumentDef[]) : Record<string, ArgMeta> {
    const meta : Record<string, ArgMeta> = {};

    for (const arg of args) {
        const type = arg.type;
        const name = arg.name;
        if (name === 'id')
            continue;
        if (name.indexOf('.') >= 0)
            continue;

        let ptype = type;
        if (type instanceof Type.Array)
            ptype = type.elem as Type;
        assert(!ptype.isArray);

        let typemeta;
        if (ptype instanceof Type.Entity && ptype.type.startsWith(`${className}:`))
            typemeta = ptype.type.substring(ptype.type.indexOf(':') + 1);
        else if (ptype instanceof Type.Entity && ptype.type === 'tt:country')
            typemeta = 'tt:EntityLower';
        else if (ptype instanceof Type.Entity)
            typemeta = 'tt:Entity';
        else if (ptype instanceof Type.Measure && ptype.unit === 'ms')
            typemeta = 'tt:Duration';
        else if (ptype instanceof Type.Measure)
            typemeta = 'tt:Measure';
        else if (ptype instanceof Type.Compound)
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
