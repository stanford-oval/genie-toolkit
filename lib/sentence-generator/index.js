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

const { parseEntity } = require('../utils');

const $runtime = require('./runtime');
const importGenie = require('../genie-compiler');
const i18n = require('../i18n');
const MultiMap = require('../multimap');
const { ReservoirSampler, } = require('../random');

const BASIC_TARGET_GEN_SIZE = 100000;
const CONTEXTUAL_TARGET_GEN_SIZE = 10000;

class SentenceGenerator extends events.EventEmitter {
    constructor(options) {
        super();
        this._target = require('../languages/' + options.targetLanguage);
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

    generate(contexts, callback) {
        this._grammar.generate(contexts, callback);
    }
    generateOne(context) {
        return this._grammar.generateOne(context);
    }

    async initialize() {
        this._grammar = new $runtime.Grammar(this._target, this._options);
        for (let file of this._templateFiles) {
            const compiledTemplate = await importGenie(file);
            this._grammar = await compiledTemplate(this._options, this._langPack, this._grammar);
        }
        this._grammar.on('progress', (value) => {
            this.emit('progress', value);
        });
    }
}

class BasicSentenceGenerator extends stream.Readable {
    constructor(options = {}) {
        super({ objectMode: true });
        options.contextual = false;
        if (options.targetPruningSize === undefined)
            options.targetPruningSize = BASIC_TARGET_GEN_SIZE;
        this._target = require('../languages/' + options.targetLanguage);
        this._idPrefix = options.idPrefix || '';
        this._generator = new SentenceGenerator(options);
        this._generator.on('progress', (value) => {
            this.emit('progress', value);
        });
        this._iterator = null;

        this._initialization = null;
        this._i = 0;
    }

    _read() {
        if (this._initialization === null)
            this._initialization = this._generator.initialize();

        this._initialization.then(() => {
            this._generator.generate([], this._output.bind(this));
            this.emit('progress', this._generator.progress);
            this.push(null);
        }).catch((e) => {
            console.error(e);
            this.emit('error', e);
        });
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
        id = this._idPrefix + depth + '000000000'.substring(0,9-id.length) + id;
        const flags = {
            synthetic: true
        };
        return this.push({ depth, id, flags, preprocessed, target_code: sequence.join(' ') });
    }
}

class PartialDialogue {
    constructor(context = null, turns = [], constants = {}, execState = undefined) {
        this.context = context;
        this.turns = turns;
        this.constants = constants;
        this.execState = undefined;
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

const FACTORS = [50, 75, 75, 100];

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

        this._partialDialogs = new ReservoirSampler(Math.ceil(this._minibatchSize), this._rng);
        this._emptyDialogue = new PartialDialogue();
        this._maybeAddPartialDialog(this._emptyDialogue);
        this._completeDialogs = [];
        for (let turnIdx = 0; turnIdx < options.maxTurns; turnIdx++) {
            const factor = turnIdx < FACTORS.length ? FACTORS[turnIdx] : FACTORS[FACTORS.length-1];
            this._completeDialogs[turnIdx] = new ReservoirSampler(Math.ceil(this._minibatchSize * factor), this._rng);
        }
    }

    _maybeAddCompleteDialog(dlg) {
        assert(dlg.turns.length > 0);
        this._completeDialogs[dlg.turns.length-1].add(dlg.turns);
    }

    _maybeAddPartialDialog(dlg) {
        const discarded = this._partialDialogs.add(dlg);
        if (discarded !== undefined)
            this._maybeAddCompleteDialog(discarded);
        return discarded !== dlg;
    }

    _addTurn(continuations, derivation) {
        const dlg = derivation.context.dlg;

        let [agentState, userState] = derivation.value;
        let agent, agent_target, user, user_target;
        let newConstants = {};
        Object.assign(newConstants, dlg.constants);
        if (dlg.context === null) {
            // first turn in the dialogue
            assert(dlg === this._emptyDialogue);
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

            const agentPrediction = this._target.computePrediction(dlg.context, agentState, 'agent');
            agent_target = agentPrediction.prettyprint();

            const userPrediction = this._target.computePrediction(agentState, userState, 'user');
            user_target = userPrediction.prettyprint();
        }

        continuations.put(dlg, {
            userState,
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

    _tryAddTurn(continuations, derivation) {
        try {
            this._addTurn(continuations, derivation);
        } catch(e) {
            console.error(derivation.toString());
            console.error(derivation.value);
            throw e;
        }
    }

    async nextTurn() {
        this._turnIdx++;
        const start = Date.now();
        if (this._debug)
            console.log(`Minibatch ${this._minibatchIdx}, turn ${this._turnIdx}`);

        const partials = this._partialDialogs.sampled;
        this._partialDialogs.reset();

        const continuations = new MultiMap;
        if (this._minibatchSize === 1) {
            assert(partials.length <= 1);
            if (partials.length > 0) {
                const derivation = this._sentenceGenerator.generateOne(partials[0]);
                if (derivation !== undefined)
                    this._tryAddTurn(continuations, derivation);
            }
        } else {
            this._sentenceGenerator.generate(partials, (depth, derivation) => {
                this._tryAddTurn(continuations, derivation);
            });
        }

        for (let i = 0; i < partials.length; i++) {
            const dlg = partials[i];
            const ourContinuations = continuations.get(dlg);

            if (ourContinuations.length === 0) {
                // if we have no continuations, mark this dialog as complete
                this._maybeAddCompleteDialog(dlg);
            } else {
                for (let { userState, newTurn, newConstants } of ourContinuations) {
                    const newDialogue = new PartialDialogue(dlg.context, dlg.turns.concat([newTurn]),
                        newConstants, dlg.execState);

                    if (this._maybeAddPartialDialog(newDialogue)) {
                        const [newContext, newExecState] = await this._dialogueAgent.execute(userState, dlg.execState);
                        newDialogue.context = newContext;
                        newDialogue.execState = newExecState;
                    }
                }
            }
        }

        const end = Date.now();
        if (this._debug) {
            console.log(`Produced ${this._partialDialogs.counter} partial dialogs this turn`);
            console.log(`Turn took ${Math.round((end-start)/1000)} seconds`);
        }
    }

    *complete() {
        for (let dlg of this._partialDialogs)
            this._maybeAddCompleteDialog(dlg);

        //assert(this._completeDialogs.length > 0);
        for (let turnIdx = 0; turnIdx < this._options.maxTurns; turnIdx++) {
            for (let dialogue of this._completeDialogs[turnIdx])
                yield dialogue;
        }
    }
}

class DialogueGenerator extends stream.Readable {
    constructor(options) {
        super({ objectMode: true });

        this._i = 0;
        this._minibatchSize = options.minibatchSize;
        this._numMinibatches = options.numMinibatches;

        this._options = options;
        this._idPrefix = options.idPrefix || '';
        this._debug = options.debug;
        this._rng = options.rng;

        options.contextual = true;
        if (options.targetPruningSize === undefined)
            options.targetPruningSize = CONTEXTUAL_TARGET_GEN_SIZE;
        if (options.maxConstants === undefined)
            options.maxConstants = 5;
        this._target = require('../languages/' + options.targetLanguage);
        this._generator = new SentenceGenerator(options);

        this._initialized = false;
        this._dialogueAgent = this._target.createSimulator(options);
        this._minibatchIdx = 0;
    }

    async _generateMinibatch() {
        if (!this._initialized) {
            await this._generator.initialize();
            this._initialized = true;
        }

        const start = Date.now();
        let counter = 0;
        try {
            const generator = new MinibatchDialogueGenerator(this._generator, this._target, this._dialogueAgent, this._options, this._minibatchIdx++);

            for (let turn = 0; turn < this._options.maxTurns; turn++)
                await generator.nextTurn();

            for (let turns of generator.complete()) {
                const dlg = {
                    id: this._idPrefix + '' + this._i++,
                    turns
                };
                this.push(dlg);
                counter ++;
            }
        } finally {
            const end = Date.now();
            if (this._debug)
                console.log(`Minibatch took ${Math.round((end-start)/1000)} seconds and produced ${counter} dialogues`);
        }
    }

    _read() {
        if (this._minibatchIdx >= this._numMinibatches) {
            this.push(null);
            return;
        }

        this._generateMinibatch().catch((e) => {
            this.emit('error', e);
        });
    }
}

module.exports = {
    // low-level interface
    SentenceGenerator,

    // stream interface for batch generation
    BasicSentenceGenerator,
    DialogueGenerator
};
