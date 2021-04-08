// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import path from 'path';
import * as child_process from 'child_process';
import * as events from 'events';

export interface TrainingJobOptions {
    id : string;
    datadir : string;
    workdir : string;
    outputdir ?: string;
    debug ?: boolean;
    config ?: Record<string, unknown>;
}

export abstract class BaseTrainingJob extends events.EventEmitter {
    private _datadir : string;
    private _workdir : string;
    private _outputdir : string|null;
    private _debug : boolean;
    private _progress : number;
    protected _killed = false;
    id : string;
    child : child_process.ChildProcess|null;
    metrics : Record<string, number>;

    constructor(options : TrainingJobOptions) {
        super();

        this.id = options.id;
        this._datadir = path.resolve(options.datadir);
        this._workdir = path.resolve(options.workdir);
        this._outputdir = options.outputdir ? path.resolve(options.outputdir) : null;

        this._debug = options.debug ?? true;

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

    abstract train() : Promise<void>;

    get progress() {
        return this._progress;
    }
    set progress(value : number) {
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
}
