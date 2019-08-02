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
const Stream = require('stream');
const readline = require('readline');
const ThingTalk = require('thingtalk');
const util = require('util');

const { DatasetParser, DatasetStringifier } = require('../lib/dataset-parsers');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const StreamUtils = require('../lib/stream-utils');
const Utils = require('../lib/utils');
const FileThingpediaClient = require('./lib/file_thingpedia_client');

class CacheParser extends Stream.Transform {
    constructor() {
        super({ objectMode: true });
    }

    _transform(line, encoding, callback) {
        const [from, to] = line.split('\t');
        callback(null, { from, to });
    }

    _flush(callback) {
        callback();
    }
}

class CacheSerializer extends Stream.Transform {
    constructor() {
        super({ writableObjectMode: true });
    }

    _transform(entry, encoding, callback) {
        callback(null, `${entry.from}\t${entry.to}\n`);
    }

    _flush(callback) {
        callback();
    }
}

class TypecheckStream extends Stream.Transform {
    constructor(schemas, cache, cacheOut, droppedOut, args) {
        super({ objectMode: true });

        this._schemas = schemas;
        this._cache = cache;
        this._cacheOut = cacheOut;
        this._droppedOut = droppedOut;

        this._interactive = args.interactive;
        if (args.interactive) {
            this._rl = readline.createInterface({ input: process.stdin, output: process.stdout });
            this._rl.setPrompt('$ ');
            this._rl.on('line', this._onLine.bind(this));
        }


        this._current = undefined;
        this._entities = undefined;
        this._resolve = undefined;
    }

    _onLine(line) {
        line = line.trim();
        if (!line) {
            this._rl.prompt();
            return;
        }

        if (line === 'h' || line === '?') {
            this._help();
            this._rl.prompt();
            return;
        }

        if (line === 'q') {
            this._quit();
            return;
        }

        if (line === 'd') {
            this._resolve(false);
            return;
        }

        this._learn(line).catch((e) => this.emit('error', e));
    }

    _help() {
        console.log('Available commands:');
        console.log('q: quit (switch to non-interactive mode)');
        console.log('d: drop');
        console.log('? or h: this help');
        console.log('Any other input is interpreted as a ThingTalk program');
    }

    async _learn(line) {
        try {
            const program = await ThingTalk.Grammar.parseAndTypecheck(line, this._schemas, false);

            const clone = {};
            Object.assign(clone, this._entities);
            const code = ThingTalk.NNSyntax.toNN(program, this._current.preprocessed, clone).join(' ');

            const cacheEntry = { from: this._current.target_code, to: code };
            this._cache.set(this._current.target_code, cacheEntry);
            if (this._cacheOut)
                this._cacheOut.write(cacheEntry);
            this._current.target_code = code;
            this._resolve(true);
        } catch(e) {
            console.log(e.name + ': ' + e.message);
            this._rl.prompt();
        }
    }

    _quit() {
        if (this._resolve)
            this._resolve(false);
        this._rl.close();
        this._interactive = false;
    }

    async _process(ex) {
        this._current = ex;
        this._entities = Utils.makeDummyEntities(ex.preprocessed);
        const program = ThingTalk.NNSyntax.fromNN(ex.target_code.split(' '), this._entities);

        try {
            await program.typecheck(this._schemas);
            this.push(ex);
            return;
        } catch(e) {
            if (this._cache.has(ex.target_code)) {
                ex.target_code = this._cache.get(ex.target_code).to;
                this.push(ex);
                return;
            }

            let ok = false;
            if (this._interactive) {
                console.log(`${ex.id}: ${e.name}: ${e.message}`);
                console.log(ex.preprocessed);
                console.log(program.prettyprint());
                ok = await new Promise((resolve, reject) => {
                    this._resolve = resolve;
                    this._rl.write(program.prettyprint());
                    this._rl.prompt();
                });
            }
            if (ok)
                this.push(this._current);
            else
                this._droppedOut.write(this._current);
        }
    }

    _transform(ex, encoding, callback) {
        this._process(ex).then(() => callback(), callback);
    }

    _flush(callback) {
        if (this._interactive)
            this._rl.close();

        this._droppedOut.end();
        this._cacheOut.end();
        callback();
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('typecheck', {
            addHelp: true,
            description: "Typecheck a dataset, optionally applying transformations to ensure the types are correct."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['--dropped'], {
            required: true,
            help: "Location where to save sentences that were dropped",
            type: fs.createWriteStream
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--cache', {
            help: "Cache file with previously applied transformations."
        });
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Process a contextual dataset.',
            defaultValue: false
        });
        parser.addArgument('--interactive', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Fix problems interactively.',
            defaultValue: false
        });
        parser.addArgument('--no-interactive', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'interactive',
            help: 'Fix problems automatically with no interaction.',
            defaultValue: false
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to typecheck (in TSV format); use - for standard input'
        });

        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
            defaultValue: false
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
        const tpClient = new FileThingpediaClient(args);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, !args.debug);

        let cache, cacheOut;
        if (args.cache) {
            if (await util.promisify(fs.exists)(args.cache)) {
                cache = await readAllLines([fs.createReadStream(args.cache)])
                    .pipe(new CacheParser())
                    .pipe(new StreamUtils.MapAccumulator('from'))
                    .read();
            } else {
                cache = new Map;
            }
            cacheOut = new CacheSerializer();
            cacheOut.pipe(fs.createWriteStream(args.cache, { flags: 'a' }));
        } else {
            cache = new Map;
            cacheOut = null;
        }
        const droppedOut = new DatasetStringifier();
        droppedOut.pipe(args.dropped);

        readAllLines(args.input_file)
            .pipe(new DatasetParser({ contextual: args.contextual }))
            .pipe(new TypecheckStream(schemas, cache, cacheOut, droppedOut, args))
            .pipe(new DatasetStringifier())
            .pipe(args.output);

        await Promise.all([
            StreamUtils.waitFinish(args.output),
            StreamUtils.waitFinish(args.dropped)
        ]);
    }
};
