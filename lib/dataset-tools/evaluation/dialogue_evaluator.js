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
"use strict";

const Stream = require('stream');
const deepEqual = require('deep-equal');
const ThingTalk = require('thingtalk');
const assert = require('assert');

const Utils = require('../../utils/misc-utils');
const I18n = require('../../i18n');
const { getBestEntityMatch } = require('../../dialogue-agent/entity-linking/entity-finder');
const { stripOutTypeAnnotations, normalizeKeywordParams } = require('./eval_utils');
const TargetLanguages = require('../../languages');

class DialogueEvaluatorStream extends Stream.Transform {
    constructor(parser, options) {
        super({ objectMode: true });

        this._parser = parser;
        this._tpClient = options.thingpediaClient;
        this._tokenizer = I18n.get(options.locale).getTokenizer();
        this._target = TargetLanguages.get(options.targetLanguage);

        this._options = options;
        this._locale = options.locale;
        this._debug = options.debug;
        this._tokenized = options.tokenized;
        this._database = options.database;

        this._cachedEntityMatches = new Map;
    }

    async _preprocess(sentence, contextEntities) {
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
                canonical: entry.id.display.toLowerCase()
            };
        });
    }

    _isWellKnownEntity(entityType) {
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

    _tokenizeSlot(value) {
        return this._tokenizer.tokenize(value).rawTokens.join(' ');
    }

    async _resolveEntity(value) {
        if (this._isWellKnownEntity(value.type)) {
            assert(value.value);
            return value;
        }

        assert(value.display);
        const cacheKey = value.type + '/' + value.value + '/' + value.display;
        let resolved = this._cachedEntityMatches.get(cacheKey);
        if (resolved)
            return resolved;

        if (this._database && this._database.has(value.type)) {
            // resolve as ID entity from the database (simulate issuing a query for it)
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
            return resolved;
        }

        // resolve as regular Thingpedia entity
        const candidates = await this._tpClient.lookupEntity(value.type, value.display);
        resolved = getBestEntityMatch(value.display, value.type, candidates);
        this._cachedEntityMatches.set(cacheKey, resolved);
        return resolved;
    }

    async _valueToSlot(value) {
        // HACK
        if (value.isComputation)
            return this._valueToSlot(value.operands[0]);
        if (value.isEntity) {
            const resolved = await this._resolveEntity(value);
            if (resolved)
                return resolved.canonical;
            return this._tokenizeSlot(value.display);
        }
        if (value.isBoolean)
            return value.value ? 'yes' : 'no';
        if (value.isLocation) {
            if (value.value.isRelative)
                return value.value.relativeTag;
            if (value.value.isAbsolute)
                return this._tokenizeSlot(value.value.display);
            // unresolved
            return value.value.name;
        }
        if (value.isContextRef)
            return 'context-' + value.name;

        if (value.isString) {
            // "tokenize" the value, because the prediction will also be tokenized
            return this._tokenizeSlot(value.toJS());
        }

        // everything else (time, currency, number, enum), use JS value
        return String(value.toJS()).toLowerCase();
    }

    async _extractSlots(state) {
        const slots = {};

        let currentDomain;

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
                    delete slots[slotKey];
                }

                for (let in_param of invocation.in_params) {
                    if (in_param.value.isUndefined || in_param.value.isVarRef)
                        continue;
                    const slotKey = nameToSlot(domain, in_param.name);
                    slots[slotKey] = in_param.value;
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
                slots[slotKey] = new ThingTalk.Ast.Value.Enum('dontcare');
                return false;
            }

            visitAtomBooleanExpression(expr) {
                if (expr.value.isUndefined || expr.value.isVarRef)
                    return false;

                const slotKey = nameToSlot(currentDomain, expr.name);
                if (expr.operator === 'in_array') // multiple values, pick the first one
                    slots[slotKey] = expr.value.value[0];
                else
                    slots[slotKey] = expr.value;
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
        delete slots['train-name'];

        // resolve entities and map Ast.Value to a string we can compare for equality
        for (let key in slots)
            slots[key] = await this._valueToSlot(slots[key]);

        return slots;
    }

    async _checkTurn(id, turn, turnIndex) {
        let context, contextCode, contextEntities;
        if (turnIndex > 0) {
            if (turn.intermediate_context) {
                context = await this._target.parse(turn.intermediate_context, this._options);
            } else {
                context = await this._target.parse(turn.context, this._options);
                // apply the agent prediction to the context to get the state of the dialogue before
                // the user speaks
                const agentPrediction = await this._target.parse(turn.agent_target, this._options);
                context = this._target.computeNewState(context, agentPrediction);
            }

            const userContext = this._target.prepareContextForPrediction(context, 'user');
            [contextCode, contextEntities] = this._target.serializeNormalized(userContext);
        } else {
            context = null;
            contextCode = ['null'];
            contextEntities = {};
        }

        const { tokens, entities } = await this._preprocess(turn.user, contextEntities);
        const goldUserTarget = await this._target.parse(turn.user_target, this._options);
        const goldUserState = this._target.computeNewState(context, goldUserTarget);
        const goldSlots = await this._extractSlots(goldUserState);

        const targetCode = this._target.serializePrediction(goldUserTarget, tokens, entities, 'user', {
           locale: this._locale,
        }).join(' ');

        const parsed = await this._parser.sendUtterance(tokens.join(' '), contextCode, contextEntities, {
            tokenized: true,
            skip_typechecking: true
        });

        const predictions = parsed.candidates
            .filter((beam) => beam.score !== 'Infinity') // ignore exact matches
            .map((beam) => beam.code);

        if (predictions.length === 0) {
            if (this._debug)
                console.log(`${id}:${turnIndex}\twrong_syntax\t${contextCode.join(' ')}\t${turn.user}\tfailed\t${targetCode}`);
            return 'wrong_syntax';
        }

        let choice = predictions[0];

        // first check if the program parses and typechecks (no hope otherwise)
        let predictedUserTarget;
        try {
            predictedUserTarget = await this._target.parsePrediction(choice, entities, this._options);
        } catch(e) {
            if (this._debug)
                console.log(`${id}:${turnIndex}\twrong_syntax\t${contextCode.join(' ')}\t${turn.user}\t${choice.join(' ')}\t${targetCode}`);
        }
        if (predictedUserTarget === null) {
            if (this._debug)
                console.log(`${id}:${turnIndex}\twrong_syntax\t${contextCode.join(' ')}\t${turn.user}\t${choice.join(' ')}\t${targetCode}`);
            return 'wrong_syntax';
        }

        const predictedUserState = this._target.computeNewState(context, predictedUserTarget);
        let predictedSlots;
        try {
            predictedSlots = await this._extractSlots(predictedUserState);
        } catch(e) {
            console.error(predictedUserTarget.prettyprint());
            throw e;
        }

        // do some light syntactic normalization
        choice = normalizeKeywordParams(Array.from(stripOutTypeAnnotations(choice))).join(' ');

        // do the actual normalization, using the full ThingTalk algorithm
        // we pass "ignoreSentence: true", which means strings are tokenized and then put in the
        // program regardless of what the sentence contains (because the neural network might
        // get creative in copying, and we don't want to crash here)
        const normalized = this._target.serializePrediction(predictedUserTarget, tokens, entities, 'user', {
           locale: this._locale,
           ignoreSentence: true
        }).join(' ');

        // check that by normalizing we did not accidentally mark wrong a program that
        // was correct before
        if (choice === targetCode && normalized !== targetCode) {
            console.error();
            console.error('NORMALIZATION ERROR');
            console.error(targetCode);
            console.error(normalized);
            console.error(choice);
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

    async _evaluate(dialogue) {
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

        const ret = {
            turns: dialogue.length,
            ok: correct_full === dialogue.length,
            ok_slot: correct_slot === dialogue.length,
            ok_initial: prefix_full >= 1,
            ok_initial_slot: prefix_slot >= 1,
            ok_partial: correct_full,
            ok_partial_slot: correct_slot,
            ok_prefix: prefix_full,
            ok_prefix_slot: prefix_slot,
            ok_progress: prefix_full,
            ok_progress_slot: prefix_slot,
        };

        if (this._debug) {
            let message = String(dialogue.id);
            for (let key in ret) {
                if (key === 'turns')
                    continue;
                message += '\t' + ret[key];
            }
            console.log(message);
        }

        return ret;
    }

    _transform(dialog, encoding, callback) {
        this._evaluate(dialog).then((result) => callback(null, result), (err) => callback(err));
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

const KEYS = ['ok', 'ok_slot', 'ok_initial', 'ok_initial_slot',
              'ok_partial', 'ok_partial_slot', 'ok_prefix', 'ok_prefix_slot',
              'ok_progress', 'ok_progress_slot'];
const BY_TURN_KEYS = ['ok_partial', 'ok_partial_slot', 'ok_prefix', 'ok_prefix_slot'];
const BY_DIALOGUE_KEYS = ['ok', 'ok_slot', 'ok_initial', 'ok_initial_slot', 'ok_progress', 'ok_progress_slot'];
class CollectDialogueStatistics extends Stream.Writable {
    constructor() {
        super({ objectMode: true });

        this._buffer = {
            total: 0,
            turns: 0,
        };
        for (let key of KEYS)
            this._buffer[key] = 0;
    }

    _write(sample, encoding, callback) {
        this._buffer.total ++;
        this._buffer.turns += sample.turns;
        for (let key of KEYS)
            this._buffer[key] += sample[key];
        callback();
    }

    _final(callback) {
        // convert to percentages
        for (let key of BY_DIALOGUE_KEYS)
            this._buffer[key] /= this._buffer.total;
        for (let key of BY_TURN_KEYS)
            this._buffer[key] /= this._buffer.turns;
        callback();
    }

    read() {
        return new Promise((resolve, reject) => {
            this.on('finish', () => resolve(this._buffer));
            this.on('error', reject);
        });
    }
}

module.exports = {
    KEYS,
    DialogueEvaluatorStream,
    CollectDialogueStatistics
};
