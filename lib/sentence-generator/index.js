// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2017-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const stream = require('stream');
const events = require('events');

const { parseEntity, makeDummyEntities } = require('../utils');

const $runtime = require('./runtime');
const importGenie = require('../genie-compiler');
const i18n = require('../i18n');
const MultiMap = require('../multimap');
const { coin, randint } = require('../random');

const BASIC_TARGET_GEN_SIZE = 100000;
const CONTEXTUAL_TARGET_GEN_SIZE = 10000;

class SentenceGenerator extends events.EventEmitter {
    constructor(options) {
        super();
        this._templateFiles = options.templateFiles;
        this._options = options;
        this._langPack = i18n.get(options.locale);
        this._postprocess = this._langPack.postprocessSynthetic;
        this._grammar = null;
        this._generator = null;
    }

    get progress() {
        return this._grammar.progress;
    }

    postprocess(sentence, program) {
        return this._postprocess(sentence, program, this._options.rng);
    }

    generate(context) {
        return this._grammar.generate(context);
    }

    async initialize() {
        this._grammar = new $runtime.Grammar(this._options);
        for (let file of this._templateFiles) {
            const compiledTemplate = await importGenie(file);
            this._grammar = await compiledTemplate(this._options, this._langPack, this._grammar);
        }
        this._grammar.on('progress', (value) => {
            this.emit('progress', value);
        });
    }
}

const MINIBATCH_SIZE = 5000;
class ContextualSentenceGenerator extends stream.Transform {
    constructor(options = {}) {
        super({ objectMode: true });
        options.contextual = true;
        if (options.targetPruningSize === undefined)
            options.targetPruningSize = CONTEXTUAL_TARGET_GEN_SIZE;

        this._options = options;
        this._idPrefix = options.idPrefix;
        this._debug = options.debug;
        this._generator = new SentenceGenerator(options);
        this._target = require('../languages/' + options.targetLanguage);

        this._minibatch = [];
        this._processed = 0;

        this._initialized = false;
        this._i = 0;
    }

    _output(depth, derivation) {
        const context = derivation.context;
        const program = derivation.value.optimize();
        assert(program !== null); // not-null even after optimize
        let preprocessed = derivation.toString();
        preprocessed = preprocessed.replace(/ +/g, ' ');
        preprocessed = this._generator.postprocess(preprocessed, program);

        const [contextCode, contextEntities] = this._target.serializeNormalized(context.value);
        let sequence;
        try {
            sequence = this._target.serialize(program, contextCode, contextEntities);
        } catch(e) {
            //console.error(context.code.join(' '));
            console.error(preprocessed);
            console.error(program.prettyprint());
            console.error(sequence);

            console.error(program.prettyprint(program).trim());
            this.emit('error', e);
        }

        let id = String(this._i++);
        id = this._idPrefix + depth + '000000000'.substring(0,9-id.length) + id;
        const flags = {
            synthetic: true,
            contextual: true,
        };

        this.push({ depth, id, flags, preprocessed, context: contextCode.join(' '), target_code: sequence.join(' ') });
    }

    async _process(minibatch) {
        if (!this._initialized) {
            await this._generator.initialize();
            this._initialized = true;
        }

        const start = Date.now();
        if (this._debug)
            console.log(`Minibatch ${this._processed}-${this._processed+minibatch.length}`);

        const contexts = await Promise.all(minibatch.map(async (contextCode) => {
            const code = contextCode.split(' ');

            const entities = makeDummyEntities(contextCode);
            const program = await this._target.parse(code, entities, this._options);
            return new $runtime.Context(code, program, entities);
        }));

        for (let [depth, derivation] of this._generator.generate(contexts))
            this._output(depth, derivation);

        this._processed += minibatch.length;
        const end = Date.now();
        if (this._debug)
            console.log(`Minibatch took ${Math.round((end-start)/1000)} seconds`);
    }

    _transform(contextExample, encoding, callback) {
        this._minibatch.push(contextExample);
        if (this._minibatch.length < MINIBATCH_SIZE) {
            callback();
            return;
        }

        const minibatch = this._minibatch;
        this._minibatch = [];
        this._process(minibatch).then(callback, callback);
    }

    _flush(callback) {
        if (this._minibatch.length > 0)
            this._process(this._minibatch).then(callback, callback);
        else
            process.nextTick(callback);
    }
}

class BasicSentenceGenerator extends stream.Readable {
    constructor(options = {}) {
        super({ objectMode: true });
        options.contextual = false;
        if (options.targetPruningSize === undefined)
            options.targetPruningSize = BASIC_TARGET_GEN_SIZE;
        this._generator = new SentenceGenerator(options);
        this._generator.on('progress', (value) => {
            this.emit('progress', value);
        });
        this._target = require('../languages/' + options.targetLanguage);
        this._iterator = null;

        this._initialization = null;
        this._i = 0;
    }

    _read() {
        if (this._initialization === null)
            this._initialization = this._generator.initialize();

        this._initialization.then(() => this._minibatch()).catch((e) => {
            console.error(e);
            this.emit('error', e);
        });
    }

    _minibatch() {
        if (this._iterator === null)
            this._iterator = this._generator.generate();

        for (;;) {
            let { value, done } = this._iterator.next();
            if (done) {
                this.emit('progress', this._generator.progress);
                this.push(null);
                return;
            }
            const [depth, derivation] = value;
            if (!this._output(depth, derivation))
                return;
        }
    }

    _output(depth, derivation) {
        let program = derivation.value.optimize();
        assert(program !== null); // not-null even after optimize
        let preprocessed = derivation.toString();
        preprocessed = preprocessed.replace(/ +/g, ' ');
        preprocessed = this._generator.postprocess(preprocessed, program);
        let sequence;
        try {
            sequence = this._target.serialize(program, [], {});
            //ThingTalk.NNSyntax.fromNN(sequence, {});

            if (sequence.some((t) => t.endsWith(':undefined')))
                throw new TypeError(`Generated undefined type`);
        } catch(e) {
            console.error(preprocessed);
            console.error(String(program));
            console.error(sequence);

            console.error(program.prettyprint().trim());
            this.emit('error', e);
        }
        let id = String(this._i++);
        id = depth + '000000000'.substring(0,9-id.length) + id;
        const flags = {
            synthetic: true
        };
        return this.push({ depth, id, flags, preprocessed, target_code: sequence.join(' ') });
    }
}

class PartialDialogue {
    constructor(context = null, turns = [], constants = {}) {
        this.context = context;
        this.turns = turns;
        this.constants = constants;

        this.weight = undefined;
    }

    updateWeight() {
        if (this.weight !== undefined)
            return;

        let weight = 0;
        for (let turn of this.turns) {
            if (turn.weight === undefined) {
                let agentWords = turn.agent.split(' ');
                let userWords = turn.user.split(' ');

                let length = 0;
                for (let word of agentWords) {
                    if (/^[A-Z]/.test(word))
                        length += 2;
                    else
                        length += 1;
                }
                for (let word of userWords) {
                    if (/^[A-Z]/.test(word))
                        length += 2;
                    else
                        length += 1;
                }
                turn.weight = length;
            }
            weight += turn.weight;
        }

        this.weight = 10 * weight;
    }
}

function mergeConstants(constants, sentence) {
    for (let token of sentence.split(' ')) {
        const entity = parseEntity(token);
        if (entity === null)
            continue;

        const [type, index] = entity;
        constants[type] = Math.max(constants[type] || 0, index + 1);
    }
}

class ReservoirSampler {
    constructor(targetSize, rng) {
        this._targetSize = targetSize;
        this._rng = rng;

        this._counter = 0;
        this._totalWeight = 0;
        this._reservoir = [];
    }

    get counter() {
        return this._counter;
    }

    get sampled() {
        return this._reservoir;
    }

    reset() {
        this._counter = 0;
        this._totalWeight = 0;
        this._reservoir = [];
    }

    add(element, weight) {
        this._counter ++;
        this._totalWeight += weight;
        if (this._reservoir.length < this._targetSize) {
            this._reservoir.push(element);
        } else {
            const prob = weight / this._totalWeight;
            if (coin(prob, this._rng)) {
                const num = randint(0, this._targetSize-1, this._rng);
                this._reservoir[num] = element;
            }
        }
    }
}

/**
 * Generate a minibatch of dialogues.
 *
 * This object is created afresh for every minibatch.
 */
class MinibatchDialogueGenerator {
    constructor(sentenceGenerator, targetLanguage, dialogueAgent, options, minibatchIdx) {
        this._sentenceGenerator = sentenceGenerator;
        this._target = targetLanguage;
        this._dialogueAgent = dialogueAgent;
        this._minibatchSize = options.minibatchSize;
        this._rng = options.rng;
        this._options = options;

        this._minibatchIdx = minibatchIdx;
        this._turnIdx = 0;

        this._debug = true;

        this._partialDialogs = new ReservoirSampler(this._minibatchSize, this._rng);
        this._maybeAddPartialDialog(new PartialDialogue());
        this._completeDialogs = new ReservoirSampler(this._minibatchSize, this._rng);
    }

    _maybeAddCompleteDialog(dlg) {
        dlg.updateWeight();
        assert(dlg.turns.length > 0);
        this._completeDialogs.add(dlg.turns, dlg.weight);
    }

    _maybeAddPartialDialog(dlg) {
        dlg.updateWeight();
        this._partialDialogs.add(dlg, dlg.weight);
    }

    async nextTurn() {
        this._turnIdx++;
        const start = Date.now();
        if (this._debug)
            console.log(`Minibatch ${this._minibatchIdx}, turn ${this._turnIdx}`);

        const partials = this._partialDialogs.sampled;
        this._partialDialogs.reset();

        const continuations = new MultiMap;
        for (let [, derivation] of this._sentenceGenerator.generate(partials)) {
            const dlg = derivation.context.dlg;

            let [agentState, userState] = derivation.value;
            let agent, agent_target, user, user_target;
            let newConstants = {};
            Object.assign(newConstants, dlg.constants);
            if (dlg.context === null) {
                // first turn in the dialogue
                assert(agentState === null);
                userState = userState.optimize();
                assert(userState !== null); // not-null even after optimize
                let turnString = derivation.toString();
                turnString = turnString.replace(/ +/g, ' ');
                turnString = this._sentenceGenerator.postprocess(turnString, userState);
                mergeConstants(newConstants, turnString);

                agent = '';
                agent_target = null;
                user = turnString;
                user_target = userState.prettyprint();
            } else {
                agentState = agentState.optimize();
                userState = userState.optimize();
                assert(agentState !== null); // not-null even after optimize
                assert(userState !== null); // not-null even after optimize
                let turnString = derivation.toString();
                turnString = turnString.replace(/ +/g, ' ');
                turnString = this._sentenceGenerator.postprocess(turnString, userState);
                mergeConstants(newConstants, turnString);

                [agent, user] = turnString.split(' <sep> ');
                assert(agent);
                assert(user);

                agent_target = agentState.prettyprint();
                user_target = userState.prettyprint();
            }

            const newContextState = await this._dialogueAgent.execute(userState);
            continuations.put(dlg, {
                newContext: newContextState,
                newTurn: {
                    context: dlg.context !== null ? dlg.context.prettyprint() : null,
                    agent,
                    agent_target,
                    user,
                    user_target
                },
                newConstants: {}
            });
        }

        for (let i = 0; i < partials.length; i++) {
            const dlg = partials[i];
            const ourContinuations = continuations.get(dlg);

            if (ourContinuations.length === 0) {
                // if we have no continuations, mark this dialog as complete
                this._maybeAddCompleteDialog(dlg);
            } else {
                for (let { newContext, newTurn, newConstants } of ourContinuations) {
                    this._maybeAddPartialDialog(new PartialDialogue(
                        newContext,
                        dlg.turns.concat([newTurn]),
                        newConstants
                    ));
                }
            }
        }

        const end = Date.now();
        if (this._debug) {
            console.log(`Produced ${this._partialDialogs.counter} partial dialogs`);
            console.log(`Turn took ${Math.round((end-start)/1000)} seconds`);
        }
    }

    complete() {
        for (let dlg of this._partialDialogs.sampled)
            this._maybeAddCompleteDialog(dlg);

        return this._completeDialogs.sampled;
    }
}

class DialogueGenerator extends stream.Readable {
    constructor(options) {
        super({ objectMode: true });

        this._i = 0;
        this._targetSize = options.targetSize;
        this._minibatchSize = options.minibatchSize;

        this._options = options;
        this._idPrefix = options.idPrefix || '';
        this._debug = options.debug;
        this._rng = options.rng;

        options.contextual = true;
        if (options.targetPruningSize === undefined)
            options.targetPruningSize = CONTEXTUAL_TARGET_GEN_SIZE;
        if (options.maxConstants === undefined)
            options.maxConstants = 5;
        this._generator = new SentenceGenerator(options);

        this._initialized = false;
        this._target = require('../languages/' + options.targetLanguage);
        this._dialogueAgent = this._target.createSimulator(options);
        this._minibatchIdx = 0;
    }

    async _generateMinibatch() {
        if (!this._initialized) {
            await this._generator.initialize();
            this._initialized = true;
        }

        const start = Date.now();
        try {
            const generator = new MinibatchDialogueGenerator(this._generator, this._target, this._dialogueAgent, this._options, this._minibatchIdx++);

            for (let turn = 0; turn < this._options.maxTurns; turn++)
                await generator.nextTurn();

            const generated = generator.complete();
            for (let turns of generated) {
                const dlg = {
                    id: this._idPrefix + '' + this._i++,
                    turns
                };
                this.push(dlg);
                if (this._i >= this._targetSize) {
                    this.push(null);
                    return;
                }
            }
        } finally {
            const end = Date.now();
            if (this._debug)
                console.log(`Minibatch took ${Math.round((end-start)/1000)} seconds`);
        }
    }

    _read() {
        if (this._i >= this._targetSize) {
            this.push(null);
            return;
        }

        this._generateMinibatch().catch((e) => {
            this.emit('error', e);
        });
    }
}

module.exports = {
    BasicSentenceGenerator,
    ContextualSentenceGenerator,
    DialogueGenerator
};
