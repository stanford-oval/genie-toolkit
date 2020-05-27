// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Stream = require('stream');
const deepEqual = require('deep-equal');
const ThingTalk = require('thingtalk');

const Utils = require('./utils');
const { stripOutTypeAnnotations, normalizeKeywordParams } = require('./eval_utils');
const editDistance = require('./edit-distance');

function getBestEntityMatch(value, searchTerm, candidates) {
    if (value !== null) {
        for (let cand of candidates) {
            if (value === cand.id.value)
                return cand.id;
        }
    }

    let best = undefined, bestScore = undefined;

    let searchTermTokens = searchTerm.split(' ');

    for (let cand of candidates) {
        let candDisplay = cand.id.display;

        let score = 0;
        score -= 0.1 * editDistance(searchTerm, candDisplay);

        let candTokens = candDisplay.split(' ');

        for (let candToken of candTokens) {
            let found = false;
            for (let token of searchTermTokens) {
                if (token === candToken) {
                    score += 10;
                    found = true;
                } else if (candToken.startsWith(token)) {
                    score += 0.5;
                }
            }
            // give a small boost to ignorable tokens that are missing
            // this offsets the char-level edit distance
            if (!found && ['the', 'hotel', 'house'].includes(candToken))
                score += 1;
        }

        //console.log(`candidate ${cand.name} score ${score}`);
        if (bestScore === undefined || score > bestScore) {
            bestScore = score;
            best = cand.id;
        }
    }

    return best;
}

class DialogueEvaluatorStream extends Stream.Transform {
    constructor(parser, tokenizer, options) {
        super({ objectMode: true });

        this._parser = parser;
        this._tokenizer = tokenizer;
        this._target = require('../lib/languages/' + options.targetLanguage);

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
            tokenized = await this._tokenizer.tokenize(this._locale, sentence);
        }
        Utils.renumberEntities(tokenized, contextEntities);
        return tokenized;
    }

    _resolveEntity(value) {
        if (!this._database)
            return null;

        const cacheKey = value.type + '/' + value.value + '/' + value.display;
        let resolved = this._cachedEntityMatches.get(cacheKey);
        if (!resolved) {
            resolved = getBestEntityMatch(value.value, value.display, this._database.get(value.type));
            this._cachedEntityMatches.set(cacheKey, resolved);
        }
        return resolved;
    }

    _extractSlots(state) {
        const slots = {};

        let currentDomain;

        const self = this;
        function valueToSlot(value) {
            // HACK
            if (value.isComputation)
                return valueToSlot(value.operands[0]);
            if (value.isEntity) {
                const resolved = self._resolveEntity(value);
                if (resolved)
                    return resolved.display;
                return value.display;
            }
            if (value.isTime)
                return value.toJS().toString();
            if (value.isCurrency)
                return value.toJS().toString().toLowerCase();

            // everything else (boolean, number, enum, string), use JS value
            return value.toJS();
        }

        // note: this function relies on the precise visit order, in which an invocation
        // is visited before the boolean expressions that use the output of that invocation
        state.visit(new class extends ThingTalk.Ast.NodeVisitor {
            visitInvocation(invocation) {
                const device = invocation.selector.kind;
                const domain = device.substring(device.lastIndexOf('.')+1).toLowerCase();
                currentDomain = domain;

                // delete all slots for this domain (they'll be set again right after)
                for (let arg of invocation.schema.iterateArguments())
                    delete slots[domain + '-' + arg.name];

                for (let in_param of invocation.in_params) {
                    if (in_param.value.isUndefined)
                        continue;
                    slots[domain + '-' + in_param.name] = valueToSlot(in_param.value);
                }

                // do not recurse
                return false;
            }

            visitDialogueHistoryItem(item) {
                // recurse only if this item comes from the user and not the agent
                return item.confirm !== 'proposed';
            }

            visitDontCareBooleanExpression(expr) {
                slots[currentDomain + '-' + expr.name] = 'dontcare';
                return false;
            }

            visitAtomBooleanExpression(expr) {
                if (expr.value.isUndefined || expr.value.isVarRef)
                    return false;

                if (expr.operator === 'in_array') // multiple values, pick the first one
                    slots[currentDomain + '-' + expr.name] = valueToSlot(expr.value.value[0]);

                slots[currentDomain + '-' + expr.name] = valueToSlot(expr.value);
                return false;
            }

            visitNotBooleanExpression(expr) {
                // explicitly do not recurse into "not" operators
                return false;
            }

            visitOrBooleanExpression(expr) {
                // explicitly do not recurse into "or" operators
                return false;
            }
        });

        return slots;
    }

    async _checkTurn(id, turn, turnIndex) {
        let context, contextCode, contextEntities;
        if (turnIndex > 0) {
            context = await this._target.parse(turn.context, this._options);
            // apply the agent prediction to the context to get the state of the dialogue before
            // the user speaks
            const agentPrediction = await this._target.parse(turn.agent_target, this._options);
            context = this._target.computeNewState(context, agentPrediction);

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
        const goldSlots = this._extractSlots(goldUserState);

        const targetCode = (await this._target.serializePrediction(goldUserTarget, tokens, entities, 'user')).join(' ');

        const parsed = await this._parser.sendUtterance(tokens.join(' '), true, contextCode, contextEntities);

        const predictions = parsed.candidates
            .filter((beam) => beam.score !== 'Infinity') // ignore exact matches
            .map((beam) => beam.code);

        if (predictions.length === 0)
            return 'wrong_syntax';

        const choice = predictions[0];

        // first check if the program parses and typechecks (no hope otherwise)
        let predictedUserTarget;
        try {
            predictedUserTarget = await this._target.parsePrediction(choice, entities, this._options);
        } catch(e) {
            if (this._debug)
                console.log(`${id}:${turnIndex}\twrong_syntax\t${contextCode.join(' ')}\t${turn.user}\t${choice.join(' ')}`);
        }
        if (predictedUserTarget === null) {
            if (this._debug)
                console.log(`${id}:${turnIndex}\twrong_syntax\t${contextCode.join(' ')}\t${turn.user}\t${choice.join(' ')}`);
            return 'wrong_syntax';
        }

        const predictedUserState = this._target.computeNewState(context, predictedUserTarget);
        let predictedSlots;
        try {
            predictedSlots = this._extractSlots(predictedUserState);
        } catch(e) {
            console.error(predictedUserTarget.prettyprint());
            throw e;
        }

        const normalized = normalizeKeywordParams(Array.from(stripOutTypeAnnotations(choice))).join(' ');

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
