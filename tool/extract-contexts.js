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
const Stream = require('stream');
const ThingTalk = require('thingtalk');

const { DatasetParser } = require('../lib/dataset-parsers');
const { shuffle } = require('../lib/random');
const { ENTITIES } = require('../lib/utils');

const StreamUtils = require('../lib/stream-utils');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const FileThingpediaClient = require('./lib/file_thingpedia_client');

async function normalize(schemas, code) {
    try {
        const program = ThingTalk.NNSyntax.fromNN(code.split(' '), (entity) => {
            if (entity in ENTITIES)
                return ENTITIES[entity];
            else if (entity.startsWith('GENERIC_ENTITY_'))
                return { value: entity, display: entity };
            else
                throw new TypeError(`Unrecognized entity ${entity}`);
        });
        await program.typecheck(schemas, false);

        const entities = {};
        return ThingTalk.NNSyntax.toNN(program, '', entities, { allocateEntities: true }).join(' ');
    } catch(e) {
        console.error(code);
        throw e;
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('extract-contexts', {
            addHelp: true,
            description: "Extract normalized contexts from a non-contextual dataset."
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
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to extract contexts from (in TSV format); use - for standard input'
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
        const rng = seedrandom.alea(args.random_seed);
        const tpClient = new FileThingpediaClient(args);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, !args.debug);

        let allprograms = await readAllLines(args.input_file)
            .pipe(new DatasetParser())
            .pipe(new Stream.Transform({
                objectMode: true,

                transform(ex, encoding, callback) {
                    normalize(schemas, ex.target_code).then((code) => callback(null, code), callback);
                },

                flush(callback) {
                    process.nextTick(callback);
                }
            }))
            .pipe(new StreamUtils.SetAccumulator())
            .read();
        allprograms = Array.from(allprograms);

        shuffle(allprograms, rng);
        for (let prog of allprograms) {
            args.output.write(prog);
            args.output.write('\n');
        }
        args.output.end();

        await StreamUtils.waitFinish(args.output);
    }
};
