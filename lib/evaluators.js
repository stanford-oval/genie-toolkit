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
const ThingTalk = require('thingtalk');

const Utils = require('./utils');
const { requoteProgram, getFunctions, getDevices } = require('./requoting');
const { stripOutTypeAnnotations, normalizeKeywordParams } = require('./eval_utils');

function iterEquals(iterable1, iterable2) {
    let iter1 = iterable1[Symbol.iterator]();
    let iter2 = iterable2[Symbol.iterator]();
    for (;;) {
        let { value: value1, done: done1 } = iter1.next();
        let { value: value2, done: done2 } = iter2.next();
        if (done1 !== done2)
            return false;
        if (done1)
            break;
        if (value1 !== value2)
            return false;
    }
    return true;
}


class SentenceEvaluator {
    constructor(parser, schemaRetriever, tokenized, debug, ex) {
        this._parser = parser;
        this._tokenized = tokenized;
        this._debug = debug;
        this._schemas = schemaRetriever;

        this._id = ex.id;
        this._context = ex.context;
        this._preprocessed = ex.preprocessed;
        this._targetPrograms = ex.target_code;
        this._predictions = ex.predictions;
    }

    _computeComplexity(code) {
        let params = 0;
        let joins = 0;
        let inString = false;
        for (let token of code.split(' ')) {
            if (token === '"')
                inString = !inString;
            if (inString)
                continue;

            if (token.startsWith('param:'))
                params ++;
            else if (token === 'join')
                joins ++;
        }

        return params + joins;
    }

    async evaluate() {

        const result = {
            id: this._id,
            preprocessed: this._preprocessed,
            target_code: this._targetPrograms,
            ok: [],
            ok_without_param: [],
            ok_function: [],
            ok_device: [],
            ok_num_function: [],
            ok_syntax: [],

            is_primitive: false,
            complexity: undefined
        };

        let contextCode = undefined, contextEntities = {};
        if (this._context !== undefined) {
            contextCode = this._context.split(' ');
            contextEntities = Utils.makeDummyEntities(this._context);
        }

        let entities;
        if (this._tokenized) {
            entities = Utils.makeDummyEntities(this._preprocessed);
            Object.assign(entities, contextEntities);
        } else {
            const tokenized = await this._parser.tokenize(this._preprocessed, contextEntities);
            entities = tokenized.entities;
        }

        assert(Array.isArray(this._targetPrograms));
        assert(this._targetPrograms.length > 0);

        const untypedTargetCode = [];
        const normalEntities = {};
        let firstTargetCode = this._targetPrograms[0];
        try {
            const sequence = firstTargetCode.split(' ');
            const parsed = ThingTalk.NNSyntax.fromNN(sequence, entities);
            await parsed.typecheck(this._schemas);
            const normalized = ThingTalk.NNSyntax.toNN(parsed, this._preprocessed, normalEntities, {
                allocateEntities: true,
                typeAnnotations: false
            });
            untypedTargetCode.push(normalized.join(' '));
        } catch(e) {
            // if the target_code did not parse due to missing functions in thingpedia, ignore it
            if (e.message.indexOf('has no query') >= 0 || e.message.indexOf('has no action') >= 0)
                return null;

            console.error(this._id, this._preprocessed, this._targetPrograms);
            throw e;
        }
        result.complexity = this._computeComplexity(this._targetPrograms[0]);

        // check all other target codes (sanity check)
        for (let i = 1; i < this._targetPrograms.length; i++) {
            try {
                const sequence = this._targetPrograms[i].split(' ');
                const parsed = ThingTalk.NNSyntax.fromNN(sequence, entities);
                await parsed.typecheck(this._schemas);
                const normalized = ThingTalk.NNSyntax.toNN(parsed, this._preprocessed, normalEntities, {
                    allocateEntities: true,
                    typeAnnotations: false
                });
                untypedTargetCode.push(normalized.join(' '));
            } catch(e) {
                console.error(this._id, this._preprocessed, this._targetPrograms);
                throw e;
            }
        }

        const requotedGold = untypedTargetCode.map((code) => Array.from(requoteProgram(code)));
        const goldFunctions = untypedTargetCode.map((code) => Array.from(getFunctions(code)));
        const goldDevices = untypedTargetCode.map((code) => Array.from(getDevices(code)));
        result.is_primitive = goldFunctions[0].length === 1;

        let first = true;
        let ok = false, ok_without_param = false, ok_function = false,
            ok_device = false, ok_num_function = false, ok_syntax = false;

        let predictions;
        if (this._predictions) {
            predictions = this._predictions;
        } else {
            try {
                const parsed = await this._parser.sendUtterance(this._preprocessed, this._tokenized, contextCode, contextEntities);
                if (!entities)
                    entities = parsed.entities;

                predictions = parsed.candidates
                    .filter((beam) => beam.score !== 'Infinity') // ignore exact matches
                    .map((beam) => beam.code);
            } catch(e) {
                console.error(`Sentence ${this._id} failed to predict`);
                console.error(e);
                predictions = [[]];
            }
        }

        for (let beam of predictions) {
            let target = Array.from(stripOutTypeAnnotations(this._targetPrograms[0].split(' '))).join(' ');
            let prediction = Array.from(stripOutTypeAnnotations(beam)).join(' ');

            // first check if the program parses and typechecks (no hope otherwise)
            try {
                const parsed = ThingTalk.NNSyntax.fromNN(beam, entities);
                await parsed.typecheck(this._schemas);
                beam = ThingTalk.NNSyntax.toNN(parsed, beam, normalEntities, { allocateEntities: true });
            } catch(e) {
                // push the previous result, so the stats
                // stay cumulative along the beam

                result.ok.push(ok);
                result.ok_without_param.push(ok_without_param);
                result.ok_function.push(ok_function);
                result.ok_device.push(ok_device);
                result.ok_num_function.push(ok_num_function);
                result.ok_syntax.push(ok_syntax);
                if (first && this._debug)
                    console.log(`${this._id}\twrong_syntax\t${this._preprocessed}\t${target}\t${prediction}`);
                first = false;
                continue;
            }
            ok_syntax = true;

            const normalized = normalizeKeywordParams(Array.from(stripOutTypeAnnotations(beam)));
            const code = normalized.join(' ');

            let beam_ok = false, beam_ok_without_param = false, beam_ok_function = false,
                beam_ok_device = false, beam_ok_num_function = false;
            let result_string = 'ok_syntax';

            for (let referenceId = 0; referenceId < this._targetPrograms.length; referenceId++) {
                if (code === untypedTargetCode[referenceId]) {
                    // we have a match!

                    beam_ok = true;
                    beam_ok_without_param = true;
                    beam_ok_function = true;
                    beam_ok_device = true;
                    beam_ok_num_function = true;
                    result_string = 'ok';
                    break;
                }

                let this_ok_without_param = iterEquals(requotedGold[referenceId], requoteProgram(normalized));
                beam_ok_without_param = beam_ok_without_param || this_ok_without_param;
                if (this_ok_without_param && !beam_ok)
                    result_string = 'ok_without_param';

                let functions = Array.from(getFunctions(normalized));
                let this_ok_function = this_ok_without_param || iterEquals(goldFunctions[referenceId], functions);
                beam_ok_function = beam_ok_function || this_ok_function;
                if (this_ok_function && !beam_ok_without_param)
                    result_string = 'ok_function';

                let this_ok_device = this_ok_function || iterEquals(goldDevices[referenceId], getDevices(normalized));
                beam_ok_device = beam_ok_device || this_ok_device;
                if (this_ok_device && !beam_ok_function)
                    result_string = 'ok_device';

                let this_ok_num_function = this_ok_device || goldFunctions[referenceId].length === functions.length;
                beam_ok_num_function = beam_ok_num_function || this_ok_num_function;
                if (this_ok_num_function && !beam_ok_device)
                    result_string = 'ok_num_function';
            }

            if (first && this._debug && result_string !== 'ok')
                console.log(`${this._id}\t${result_string}\t${this._preprocessed}\t${target}\t${prediction}`);
            first = false;
            ok = ok || beam_ok;
            ok_without_param = ok_without_param || beam_ok_without_param;
            ok_function = ok_function || beam_ok_function;
            ok_device = ok_device || beam_ok_device;
            ok_num_function = ok_num_function || beam_ok_num_function;

            result.ok.push(ok);
            result.ok_without_param.push(ok_without_param);
            result.ok_function.push(ok_function);
            result.ok_device.push(ok_device);
            result.ok_num_function.push(ok_num_function);
            result.ok_syntax.push(ok_syntax);
        }

        return result;
    }
}

class SentenceEvaluatorStream extends Stream.Transform {
    constructor(parser, schemas, tokenized, debug) {
        super({ objectMode: true });

        this._parser = parser;
        this._schemas = schemas;
        this._tokenized = tokenized;
        this._debug = debug;
    }

    _transform(ex, encoding, callback) {
        const evaluator = new SentenceEvaluator(this._parser, this._schemas, this._tokenized, this._debug, ex);

        evaluator.evaluate().then((result) => callback(null, result), (err) => callback(err));
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

class CollectSentenceStatistics extends Stream.Writable {
    constructor(options = {}) {
        super({ objectMode: true });

        this._maxComplexity = options.maxComplexity;

        this._buffer = {
            total: 0,
            primitives: 0,
            compounds: 0,
            ok: [],
            ok_without_param: [],
            ok_function: [],
            ok_device: [],
            ok_num_function: [],
            ok_syntax: [],
            'prim/ok': [],
            'prim/ok_without_param': [],
            'prim/ok_function': [],
            'prim/ok_device': [],
            'prim/ok_num_function': [],
            'prim/ok_syntax': [],
            'comp/ok': [],
            'comp/ok_without_param': [],
            'comp/ok_function': [],
            'comp/ok_device': [],
            'comp/ok_num_function': [],
            'comp/ok_syntax': [],
        };
    }

    _write(ex, encoding, callback) {
        this._buffer.total ++;
        if (ex.is_primitive)
            this._buffer.primitives ++;
        else
            this._buffer.compounds ++;

        let compkey;
        if (this._maxComplexity && ex.complexity >= this._maxComplexity)
            compkey = 'complexity_>=' + this._maxComplexity + '/';
        else
            compkey = 'complexity_' + ex.complexity + '/';
        if (!this._buffer[compkey + 'total']) {
            this._buffer[compkey + 'total'] = 0;
            for (let key of ['ok', 'ok_without_param', 'ok_function', 'ok_device', 'ok_num_function', 'ok_syntax'])
                this._buffer[compkey + key] = [];
        }

        this._buffer[compkey + 'total'] += 1;

        for (let key of ['ok', 'ok_without_param', 'ok_function', 'ok_device', 'ok_num_function', 'ok_syntax']) {
            for (let beampos = 0; beampos < ex[key].length; beampos++) {
                while (this._buffer[key].length <= beampos)
                    this._buffer[key].push(0);
                if (ex[key][beampos])
                    this._buffer[key][beampos] ++;

                let subkey = ex.is_primitive ? 'prim/' + key : 'comp/' + key;
                while (this._buffer[subkey].length <= beampos)
                    this._buffer[subkey].push(0);
                if (ex[key][beampos])
                    this._buffer[subkey][beampos] ++;

                subkey = compkey + key;
                while (this._buffer[subkey].length <= beampos)
                    this._buffer[subkey].push(0);
                if (ex[key][beampos])
                    this._buffer[subkey][beampos] ++;
                assert(!isNaN(this._buffer[subkey][beampos]));
            }
        }
        callback();
    }

    _final(callback) {
        // convert to percentages
        for (let key of ['ok', 'ok_without_param', 'ok_function', 'ok_device', 'ok_num_function', 'ok_syntax']) {
            for (let beampos = 0; beampos < this._buffer[key].length; beampos++) {
                //this._buffer[key][beampos] = (this._buffer[key][beampos] * 100 / this._buffer.total).toFixed(2);
                //this._buffer['prim/' + key][beampos] = (this._buffer['prim/' + key][beampos] * 100 / this._buffer.primitives).toFixed(2);
                //this._buffer['comp/' + key][beampos] = (this._buffer['comp/' + key][beampos] * 100 / this._buffer.compounds).toFixed(2);

                this._buffer[key][beampos] /= this._buffer.total;
                this._buffer['prim/' + key][beampos] /= this._buffer.primitives;
                this._buffer['comp/' + key][beampos] /= this._buffer.compounds;

                for (let i = 0; i < 20; i++) {
                    const compkey = 'complexity_' + i + '/';
                    if (this._buffer[compkey + 'total']) {
                        this._buffer[compkey + key][beampos] /= this._buffer[compkey + 'total'];
                        assert(!isNaN(this._buffer[compkey + key][beampos]), this._buffer[compkey + key]);
                    }
                }
                if (this._maxComplexity) {
                    const compkey = 'complexity_>=' + this._maxComplexity + '/';
                    if (this._buffer[compkey + 'total']) {
                        this._buffer[compkey + key][beampos] /= this._buffer[compkey + 'total'];
                        assert(!isNaN(this._buffer[compkey + key][beampos]), this._buffer[compkey + key]);
                    }
                }
            }
        }
        callback();
    }

    read() {
        return new Promise((resolve, reject) => {
            this.on('finish', () => resolve(this._buffer));
            this.on('error', reject);
        });
    }
}

module.exports = {
    SentenceEvaluatorStream,
    CollectSentenceStatistics,
};
