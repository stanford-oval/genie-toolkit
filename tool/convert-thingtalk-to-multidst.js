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

const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');
const Stream = require('stream');
const fs = require('fs');
const JSONStream = require('JSONStream');
const seedrandom = require('seedrandom');
const assert = require('assert');

const MultiDST = require('../lib/languages/multidst/ast');
const StreamUtils = require('../lib/utils/stream-utils');
const { getBestEntityMatch } = require('../lib/dialogue-agent/entity-linking/entity-finder');
const { uniform } = require('../lib/utils/random');
const TargetLanguages = require('../lib/languages');
const { DialogueParser } = require('../lib/dataset-tools/parsers');

const ProgressBar = require('./lib/progress_bar');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const MultiJSONDatabase = require('./lib/multi_json_database');

class DialogueToDSTStream extends Stream.Transform {
    constructor(options) {
        super({ objectMode: true });

        this._locale = options.locale;
        this._database = options.database;
        this._ontology = options.ontology;
        this._replaceParameters = options.replaceParameters;
        this._rng = options.rng;

        this._options = options;
        this._debug = options.debug;
        this._inputTarget = TargetLanguages.get('thingtalk');

        this._cachedEntityMatches = new Map;
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

    _valueToEntityToken(value) {
        if (value.isEntity) {
            if (value.type === 'tt:phone_number') {
                assert(value.value.startsWith(`str:ENTITY_tt:phone_number::`));
                return 'PHONE_NUMBER_' + value.value.substring(`str:ENTITY_tt:phone_number::`.length, value.value.length-1);
            } else {
                const match = /^str:ENTITY_[^:]+:[^:]+::([0-9]+):$/.exec(value.value);
                return 'GENERIC_ENTITY_' + value.type + '_' + match[1];
            }
        }
        if (value.isString) {
            assert(value.value.startsWith(`str:QUOTED_STRING::`));
            return 'QUOTED_STRING_' + value.value.substring(`str:QUOTED_STRING::`.length, value.value.length-1);
        }
        if (value.isNumber)
            return `NUMBER_` + (value.value - 12 - 1);
        if (value.isTime)
            return `TIME_` + (value.value.hour * 4 + value.value.minute / 15);
        if (value.isNumber)
            return `NUMBER_` + (value.value - 12 - 1);
        if (value.isCurrency)
            return `CURRENCY_` + (value.value - 2);
        if (value.isMeasure && value.unit === 'ms')
            return `DURATION_` + (value.value - 2);

        console.error(value);
        throw new TypeError();
    }

    _valueToSlot(value, ontologyKey, replacements) {
        // HACK
        if (value.isComputation)
            return this._valueToSlot(value.operands[0], ontologyKey, replacements);
        if (value.isBoolean)
            return new MultiDST.TristateValue(value.value ? 'yes' : 'no');
        if (value.isEnum)
            return new MultiDST.ConstantValue(value.toJS());
        if (value.isNumber && (value.value >= -12 && value.value < 12))
            return new MultiDST.ConstantValue(value.toJS());

        if (this._replaceParameters) {
            const replaceKey = this._valueToEntityToken(value);
            if (replacements.has(replaceKey))
                return new MultiDST.ConstantValue(replacements.get(replaceKey));

            const candidates = this._ontology[ontologyKey];
            assert(candidates && candidates.length, ontologyKey);
            const replacement = uniform(candidates, this._rng);
            assert(replacement, ontologyKey);
            replacements.set(replaceKey, replacement);
            return new MultiDST.ConstantValue(replacement);
        } else {
            if (value.isEntity) {
                const resolved = this._resolveEntity(value);
                if (resolved)
                    return resolved.canonical;
                return new MultiDST.ConstantValue(value.canonical);
            }
            if (value.isTime)
                return new MultiDST.ConstantValue(value.toJS().toString());
            if (value.isCurrency)
                return new MultiDST.ConstantValue(value.toJS().toString().toLowerCase());

            // everything else (boolean, number, enum, string), use JS value
            return new MultiDST.ConstantValue(value.toJS());
        }
    }

    _extractSlots(state, replacements, forSide) {
        const slots = new MultiDST.DialogState();

        let currentDomain;

        const self = this;

        function nameToSlot(domain, name) {
            if (name === 'id' || name === domain)
                return [domain + '-name', domain + '-name'];
            const slotKey = domain + '-' + name.replace(/_/g, '-');
            const ontologyKey = domain + '-' + name.replace(/_/g, ' ');
            return [slotKey, ontologyKey];
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
                    slots.delete(domain + '-' + arg.name.replace(/_/g, '-'));

                for (let in_param of invocation.in_params) {
                    if (in_param.value.isUndefined)
                        continue;

                    const [slotKey, ontologyKey] = nameToSlot(domain, in_param.name);
                    slots.set(slotKey, self._valueToSlot(in_param.value, ontologyKey, replacements));
                }

                // do not recurse
                return false;
            }

            visitDialogueHistoryResultItem(result) {
                if (forSide !== 'agent')
                    return false;

                for (let name in result.value) {
                    const [, ontologyKey] = nameToSlot(currentDomain, name);
                    self._valueToSlot(result.value[name], ontologyKey, replacements);
                }

                return false;
            }

            visitDialogueHistoryItem(item) {
                // recurse only if this item comes from the user and not the agent
                return forSide === 'agent' || item.confirm !== 'proposed';
            }

            visitDontCareBooleanExpression(expr) {
                const [slotKey, ] = nameToSlot(currentDomain, expr.name);
                slots.set(slotKey, new MultiDST.TristateValue('dontcare'));
                return false;
            }

            visitAtomBooleanExpression(expr) {
                if (expr.value.isUndefined || expr.value.isVarRef)
                    return false;

                const [slotKey, ontologyKey] = nameToSlot(currentDomain, expr.name);
                if (expr.operator === 'in_array') // multiple values, pick the first one
                    slots.set(slotKey, self._valueToSlot(expr.value.value[0], ontologyKey, replacements));

                slots.set(slotKey, self._valueToSlot(expr.value, ontologyKey, replacements));
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

        // remove train-name which is not in multiwoz
        slots.delete('train-name');

        if (slots.size > 0)
            slots.intent = 'init_request';
        else
            slots.intent = 'greet';
        return slots;
    }

    _replaceTokensInUtterance(utterance, replacements, userTarget) {
        if (!this._replaceParameters)
            return utterance;

        const output = [];
        for (let token of utterance.split(' ')) {
            if (/^[A-Z]/.test(token)) {
                let replacement = replacements.get(token);
                if (!replacement) {
                    if (token.startsWith('NUMBER_')) {
                        replacement = token.substring('NUMBER_'.length);
                    } else if (token.startsWith('TIME_')) {
                        replacement = uniform(this._ontology['train-leave at'], this._rng);
                    } else if (token.startsWith('PHONE_NUMBER_')) {
                        replacement = uniform(this._ontology['restaurant-phone'], this._rng);
                    } else {
                        replacement = '';
                        console.error(`missing entity ${token}`);
                        //console.error(utterance);
                        //console.error(replacements);
                        //throw new Error(`missing entity ${token}: ${userTarget.prettyprint()}`);
                    }
                }
                if (replacement)
                    output.push(replacement);
            } else {
                output.push(token);
            }
        }

        return output.join(' ');
    }

    async _doDialogue(dlg) {
        const output = [];
        const replacements = new Map;
        for (let i = 0; i < dlg.length; i++) {
            const turn = dlg[i];
            if (i > 0) {
                // first parse the agent target and extract the slots - we use this to populate the
                // replacements map so we can replace the tokens in the agent utterance
                let context;
                context = await this._inputTarget.parse(turn.context, this._options);
                // apply the agent prediction to the context to get the state of the dialogue before
                // the user speaks
                const agentTarget = await this._inputTarget.parse(turn.agent_target, this._options);
                context = this._inputTarget.computeNewState(context, agentTarget);

                // ignore the result of extracting the slots for the agent, we run it to modify replacements
                this._extractSlots(context, replacements, 'agent');

                // if we have an "intermediate context" (C: block after AT:) we ran the execution
                // after the agent spoke, so we discard the agent context
                if (turn.intermediate_context)
                    context = await this._inputTarget.parse(turn.intermediate_context, this._options);

                // now apply the user prediction, to get
                const userTarget = await this._inputTarget.parse(turn.user_target, this._options);
                context = this._inputTarget.computeNewState(context, userTarget);

                const userSlots = this._extractSlots(context, replacements, 'user');

                output.push({
                    system: this._replaceTokensInUtterance(turn.agent, replacements, agentTarget),
                    user: this._replaceTokensInUtterance(turn.user, replacements, userTarget),
                    target: userSlots.prettyprint()
                });
            } else {
                const userTarget = await this._inputTarget.parse(turn.user_target, this._options);

                const userSlots = this._extractSlots(userTarget, replacements, 'user');
                output.push({
                    system: '',
                    user: this._replaceTokensInUtterance(turn.user, replacements, userTarget),
                    target: userSlots.prettyprint()
                });
            }
        }

        return { id: dlg.id, turns: output };
    }

    _transform(dlg, encoding, callback) {
        this._doDialogue(dlg).then((result) => callback(null, result), callback);
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

class SimpleCountStream extends Stream.Transform {
    constructor(N) {
        super({ objectMode: true });

        this._i = 0;
        this._N = N;
    }

    _transform(obj, encoding, callback) {
        this.push(obj);
        this._i ++;
        if (this._i % 100 === 0)
            this.emit('progress', this._i/this._N);
        callback();
    }

    _final(callback) {
        this.emit('progress', 1);
        callback();
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('convert-thingtalk-to-multidst', {
            addHelp: true,
            description: "Transform a dialog input file in ThingTalk format into a dialogue state tracking dataset."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--database-file', {
            required: true,
            help: `Path to a file pointing to JSON databases used to simulate queries.`,
        });
        parser.addArgument(['-N', '--input-size'], {
            required: false,
            help: `Total number of dialogues in the input set (used for the progress bar).`,
        });
        parser.addArgument('--replace-parameters', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Replace placeholders with values from the ontology.',
            defaultValue: false
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input dialog file; use - for standard input'
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
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
    },

    async execute(args) {
        const counter = new SimpleCountStream(args.input_size);
        let tpClient = new Tp.FileClient(args);

        const database = new MultiJSONDatabase(args.database_file);
        await database.load();

        const ontology = require('../languages/multiwoz/ontology.json');
        const systemOntology = require('../languages/multiwoz/system-ontology.json');
        ontology['train-duration'] = systemOntology['time'];
        ontology['train-name'] = systemOntology['id'];
        ontology['attraction-entrance fee'] = ontology['train-price'] = systemOntology['ticket'];
        ontology['attraction-address'] = ontology['restaurant-address'] = ontology['hotel-address'] = systemOntology['addr'];
        ontology['attraction-address'] = ontology['restaurant-address'] = ontology['hotel-address'] = systemOntology['addr'];
        ontology['attraction-postcode'] = ontology['restaurant-postcode'] = ontology['hotel-postcode'] = systemOntology['post'];
        ontology['attraction-phone'] = ontology['restaurant-phone'] = ontology['hotel-phone'] = systemOntology['phone'];
        ontology['taxi-car'] = systemOntology['car'];
        ontology['restaurant-reference number'] = ontology['hotel-reference number'] =
            ontology['train-reference number'] = ontology['taxi-reference number'] = systemOntology['ref'];

        ontology['attraction-openhours'] = [];
        for (let item in database.get('uk.ac.cam.multiwoz.Attraction:Attraction'))
            ontology['attraction-openhours'].push(item.openhours || '?');

        readAllLines(args.input_file, '====')
            .pipe(new DialogueParser())
            .pipe(new DialogueToDSTStream({
                rng: seedrandom.alea(args.random_seed),
                locale: args.locale,
                debug: args.debug,
                thingpediaClient: tpClient,
                database: database,
                ontology: ontology,
                replaceParameters: args.replace_parameters,
            }))
            .pipe(counter)
            .pipe(JSONStream.stringify(undefined, undefined, undefined, 2))
            .pipe(args.output);

        const progbar = new ProgressBar(1);
        counter.on('progress', (value) => {
            //console.log(value);
            progbar.update(value);
        });

        // issue an update now to show the progress bar
        progbar.update(0);

        await StreamUtils.waitFinish(args.output);
    }
};
