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

const fs = require('fs');
const JSONStream = require('JSONStream');
const Stream = require('stream');
const Tp = require('thingpedia');
const seedrandom = require('seedrandom');

const { AVAILABLE_LANGUAGES } = require('../lib/languages');
const { DialogueGenerator } = require('../lib/sentence-generator');

const { DialogueSerializer } = require('./lib/dialog_parser');
const StreamUtils = require('../lib/stream-utils');
const { ActionSetFlag } = require('./lib/argutils');

const DIALOG_SERIALIZERS = {
    json() {
        return JSONStream.stringify(undefined, undefined, undefined, 2);
    },

    txt() {
        return new DialogueSerializer();
    },

    txt_only() {
        return new DialogueSerializer({ annotations: false });
    }
};

class SimpleCountStream extends Stream.Transform {
    constructor(N) {
        super({ objectMode: true });

        this._i = 0;
        this._N = N;
    }

    _transform(element, encoding, callback) {
        this._i ++;
        if (this._i % 100 === 0)
            this.emit('progress', this._i/this._N);
        callback(null, element);
    }

    _flush(callback) {
        callback();
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('generate-dialogs', {
            addHelp: true,
            description: "Generate a new synthetic dialog dataset, given a template file."
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
        parser.addArgument(['-f', '--output-format'], {
            required: false,
            defaultValue: 'txt-only',
            choices: ['json', 'txt', 'txt-only'],
            help: `Output format`
        });
        parser.addArgument(['--max-turns'], {
            required: false,
            defaultValue: 7,
            type: Number,
            help: `Maximum number of turns per dialog`
        });
        parser.addArgument(['-t', '--target-language'], {
            required: false,
            defaultValue: 'thingtalk',
            choices: AVAILABLE_LANGUAGES,
            help: `The programming language to generate`
        });
        parser.addArgument('--thingpedia', {
            required: false,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--entities', {
            required: false,
            help: 'Path to JSON file containing entity type definitions.'
        });
        parser.addArgument('--dataset', {
            required: false,
            help: 'Path to file containing primitive templates, in ThingTalk syntax.'
        });
        parser.addArgument('--template', {
            required: true,
            nargs: '+',
            help: 'Path to file containing construct templates, in Genie syntax.'
        });
        parser.addArgument('--set-flag', {
            required: false,
            nargs: 1,
            action: ActionSetFlag,
            constant: true,
            metavar: 'FLAG',
            help: 'Set a flag for the construct template file.',
        });
        parser.addArgument('--unset-flag', {
            required: false,
            nargs: 1,
            action: ActionSetFlag,
            constant: false,
            metavar: 'FLAG',
            help: 'Unset (clear) a flag for the construct template file.',
        });
        parser.addArgument('--maxdepth', {
            required: false,
            type: Number,
            defaultValue: 4,
            help: 'Maximum depth of sentence generation',
        });
        parser.addArgument('--target-pruning-size', {
            required: false,
            type: Number,
            defaultValue: 100,
            help: 'Pruning target for each non-terminal',
        });
        parser.addArgument(['-B', '--minibatch-size'], {
            required: false,
            type: Number,
            defaultValue: 1000,
            help: 'Number of partial dialogue to keep in the working set for each minibatch',
        });
        parser.addArgument(['-n', '--num-minibatches'], {
            required: false,
            defaultValue: 1,
            type: Number,
            help: `Number of minibatches of dialogues to generate`
        });

        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
            defaultValue: true
        });
        parser.addArgument('--no-debug', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'debug',
            help: 'Disable debugging.',
        });
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
    },

    async execute(args) {
        const counter = new SimpleCountStream(args.target_size);

        let tpClient = null;
        if (args.thingpedia)
            tpClient = new Tp.FileClient(args);
        const options = {
            rng: seedrandom.alea(args.random_seed),
            locale: args.locale,
            flags: args.flags || {},
            templateFiles: args.template,
            targetLanguage: args.target_language,
            thingpediaClient: tpClient,
            maxDepth: args.maxdepth,
            targetPruningSize: args.target_pruning_size,
            maxTurns: args.max_turns,
            minibatchSize: args.minibatch_size,
            numMinibatches: args.num_minibatches,

            debug: args.debug,
        };
        new DialogueGenerator(options)
            .pipe(counter)
            .pipe(DIALOG_SERIALIZERS[args.output_format.replace('-', '_')]())
            .pipe(args.output);

        await StreamUtils.waitFinish(args.output);
    }
};
