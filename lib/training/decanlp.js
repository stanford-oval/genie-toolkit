// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const path = require('path');
const fs = require('fs');
const util = require('util');
const Tp = require('thingpedia');

const BaseTrainingJob = require('./base_training_job');

const { execCommand, safeMkdir, safeRmdir } = require('./exec-utils');
async function request(url) {
    return JSON.parse(await Tp.Helpers.Http.get(url, { accept: 'application/json' })).data;
}

const DEFAULT_TRAINING_CONFIG = {
    task_name: 'almond',
    locale: 'en-US',
    thingpedia_snapshot: '-1',
    train_iterations: 100000,
    save_every: 2000,
    log_every: 500,
    val_every: 1000
};

module.exports = class DecaNLPTrainingJob extends BaseTrainingJob {
    constructor(options) {
        super(options);

        this._config = {};
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
            'train',
            '--train_tasks', this._config.task_name,
            '--save', path.resolve(this.workdir, 'model'),
            '--cached', path.resolve(this.workdir, 'cache'),
            '--data', this.workdir,
            '--preserve_case',
        ];
        if (process.env.DECANLP_EMBEDDINGS)
            args.push('--embeddings', process.env.DECANLP_EMBEDDINGS);
        else
            args.push('--embeddings', path.resolve(this.workdir, 'embeddings'));
        for (let key in this._config) {
            if (['thingpedia_snapshot', 'thingpedia_developer_key', 'locale', 'synthetic_depth', 'task_name'].indexOf(key) >= 0)
                continue;
            if (typeof this._config[key] === 'boolean') {
                if (this._config[key])
                    args.push('--' + key);
            } else {
                args.push('--' + key, String(this._config[key]));
            }
        }

        this.metrics = {};
        await execCommand(this, 'decanlp', args, (line) => {
            const match = /train_[a-z]+:([0-9]+)\/[0-9]+:val_[a-z]+:(.*)$/.exec(line);
            if (match === null)
                return;
            this.progress = parseFloat(match[1])/this._config.train_iterations;
            for (let metric of match[2].split(':')) {
                 let [key, value] = metric.split('_');
                 this.metrics[key] = parseFloat(value);
            }
        });
        if (this._killed)
            return;

        if (this.outputdir)
            await this._findBestModel();
    }

    async _findBestModel() {
        if (this._killed)
            return;

        // copy the best model into the output directory
        await execCommand(this, 'cp', [
            path.resolve(this.workdir, 'model/best.pth'),
            path.resolve(this.workdir, 'model/config.json'),
            this.outputdir
        ]);
    }

    async _saveThingpediaJson() {
        let deviceUrl = this.thingpediaUrl + '/api/v3/snapshot/' + this.config.thingpedia_snapshot + '?meta=1&locale=' + this.config.locale;
        if (this.config.thingpedia_developer_key)
            deviceUrl += '&developer_key=' + this.config.thingpedia_developer_key;
        let entityUrl = this.thingpediaUrl + '/api/v3/entities/all?snapshot=' + this.config.thingpedia_snapshot + '&locale=' + this.config.locale;
        if (this.config.thingpedia_developer_key)
            entityUrl += '&developer_key=' + this.config.thingpedia_developer_key;

        const [devices, entities] = await Promise.all([request(deviceUrl), request(entityUrl)]);
        await util.promisify(fs.writeFile)(path.resolve(this.outputdir, 'thingpedia.json'), JSON.stringify({ devices, entities }));
    }

    async train() {
        if (this.outputdir) {
            // remove the output directory first
            // this will complain loudly if the directory is not empty
            await safeRmdir(this.outputdir);
            await safeMkdir(this.outputdir);
            await this._saveThingpediaJson();
        }

        await safeMkdir(this.workdir);
        if (this._killed)
            return;
        await this._train();
    }
};
