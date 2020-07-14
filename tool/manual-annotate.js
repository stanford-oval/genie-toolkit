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
"use strict";

const fs = require('fs');
const events = require('events');
const csvparse = require('csv-parse');
const csvstringify = require('csv-stringify');
const readline = require('readline');
const Tp = require('thingpedia');

const ParserClient = require('../lib/prediction/parserclient');
const { DatasetStringifier } = require('../lib/dataset-tools/parsers');

const ThingTalk = require('thingtalk');

function waitFinish(stream) {
    return new Promise((resolve, reject) => {
        stream.on('finish', resolve);
        stream.on('error', reject);
    });
}
function waitEnd(stream) {
    return new Promise((resolve, reject) => {
        stream.on('end', resolve);
        stream.on('error', reject);
    });
}

class Trainer extends events.EventEmitter {
    constructor(rl, lines, options) {
        super();

        this._rl = rl;

        const tpClient = new Tp.FileClient(options);
        this._schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
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

                this.emit('dropped', { id: this._id, utterance: this._utterance, comment });
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

    async _learnProgram(program) {
        let targetCode;
        try {
            let clone = {};
            Object.assign(clone, this._entities);
            targetCode = ThingTalk.NNSyntax.toNN(program, this._preprocessed, clone).join(' ');
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

    async _learnThingTalk(code) {
        let program;
        try {
            program = await ThingTalk.Grammar.parseAndTypecheck(code, this._schemas);
        } catch(e) {
            console.log(`${e.name}: ${e.message}`);
            this._rl.setPrompt('TT: ');
            this._rl.prompt();
            return;
        }
        this._learnProgram(program);
    }

    _edit(i) {
        if (Number.isNaN(i) || i < 1 || i > this._candidates.length) {
            console.log('Invalid number');
            this._rl.setPrompt('$ ');
            this._rl.prompt();
            return;
        }
        i -= 1;
        const program = this._candidates[i];
        this._state = 'code';
        this._rl.setPrompt('TT: ');
        this._rl.write(program.prettyprint(true));
        this._rl.prompt();
    }

    _learnNumber(i) {
        if (i < 1 || i > this._candidates.length) {
            console.log('Invalid number');
            this._rl.setPrompt('$ ');
            this._rl.prompt();
            return;
        }
        i -= 1;
        this._learnProgram(this._candidates[i]);
    }

    _more() {
        if (this._state === 'top3') {
            this._state = 'full';
            console.log(`Sentence #${this._serial+1} (${this._id}): ${this._utterance}`);
            for (let i = 0; i < this._candidates.length; i++)
                console.log(`${i+1}) ${this._candidates[i].code.join(' ')}`);
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

    async _next() {
        this._serial++;

        const { value: line, done } = this._nextLine.next();
        if (done) {
            this.emit('end');
            return;
        }

        this._state = 'loading';
        let { id, utterance, preprocessed, target_code: oldTargetCode, comment } = line;
        this._utterance = utterance;
        if (!oldTargetCode)
            oldTargetCode = preprocessed;

        if (!id)
            id = this._serial;

        const parsed = await this._parser.sendUtterance(utterance, /* context */ undefined, /* contextEntities */ {});

        if (oldTargetCode) {
            try {
                const program = ThingTalk.NNSyntax.fromNN(oldTargetCode.split(' '), parsed.entities);
                await program.typecheck(this._schemas);
            } catch(e) {
                console.log(`Sentence ${id}'s existing code is incorrect: ${e}`); //'
                oldTargetCode = undefined;
            }
        }
        if (oldTargetCode)
            parsed.candidates.unshift({ code: oldTargetCode.split(' '), score: 'Infinity' });

        this._state = 'top3';
        this._id = id;
        this._comment = comment;
        this._preprocessed = parsed.tokens.join(' ');
        this._entities = parsed.entities;
        this._candidates = (await Promise.all(parsed.candidates.map(async (cand) => {
            try {
                const program = ThingTalk.NNSyntax.fromNN(cand.code, parsed.entities);
                await program.typecheck(this._schemas);
                return program;
            } catch(e) {
                console.error(e);
                return null;
            }
        }))).filter((c) => c !== null);

        console.log(`Sentence #${this._serial+1} (${this._id}): ${utterance}`);
        if (this._comment)
            console.log(`(previously dropped as "${this._comment}")`);
        for (var i = 0; i < 3 && i < this._candidates.length; i++)
            console.log(`${i+1}) ${this._candidates[i].prettyprint()}`);
        this._rl.setPrompt('$ ');
        this._rl.prompt();
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('manual-annotate', {
            addHelp: true,
            description: `Import a manually annotated dataset. For each command use ` +
                `"$number": to select from the candidates, ` +
                `"e $number": to edit on top of the selected thingtalk code, ` +
                `"n": show more candidates, ` +
                `"t": to type in the thingtalk directly, ` +
                `"d": drop the example,` +
                `"d $comment": drop the example with some comment.`
        });
        parser.addArgument('--annotated', {
            required: false,
            defaultValue: './annotated.tsv',
        });
        parser.addArgument('--dropped', {
            required: false,
            defaultValue: './dropped.tsv',
        });
        parser.addArgument('input', {
            type: fs.createReadStream,
            help: `The script expects a tsv input file with columns: id, utterance, preprocessed, target_code`
        });
        parser.addArgument('--offset', {
            required: false,
            type: parseInt,
            defaultValue: 1,
            help: `Start from the nth line of the input tsv file.`
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--server', {
            required: false,
            defaultValue: 'https://almond-nl.stanford.edu',
            help: `The URL of the natural language server.`
        });
    },

    async execute(args) {
        const learned = new DatasetStringifier();
        learned.pipe(fs.createWriteStream(args.annotated, { flags: (args.offset > 0 ? 'a' : 'w') }));
        const droppedfile = fs.createWriteStream(args.dropped, { flags: (args.offset > 0 ? 'a' : 'w') });
        const dropped = csvstringify({ header: true, delimiter: '\t' });
        dropped.pipe(droppedfile);

        let lines = [];
        args.input.setEncoding('utf8');
        const input = args.input.pipe(csvparse({ columns: true, relax: true, delimiter: '\t' }));
        input.on('data', (line) => {
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
        trainer.on('learned', (ex) => {
            learned.write(ex);
        });
        trainer.on('dropped', (row) => {
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
};
