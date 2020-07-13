// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
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

const path = require('path');
const events = require('events');

module.exports = class BaseTrainingJob extends events.EventEmitter {
    constructor(options) {
        super();

        this._options = options;

        this.id = options.id;
        this._datadir = path.resolve(options.datadir);
        this._workdir = path.resolve(options.workdir);
        this._outputdir = options.outputdir ? path.resolve(options.outputdir) : null;

        this._debug = options.debug;
        if (this._debug === undefined)
            this._debug = true;

        this._progress = 0;

        this.child = null;
        this.metrics = {};
    }

    get datadir() {
        return this._datadir;
    }
    get workdir() {
        return this._workdir;
    }
    get outputdir() {
        return this._outputdir;
    }
    get debug() {
        return this._debug;
    }

    /* istanbul ignore next */
    async train() {
        throw new TypeError(`Abstract method`);
    }
    /* istanbul ignore next */
    async evaluate(useTestSet) {
        throw new TypeError(`Abstract method`);
    }

    get progress() {
        return this._progress;
    }
    set progress(value) {
        // progress is monotonic
        if (value > this._progress) {
            this._progress = value;
            this.emit('progress', value);
        }
    }

    kill() {
        this._killed = true;
        if (this.child)
            this.child.kill('SIGTERM');
    }
};
