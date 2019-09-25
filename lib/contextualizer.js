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

const assert = require('assert');
const Stream = require('stream');

const I18n = require('./i18n');
const { uniform, coin } = require('./random');

function extractEntities(code) {
    const entities = {};

    for (let token of code) {
        const match = /^([A-Z].*)_([0-9]+)$/.exec(token);
        if (match !== null) {
            const type = match[1];
            const num = parseInt(match[2]);

            entities[type] = Math.max(entities[type]||0, num);
        }
    }

    return entities;
}

function renumberEntities(code, offsets) {
    let changed = false;
    for (let i = 0; i < code.length; i++) {
        const match = /^([A-Z].*)_([0-9]+)$/.exec(code[i]);
        if (match !== null && match[1] in offsets) {
            code[i] = match[1] + '_' + (parseInt(match[2]) + offsets[match[1]] + 1);
            changed = true;
        }
    }
    return changed;
}

module.exports = class Contextualizer extends Stream.Transform {
    constructor(allprograms, options) {
        super({ objectMode: true });

        this._locale = options.locale;
        this._samples = options.numSamples;
        this._nullOnly = options.nullOnly;
        this._templates = I18n.get(options.locale).CHANGE_SUBJECT_TEMPLATES.map((tpl) => tpl.split('{}'));
        for (let tpl of this._templates)
            assert.strictEqual(tpl.length, 2);

        this._allprograms = allprograms;
        this._rng = options.rng;
    }

    _transform(ex, encoding, callback) {
        // if the example already has a context, we have nothing to do
        if (ex.context) {
            callback(null, ex);
            return;
        }

        if (this._nullOnly) {
            ex.context = 'null';
            callback(null, ex);
            return;
        }

        for (let i = 0; i < this._samples; i++) {
            const clone = {};
            Object.assign(clone, ex);

            clone.id = ex.id + ':' + i;
            if (coin(0.5, this._rng))
                clone.context = 'null';
            else
                clone.context = uniform(this._allprograms, this._rng);

            if (clone.context !== 'null') {
                if (this._templates.length > 0 && coin(0.1, this._rng)) {
                    const template = uniform(this._templates, this._rng);

                    clone.preprocessed = template[0] + ex.preprocessed + template[1];
                }

                const preprocessed = clone.preprocessed.split(' ');
                const code = clone.target_code.split(' ');
                const contextentities = extractEntities(clone.context.split(' '));
                renumberEntities(preprocessed, contextentities);
                renumberEntities(code, contextentities);
                clone.preprocessed = preprocessed.join(' ');
                clone.target_code = code.join(' ');
            }
            this.push(clone);
        }

        callback(null);
    }

    _flush(callback) {
        process.nextTick(callback);
    }
};
