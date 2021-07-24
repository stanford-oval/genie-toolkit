// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import { SchemaRetriever } from 'thingtalk';

export async function getAllDevicesOfKind(schemas : SchemaRetriever, kind : string) {
    let numDevices = 1;

    if (kind.startsWith('org.thingpedia.iot.')) { // HACK
        numDevices = 6;
    } else {
        const classDef = await schemas.getFullMeta(kind);
        const config = classDef.config;
        if (config && config.module !== 'org.thingpedia.config.none' &&
            config.module !== 'org.thingpedia.config.builtin')
            numDevices = 3;
    }

    if (numDevices === 1) {
        // make up a unique fake device, and make the uniqueId same as the kind,
        // so the device will not be recorded in the context
        return [{
            kind, name: kind, uniqueId: kind
        }];
    } else {
        const out = [];
        for (let i = 0; i < numDevices; i++) {
            out.push({
                kind,
                name: `Simulated Device ${kind} ${i}`,
                // pick a format that matches the other simulated values
                uniqueId: `str:ENTITY_tt:device_id::${i}:`
            });
        }
        return out;
    }
}
