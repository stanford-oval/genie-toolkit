// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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


import * as fs from 'fs';
import Stream from 'stream';
import * as readline from 'readline';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import util from 'util';

import { DatasetParser, DatasetStringifier } from '../lib/dataset-tools/parsers';
import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import * as StreamUtils from '../lib/utils/stream-utils';
import * as Utils from '../lib/utils/misc-utils';

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
            this._rl.on('line', (line) => this._onLine(line));
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

    _cacheable(from, to) {
        if (to === 'null')
            return true;

        // if the number of quotes changed in from/to, then the mapping depends on
        // the sentence as well, so the program is not cacheable
        const fromqcount = from.split(' ').filter((t) => t === '"').length;
        const toqcount = to.split(' ').filter((t) => t === '"').length;
        return fromqcount === toqcount;
    }

    _doCache(to) {
        if (!this._cacheable(this._current.target_code, to))
            return;
        const cacheEntry = { from: this._current.target_code, to };
        this._cache.set(this._current.target_code, cacheEntry);
        if (this._cacheOut)
            this._cacheOut.write(cacheEntry);
    }

    async _learn(line) {
        try {
            const program = await ThingTalk.Grammar.parseAndTypecheck(line, this._schemas, false);

            const clone = {};
            Object.assign(clone, this._entities);
            const code = ThingTalk.NNSyntax.toNN(program, this._current.preprocessed, clone).join(' ');

            this._doCache(code);
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
        let program;
        try {
            program = ThingTalk.NNSyntax.fromNN(ex.target_code.split(' '), this._entities);

            await program.typecheck(this._schemas);

            // run toNN to verify all the strings/entities are correct
            const clone = {};
            Object.assign(clone, this._entities);
            ThingTalk.NNSyntax.toNN(program, this._current.preprocessed, clone);

            this.push(ex);
            return;
        } catch(e) {
            if (this._cache.has(ex.target_code)) {
                const cached = this._cache.get(ex.target_code);
                if (cached.to === 'null') {
                    this._droppedOut.write(this._current);
                    return;
                }

                ex.target_code = this._cache.get(ex.target_code).to;
                this.push(ex);
                return;
            }

            let ok = false;
            if (this._interactive) {
                console.log(`${ex.id}: ${e.name}: ${e.message}`);
                console.log(ex.preprocessed);
                if (program)
                    console.log(program.prettyprint());
                else
                    console.log(ex.target_code);
                ok = await new Promise((resolve, reject) => {
                    this._resolve = resolve;
                    if (program)
                        this._rl.write(program.prettyprint().replace(/\n/g, ' '));
                    this._rl.prompt();
                });
            }
            if (ok) {
                this.push(this._current);
            } else {
                this._doCache('null');
                this._droppedOut.write(this._current);
            }
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

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('typecheck', {
        add_help: true,
        description: "Typecheck a dataset, optionally applying transformations to ensure the types are correct."
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream
    });
    parser.add_argument('--dropped', {
        required: true,
        help: "Location where to save sentences that were dropped",
        type: fs.createWriteStream
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--cache', {
        help: "Cache file with previously applied transformations."
    });
    parser.add_argument('--contextual', {
        action: 'store_true',
        help: 'Process a contextual dataset.',
        default: false
    });
    parser.add_argument('--interactive', {
        action: 'store_true',
        help: 'Fix problems interactively.',
        default: false
    });
    parser.add_argument('--no-interactive', {
        action: 'store_false',
        dest: 'interactive',
        help: 'Fix problems automatically with no interaction.',
        default: false
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: maybeCreateReadStream,
        help: 'Input datasets to typecheck (in TSV format); use - for standard input'
    });

    parser.add_argument('--debug', {
        action: 'store_true',
        help: 'Enable debugging.',
        default: false
    });
    parser.add_argument('--no-debug', {
        action: 'store_false',
        dest: 'debug',
        help: 'Disable debugging.',
    });
    parser.add_argument('--random-seed', {
        default: 'almond is awesome',
        help: 'Random seed'
    });
}

export async function execute(args) {
    const tpClient = new Tp.FileClient(args);
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
