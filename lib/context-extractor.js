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

const { shuffle } = require('./random');


module.exports = class ContextExtractor extends Stream.Writable {
    constructor(options) {
        super({ objectMode: true });

        this._options = options;
        this._rng = options.rng;
        this._target = require('./languages/' + options.targetLanguage);
        this._buffer = new Set;
    }

    async _process(ex) {
        const code = await this._target.normalize(ex.target_code, this._options);
        this._buffer.add(code);
    }

    _write(ex, encoding, callback) {
        this._process(ex).then(() => callback(null), callback);
    }

    read() {
        return new Promise((resolve, reject) => {
            this.on('finish', () => {
                const allprograms = Array.from(this._buffer);

                shuffle(allprograms, this._rng);
                resolve(allprograms);
            });
            this.on('error', reject);
        });
    }
};
