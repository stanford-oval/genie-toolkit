// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const seedrandom = require('seedrandom');
const fs = require('fs');
const assert = require('assert');
const Stream = require('stream');

const { DatasetParser, DatasetStringifier } = require('../lib/dataset-parsers');
const I18n = require('../lib/i18n');
const { uniform, coin } = require('../lib/random');

const StreamUtils = require('../lib/stream-utils');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');

function extractEntities(code) {
    const entities = {};

    for (let token of code) {
        const match = /^([A-Z].*)_([0-9]+)$/.exec(token);
        if (match !== null) {
            const type = match[1];
            const num = parseInt(match[2]);

            entities[type] = Math.max(entities[type]||0, num);
        }
    }

    return entities;
}

function renumberEntities(code, offsets) {
    let changed = false;
    for (let i = 0; i < code.length; i++) {
        const match = /^([A-Z].*)_([0-9]+)$/.exec(code[i]);
        if (match !== null && match[1] in offsets) {
            code[i] = match[1] + '_' + (parseInt(match[2]) + offsets[match[1]] + 1);
            changed = true;
        }
    }
    return changed;
}

class ContextualizeStream extends Stream.Transform {
    constructor(allprograms, options) {
        super({ objectMode: true });

        this._locale = options.locale;
        this._samples = options.numSamples;
        this._nullOnly = options.nullOnly;
        this._templates = I18n.get(options.locale).CHANGE_SUBJECT_TEMPLATES.map((tpl) => tpl.split('{}'));
        for (let tpl of this._templates)
            assert.strictEqual(tpl.length, 2);

        this._allprograms = allprograms;
        this._rng = options.rng;
    }

    _transform(ex, encoding, callback) {
        if (this._nullOnly) {
            ex.context = 'null';
            callback(null, ex);
            return;
        }
    
        for (let i = 0; i < this._samples; i++) {
            const clone = {};
            Object.assign(clone, ex);

            clone.id = ex.id + ':' + i;
            if (coin(0.5, this._rng))
                clone.context = 'null';
            else
                clone.context = uniform(this._allprograms, this._rng);

            if (clone.context !== 'null') {
                if (this._templates.length > 0 && coin(0.1, this._rng)) {
                    const template = uniform(this._templates, this._rng);

                    clone.preprocessed = template[0] + ex.preprocessed + template[1];
                }

                const preprocessed = clone.preprocessed.split(' ');
                const code = clone.target_code.split(' ');
                const contextentities = extractEntities(clone.context.split(' '));
                renumberEntities(preprocessed, contextentities);
                renumberEntities(code, contextentities);
                clone.preprocessed = preprocessed.join(' ');
                clone.target_code = code.join(' ');
            }
            this.push(clone);
        }

        callback(null);
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('contextualize', {
            addHelp: true,
            description: "Transform a non-contextual dataset to a contextual one."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
        });
        parser.addArgument(['-c', '--context'], {
            required: true,
            action: 'append',
            type: fs.createReadStream,
            help: `Context files to use`,
        });
        parser.addArgument(['--expansion-factor'], {
            type: Number,
            help: `Number of contexts per input sentence`,
            defaultValue: 20
        });
        parser.addArgument('--null-only', {
            action: 'storeTrue',
            help: 'Use only the null context. If set, --expansion-factor is ignored.',
            defaultValue: false
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to contextualize (in TSV format); use - for standard input'
        });
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
    },

    async execute(args) {
        const rng = seedrandom.alea(args.random_seed);

        let allprograms = await readAllLines(args.context)
            .pipe(new StreamUtils.ArrayAccumulator())
            .read();

        await StreamUtils.waitFinish(
            readAllLines(args.input_file)
            .pipe(new DatasetParser({ parseMultiplePrograms: args.null_only, preserveId: true }))
            .pipe(new ContextualizeStream(allprograms, {
                locale: args.locale,
                numSamples: args.expansion_factor,
                nullOnly: args.null_only,

                rng
            }))
            .pipe(new DatasetStringifier())
            .pipe(args.output)
        );
    }
};
