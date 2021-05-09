// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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
import * as Stream from 'stream';

import * as StreamUtils from '../lib/utils/stream-utils';
import {
    DialogueParser,
    DialogueSerializer,
    ParsedDialogue,
    DialogueTurn,
} from '../lib/dataset-tools/parsers';

import { ActionSetFlag, readAllLines } from './lib/argutils';
import { parallelize } from '../lib';

export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('simulate-dialogs', {
        add_help: true,
        description: `Simulate execution and run the dialogue agent on a dialogue dataset, advancing to the next turn.`
    });
    parser.add_argument('-o', '--output', {
        required: true,
        type: fs.createWriteStream,
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
    });
    parser.add_argument('--timezone', {
        required: false,
        default: undefined,
        help: `Timezone to use to print dates and times (defaults to the current timezone).`
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('--entities', {
        required: true,
        help: 'Path to JSON file containing entity type definitions.'
    });
    parser.add_argument('--dataset', {
        required: true,
        help: 'Path to file containing primitive templates, in ThingTalk syntax.'
    });
    parser.add_argument('--database-file', {
        required: false,
        help: `Path to a file pointing to JSON databases used to simulate queries.`,
    });
    parser.add_argument('--parameter-datasets', {
        required: false,
        help: 'TSV file containing the paths to datasets for strings and entity types.'
    });
    parser.add_argument('--set-flag', {
        required: false,
        nargs: 1,
        action: ActionSetFlag,
        const: true,
        metavar: 'FLAG',
        help: 'Set a flag for the construct template file.',
    });
    parser.add_argument('--unset-flag', {
        required: false,
        nargs: 1,
        action: ActionSetFlag,
        const: false,
        metavar: 'FLAG',
        help: 'Unset (clear) a flag for the construct template file.',
    });
    parser.add_argument('input_file', {
        nargs: '+',
        type: fs.createReadStream,
        help: 'Input dialog file'
    });
    parser.add_argument('--introduce-errors', {
        action: 'store_true',
        help: 'Simulate the dialogue as-if the user target was erroneous.',
        default: false
    });
    parser.add_argument('--nlu-server', {
        required: false,
        help: `The URL of the natural language server to parse user utterances. Use a file:// URL pointing to a model directory to use a local instance of genienlp.
               If provided, will be used to parse the last user utterance instead of reading the parse from input_file.`
    });
    parser.add_argument('--output-mistakes-only', {
        action: 'store_true',
        help: 'If set and --nlu-server is provided, will only output partial dialogues where a parsing mistake happens.',
        default: false
    });
    parser.add_argument('--all-turns', {
        action: 'store_true',
        help: `If set, will run simulation on all dialogue turns as opposed to only the last turn (but still for one turn only).
        The output will have as many partial dialogues as there are dialogue turns in the input.`,
        default: false
    });
    parser.add_argument('--debug', {
        action: 'store_true',
        default: false,
        help: 'Enable debugging.',
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
    parser.add_argument('--detokenize-all', {
        action: 'store_true',
        help: `If set, will detokenize and fix capitalization of all user and agent turns.`,
        default: false
    });
    parser.add_argument('--abort-on-error', {
        action: 'store_true',
        default: false,
        help: 'Abort on the first policy error. Implied by --debug.',
    });
    parser.add_argument('--verbose-agent', {
        action: 'store_true',
        help: `If set, we will pass verboseagent flag to the agent. This will affect which templates are used for response generation.`,
        default: false
    });
    parser.add_argument('--parallelize', {
        type: Number,
        help: 'Run N threads in parallel',
        metavar: 'N',
        default: 1,
    });
}

class DialogueToPartialDialoguesStream extends Stream.Transform {

    constructor() {
        super({ objectMode : true });
    }

    private _copyDialogueTurns(turns : DialogueTurn[]) : DialogueTurn[] {
        const copy : DialogueTurn[] = [];
        for (let i = 0; i < turns.length; i++) {
            copy.push({
                context : turns[i].context,
                agent : turns[i].agent,
                agent_target : turns[i].agent_target,
                intermediate_context : turns[i].intermediate_context,
                user : turns[i].user,
                user_target : turns[i].user_target
            });
        }
        return copy;
    }

    async _run(dlg : ParsedDialogue) : Promise<void> {
        for (let i = 1; i < dlg.length + 1; i++) {
            // do a deep copy so that later streams can modify these dialogues
            const output = this._copyDialogueTurns(dlg.slice(0, i));
            (output as ParsedDialogue).id = dlg.id + '/' + (i-1);
            this.push(output);
        }
    }

    _transform(dlg : ParsedDialogue, encoding : BufferEncoding, callback : (err : Error|null, dlgs ?: ParsedDialogue) => void) {
        this._run(dlg).then(() => callback(null), callback);
    }

    _flush(callback : () => void) {
        callback();
    }
}

export async function execute(args : any) {
    const input = readAllLines(args.input_file, '====');
    delete args.input_file;
    const output = args.output;
    delete args.output;
    if (args.all_turns) {
        await StreamUtils.waitFinish(
            input
            .pipe(new DialogueParser())
            .pipe(new DialogueToPartialDialoguesStream()) // convert each dialogues to many partial dialogues
            .pipe(await parallelize(args.parallelize, require.resolve('./workers/simulate-dialogs-worker'), args))
            .pipe(new DialogueSerializer())
            .pipe(output)
        );
    } else {
        await StreamUtils.waitFinish(
            input
            .pipe(new DialogueParser())
            .pipe(await parallelize(args.parallelize, require.resolve('./workers/simulate-dialogs-worker'), args))
            .pipe(new DialogueSerializer())
            .pipe(output)
        );
    }
}
