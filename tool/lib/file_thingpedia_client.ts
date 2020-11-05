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


import * as Tp from 'thingpedia';

import FileParameterProvider from './file_parameter_provider';

interface EntityRecord {
    type : string;
    value : string;
    canonical : string;
    name : string;
}

interface EntityLookupResult {
    meta : {
        name : string;
        is_well_known : boolean|number;
        has_ner_support : boolean|number;
    };
    data : EntityRecord[];
}

interface FileClientArgs {
    thingpedia : string;
    locale : string;
    entities ?: string;
    dataset ?: string;
    parameter_datasets : string;
}

/**
 * A subclass of {@link thingpedia}.FileClient that supports
 * looking up entities by value using the file parameter provider.
 */
export default class FileThingpediaClient extends Tp.FileClient {
    private _cachedEntities : Map<string, EntityRecord[]>;
    private _provider : FileParameterProvider;

    constructor(options : FileClientArgs) {
        super(options);

        this._cachedEntities = new Map;
        this._provider = new FileParameterProvider(options.parameter_datasets, options.locale);
    }

    async lookupEntity(entityType : string, searchTerm : string) : Promise<EntityLookupResult> {
        // ignore search term, return everything
        const cached = this._cachedEntities.get(entityType);
        if (cached)
            return { data: cached, meta: { name: entityType, is_well_known: false, has_ner_support: true } };

        const result = await this._provider.getEntity(entityType);
        this._cachedEntities.set(entityType, result);
        return { data: result, meta: { "name": entityType, is_well_known: false, has_ner_support: true } };
    }
}
