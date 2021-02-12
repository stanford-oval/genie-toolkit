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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>


import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import Stream from 'stream';
import * as fs from 'fs';
import JSONStream from 'JSONStream';
import assert from 'assert';

import * as StreamUtils from '../lib/utils/stream-utils';
import { getBestEntityMatch } from '../lib/dialogue-agent/entity-linking/entity-finder';
import * as Utils from '../lib/utils/misc-utils';
import * as I18n from '../lib/i18n';
import * as ThingTalkUtils from '../lib/utils/thingtalk';
import { DialogueParser } from '../lib/dataset-tools/parsers';

import { maybeCreateReadStream, readAllLines } from './lib/argutils';
import MultiJSONDatabase from './lib/multi_json_database';
import * as ParserClient from '../lib/prediction/parserclient';


class DialogueToDSTStream extends Stream.Transform {
    constructor(options) {
        super({ objectMode: true });

        this._locale = options.locale;
        this._database = options.database;
        this._tokenized = options.tokenized;
        this._tokenizer = I18n.get(options.locale).getTokenizer();
        this._parser = options.parser;

        this._options = options;
        this._debug = options.debug;

        this._cachedEntityMatches = new Map;
    }

    _preprocess(sentence, contextEntities) {
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

    _getIDs(type) {
        return this._database.get(type).map((entry) => {
            return {
                value: entry.id.value,
                name: entry.id.display,
                canonical: entry.id.display
            };
        });
    }

    _resolveEntity(value) {
        if (!this._database || (!value.value && !value.display))
            return null;

        const cacheKey = value.type + '/' + value.value + '/' + value.display;
        let resolved = this._cachedEntityMatches.get(cacheKey);
        if (!resolved) {
            const ids = this._getIDs(value.type);
            if (value.value) {
                for (let id of ids) {
                    if (id.value === value.value) {
                        resolved = id;
                        break;
                    }
                }
            }
            if (!resolved)
                resolved = getBestEntityMatch(value.display, value.type, ids);
            this._cachedEntityMatches.set(cacheKey, resolved);
        }
        return resolved;
    }

    _valueToSlot(value) {
        // HACK
        if (value.isComputation)
            return this._valueToSlot(value.operands[0]);
        if (value.isBoolean)
            return value.value ? 'yes' : 'no';
        if (value.isEntity) {
            const resolved = this._resolveEntity(value);
            assert(resolved);
            if (resolved)
                return resolved.canonical;
            return value.display;
        }
        // everything else (time, currency, number, enum, string), use JS value
        return String(value.toJS()).toLowerCase();
    }

    _extractSlots(state) {
        const slots = new Map();

        let currentDomain;

        const self = this;

        function nameToSlot(domain, name) {
            if (name === 'id' || name === domain)
                return domain + '-name';
            const slotKey = domain + '-' + name.replace(/_/g, '-');
            return slotKey;
        }

        // note: this function relies on the precise visit order, in which an invocation
        // is visited before the boolean expressions that use the output of that invocation
        state.visit(new class extends ThingTalk.Ast.NodeVisitor {
            visitInvocation(invocation) {
                const device = invocation.selector.kind;
                const domain = device.substring(device.lastIndexOf('.')+1).toLowerCase();
                currentDomain = domain;

                // delete all slots for this domain (they'll be set again right after)
                for (let arg of invocation.schema.iterateArguments()) {
                    if (arg.name === currentDomain) {
                        // do not erase the "id" slot just because we have an action!
                        assert(arg.type.isEntity);
                        continue;
                    }
                    const slotKey = nameToSlot(domain, arg.name);
                    slots.delete(slotKey);
                }

                for (let in_param of invocation.in_params) {
                    if (in_param.value.isUndefined)
                        continue;

                    const slotKey = nameToSlot(domain, in_param.name);
                    slots.set(slotKey, self._valueToSlot(in_param.value));
                }

                // do not recurse
                return false;
            }

            visitDialogueHistoryItem(item) {
                // recurse only if this item comes from the user and not the agent
                return item.confirm !== 'proposed';
            }

            visitDontCareBooleanExpression(expr) {
                const slotKey = nameToSlot(currentDomain, expr.name);
                slots.set(slotKey, 'dontcare');
                return false;
            }

            visitAtomBooleanExpression(expr) {
                if (expr.value.isUndefined || expr.value.isVarRef)
                    return false;

                const slotKey = nameToSlot(currentDomain, expr.name);
                if (expr.operator === 'in_array') // multiple values, pick the first one
                    slots.set(slotKey, self._valueToSlot(expr.value.value[0]));
                else
                    slots.set(slotKey, self._valueToSlot(expr.value));
                return false;
            }

            visitNotBooleanExpression(expr) {
                // explicitly do not recurse into "not" operators
                return false;
            }

            visitOrBooleanExpression(expr) {
                // explicitly do not recurse into "or" operators
                // (unless they are an "or" of one operand)
                return expr.operands.length === 1;
            }
        });

        // remove train-name which is not in multiwoz
        slots.delete('train-name');

        let prediction = [];
        for (let [key, value] of slots) {
            assert(typeof value === 'string');
            prediction.push(key + '-' + value);
        }
        prediction.sort();
        return prediction;
    }

    async _checkTurn(id, turn, turnIndex) {
        let context, contextCode, contextEntities;
        if (turnIndex > 0) {
            if (turn.intermediate_context) {
                context = await ThingTalkUtils.parse(turn.intermediate_context, this._options);
            } else {
                context = await ThingTalkUtils.parse(turn.context, this._options);
                // apply the agent prediction to the context to get the state of the dialogue before
                // the user speaks
                const agentPrediction = await ThingTalkUtils.parse(turn.agent_target, this._options);
                context = ThingTalkUtils.computeNewState(context, agentPrediction);
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
        const goldUserState = ThingTalkUtils.computeNewState(context, goldUserTarget);
        const goldSlots = this._extractSlots(goldUserState);

        const parsed = await this._parser.sendUtterance(tokens.join(' '), contextCode, contextEntities, {
            tokenized: true,
            skip_typechecking: true
        });

        const predictions = parsed.candidates
            .filter((beam) => beam.score !== 'Infinity') // ignore exact matches
            .map((beam) => beam.code);

        if (predictions.length === 0)
            return [goldSlots, []];

        const choice = predictions[0];

        let predictedUserTarget;
        try {
            predictedUserTarget = await ThingTalkUtils.parsePrediction(choice, entities, this._options);
        } catch(e) {
            return [goldSlots, []];
        }
        if (predictedUserTarget === null)
            return [goldSlots, []];

        const predictedUserState = ThingTalkUtils.computeNewState(context, predictedUserTarget);
        let predictedSlots;
        try {
            predictedSlots = this._extractSlots(predictedUserState);
        } catch(e) {
            console.error(predictedUserTarget.prettyprint());
            throw e;
        }

        return [goldSlots, predictedSlots];
    }

    async _doDialogue(dlg) {
        const output = {};
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

    _transform(dlg, encoding, callback) {
        this._doDialogue(dlg).then((result) => callback(null, result), callback);
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

export function initArgparse(subparsers) {
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

export async function execute(args) {
    let tpClient = null;
    if (args.thingpedia)
        tpClient = new Tp.FileClient(args);
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
        .pipe(JSONStream.stringifyObject(undefined, undefined, undefined, 2))
        .pipe(args.output);

    await StreamUtils.waitFinish(args.output);

    await parser.stop();
}
