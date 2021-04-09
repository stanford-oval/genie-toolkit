// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

import * as argparse from 'argparse';
import * as Tp from 'thingpedia';
import * as Stream from 'stream';
import assert from 'assert';
import * as fs from 'fs';
import JSONStream from 'JSONStream';
import { Ast, } from 'thingtalk';

import * as StreamUtils from '../lib/utils/stream-utils';
import * as Utils from '../lib/utils/misc-utils';
import { EntityMap } from '../lib/utils/entity-utils';
import * as I18n from '../lib/i18n';
import * as ThingTalkUtils from '../lib/utils/thingtalk';
import {
    DialogueParser,
    ParsedDialogue,
    DialogueTurn
} from '../lib/dataset-tools/parsers';
import SlotExtractor from '../lib/dataset-tools/evaluation/slot_extractor';
import { SimulationDatabase } from '../lib/dialogue-agent/simulator/types';

import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import MultiJSONDatabase from './lib/multi_json_database';
import * as ParserClient from '../lib/prediction/parserclient';

interface DialogueToDSTStreamOptions {
    locale : string;
    thingpediaClient : Tp.BaseClient;
    database : SimulationDatabase|undefined;
    tokenized : boolean;
    parser : ParserClient.ParserClient;
    debug : boolean;
}

class DialogueToDSTStream extends Stream.Transform {
    private _slotExtractor : SlotExtractor;
    private _tokenized : boolean;
    private _tokenizer : I18n.BaseTokenizer;
    private _parser : ParserClient.ParserClient;
    private _options : DialogueToDSTStreamOptions;

    constructor(options : DialogueToDSTStreamOptions) {
        super({ objectMode: true });

        this._slotExtractor = new SlotExtractor(options.locale, options.thingpediaClient, options.database);
        this._tokenized = options.tokenized;
        this._tokenizer = I18n.get(options.locale).getTokenizer();
        this._parser = options.parser;
        this._options = options;
    }

    private _preprocess(sentence : string, contextEntities : EntityMap) {
        let tokenized;
        if (this._tokenized) {
            const tokens = sentence.split(' ');
            const entities = Utils.makeDummyEntities(sentence);
            tokenized = { tokens, entities };
        } else {
            tokenized = this._tokenizer.tokenize(sentence);
        }
        Utils.renumberEntities(tokenized, contextEntities);
        return tokenized;
    }

    private async _checkTurn(id : string, turn : DialogueTurn, turnIndex : number) : Promise<[Record<string, string>, Record<string, string>]> {
        let context, contextCode, contextEntities;
        if (turnIndex > 0) {
            if (turn.intermediate_context) {
                context = await ThingTalkUtils.parse(turn.intermediate_context, this._options);
                assert(context instanceof Ast.DialogueState);
            } else {
                context = await ThingTalkUtils.parse(turn.context!, this._options);
                assert(context instanceof Ast.DialogueState);
                // apply the agent prediction to the context to get the state of the dialogue before
                // the user speaks
                const agentPrediction = await ThingTalkUtils.parse(turn.agent_target!, this._options);
                assert(agentPrediction instanceof Ast.DialogueState);
                context = ThingTalkUtils.computeNewState(context, agentPrediction, 'agent');
            }

            const userContext = ThingTalkUtils.prepareContextForPrediction(context, 'user');
            [contextCode, contextEntities] = ThingTalkUtils.serializeNormalized(userContext);
        } else {
            context = null;
            contextCode = ['null'];
            contextEntities = {};
        }

        const { tokens, entities } = this._preprocess(turn.user, contextEntities);
        const goldUserTarget = await ThingTalkUtils.parse(turn.user_target, this._options);
        assert(goldUserTarget instanceof Ast.DialogueState);
        const goldUserState = ThingTalkUtils.computeNewState(context, goldUserTarget, 'user');
        const goldSlots = await this._slotExtractor.extractSlots(goldUserState);

        const parsed = await this._parser.sendUtterance(tokens.join(' '), contextCode, contextEntities, {
            tokenized: true,
            skip_typechecking: true
        });

        const predictions = parsed.candidates
            .filter((beam) => beam.score !== 'Infinity') // ignore exact matches
            .map((beam) => beam.code);

        if (predictions.length === 0)
            return [goldSlots, {}];

        const choice = predictions[0];

        let predictedUserTarget;
        try {
            predictedUserTarget = await ThingTalkUtils.parsePrediction(choice, entities, this._options);
        } catch(e) {
            return [goldSlots, {}];
        }
        if (predictedUserTarget === null)
            return [goldSlots, {}];

        assert(predictedUserTarget instanceof Ast.DialogueState);
        const predictedUserState = ThingTalkUtils.computeNewState(context, predictedUserTarget, 'user');
        let predictedSlots;
        try {
            predictedSlots = await this._slotExtractor.extractSlots(predictedUserState);
        } catch(e) {
            console.error(predictedUserTarget.prettyprint());
            throw e;
        }

        return [goldSlots, predictedSlots];
    }

    private async _doDialogue(dlg : ParsedDialogue) : Promise<[string, Record<number, { turn_belief : Record<string, string>, pred_bs_ptr : Record<string, string> }>]> {
        const output : Record<number, { turn_belief : Record<string, string>, pred_bs_ptr : Record<string, string> }> = [];
        for (let i = 0; i < dlg.length; i++) {
            const turn = dlg[i];

            const [goldSlots, predictedSlots] = await this._checkTurn(dlg.id, turn, i);
            output[i] = {
                turn_belief: goldSlots,
                pred_bs_ptr: predictedSlots
            };
        }

        return [dlg.id, output];
    }

    _transform(dlg : ParsedDialogue, encoding : BufferEncoding, callback : (error : Error|null, result ?: unknown) => void) {
        this._doDialogue(dlg).then((result) => callback(null, result), callback);
    }

    _flush(callback : () => void) {
        process.nextTick(callback);
    }
}

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('extract-predicted-slots', {
        add_help: true,
        description: "Transform a dialog input file in ThingTalk format into a dialogue state tracking prediction file."
    });
    parser.add_argument('-o', '--output', {
        required: false,
        default: process.stdout,
        type: fs.createWriteStream,
        help: "Write results to this file instead of stdout"
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
    });
    parser.add_argument('--url', {
        required: false,
        help: "URL of the server to evaluate. Use a file:// URL pointing to a model directory to evaluate using a local instance of genienlp",
        default: 'http://127.0.0.1:8400',
    });
    parser.add_argument('--tokenized', {
        required: false,
        action: 'store_true',
        default: false,
        help: "The dataset is already tokenized."
    });
    parser.add_argument('--no-tokenized', {
        required: false,
        dest: 'tokenized',
        action: 'store_false',
        help: "The dataset is not already tokenized (this is the default)."
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: maybeCreateReadStream,
        help: 'Input datasets to evaluate (in dialog format); use - for standard input'
    });
    parser.add_argument('--debug', {
        action: 'store_true',
        help: 'Enable debugging.',
        default: true
    });
    parser.add_argument('--no-debug', {
        action: 'store_false',
        dest: 'debug',
        help: 'Disable debugging.',
    });
    parser.add_argument('--database-file', {
        required: false,
        help: `Path to a file pointing to JSON databases used to simulate queries.`,
    });
}

export async function execute(args : any) {
    const tpClient = new Tp.FileClient(args);
    const parser = ParserClient.get(args.url, args.locale);
    await parser.start();

    let database;
    if (args.database_file) {
        database = new MultiJSONDatabase(args.database_file);
        await database.load();
    }

    readAllLines(args.input_file, '====')
        .pipe(new DialogueParser())
        .pipe(new DialogueToDSTStream({
            locale: args.locale,
            debug: args.debug,
            tokenized: args.tokenized,
            thingpediaClient: tpClient,
            database: database,
            parser: parser,
        }))
        .pipe((JSONStream as any /* FIXME bad type declaration */).stringifyObject(undefined, undefined, undefined, 2))
        .pipe(args.output);

    await StreamUtils.waitFinish(args.output);

    await parser.stop();
}
