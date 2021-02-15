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
// Author: Mehrad Moradshahi <mehrad@cs.stanford.edu>


import Stream from 'stream';

/**
 This class provides an interface to conditionally control the flow of input stream
 to two writable streams based on 'is_ok' property of each input example
 */
export default class ConditionalDatasetSplitter extends Stream.Writable {
    constructor(options) {
        super({ objectMode: true });

        this._output = options.output;
        this._outputErrors = options.outputErrors;

    }

    _final(callback) {
        this._output.end();
        if (this._outputErrors)
            this._outputErrors.end();
        callback();
    }

    _write(row, encoding, callback) {
        // guard against null values
        if (!row) {
            callback();
            return;
        }

        if (row.is_ok) {
            this._output.write(row, callback);
        } else {
            if (this._outputErrors)
                this._outputErrors.write(row, callback);
            else
                callback();
        }
    }
}
