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
// Author: Silei Xu <silei@cs.stanford.edu>
//         Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const Stream = require('stream');

const FlagUtils = require('./flags');

class DatasetStringifier extends Stream.Transform {
    constructor() {
        super({
            writableObjectMode: true,
        });
    }

    _transform(ex, encoding, callback) {
        let buffer = FlagUtils.makeId(ex) + '\t';
        if (ex.context)
            buffer += ex.context + '\t';
        buffer += ex.preprocessed + '\t';
        if (Array.isArray(ex.target_code))
            buffer += ex.target_code.join('\t');
        else
            buffer += ex.target_code;
        if (ex.prediction)
            buffer += '\t' + ex.prediction;
        buffer += '\n';
        callback(null, buffer);
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

class DatasetParser extends Stream.Transform {
    constructor(options = {}) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });

        this._contextual = options.contextual;
        this._preserveId = options.preserveId;
        this._overrideFlags = options.overrideFlags;
        this._parseMultiplePrograms = options.parseMultiplePrograms;
    }

    _transform(line, encoding, callback) {
        const parts = line.trim().split('\t');

        let ex;
        if (this._contextual) {
            if (this._parseMultiplePrograms) {
                ex = {
                    id: parts[0],
                    context: parts[1],
                    preprocessed: parts[2],
                    target_code: parts.slice(3)
                };
            } else {
                if (parts.length < 4)
                    throw new Error(`malformed line ${line}`);
                ex = {
                    id: parts[0],
                    context: parts[1],
                    preprocessed: parts[2],
                    target_code: parts[3]
                };
            }
        } else {
            if (this._parseMultiplePrograms) {
                ex = {
                    id: parts[0],
                    preprocessed: parts[1],
                    target_code: parts.slice(2)
                };
            } else {
                const [id, preprocessed, target_code] = parts;
                ex = {
                    id, preprocessed, target_code
                };
            }
        }

        ex.flags = {};
        if (this._overrideFlags) {
            for (let flag of Array.from(this._overrideFlags))
                ex.flags[flag] = true;
        } else if (!this._preserveId) {
            FlagUtils.parseId(ex);
        }

        callback(null, ex);
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

module.exports = {
    DatasetParser,
    DatasetStringifier
};
