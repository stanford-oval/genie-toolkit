// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const fs = require('fs');
const assert = require('assert');
const util = require('util');
const ThingTalk = require('thingtalk');

const { parseConstantFile } = require('./lib/constant-file');
const CanonicalGenerator = require('./lib/canonical-generator');
const StreamUtils = require('../lib/stream-utils');

async function loadClassDef(thingpedia) {
    const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }));
    assert(library.isLibrary && library.classes.length === 1);
    return library.classes[0];
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('autogen-annotations', {
            addHelp: true,
            description: "Use BERT to expand canonicals"
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['-l', '--locale'], {
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
        });
        parser.addArgument('--constants', {
            required: true,
            help: 'TSV file containing constant values to use.'
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--queries', {
            required: true,
            help: `List of query functions to include, split by comma (no space).`
        });
        parser.addArgument('--skip', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Skip the entire process.',
            defaultValue: false
        });
        parser.addArgument('--algorithm', {
            help: 'Different algorithms to generate canonicals including bert, bart, adj, split by comma (no space)',
            defaultValue: null
        });
        parser.addArgument('--pruning', {
            required: false,
            type: Number,
            defaultValue: 0.5,
            help: `The minimum fraction required for a candidate to be added`
        });
        parser.addArgument('--parameter-datasets', {
            required: true,
            help: `TSV file containing the paths to datasets for strings and entity types.`
        });
        parser.addArgument('--model', {
            required: false,
            defaultValue: 'bert-large-uncased',
            help: `A string specifying a model name recognizable by the Transformers package (e.g. bert-base-uncased), `
                + `or a path to the directory where the model is saved`
        });
        parser.addArgument('--is-paraphraser', {
            required: false,
            defaultValue: false,
            action: 'storeTrue',
            help: `Set to True if model_name_or_path was fine-tuned on a paraphrasing dataset`
        });
        parser.addArgument('--gpt2-ordering', {
            required: false,
            defaultValue: false,
            action: 'storeTrue',
            help: `Set to True to use gpt2 to decide where to put value`
        });
        parser.addArgument('--paraphraser-model', {
            required: false,
            help: `A path to the directory where the bart paraphraser model is saved`
        });
        parser.addArgument('--mask', {
            required: false,
            defaultValue: false,
            action: 'storeTrue',
            help: `mask token before predicting`
        });
        parser.addArgument('--debug', {
            required: false,
            defaultValue: false,
            action: 'storeTrue',
            help: `Enable debugging, which will output intermediate result into files.`
        });
    },

    async execute(args) {
        const classDef = await loadClassDef(args.thingpedia);

        if (args.skip) {
            args.output.end(classDef.prettyprint());
        } else {
            const options = args;
            const constants = await parseConstantFile(args.locale, args.constants);
            const canonicalGenerator = new CanonicalGenerator(classDef, constants, args.queries.split(','), args.parameter_datasets, options);
            const updatedClassDef = await canonicalGenerator.generate();
            args.output.end(updatedClassDef.prettyprint());
        }

        StreamUtils.waitFinish(args.output);
    }
};
