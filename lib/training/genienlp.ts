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


import path from 'path';
import * as fs from 'fs';
import util from 'util';

import { BaseTrainingJob, TrainingJobOptions } from './base_training_job';

import { execCommand, safeMkdir, safeRmdir } from '../utils/process-utils';

export interface GenieNLPConfig {
    task_name : 'almond'|'almond_dialogue_nlu',
    train_iterations : number,
    save_every : number,
    log_every : number,
    val_every : number,

    [key : string] : unknown
}

const DEFAULT_TRAINING_CONFIG : GenieNLPConfig = {
    task_name: 'almond',
    train_iterations: 100000,
    save_every: 2000,
    log_every: 500,
    val_every: 1000
};

export default class GenieNLPTrainingJob extends BaseTrainingJob {
    private _config : GenieNLPConfig;

    constructor(options : TrainingJobOptions & { config : GenieNLPConfig }) {
        super(options);

        this._config = {} as GenieNLPConfig;
        Object.assign(this._config, DEFAULT_TRAINING_CONFIG);
        if (options.config)
            Object.assign(this._config, options.config);
    }

    get config() {
        return this._config;
    }

    async _train() {
        await util.promisify(fs.symlink)(path.resolve(this.datadir), path.resolve(this.workdir, this._config.task_name));

        const args = [
            'genienlp', 'train',
            '--train_tasks', this._config.task_name,
            '--save', path.resolve(this.workdir, 'model'),
            '--cache', path.resolve(this.workdir, 'cache'),
            '--data', this.workdir,
            '--preserve_case',
            '--no_commit',
        ];
        if (process.env.GENIENLP_EMBEDDINGS)
            args.push('--embeddings', process.env.GENIENLP_EMBEDDINGS);
        else
            args.push('--embeddings', path.resolve(this.workdir, 'embeddings'));
        for (const key in this._config) {
            if (['thingpedia_snapshot', 'thingpedia_developer_key', 'synthetic_depth', 'task_name'].indexOf(key) >= 0)
                continue;
            if (typeof this._config[key] === 'boolean') {
                if (this._config[key])
                    args.push('--' + key);
            } else {
                args.push('--' + key, String(this._config[key]));
            }
        }

        this.metrics = {};
        await execCommand(args, { debug: this.debug, handleStderr: (line) => {
            // the line we are looking for has the form:
            // ...:train_contextual_almond:70000/100000:val_deca:...
            // or
            // ...:train_almond:70000/100000:val_deca:...
            const match = /train_[a-z_]+:([0-9]+)\/[0-9]+:val_[a-z_]+:(.*)$/.exec(line);
            if (match === null)
                return;
            this.progress = parseFloat(match[1])/this._config.train_iterations;
            for (const metric of match[2].split(':')) {
                 const [key, value] = metric.split('_');
                 this.metrics[key] = parseFloat(value);
            }
        } }, this);
        if (this._killed)
            return;

        if (this.outputdir)
            await this._findBestModel();
    }

    async _findBestModel() {
        if (this._killed)
            return;

        const args = ['genienlp', 'export',
            '--path', path.resolve(this.workdir, 'model'),
            '--output', path.resolve(this.outputdir!)
        ];
        if (process.env.GENIENLP_EMBEDDINGS)
            args.push('--embeddings', process.env.GENIENLP_EMBEDDINGS);
        else
            args.push('--embeddings', path.resolve(this.workdir, 'embeddings'));

        await execCommand(args, { debug: this.debug, }, this);
    }

    async train() {
        if (this.outputdir) {
            // remove the output directory first
            // this will complain loudly if the directory is not empty
            await safeRmdir(this.outputdir);
            await safeMkdir(this.outputdir);
        }

        await safeMkdir(this.workdir);
        if (this._killed)
            return;
        await this._train();
    }
}
