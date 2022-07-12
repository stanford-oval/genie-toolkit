// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import * as argparse from 'argparse';
import * as fs from 'fs';
import Stream from 'stream';
import * as readline from 'readline';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import util from 'util';

import { SentenceExample, DatasetParser, DatasetStringifier } from '../lib/dataset-tools/parsers';
import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import * as StreamUtils from '../lib/utils/stream-utils';
import * as Utils from '../lib/utils/misc-utils';
import { EntityMap } from '../lib/utils/entity-utils';
import * as ThingTalkUtils from '../lib/utils/thingtalk';

interface CacheEntry {
    from : string;
    to : string;
}

class CacheParser extends Stream.Transform {
    constructor() {
        super({ objectMode: true });
    }

    _transform(line : string, encoding : BufferEncoding, callback : (err ?: Error|null, res ?: CacheEntry) => void) {
        const [from, to] = line.split('\t');
        callback(null, { from, to });
    }

    _flush(callback : () => void) {
        callback();
    }
}

class CacheSerializer extends Stream.Transform {
    constructor() {
        super({ writableObjectMode: true });
    }

    _transform(entry : CacheEntry, encoding : BufferEncoding, callback : (err ?: Error|null, res ?: string|Buffer) => void) {
        callback(null, `${entry.from}\t${entry.to}\n`);
    }

    _flush(callback : () => void) {
        callback();
    }
}

class TypecheckStream extends Stream.Transform {
    private _locale : string;
    private _timezone : string;
    private _includeEntityValue : boolean;
    private _excludeEntityDisplay : boolean;
    private _tpClient : Tp.BaseClient;
    private _schemas : ThingTalk.SchemaRetriever;
    private _cache : Map<string, CacheEntry>;
    private _cacheOut : Stream.Writable|undefined;
    private _droppedOut : Stream.Writable;
    private _interactive : boolean;
    private _strict : boolean;
    private _rl ?: readline.Interface;

    private _current : SentenceExample|undefined;
    private _entities : EntityMap|undefined;
    private _resolve : ((res : boolean) => void)|undefined;

    constructor(tpClient : Tp.BaseClient,
                schemas : ThingTalk.SchemaRetriever,
                cache : Map<string, CacheEntry>,
                cacheOut : Stream.Writable|undefined,
                droppedOut : Stream.Writable,
                args : { 
                    interactive : boolean, 
                    strict : boolean, 
                    locale : string, 
                    timezone : string, 
                    include_entity_value : boolean, 
                    exclude_entity_display : boolean 
                }) {
        super({ objectMode: true });

        this._locale = args.locale;
        this._timezone = args.timezone;
        this._includeEntityValue = args.include_entity_value;
        this._excludeEntityDisplay = args.exclude_entity_display;
        this._tpClient = tpClient;
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
        this._strict = args.strict;

        this._current = undefined;
        this._entities = undefined;
        this._resolve = undefined;
    }

    private _onLine(line : string) {
        line = line.trim();
        if (!line) {
            this._rl!.prompt();
            return;
        }

        if (line === 'h' || line === '?') {
            this._help();
            this._rl!.prompt();
            return;
        }

        if (line === 'q') {
            this._quit();
            return;
        }

        if (line === 'd') {
            this._resolve!(false);
            return;
        }

        this._learn(line).catch((e) => this.emit('error', e));
    }

    private _help() {
        console.log('Available commands:');
        console.log('q: quit (switch to non-interactive mode)');
        console.log('d: drop');
        console.log('? or h: this help');
        console.log('Any other input is interpreted as a ThingTalk program');
    }

    private _cacheable(from : string, to : string) {
        if (to === 'null')
            return true;

        // if the number of quotes changed in from/to, then the mapping depends on
        // the sentence as well, so the program is not cacheable
        const fromqcount = from.split(' ').filter((t) => t === '"').length;
        const toqcount = to.split(' ').filter((t) => t === '"').length;
        return fromqcount === toqcount;
    }

    private _doCache(to : string) {
        const targetCode = String(this._current!.target_code);
        if (!this._cacheable(targetCode, to))
            return;
        const cacheEntry = { from: targetCode, to };
        this._cache.set(targetCode, cacheEntry);
        if (this._cacheOut)
            this._cacheOut.write(cacheEntry);
    }

    async _learn(line : string) {
        try {
            const program = await ThingTalkUtils.parse(line, this._schemas);
            const code = ThingTalkUtils.serializePrediction(program, this._current!.preprocessed, this._entities!, {
                locale: this._locale,
                timezone: this._timezone,
                includeEntityValue: this._includeEntityValue,
                excludeEntityDisplay: this._excludeEntityDisplay
            }).join(' ');

            this._doCache(code);
            this._current!.target_code = code;
            this._resolve!(true);
        } catch(e) {
            console.log(e.name + ': ' + e.message);
            this._rl!.prompt();
        }
    }

    private _quit() {
        if (this._resolve)
            this._resolve(false);
        this._rl!.close();
        this._interactive = false;
    }

    private async _process(ex : SentenceExample) {
        this._current = ex;
        this._entities = Utils.makeDummyEntities(ex.preprocessed);
        let program : ThingTalk.Ast.Input|undefined;
        try {
            program = await ThingTalkUtils.parsePrediction(String(ex.target_code).split(' '), this._entities, {
                timezone: this._timezone,
                thingpediaClient: this._tpClient,
                schemaRetriever: this._schemas,
            }, true);

            ex.target_code = ThingTalkUtils.serializePrediction(program!, this._current!.preprocessed, this._entities, {
                locale: this._locale,
                timezone: this._timezone,
                includeEntityValue: this._includeEntityValue,
                excludeEntityDisplay: this._excludeEntityDisplay
            }).join(' ');
            this.push(ex);
            return;
        } catch(e) {
            if (this._strict)
                throw e;

            if (this._cache.has(String(ex.target_code))) {
                const cached = this._cache.get(String(ex.target_code))!;
                if (cached.to === 'null') {
                    this._droppedOut.write(this._current);
                    return;
                }

                ex.target_code = cached.to;
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
                        this._rl!.write(program.prettyprint().replace(/\n/g, ' '));
                    this._rl!.prompt();
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

    _transform(ex : SentenceExample, encoding : BufferEncoding, callback : (err ?: Error) => void) {
        this._process(ex).then(() => callback(), callback);
    }

    _flush(callback : () => void) {
        if (this._interactive)
            this._rl!.close();

        this._droppedOut.end();
        if (this._cacheOut)
            this._cacheOut.end();
        callback();
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
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
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
    });
    parser.add_argument('--timezone', {
        required: false,
        default: undefined,
        help: `Timezone to use to interpret dates and times (defaults to the current timezone).`
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
    });
    parser.add_argument('--strict', {
        action: 'store_true',
        help: 'Abort on any error.',
        default: false
    });
    parser.add_argument('--no-strict', {
        action: 'store_false',
        dest: 'strict',
        help: 'Silently ignore errors.',
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
    parser.add_argument('--include-entity-value', {
        action: 'store_true',
        help: "Include entity value in thingtalk",
        default: false
    });
    parser.add_argument('--exclude-entity-display', {
        action: 'store_true',
        help: "Drop entity display in thingtalk",
        default: false
    });
}

export async function execute(args : any) {
    const tpClient = new Tp.FileClient(args);
    const schemas = new ThingTalk.SchemaRetriever(tpClient, null, !args.debug);

    let cache : Map<string, CacheEntry>, cacheOut;
    if (args.cache) {
        if (await util.promisify(fs.exists)(args.cache)) {
            cache = await readAllLines([fs.createReadStream(args.cache)])
                .pipe(new CacheParser())
                .pipe(new StreamUtils.MapAccumulator<CacheEntry, 'from'>('from'))
                .read();
        } else {
            cache = new Map;
        }
        cacheOut = new CacheSerializer();
        cacheOut.pipe(fs.createWriteStream(args.cache, { flags: 'a' }));
    } else {
        cache = new Map;
        cacheOut = undefined;
    }
    const droppedOut = new DatasetStringifier();
    droppedOut.pipe(args.dropped);

    readAllLines(args.input_file)
        .pipe(new DatasetParser({ contextual: args.contextual }))
        .pipe(new TypecheckStream(tpClient, schemas, cache, cacheOut, droppedOut, args))
        .pipe(new DatasetStringifier())
        .pipe(args.output);

    await Promise.all([
        StreamUtils.waitFinish(args.output),
        StreamUtils.waitFinish(args.dropped)
    ]);
}
