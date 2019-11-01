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

const ThingTalk = require('thingtalk');
const NNSyntax = ThingTalk.NNSyntax;

const { makeDummyEntities } = require('../utils');

const $runtime = require('./runtime');
const importGenie = require('../genie-compiler');
const i18n = require('../i18n');

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

    get schemas() {
        return this._schemas;
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
        const languageClass = await importGenie(this._options.templateFile);
        this._grammar = await languageClass(this._options, this._grammar);
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

        this._idPrefix = options.idPrefix;
        this._debug = options.debug;
        this._generator = new SentenceGenerator(options);

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
            const entities = {};
            Object.assign(entities, context.entities);
            sequence = NNSyntax.toNN(program, context.code, entities);
            //ThingTalk.NNSyntax.fromNN(sequence, {});

            if (sequence.some((t) => t.endsWith(':undefined')))
                throw new TypeError(`Generated undefined type`);
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
            const program = ThingTalk.NNSyntax.fromNN(code, entities);
            await program.typecheck(this._generator.schemas, false);
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
            sequence = NNSyntax.toNN(program, {});
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

module.exports = {
    BasicSentenceGenerator,
    ContextualSentenceGenerator
};
