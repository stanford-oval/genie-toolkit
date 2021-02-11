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


import Stream from 'stream';
import deepEqual from 'deep-equal';
import * as Tp from 'thingpedia';
import * as ThingTalk from 'thingtalk';
import { Ast, } from 'thingtalk';
import assert from 'assert';

import * as Utils from '../../utils/misc-utils';
import { EntityMap } from '../../utils/entity-utils';
import * as I18n from '../../i18n';
import { EntityRecord, getBestEntityMatch } from '../../dialogue-agent/entity-linking/entity-finder';
import { stripOutTypeAnnotations } from './eval_utils';
import { ParserClient, PredictionResult } from '../../prediction/parserclient';
import { ParsedDialogue, DialogueTurn } from '../parsers';
import * as ThingTalkUtils from '../../utils/thingtalk';

// FIXME move this to a shared place with the simulation code
interface SimulationDatabase {
    has(key : string) : boolean;
    get(key : string) : Array<{ [key : string] : unknown }>|undefined;
}

interface DialogueEvaluatorOptions {
    thingpediaClient : Tp.BaseClient|null;
    locale : string;
    targetLanguage : string;
    tokenized : boolean;
    database ?: SimulationDatabase;

    debug ?: boolean;
}

export interface ExampleEvaluationResult {
    turns : number;
    ok : number;
    ok_slot : number;
    ok_initial : number;
    ok_initial_slot : number;
    ok_partial : number;
    ok_partial_slot : number;
    ok_prefix : number;
    ok_prefix_slot : number;
    ok_progress : number;
    ok_progress_slot : number;
}
export type EvaluationResult = ExampleEvaluationResult & {
    total : number,
    turns : number,
    [key : string] : number
};

const MINIBATCH_SIZE = 100;

class DialogueEvaluatorStream extends Stream.Transform {
    private _parser : ParserClient;
    private _tpClient : Tp.BaseClient|null;
    private _tokenizer : I18n.BaseTokenizer;
    private _options : DialogueEvaluatorOptions;
    private _locale : string;
    private _debug : boolean;
    private _tokenized : boolean;
    private _database : SimulationDatabase|undefined;
    private _cachedEntityMatches : Map<string, EntityRecord>;
    private _minibatch : Array<Promise<ExampleEvaluationResult>>;

    constructor(parser : ParserClient,
                options : DialogueEvaluatorOptions) {
        super({ objectMode: true });

        this._parser = parser;
        this._tpClient = options.thingpediaClient;
        this._tokenizer = I18n.get(options.locale).getTokenizer();

        this._options = options;
        this._locale = options.locale;
        this._debug = !!options.debug;
        this._tokenized = options.tokenized;
        this._database = options.database;

        this._cachedEntityMatches = new Map;

        this._minibatch = [];
    }

    private async _preprocess(sentence : string, contextEntities : EntityMap) {
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

    private _isWellKnownEntity(entityType : string) {
        switch (entityType) {
        case 'tt:username':
        case 'tt:hashtag':
        case 'tt:picture':
        case 'tt:url':
        case 'tt:email_address':
        case 'tt:phone_number':
        case 'tt:path_name':
        case 'tt:device':
        case 'tt:function':
            return true;
        default:
            return false;
        }
    }

    private _tokenizeSlot(value : string) {
        return this._tokenizer.tokenize(value).rawTokens.join(' ');
    }

    private async _resolveEntity(value : Ast.EntityValue) : Promise<EntityRecord> {
        if (this._isWellKnownEntity(value.type)) {
            assert(value.value);
            return { value: value.value!, name: value.display||'', canonical: value.value! };
        }

        const searchKey = value.display||value.value;
        assert(searchKey);
        const cacheKey = value.type + '/' + value.value + '/' + searchKey;
        let resolved = this._cachedEntityMatches.get(cacheKey);
        if (resolved)
            return resolved;

        if (this._database && this._database.has(value.type)) {
            // resolve as ID entity from the database (simulate issuing a query for it)
            const ids = this._database.get(value.type)!.map((entry) => {
                const id = entry.id as { value : string, display : string };
                return {
                    value: id.value,
                    name: id.display,
                    canonical: id.display.toLowerCase()
                };
            });
            if (value.value) {
                for (const id of ids) {
                    if (id.value === value.value) {
                        resolved = id;
                        break;
                    }
                }
            }
            if (!resolved)
                resolved = getBestEntityMatch(searchKey, value.type, ids);
            this._cachedEntityMatches.set(cacheKey, resolved);
            return resolved;
        }

        // resolve as regular Thingpedia entity
        const candidates = await this._tpClient!.lookupEntity(value.type, searchKey);
        resolved = getBestEntityMatch(searchKey, value.type, candidates.data);
        this._cachedEntityMatches.set(cacheKey, resolved);
        return resolved;
    }

    private async _valueToSlot(value : Ast.Value) : Promise<string> {
        // HACK
        if (value instanceof Ast.ComputationValue)
            return this._valueToSlot(value.operands[0]);
        if (value instanceof Ast.EntityValue) {
            const resolved = await this._resolveEntity(value);
            if (resolved)
                return resolved.canonical;
            return this._tokenizeSlot(value.display||'');
        }
        if (value instanceof Ast.BooleanValue)
            return value.value ? 'yes' : 'no';
        if (value instanceof Ast.LocationValue) {
            if (value.value instanceof Ast.RelativeLocation)
                return value.value.relativeTag;
            if (value.value instanceof Ast.AbsoluteLocation)
                return this._tokenizeSlot(value.value.display||'');
            // unresolved
            assert(value.value instanceof Ast.UnresolvedLocation);
            return this._tokenizeSlot(value.value.name);
        }
        if (value instanceof Ast.ContextRefValue)
            return 'context-' + value.name;

        if (value instanceof Ast.StringValue) {
            // "tokenize" the value, because the prediction will also be tokenized
            return this._tokenizeSlot(value.toJS());
        }

        // everything else (time, currency, number, enum), use JS value
        return String(value.toJS()).toLowerCase();
    }

    private async _extractSlots(state : Ast.Node) {
        const slotValues : Record<string, Ast.Value> = {};
        let currentDomain : string|undefined;

        function nameToSlot(domain : string, name : string) {
            if (name === 'id' || name === domain)
                return domain + '-name';
            const slotKey = domain + '-' + name.replace(/_/g, '-');
            return slotKey;
        }

        // note: this function relies on the precise visit order, in which an invocation
        // is visited before the boolean expressions that use the output of that invocation
        state.visit(new class extends ThingTalk.Ast.NodeVisitor {
            visitInvocation(invocation : Ast.Invocation) {
                const selector = invocation.selector;
                assert(selector instanceof Ast.DeviceSelector);
                const device = selector.kind;
                const domain = device.substring(device.lastIndexOf('.')+1).toLowerCase();
                currentDomain = domain;

                // delete all slots for this domain (they'll be set again right after)
                for (const arg of invocation.schema!.iterateArguments()) {
                    if (arg.name === currentDomain) {
                        // do not erase the "id" slot just because we have an action!
                        assert(arg.type.isEntity);
                        continue;
                    }
                    const slotKey = nameToSlot(domain, arg.name);
                    delete slotValues[slotKey];
                }

                for (const in_param of invocation.in_params) {
                    if (in_param.value.isUndefined || in_param.value.isVarRef)
                        continue;
                    const slotKey = nameToSlot(domain, in_param.name);
                    slotValues[slotKey] = in_param.value;
                }

                // do not recurse
                return false;
            }

            visitDialogueHistoryItem(item : Ast.DialogueHistoryItem) {
                // recurse only if this item comes from the user and not the agent
                return item.confirm !== 'proposed';
            }

            visitDontCareBooleanExpression(expr : Ast.DontCareBooleanExpression) {
                const slotKey = nameToSlot(currentDomain!, expr.name);
                slotValues[slotKey] = new ThingTalk.Ast.Value.Enum('dontcare');
                return false;
            }

            visitAtomBooleanExpression(expr : Ast.AtomBooleanExpression) {
                if (expr.value.isUndefined || expr.value.isVarRef)
                    return false;

                const slotKey = nameToSlot(currentDomain!, expr.name);
                if (expr.operator === 'in_array') // multiple values, pick the first one
                    slotValues[slotKey] = (expr.value as Ast.ArrayValue).value[0];
                else
                    slotValues[slotKey] = expr.value;
                return false;
            }

            visitNotBooleanExpression(expr : Ast.NotBooleanExpression) {
                // explicitly do not recurse into "not" operators
                return false;
            }

            visitOrBooleanExpression(expr : Ast.OrBooleanExpression) {
                // explicitly do not recurse into "or" operators
                // (unless they are an "or" of one operand)
                return expr.operands.length === 1;
            }
        });

        // remove train-name which is not in multiwoz
        delete slotValues['train-name'];

        // resolve entities and map Ast.Value to a string we can compare for equality
        const slotStrings : Record<string, string> = {};
        for (const key in slotValues)
            slotStrings[key] = await this._valueToSlot(slotValues[key]);

        return slotStrings;
    }

    private async _checkTurn(id : string, turn : DialogueTurn, turnIndex : number) : Promise<'ok' | 'ok_slot' | 'ok_syntax' | 'wrong_syntax'> {
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

        const { tokens, entities } = await this._preprocess(turn.user, contextEntities);
        const goldUserTarget = await ThingTalkUtils.parse(turn.user_target, this._options);
        assert(goldUserTarget instanceof Ast.DialogueState);
        const goldUserState = ThingTalkUtils.computeNewState(context, goldUserTarget, 'user');
        const goldSlots = await this._extractSlots(goldUserState);

        const targetCode = ThingTalkUtils.serializePrediction(goldUserTarget, tokens, entities, {
           locale: this._locale,
        }).join(' ');

        const parsed : PredictionResult = await this._parser.sendUtterance(tokens.join(' '), contextCode, contextEntities, {
            tokenized: true,
            skip_typechecking: true,
            example_id: id + '/' + turnIndex,
        });

        const predictions = parsed.candidates
            .filter((beam) => beam.score !== 'Infinity') // ignore exact matches
            .map((beam) => beam.code);

        if (predictions.length === 0) {
            if (this._debug)
                console.log(`${id}:${turnIndex}\twrong_syntax\t${contextCode.join(' ')}\t${turn.user}\tfailed\t${targetCode}`);
            return 'wrong_syntax';
        }

        const choice : string[] = predictions[0];

        // first check if the program parses and typechecks (no hope otherwise)
        let predictedUserTarget : Ast.Input;
        try {
            predictedUserTarget = await ThingTalkUtils.parsePrediction(choice, entities, this._options, true);
            assert(predictedUserTarget instanceof Ast.DialogueState);
        } catch(e) {
            if (this._debug)
                console.log(`${id}:${turnIndex}\twrong_syntax\t${contextCode.join(' ')}\t${turn.user}\t${choice.join(' ')}\t${targetCode}`);
            return 'wrong_syntax';
        }

        const predictedUserState = ThingTalkUtils.computeNewState(context, predictedUserTarget, 'user');
        let predictedSlots;
        try {
            predictedSlots = await this._extractSlots(predictedUserState);
        } catch(e) {
            console.error(predictedUserTarget.prettyprint());
            throw e;
        }

        // do some light syntactic normalization
        const choiceString : string = Array.from(stripOutTypeAnnotations(choice)).join(' ');

        // do the actual normalization, using the full ThingTalk algorithm
        // we pass "ignoreSentence: true", which means strings are tokenized and then put in the
        // program regardless of what the sentence contains (because the neural network might
        // get creative in copying, and we don't want to crash here)
        const normalized = ThingTalkUtils.serializePrediction(predictedUserTarget, tokens, entities, {
           locale: this._locale,
           ignoreSentence: true
        }).join(' ');

        // check that by normalizing we did not accidentally mark wrong a program that
        // was correct before
        if (choiceString === targetCode && normalized !== targetCode) {
            console.error();
            console.error('NORMALIZATION ERROR');
            console.error(targetCode);
            console.error(normalized);
            console.error(choice.join(' '));
            console.error(choiceString);
            throw new Error('Normalization Error');
        }

        if (normalized === targetCode) {
            if (this._debug)
                console.log(`${id}:${turnIndex}\tok\t${contextCode.join(' ')}\t${turn.user}\t${normalized}\t${targetCode}`);
            if (!deepEqual(goldSlots, predictedSlots, { strict: true })) {
                console.error(goldSlots, predictedSlots);
                throw new Error(`Program matches but slots do not`);
            }
            return 'ok';
        } else if (deepEqual(goldSlots, predictedSlots, { strict: true })) {
            if (this._debug)
                console.log(`${id}:${turnIndex}\tok_slot\t${contextCode.join(' ')}\t${turn.user}\t${normalized}\t${targetCode}`);
            return 'ok_slot';
        } else {
            if (this._debug)
                console.log(`${id}:${turnIndex}\tok_syntax\t${contextCode.join(' ')}\t${turn.user}\t${normalized}\t${targetCode}`);
            return 'ok_syntax';
        }
    }

    private async _evaluate(dialogue : ParsedDialogue) {
        let prefix_full = 0;
        let correct_full = 0;
        let prefix_slot = 0;
        let correct_slot = 0;
        let failed_full = false, failed_slot = false;
        for (let i = 0; i < dialogue.length; i++) {
            const turn = dialogue[i];
            let ok;
            try {
                ok = await this._checkTurn(dialogue.id, turn, i);
            } catch(e) {
                console.error(dialogue.id, turn);
                throw e;
            }
            if (ok === 'ok') {
                correct_full += 1;
                correct_slot += 1;
                if (!failed_slot)
                    prefix_slot += 1;
                if (!failed_full)
                    prefix_full += 1;
            } else if (ok === 'ok_slot') {
                correct_slot += 1;
                if (!failed_slot)
                    prefix_slot += 1;
                failed_full = true;
            } else {
                failed_full = true;
                failed_slot = true;
            }
        }

        const ret : ExampleEvaluationResult = {
            turns: dialogue.length,
            ok: Number(correct_full === dialogue.length),
            ok_slot: Number(correct_slot === dialogue.length),
            ok_initial: Number(prefix_full >= 1),
            ok_initial_slot: Number(prefix_slot >= 1),
            ok_partial: Number(correct_full),
            ok_partial_slot: Number(correct_slot),
            ok_prefix: Number(prefix_full),
            ok_prefix_slot: Number(prefix_slot),
            ok_progress: Number(prefix_full),
            ok_progress_slot: Number(prefix_slot),
        };

        if (this._debug) {
            let message = String(dialogue.id);
            for (const key in ret) {
                if (key === 'turns')
                    continue;
                message += '\t' + ret[key as keyof ExampleEvaluationResult];
            }
            console.log(message);
        }

        return ret;
    }

    private async _flushMinibatch() {
        for (const res of await Promise.all(this._minibatch))
            this.push(res);
        this._minibatch = [];
    }

    private async _pushDialogue(dialog : ParsedDialogue) {
        this._minibatch.push(this._evaluate(dialog));
        if (this._minibatch.length >= MINIBATCH_SIZE)
            await this._flushMinibatch();
    }

    _transform(dialog : ParsedDialogue, encoding : BufferEncoding, callback : (err : Error|null) => void) {
        this._pushDialogue(dialog).then(() => callback(null), (err) => callback(err));
    }

    _flush(callback : (err : Error|null) => void) {
        this._flushMinibatch().then(() => callback(null), (err) => callback(err));
    }
}

const KEYS : Array<keyof ExampleEvaluationResult> = [
    'ok', 'ok_slot', 'ok_initial', 'ok_initial_slot',
    'ok_partial', 'ok_partial_slot', 'ok_prefix', 'ok_prefix_slot',
    'ok_progress', 'ok_progress_slot'
];
const BY_TURN_KEYS : Array<keyof ExampleEvaluationResult> = ['ok_partial', 'ok_partial_slot', 'ok_prefix', 'ok_prefix_slot'];
const BY_DIALOGUE_KEYS : Array<keyof ExampleEvaluationResult> = ['ok', 'ok_slot', 'ok_initial', 'ok_initial_slot', 'ok_progress', 'ok_progress_slot'];
class CollectDialogueStatistics extends Stream.Writable {
    private _buffer : EvaluationResult;

    constructor() {
        super({ objectMode: true });

        this._buffer = {
            total: 0,
            turns: 0,
        } as EvaluationResult;
        for (const key of KEYS)
            this._buffer[key] = 0;
    }

    _write(sample : EvaluationResult, encoding : BufferEncoding, callback : () => void) {
        this._buffer.total ++;
        this._buffer.turns += sample.turns;
        for (const key of KEYS)
            this._buffer[key] += sample[key];
        callback();
    }

    _final(callback : () => void) {
        // convert to percentages
        for (const key of BY_DIALOGUE_KEYS)
            this._buffer[key] /= this._buffer.total;
        for (const key of BY_TURN_KEYS)
            this._buffer[key] /= this._buffer.turns;
        callback();
    }

    read() {
        return new Promise<EvaluationResult>((resolve, reject) => {
            this.on('finish', () => resolve(this._buffer));
            this.on('error', reject);
        });
    }
}

export {
    KEYS,
    DialogueEvaluatorStream,
    CollectDialogueStatistics
};
