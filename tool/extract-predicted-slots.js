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

const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');
const Stream = require('stream');
const fs = require('fs');
const JSONStream = require('JSONStream');
const assert = require('assert');

const StreamUtils = require('../lib/utils/stream-utils');
const { getBestEntityMatch } = require('../lib/utils/entity-finder');
const Utils = require('../lib/utils/misc-utils');

const TokenizerService = require('../lib/tokenizer');
const { DialogueParser } = require('./lib/dialog_parser');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const MultiJSONDatabase = require('./lib/multi_json_database');
const ParserClient = require('../lib/prediction/parserclient');


class DialogueToDSTStream extends Stream.Transform {
    constructor(options) {
        super({ objectMode: true });

        this._locale = options.locale;
        this._database = options.database;
        this._tokenized = options.tokenized;
        this._tokenizer = options.tokenizer;
        this._parser = options.parser;

        this._options = options;
        this._debug = options.debug;
        this._target = require('../lib/languages/dlgthingtalk');

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
        if (!this._database || (!value.value && !value.display))
            return null;

        const cacheKey = value.type + '/' + value.value + '/' + value.display;
        let resolved = this._cachedEntityMatches.get(cacheKey);
        if (!resolved) {
            resolved = getBestEntityMatch(value.value, value.display, this._database.get(value.type));
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
                return resolved.display;
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
        const goldSlots = this._extractSlots(goldUserState);

        const parsed = await this._parser.sendUtterance(tokens.join(' '), contextCode, contextEntities, { tokenized: true });

        const predictions = parsed.candidates
            .filter((beam) => beam.score !== 'Infinity') // ignore exact matches
            .map((beam) => beam.code);

        if (predictions.length === 0)
            return [goldSlots, []];

        const choice = predictions[0];

        let predictedUserTarget;
        try {
            predictedUserTarget = await this._target.parsePrediction(choice, entities, this._options);
        } catch(e) {
            return [goldSlots, []];
        }
        if (predictedUserTarget === null)
            return [goldSlots, []];

        const predictedUserState = this._target.computeNewState(context, predictedUserTarget);
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

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('extract-predicted-slots', {
            addHelp: true,
            description: "Transform a dialog input file in ThingTalk format into a dialogue state tracking prediction file."
        });
        parser.addArgument(['-o', '--output'], {
            required: false,
            defaultValue: process.stdout,
            type: fs.createWriteStream,
            description: "Write results to this file instead of stdout"
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
        });
        parser.addArgument('--url', {
            required: false,
            help: "URL of the server to evaluate. Use a file:// URL pointing to a model directory to evaluate using a local instance of decanlp",
            defaultValue: 'http://127.0.0.1:8400',
        });
        parser.addArgument('--tokenized', {
            required: false,
            action: 'storeTrue',
            defaultValue: false,
            help: "The dataset is already tokenized."
        });
        parser.addArgument('--no-tokenized', {
            required: false,
            dest: 'tokenized',
            action: 'storeFalse',
            help: "The dataset is not already tokenized (this is the default)."
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to evaluate (in dialog format); use - for standard input'
        });
        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
            defaultValue: true
        });
        parser.addArgument('--no-debug', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'debug',
            help: 'Disable debugging.',
        });
        parser.addArgument('--database-file', {
            required: false,
            help: `Path to a file pointing to JSON databases used to simulate queries.`,
        });
    },

    async execute(args) {
        let tpClient = null;
        if (args.thingpedia)
            tpClient = new Tp.FileClient(args);
        const parser = ParserClient.get(args.url, args.locale);
        let tokenizer = null;
        if (!args.tokenized)
            tokenizer = TokenizerService.get('local', true);
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
                tokenizer: tokenizer,
            }))
            .pipe(JSONStream.stringifyObject(undefined, undefined, undefined, 2))
            .pipe(args.output);

        await StreamUtils.waitFinish(args.output);

        await parser.stop();
        await tokenizer.end();
    }
};
