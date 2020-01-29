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

const { makeDummyEntities } = require('../utils');

const $runtime = require('./runtime');
const importGenie = require('../genie-compiler');
const i18n = require('../i18n');
const { uniform } = require('../random');
const MultiMap = require('../multimap');

const BASIC_TARGET_GEN_SIZE = 100000;
const CONTEXTUAL_TARGET_GEN_SIZE = 10000;

class SentenceGenerator extends events.EventEmitter {
    constructor(options) {
        super();
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
        for (let file of this._options.templateFiles) {
            const compiledTemplate = await importGenie(file);
            this._grammar = await compiledTemplate(this._options, this._grammar);
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
        let sequence;
        try {
            sequence = this._target.serialize(program, context.code, context.entities);
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
        this.push({ depth, id, flags, preprocessed, context: context.code.join(' '), target_code: sequence.join(' ') });
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

            console.error(program.prettyprint(program).trim());
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

/**
 * Generate a minibatch of dialogs.
 *
 * This object is created afresh for every minibatch.
 */
class MinibatchDialogGenerator {
    constructor(sentenceGenerator, targetLanguage, options, minibatchIdx) {
        this._sentenceGenerator = sentenceGenerator;
        this._target = targetLanguage;
        this._minibatchSize = options.minibatchSize;
        this._rng = options.rng;

        // total counters include those that were randomly pruned
        this._numTotalCompleteDialogs = 0;
        this._completeDialogs = [];

        this._numTotalPartialDialogs = 0;
        this._partialDialogs = [];

        this._minibatchIdx = minibatchIdx;
        this._turnIdx = 0;
    }

    async init(initialSentences) {
        this._partialDialogs = await Promise.all(initialSentences.map(async (example) => {
            const code = example.target_code.split(' ');

            const entities = makeDummyEntities(example.target_code);
            const program = await this._target.parse(code, entities, this._options);

            const dlg = [{
                system: '',
                user: example.preprocessed,
                target: example.target_code
            }];
            const context = new $runtime.Context(code, program, entities);
            return [context, dlg];
        }));
        this._numTotalPartialDialogs = this._partialDialogs.length;
    }

    async _maybeAddCompleteDialog(dlg) {
        this._numTotalCompleteDialogs ++;
        if (this._completeDialogs.length < this._minibatchSize) {
            this._completeDialogs.push(dlg);
        } else {
            const num = Math.floor(this._rng() * this._numTotalCompleteDialogs);
            if (num < this._minibatchSize)
                this._completeDialogs[num] = dlg;
        }
    }

    async _maybeAddPartialDialog(context, dlg) {
        this._numTotalPartialDialogs ++;
        if (this._partialDialogs.length < this._minibatchSize) {
            this._partialDialogs.push([context, dlg]);
        } else {
            const num = Math.floor(this._rng() * this._numTotalPartialDialogs);
            if (num < this._minibatchSize)
                this._partialDialogs[num] = [context, dlg];
        }
    }

    async nextTurn() {
        this._turnIdx++;
        const start = Date.now();
        if (this._debug)
            console.log(`Minibatch ${this._minibatchIdx}, turn ${this._turnIdx}`);

        const contexts = this._partialDialogs.map(([ctx,]) => ctx);

        const continuations = new MultiMap;
        for (let [, derivation] of this._sentenceGenerator.generate(contexts)) {
            const context = derivation.context;

            const program = derivation.value.optimize();
            assert(program !== null); // not-null even after optimize
            let preprocessed = derivation.toString();
            preprocessed = preprocessed.replace(/ +/g, ' ');
            preprocessed = this._sentenceGenerator.postprocess(preprocessed, program);

            const [system, user] = preprocessed.split(' <sep> ');
            assert(system);
            assert(user);

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

                console.error(program.prettyprint(program).trim());
                this.emit('error', e);
            }

            const newContext = new $runtime.Context(sequence, program, {});
            continuations.put(context, [newContext, {
                system,
                user,
                target: sequence.join(' ')
            }]);

        }

        const partials = this._partialDialogs;
        this._partialDialogs = [];
        this._numTotalPartialDialogs = 0;

        for (let i = 0; i < partials.length; i++) {
            const [context, dlg] = partials[i];
            const ourContinuations = continuations.get(context);

            if (ourContinuations.length === 0) {
                // if we have no continuations, mark this dialog as complete
                this._maybeAddCompleteDialog(dlg);
            } else {
                for (let [newContext, newTurn] of ourContinuations) {
                    const clone = dlg.slice();
                    clone.push(newTurn);
                    this._maybeAddPartialDialog(newContext, clone);
                }
            }
        }

        const end = Date.now();
        if (this._debug)
            console.log(`Turn took ${Math.round((end-start)/1000)} seconds`);
    }

    complete() {
        for (let [,dlg] of this._partialDialogs)
            this._maybeAddCompleteDialog(dlg);

        return this._completeDialogs;
    }
}

const INPUT_MINIBATCH_MULTIPLIER = 5;

class DialogGenerator extends stream.Transform {
    constructor(options) {
        super({ objectMode: true });

        this._i = 0;
        this._targetSize = options.targetSize;
        this._minibatchSize = options.minibatchSize;
        this._inputMinibatchSize = INPUT_MINIBATCH_MULTIPLIER * options.minibatchSize;

        this._options = options;
        this._idPrefix = options.idPrefix || '';
        this._debug = options.debug;
        this._rng = options.rng;

        options.contextual = true;
        if (options.targetPruningSize === undefined)
            options.targetPruningSize = CONTEXTUAL_TARGET_GEN_SIZE;
        this._generator = new SentenceGenerator(options);
        this._initialized = false;
        this._target = require('../languages/' + options.targetLanguage);

        this._inputMinibatch = [];
        this._minibatchIdx = 0;
    }

    async _processInputMinibatch(inputMinibatch) {
        if (!this._initialized) {
            await this._generator.initialize();
            this._initialized = true;
        }

        for (let i = 0; i < INPUT_MINIBATCH_MULTIPLIER; i++) {
            const start = Date.now();
            try {
                // sample **with** replacement - so the same initial sentence can be used in multiple dialogues
                const initialMinibatch = [];
                for (let j = 0; j < this._minibatchSize; j++)
                    initialMinibatch.push(uniform(inputMinibatch, this._rng));

                const generator = new MinibatchDialogGenerator(this._generator, this._target, this._options, this._minibatchIdx++);

                await generator.init(initialMinibatch);
                for (let turn = 0; turn < this._options.maxTurns; turn++)
                    await generator.nextTurn();

                const generated = generator.complete();
                for (let turns of generated) {
                    const dlg = {
                        id: this._idPrefix + '' + this._i++,
                        turns
                    };
                    this.push(dlg);
                    if (this._i >= this._targetSize)
                        return;
                }
            } finally {
                const end = Date.now();
                if (this._debug)
                    console.log(`Minibatch took ${Math.round((end-start)/1000)} seconds`);
            }
        }
    }

    _transform(contextExample, encoding, callback) {
        if (this._i >= this._targetSize) {
            callback();
            return;
        }

        this._inputMinibatch.push(contextExample);
        if (this._inputMinibatch.length < this._inputMinibatchSize) {
            callback();
            return;
        }

        const minibatch = this._inputMinibatch;
        this._inputMinibatch = [];
        this._processInputMinibatch(minibatch).then(callback, callback);
    }

    _flush(callback) {
        if (this._i >= this._targetSize) {
            callback();
            return;
        }

        if (this._inputMinibatch.length > 0)
            this._processInputMinibatch(this._inputMinibatch).then(callback, callback);
        else
            process.nextTick(callback);
    }
}

module.exports = {
    BasicSentenceGenerator,
    ContextualSentenceGenerator,
    DialogGenerator
};
