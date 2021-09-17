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
import * as stream from 'stream';
import * as fs from 'fs';
import * as events from 'events';
import csvparse from 'csv-parse';
import csvstringify from 'csv-stringify';
import * as readline from 'readline';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';

import * as ParserClient from '../lib/prediction/parserclient';
import { SentenceExample, DatasetStringifier } from '../lib/dataset-tools/parsers';
import { EntityMap } from '../lib/utils/entity-utils';
import * as ThingTalkUtils from '../lib/utils/thingtalk';

function waitFinish(stream : stream.Writable) {
    return new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}
function waitEnd(stream : stream.Readable) {
    return new Promise((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
    });
}

interface TrainerOptions {
    locale : string;
    timezone : string;
    thingpedia : string;
    server : string;
    offset : number;
}

interface DroppedExample {
    id : string;
    utterance : string;
    comment : string;
}

class Trainer extends events.EventEmitter {
    private _rl : readline.Interface;
    private _tpClient : Tp.BaseClient;
    private _schemas : ThingTalk.SchemaRetriever;
    private _parser : ParserClient.ParserClient;
    private _locale : string;
    private _timezone : string;

    private _nextLine : Iterator<string>;

    private _state : 'loading'|'code'|'top3'|'full';
    private _candidates : ThingTalk.Ast.Input[]|undefined;
    private _utterance : string|undefined;
    private _preprocessed : string|undefined;
    private _comment : string|undefined;
    private _entities : EntityMap|undefined;
    private _serial : number;
    private _id : string|undefined;

    constructor(rl : readline.Interface, lines : string[], options : TrainerOptions) {
        super();

        this._rl = rl;

        this._locale = options.locale;
        this._timezone = options.timezone;
        this._tpClient = new Tp.FileClient(options);
        this._schemas = new ThingTalk.SchemaRetriever(this._tpClient, null, true);
        this._parser = ParserClient.get(options.server, 'en-US');

        this._nextLine = lines[Symbol.iterator]();

        this._state = 'loading';
        this._candidates = undefined;
        this._utterance = undefined;
        this._preprocessed = undefined;
        this._comment = undefined;
        this._entities = undefined;
        this._serial = options.offset - 2;
        this._id = undefined;

        rl.on('line', async (line) => {
            if (line.trim().length === 0 || this._state === 'loading') {
                rl.prompt();
                return;
            }

            if (line === 'd' || line.startsWith('d ')) {
                let comment = line.substring(2).trim();
                if (!comment && this._comment)
                    comment = this._comment;

                const ex : DroppedExample = { id: this._id!, utterance: this._utterance!, comment };
                this.emit('dropped', ex);
                this.next();
                return;
            }

            if (this._state === 'code') {
                this._learnThingTalk(line).catch((e) => this.emit('error', e));
                return;
            }

            if (Number.isFinite(parseInt(line))) {
                this._learnNumber(parseInt(line));
            } else if (line === 'n') {
                this._more();
            } else if (line.startsWith('e ')) {
                this._edit(parseInt(line.substring(2).trim()));
            } else if (line === 't') {
                this._state = 'code';
                rl.setPrompt('TT: ');
                rl.prompt();
            } else {
                //console.log('Invalid command');
                //rl.prompt();
                this._learnThingTalk(line).catch((e) => this.emit('error', e));
            }
        });
    }

    async start() {
        await this._parser.start();
    }
    async stop() {
        await this._parser.stop();
    }

    private async _learnProgram(program : ThingTalk.Ast.Input) {
        let targetCode;
        try {
            targetCode = ThingTalkUtils.serializePrediction(program, this._preprocessed!, this._entities!, {
                locale: this._locale,
                timezone: this._timezone,
            }).join(' ');
        } catch(e) {
            console.log(`${e.name}: ${e.message}`);
            this._rl.setPrompt('TT: ');
            this._rl.prompt();
            return;
        }
        console.log(`Learned: ${targetCode}`);
        this.emit('learned', {
            id: this._id,
            flags: {},
            preprocessed: this._preprocessed,
            target_code: targetCode
        });
        this.next();
    }

    private async _learnThingTalk(code : string) {
        let program;
        try {
            program = await ThingTalkUtils.parse(code, this._schemas);
        } catch(e) {
            console.log(`${e.name}: ${e.message}`);
            this._rl.setPrompt('TT: ');
            this._rl.prompt();
            return;
        }
        this._learnProgram(program);
    }

    private _edit(i : number) {
        if (Number.isNaN(i) || i < 1 || i > this._candidates!.length) {
            console.log('Invalid number');
            this._rl.setPrompt('$ ');
            this._rl.prompt();
            return;
        }
        i -= 1;
        const program = this._candidates![i];
        this._state = 'code';
        this._rl.setPrompt('TT: ');
        this._rl.write(program.prettyprint());
        this._rl.prompt();
    }

    private _learnNumber(i : number) {
        if (i < 1 || i > this._candidates!.length) {
            console.log('Invalid number');
            this._rl.setPrompt('$ ');
            this._rl.prompt();
            return;
        }
        i -= 1;
        this._learnProgram(this._candidates![i]);
    }

    private _more() {
        if (this._state === 'top3') {
            this._state = 'full';
            console.log(`Sentence #${this._serial+1} (${this._id}): ${this._utterance}`);
            const candidates = this._candidates!;
            for (let i = 0; i < candidates.length; i++)
                console.log(`${i+1}) ${candidates[i].prettyprint()}`);
            this._rl.setPrompt('$ ');
            this._rl.prompt();
        } else {
            this._state = 'code';
            this._rl.setPrompt('TT: ');
            this._rl.prompt();
        }
    }

    next() {
        this._next().catch((e) => this.emit('error', e));
    }

    private async _next() {
        this._serial++;

        const { value: line, done } = this._nextLine.next();
        if (done) {
            this.emit('end');
            return;
        }

        this._state = 'loading';
        const { id, utterance, preprocessed, target_code, comment } = line;
        this._utterance = utterance;
        let oldTargetCode = target_code || preprocessed;

        const parsed = await this._parser.sendUtterance(utterance, /* context */ undefined, /* contextEntities */ {}, {
            tokenized: false,
            skip_typechecking: true
        });

        if (oldTargetCode) {
            try {
                await ThingTalkUtils.parsePrediction(oldTargetCode.split(' '), parsed.entities, {
                    timezone: this._timezone,
                    thingpediaClient: this._tpClient,
                    schemaRetriever: this._schemas
                }, true);
            } catch(e) {
                console.log(`Sentence ${id}'s existing code is incorrect: ${e}`); //'
                oldTargetCode = undefined;
            }
        }
        if (oldTargetCode)
            parsed.candidates.unshift({ code: oldTargetCode.split(' '), score: 'Infinity' });

        this._state = 'top3';
        this._id = id || String(this._serial);
        this._comment = comment;
        this._preprocessed = parsed.tokens.join(' ');
        this._entities = parsed.entities;
        const candidates = await ThingTalkUtils.parseAllPredictions(parsed.candidates, parsed.entities, {
            timezone: this._timezone,
            thingpediaClient: this._tpClient,
            schemaRetriever: this._schemas
        });
        this._candidates = candidates;

        console.log(`Sentence #${this._serial+1} (${this._id}): ${utterance}`);
        if (this._comment)
            console.log(`(previously dropped as "${this._comment}")`);
        for (let i = 0; i < 3 && i < candidates.length; i++)
            console.log(`${i+1}) ${candidates[i].prettyprint()}`);
        this._rl.setPrompt('$ ');
        this._rl.prompt();
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('manual-annotate', {
        add_help: true,
        description: `Import a manually annotated dataset. For each command use ` +
            `"$number": to select from the candidates, ` +
            `"e $number": to edit on top of the selected thingtalk code, ` +
            `"n": show more candidates, ` +
            `"t": to type in the thingtalk directly, ` +
            `"d": drop the example,` +
            `"d $comment": drop the example with some comment.`
    });
    parser.add_argument('--annotated', {
        required: false,
        default: './annotated.tsv',
    });
    parser.add_argument('--dropped', {
        required: false,
        default: './dropped.tsv',
    });
    parser.add_argument('input', {
        type: fs.createReadStream,
        help: `The script expects a tsv input file with columns: id, utterance, preprocessed, target_code`
    });
    parser.add_argument('--offset', {
        required: false,
        type: parseInt,
        default: 1,
        help: `Start from the nth line of the input tsv file.`
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
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
    parser.add_argument('--server', {
        required: false,
        default: 'https://almond-nl.stanford.edu',
        help: `The URL of the natural language server.`
    });
}

export async function execute(args : any) {
    const learned = new DatasetStringifier();
    learned.pipe(fs.createWriteStream(args.annotated, { flags: (args.offset > 0 ? 'a' : 'w') }));
    const droppedfile = fs.createWriteStream(args.dropped, { flags: (args.offset > 0 ? 'a' : 'w') });
    const dropped = csvstringify({ header: true, delimiter: '\t' });
    dropped.pipe(droppedfile);

    let lines : string[] = [];
    args.input.setEncoding('utf8');
    const input = args.input.pipe(csvparse({ columns: true, relax: true, delimiter: '\t' }));
    input.on('data', (line : string) => {
        lines.push(line);
    });
    await waitEnd(input);

    if (args.offset > 1)
        lines = lines.slice(args.offset-1);

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt('$ ');

    function quit() {
        learned.end();
        dropped.end();

        console.log('Bye\n');
        rl.close();
        //process.exit();
    }

    const trainer = new Trainer(rl, lines, args);
    trainer.on('end', quit);
    trainer.on('learned', (ex : SentenceExample) => {
        learned.write(ex);
    });
    trainer.on('dropped', (row : DroppedExample) => {
        dropped.write(row);
    });
    rl.on('SIGINT', quit);
    await trainer.start();
    trainer.next();
    //process.stdin.on('end', quit);

    await Promise.all([
        waitFinish(learned),
        waitFinish(droppedfile),
    ]);

    await trainer.stop();
}
