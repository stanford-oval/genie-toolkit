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
const byline = require('byline');

const BaseTrainingJob = require('./base_training_job');

const StreamUtils = require('../stream-utils');
const { execCommand, safeMkdir, safeRmdir } = require('./exec-utils');

const DECANLP_PATH = path.resolve(process.env.DECANLP_PATH || '/opt/decanlp');
const DECANLP_PYTHON = process.env.DECANLP_PYTHON || 'python3';

const TASK_NAME = 'almond';

const DEFAULT_TRAINING_CONFIG = {
    train_iterations: 250000,
    save_every: 5000,
    log_every: 1000,
    train_batch_tokens: 256,
    val_batch_size: 100,
};

module.exports = class DecaNLPTrainingJob extends BaseTrainingJob {
    constructor(options) {
        super(options);

        this._config = {};
        Object.assign(this._config, DEFAULT_TRAINING_CONFIG);
        if (options.config)
            Object.assign(this._config, options.config);

        this._processeddatadir = path.resolve(this.workdir, TASK_NAME, 'en-tt');
    }

    get config() {
        return this._config;
    }

    async _datagen() {
        await safeMkdir(this._processeddatadir);

        for (let split of ['train', 'test', 'eval']) {
            const input = fs.createReadStream(path.resolve(this.datadir, split + '.tsv'));

            // we need to do some gymnastics to handle a non-existent test.tsv correctly,
            // and also pipe into two different files
            await new Promise((resolve, reject) => {
                input.on('error', (e) => {
                    if (e.code === 'ENOENT' && split === 'test')
                        resolve();
                    else
                        reject(e);
                });
                input.on('open', () => {
                    const outsentence = fs.createWriteStream(path.resolve(this._processeddatadir, split + '.en-tt.en'));
                    const outprogram = fs.createWriteStream(path.resolve(this._processeddatadir, split + '.en-tt.tt'));

                    const wrapped = byline(input);
                    wrapped.on('data', (line) => {
                        let [, sentence, program] = line.split('\t');
                        outsentence.write(sentence + '\n');
                        outprogram.write(program + '\n');
                    });
                    wrapped.on('end', () => {
                        outsentence.end();
                        outprogram.end();
                    });

                    resolve(Promise.all([
                        StreamUtils.waitFinish(outsentence),
                        StreamUtils.waitFinish(outprogram)
                    ]));
                });
            });
        }
    }

    async _train() {
        const args = [
            path.resolve(DECANLP_PATH, 'train.py'),
            '--save', path.resolve(this.workdir, 'model'),
            '--data', this._processeddatadir,
        ];
        if (process.env.DECANLP_EMBEDDINGS)
            args.push('--embeddings', process.env.DECANLP_EMBEDDINGS);
        else
            args.push('--embeddings', path.resolve(this.workdir, 'embeddings'));
        for (let key in this.config) {
            if (key === 'thingpedia_snapshot' || key === 'synthetic_depth')
                continue;
            args.push(key, String(this.config[key]));
        }

        await execCommand(this, DECANLP_PYTHON, args);
        if (this._killed)
            return;

        await this._extractEvalMetrics();
        if (this._killed)
            return;
        await this._findBestModel();
    }

    async _findBestModel() {
        // TODO
    }

    async _extractEvalMetrics() {
        // TODO
    }

    async train() {
        // remove the output directory first
        // this will complain loudly if the directory is not empty
        if (this.outputdir)
            await safeRmdir(this.outputdir);
        await safeMkdir(this.workdir);
        if (this._killed)
            return;

        await this._datagen();
        if (this._killed)
            return;
        await this._train();
    }

    async _eval(useTestSet) {
        // TODO
    }

    async evaluate(useTestSet) {
        if (!fs.existsSync(this.workdir))
            await this._datagen();

        return this._eval();
    }
};
