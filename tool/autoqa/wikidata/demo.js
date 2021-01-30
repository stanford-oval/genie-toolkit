// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Silei Xu <silei@cs.stanford.edu>
"use strict";

const readline = require('readline');
const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');
const ParserClient = require('../../../lib/prediction/parserclient');

const { wikidataQuery } = require('./utils');

class CommandLineHandler {
    constructor(rl, options) {
        this._rl = rl;
        this._rl.on('line', this._onLine.bind(this));
        this._rl.on('SIGINT', this._quit.bind(this));

        const tpClient = new Tp.FileClient(options);
        this._schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
        this._parser = ParserClient.get(options.server, 'en-US');
    }

    async start() {
        await this._parser.start();
        this._rl.prompt();
    }

    async _quit() {
        console.log('Bye\n');
        await this._parser.stop();
        this._engine.stop();
        this._rl.close();
    }

    async _parseCommand(line) {
        const parsed = await this._parser.sendUtterance(line, /* context */ undefined, /* contextEntities */ {}, {
            tokenized: false,
            skip_typechecking: true
        });
        if (parsed.candidates.length === 0) {
            console.log('Failed to parse the query. Please try something different');
            return;
        }
        const code = parsed.candidates[0].code;
        let program;
        try {
            program = ThingTalk.NNSyntax.fromNN(code, parsed.entities);
            await program.typecheck(this._schemas);
            console.log(`ThingTalk: ${program.prettyprint()}`);
        } catch(e) {
            console.log(`The model failed to make a prediction that is syntax correct, please try something else`);
            console.error(`Prediction: ${code.join(' ')}`);
            return;
        }

        try {
            const sparql = ThingTalk.Helper.toSparql(program);
            console.log(`SPARQL: ${sparql}`);
            console.log(`Querying Wikidata Server... (this may take up to 30 seconds)`);
            const results = await wikidataQuery(sparql);
            console.log(`Answer:`);
            for (let result of results)
                console.log(result);
        } catch(e) {
            if (e.code)
                console.error('Something went wrong when querying Wikidata server, check the log for details.');
            else
                console.error(e);
        }

    }

    async _onLine(line) {
        await this._parseCommand(line);
        this._rl.prompt();
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.add_parser('wikidata-demo', {
            add_help: true,
            description: "Demo a Wikidata skill."
        });
        parser.add_argument('-l', '--locale', {
            required: false,
            default: 'en-US',
            help: `BGP 47 locale tag of the language to use for the assistant (defaults to 'en-US', English)`
        });
        parser.add_argument('--manifest', {
            required: true,
            help: 'URL of wikidata manifest to use.'
        });
        parser.add_argument('--model', {
            required: true,
            help: 'NLP server URL to use for NLU (can be a file:/// URL).'
        });
    },

    async execute(args) {
        const options = {
            thingpedia: args.manifest,
            server: args.model
        };

        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.setPrompt('$ ');
        const handler = new CommandLineHandler(rl, options);
        await handler.start();
    }
};
