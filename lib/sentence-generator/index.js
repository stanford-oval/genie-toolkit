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
const yaml = require('js-yaml');
const util = require('util');
const fs = require('fs');

const $runtime = require('./runtime');
const i18n = require('../i18n');
const MultiMap = require('../utils/multimap');
const { ReservoirSampler, } = require('../utils/random');
const importGenie = require('./compiler');
const TargetLanguages = require('../languages');

const BASIC_TARGET_GEN_SIZE = 100000;
const CONTEXTUAL_TARGET_GEN_SIZE = 10000;

class SentenceGenerator extends events.EventEmitter {
    constructor(options) {
        super();
        this._target = TargetLanguages.get(options.targetLanguage);
        this._templateFiles = options.templateFiles;
        this._options = options;
        this._langPack = i18n.get(options.locale);
        this._grammar = null;
        this._generator = null;
    }

    get progress() {
        return this._grammar.progress;
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
        this._grammar.finalize();
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
        this._target = TargetLanguages.get(options.targetLanguage);
        this._idPrefix = options.idPrefix || '';
        this._langPack = i18n.get(options.locale);
        this._rng = options.rng;
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

    _postprocessSentence(derivation, program) {
        let utterance = derivation.toString();
        utterance = utterance.replace(/ +/g, ' ');
        utterance = this._langPack.postprocessSynthetic(utterance, program, this._rng);
        return utterance;
    }

    _output(depth, derivation) {
        let program = derivation.value.optimize();
        assert(program !== null); // not-null even after optimize
        const preprocessed = this._postprocessSentence(derivation, program);
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
    constructor(context = null, turns = [], execState = undefined) {
        this.context = context;
        this.turns = turns;
        this.execState = execState;
    }
}

const FACTORS = [50, 75, 75, 100];

/**
 * Generate a minibatch of dialogues.
 *
 * This object is created afresh for every minibatch.
 */
class MinibatchDialogueGenerator {
    constructor(agentGenerator, userGenerator, targetLanguage, langPack, dialogueAgent, stateValidator, options, minibatchIdx) {
        this._agentGenerator = agentGenerator;
        this._userGenerator = userGenerator;
        this._target = targetLanguage;
        this._langPack = langPack;
        this._dialogueAgent = dialogueAgent;
        this._stateValidator = stateValidator;
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

    _postprocessSentence(derivation, program) {
        let utterance = derivation.toString();
        utterance = utterance.replace(/ +/g, ' ');
        utterance = this._langPack.postprocessSynthetic(utterance, program, this._rng);
        return utterance;
    }

    _generateAgent(partials) {
        const agentTurns = [];
        this._agentGenerator.generate(partials, (depth, derivation) => {
            // derivation.dlg is the PartialDialogue that is being continued
            // derivation.value is the object returned by the root semantic function, with:
            // - state (the thingtalk state)
            // - context (the context info to pass to the semantic function of the user)
            // - tags (context tags to set when generating user sentences)
            // - other properties only relevant to inference time we don't care about

            // set the turn of the agent
            let state = derivation.value.state;
            state = state.optimize();
            assert(state !== null); // not-null even after optimize
            this._stateValidator.validateAgent(state);
            const utterance = this._postprocessSentence(derivation, state);

            const dlg = derivation.context.priv;
            assert(dlg instanceof PartialDialogue);
            const prediction = this._target.computePrediction(dlg.context, state, 'agent');
            const target = prediction.prettyprint();

            agentTurns.push({
                dlg,
                context: derivation.value.context,
                tags: derivation.value.tags,
                utterance,
                state,
                target
            });
        });
        return agentTurns;
    }

    _generateUser(continuations, agentTurns) {
        this._userGenerator.generate(agentTurns, (depth, derivation) => {
            // the derivation value for the user is directly the thingtalk user state
            // (unlike the agent)

            let state = derivation.value;
            state = state.optimize();
            assert(state !== null); // not-null even after optimize
            this._stateValidator.validateUser(state);
            const utterance = this._postprocessSentence(derivation, state);

            const agentTurn = derivation.context.priv;
            const dlg = agentTurn.dlg;
            assert(dlg instanceof PartialDialogue);
            assert(dlg === this._emptyDialogue || agentTurn.state);
            const prediction = this._target.computePrediction(agentTurn.state, state, 'user');
            const target = prediction.prettyprint();

            continuations.put(dlg, {
                userState: state,
                newTurn: {
                    context: dlg.context !== null ? dlg.context.prettyprint() : null,
                    agent: agentTurn.utterance,
                    agent_target: agentTurn.target,
                    user: utterance,
                    user_target: target,
                },
            });
        });
    }

    async _continueOneDialogue(dlg, continuations) {
        const ourContinuations = continuations.get(dlg);

        if (ourContinuations.length === 0) {
            // if we have no continuations, mark this dialog as complete
            this._maybeAddCompleteDialog(dlg);
        } else {
            for (let { userState, newTurn } of ourContinuations) {
                const newDialogue = new PartialDialogue(dlg.context, dlg.turns.concat([newTurn]),
                    dlg.execState);

                if (this._maybeAddPartialDialog(newDialogue)) {
                    const [newContext, newExecState] = await this._dialogueAgent.execute(userState, dlg.execState);
                    newDialogue.context = newContext;
                    newDialogue.execState = newExecState;
                }
            }
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

        let agentTurns = [];
        if (this._turnIdx > 1) { // turnIdx is 1-based because we incremented it already
            agentTurns = this._generateAgent(partials);
        } else {
            agentTurns = [{
                dlg: this._emptyDialogue,
                context: null,
                tags: [],
                utterance: '',
                state: null,
                target: null,
            }];
        }
        this._generateUser(continuations, agentTurns);

        for (let dlg of partials)
            await this._continueOneDialogue(dlg, continuations);

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

class StateValidator {
    constructor(policyManifest, target) {
        this._policyManifest = policyManifest;
        this._policy = null;
        this._target = target;
    }

    async load() {
        if (!this._policyManifest)
            return;
        const buffer = await util.promisify(fs.readFile)(this._policyManifest, { encoding: 'utf8' });
        this._policy = yaml.safeLoad(buffer);
        this._policy.dialogueActs.user = new Set(this._policy.dialogueActs.user);
        this._policy.dialogueActs.agent = new Set(this._policy.dialogueActs.agent);
        this._policy.dialogueActs.withParam = new Set(this._policy.dialogueActs.withParam);
    }

    validateUser(state) {
        this._target.validateState(state, 'user');

        if (!this._policy)
            return;
        assert.strictEqual(state.policy, this._policy.name);
        assert(this._policy.dialogueActs.user.has(state.dialogueAct));
        // if and only if
        assert((state.dialogueActParam !== null) === (this._policy.dialogueActs.withParam.has(state.dialogueAct)));
    }

    validateAgent(state) {
        this._target.validateState(state, 'agent');

        if (!this._policy)
            return;
        assert.strictEqual(state.policy, this._policy.name);
        assert(this._policy.dialogueActs.user.has(state.dialogueAct));
        assert(state.dialogueAct !== this._policy.terminalAct);
        // if and only if
        assert((state.dialogueActParam !== null) === (this._policy.dialogueActs.withParam.has(state.dialogueAct)));
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
        this._target = TargetLanguages.get(options.targetLanguage);
        this._langPack = i18n.get(options.locale);

        const agentOptions = {};
        Object.assign(agentOptions, options);
        agentOptions.rootSymbol = '$agent';
        agentOptions.contextInitializer = (partialDialogue, functionTable) => {
            const tagger = functionTable.get('context');
            return tagger(partialDialogue.context);
        };
        this._agentGenerator = new SentenceGenerator(agentOptions);

        const userOptions = {};
        Object.assign(userOptions, options);
        userOptions.rootSymbol = '$user';
        userOptions.contextInitializer = (agentTurn, functionTable) => {
            if (agentTurn.context === null) {
                // first turn
                const tagger = functionTable.get('context');
                return tagger(null);
            } else {
                return [agentTurn.tags, agentTurn.context];
            }
        };
        this._userGenerator = new SentenceGenerator(userOptions);
        this._stateValidator = new StateValidator(options.policyFile, this._target);

        this._initialized = false;
        this._dialogueAgent = this._target.createSimulator(options);
        this._minibatchIdx = 0;
    }

    async _generateMinibatch() {
        if (!this._initialized) {
            await this._userGenerator.initialize();
            await this._agentGenerator.initialize();
            await this._stateValidator.load();
            this._initialized = true;
        }

        const start = Date.now();
        let counter = 0;
        try {
            const generator = new MinibatchDialogueGenerator(this._agentGenerator,
                this._userGenerator, this._target, this._langPack, this._dialogueAgent,
                this._stateValidator, this._options, this._minibatchIdx++);

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
