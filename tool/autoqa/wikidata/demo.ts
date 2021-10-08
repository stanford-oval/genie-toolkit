// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as argparse from 'argparse';
import * as readline from 'readline';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';

import * as ParserClient from '../../../lib/prediction/parserclient';
import * as ThingTalkUtils from '../../../lib/utils/thingtalk';

import { wikidataQuery } from './utils';

class CommandLineHandler {
    private _locale : string;
    private _timezone : string|undefined;
    private _rl : readline.Interface;
    private _tpClient : Tp.BaseClient;
    private _schemas : ThingTalk.SchemaRetriever;
    private _parser : ParserClient.ParserClient;

    constructor(rl : readline.Interface, options : { locale : string, timezone : string|undefined, server : string, thingpedia : string }) {
        this._rl = rl;
        this._rl.on('line', this._onLine.bind(this));
        this._rl.on('SIGINT', this._quit.bind(this));

        this._locale = options.locale;
        this._timezone = options.timezone;

        this._tpClient = new Tp.FileClient(options);
        this._schemas = new ThingTalk.SchemaRetriever(this._tpClient, null, true);
        this._parser = ParserClient.get(options.server, 'en-US');
    }

    async start() {
        await this._parser.start();
        this._rl.prompt();
    }

    private async _quit() {
        console.log('Bye\n');
        await this._parser.stop();
        this._rl.close();
    }

    private async _parseCommand(line : string) {
        const parsed = await this._parser.sendUtterance(line, /* context */ undefined, /* contextEntities */ {}, {
            tokenized: false,
            skip_typechecking: true
        });
        if (parsed.candidates.length === 0) {
            console.log('Failed to parse the query. Please try something different');
            return;
        }
        const candidates = await ThingTalkUtils.parseAllPredictions(parsed.candidates, parsed.entities, {
            locale: this._locale,
            timezone: this._timezone,
            thingpediaClient: this._tpClient,
            schemaRetriever: this._schemas
        });
        const program = candidates[0];
        if (program && program instanceof ThingTalk.Ast.Program) {
            console.log(`ThingTalk: ${program.prettyprint()}`);
        } else {
            console.log(`The model failed to make a prediction that is syntactically correct, please try something else`);
            console.error(`Prediction: ${parsed.candidates[0].code.join(' ')}`);
            return;
        }

        try {
            const sparql = ThingTalk.Helper.toSparql(program);
            console.log(`SPARQL: ${sparql}`);
            console.log(`Querying Wikidata Server... (this may take up to 30 seconds)`);
            const results = await wikidataQuery(sparql);
            console.log(`Answer:`);
            for (const result of results)
                console.log(result);
        } catch(e) {
            if (e.code)
                console.error('Something went wrong when querying Wikidata server, check the log for details.');
            else
                console.error(e);
        }

    }

    private async _onLine(line : string) {
        await this._parseCommand(line);
        this._rl.prompt();
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('wikidata-demo', {
        add_help: true,
        description: "Demo a Wikidata skill."
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to use for the assistant (defaults to 'en-US', English)`
    });
    parser.add_argument('--timezone', {
        required: false,
        default: undefined,
        help: `Timezone to use to interpret dates and times (defaults to the current timezone).`
    });
    parser.add_argument('--manifest', {
        required: true,
        help: 'URL of wikidata manifest to use.'
    });
    parser.add_argument('--model', {
        required: true,
        help: 'NLP server URL to use for NLU (can be a file:/// URL).'
    });
}

export async function execute(args : any) {
    const options = {
        locale: args.locale,
        timezone: args.timezone,
        thingpedia: args.manifest,
        server: args.model
    };

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt('$ ');
    const handler = new CommandLineHandler(rl, options);
    await handler.start();
}
