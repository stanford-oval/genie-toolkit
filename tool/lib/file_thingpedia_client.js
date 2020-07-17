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

const Tp = require('thingpedia');

const FileParameterProvider = require('./file_parameter_provider');

/**
 * A subclass of {@link thingpedia}.FileClient that supports
 * looking up entities by value using the file parameter provider.
 */
class FileThingpediaClient extends Tp.FileClient {
    constructor(options) {
        super(options);

        this._cachedEntities = new Map;
        this._provider = new FileParameterProvider(options.parameter_datasets, options.locale);
    }

    async lookupEntity(entityType, searchTerm) {
        // ignore search term, return everything
        let result = this._cachedEntities.get(entityType);
        if (result)
            return result;

        result = await this._provider.getEntity(entityType);
        this._cachedEntities.set(entityType, result);
        return result;
    }
}
module.exports = FileThingpediaClient;
