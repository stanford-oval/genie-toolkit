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
const ThingTalk = require('thingtalk');

const { shuffle } = require('./random');
const { ENTITIES } = require('./utils');

async function normalize(schemas, code) {
    try {
        const program = ThingTalk.NNSyntax.fromNN(code.split(' '), (entity) => {
            if (entity in ENTITIES)
                return ENTITIES[entity];
            else if (entity.startsWith('GENERIC_ENTITY_'))
                return { value: entity, display: entity };
            else
                throw new TypeError(`Unrecognized entity ${entity}`);
        });
        await program.typecheck(schemas, false);

        const entities = {};
        return ThingTalk.NNSyntax.toNN(program, '', entities, { allocateEntities: true }).join(' ');
    } catch(e) {
        console.error(code);
        throw e;
    }
}

module.exports = class ContextExtractor extends Stream.Writable {
    constructor(schemas, rng) {
        super({ objectMode: true });

        this._schemas = schemas;
        this._rng = rng;
        this._buffer = new Set;
    }

    async _process(ex) {
        const code = await normalize(this._schemas, ex.target_code);
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
