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

const assert = require('assert');
const Stream = require('stream');
const ThingTalk = require('thingtalk');

const Utils = require('../../utils/misc-utils');
const { requoteProgram, getFunctions, getDevices } = require('../requoting');
const { stripOutTypeAnnotations, normalizeKeywordParams } = require('./eval_utils');
const I18n = require('../../i18n');

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

const COMPLEXITY_METRICS = {
    num_params(id, code) {
        let params = 0;
        let joins = 0;
        let inString = false;
        for (let token of code.split(' ')) {
            if (token === '"')
                inString = !inString;
            if (inString)
                continue;

            // distance is computed by geo, which will be counted
            if (token.startsWith('param:') && !token.startsWith('param:distance'))
                params ++;
            else if (token === 'join')
                joins ++;
        }

        return params + joins;
    },

    turn_number(id, code) {
        const match = /\/([0-9]+)(?:-[0-9]+)*$/.exec(id);
        return parseInt(match[1]);
    }
};


class SentenceEvaluator {
    constructor(locale, parser, schemaRetriever, tokenized, debug, complexityMetric, ex) {
        this._parser = parser;
        this._tokenized = tokenized;
        this._debug = debug;
        this._schemas = schemaRetriever;
        this._tokenizer = I18n.get(locale).getTokenizer();

        this._id = ex.id;
        this._context = ex.context;
        this._preprocessed = ex.preprocessed;
        this._targetPrograms = ex.target_code;
        this._predictions = ex.predictions;

        if (complexityMetric)
            this._computeComplexity = COMPLEXITY_METRICS[complexityMetric];
    }

    _hasNumeric(code) {
        for (let token of code.split(' ')) {
            if (!isNaN(token))
                return true;
            if (token === '>=' || token === '<=')
                return true;
            if (token.startsWith('NUMBER_'))
                return true;
        }
        return false;
    }

    async evaluate() {

        const result = {
            id: this._id,
            preprocessed: this._preprocessed,
            target_code: this._targetPrograms,
            target_devices: [],
            ok: [],
            ok_without_param: [],
            ok_function: [],
            ok_device: [],
            ok_num_function: [],
            ok_syntax: [],

            is_primitive: false,
            complexity: undefined,
            has_numeric: false
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
            const tokenized = await this._tokenizer.tokenize(this._preprocessed);
            Utils.renumberEntities(tokenized, contextEntities);
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
        if (this._computeComplexity)
            result.complexity = this._computeComplexity(this._id, this._targetPrograms[0]);
        else
            result.complexity = 0;
        result.has_numeric = this._hasNumeric(this._targetPrograms[0]);

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
        result.target_devices = goldDevices[0];

        let first = true;
        let ok = false, ok_without_param = false, ok_function = false,
            ok_device = false, ok_num_function = false, ok_syntax = false;

        let predictions;
        if (this._predictions) {
            predictions = this._predictions;
        } else {
            try {
                const parsed = await this._parser.sendUtterance(this._preprocessed, contextCode, contextEntities, {
                    tokenized: this._tokenized,
                    skip_typechecking: true
                });
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
    constructor(locale, parser, schemas, tokenized, debug, complexityMetric) {
        super({ objectMode: true });

        this._locale = locale;
        this._parser = parser;
        this._schemas = schemas;
        this._tokenized = tokenized;
        this._debug = debug;
        this._complexityMetric = complexityMetric;
    }

    _transform(ex, encoding, callback) {
        const evaluator = new SentenceEvaluator(this._locale, this._parser, this._schemas, this._tokenized, this._debug, this._complexityMetric, ex);

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
        this._splitByDevice = options.splitByDevice;

        // _buffer will map devices to individual buffers. If splitByDevice is
        // false, there will only be a single buffer. Otherwise, these individual
        // buffers will be created ad-hoc, as new devices come up.
        this._buffer = {};
    }

    _write(ex, encoding, callback) {
        let uniqueDevices;
        if (this._splitByDevice) {
            uniqueDevices = Array.from(new Set(ex.target_devices));
            uniqueDevices = uniqueDevices.filter(val => !val.includes('dialogue.transaction'));
            if (uniqueDevices.length === 0)
                uniqueDevices.push('generic'); // generic device, for deviceless acts
        } else
            uniqueDevices = ['all'];
        for (let device of uniqueDevices) {
            if (!(device in this._buffer)) {
                this._buffer[device] = {
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
            this._buffer[device].total ++;
            if (ex.is_primitive)
                this._buffer[device].primitives ++;
            else
                this._buffer[device].compounds ++;

            let compkey;
            if (this._maxComplexity && ex.complexity >= this._maxComplexity)
                compkey = 'complexity_>=' + this._maxComplexity + '/';
            else
                compkey = 'complexity_' + ex.complexity + '/';
            if (!this._buffer[device][compkey + 'total']) {
                this._buffer[device][compkey + 'total'] = 0;
                for (let key of ['ok', 'ok_without_param', 'ok_function', 'ok_device', 'ok_num_function', 'ok_syntax'])
                    this._buffer[device][compkey + key] = [];
            }


            let numericKey = ex.has_numeric ? 'with_numeric_' : 'without_numeric_';
            if (!this._buffer[device][numericKey + 'total']) {
                this._buffer[device][numericKey + 'total'] = 0;
                for (let key of ['ok', 'ok_without_param', 'ok_function', 'ok_device', 'ok_num_function', 'ok_syntax'])
                    this._buffer[device][numericKey + key] = [];
            }

            this._buffer[device][compkey + 'total'] += 1;
            this._buffer[device][numericKey + 'total'] += 1;

            for (let key of ['ok', 'ok_without_param', 'ok_function', 'ok_device', 'ok_num_function', 'ok_syntax']) {
                for (let beampos = 0; beampos < ex[key].length; beampos++) {
                    while (this._buffer[device][key].length <= beampos)
                        this._buffer[device][key].push(0);
                    if (ex[key][beampos])
                        this._buffer[device][key][beampos] ++;

                    let subkey = ex.is_primitive ? 'prim/' + key : 'comp/' + key;
                    while (this._buffer[device][subkey].length <= beampos)
                        this._buffer[device][subkey].push(0);
                    if (ex[key][beampos])
                        this._buffer[device][subkey][beampos] ++;

                    subkey = compkey + key;
                    while (this._buffer[device][subkey].length <= beampos)
                        this._buffer[device][subkey].push(0);
                    if (ex[key][beampos])
                        this._buffer[device][subkey][beampos] ++;
                    assert(!isNaN(this._buffer[device][subkey][beampos]));

                    subkey = numericKey + key;
                    while (this._buffer[device][subkey].length <= beampos)
                        this._buffer[device][subkey].push(0);
                    if (ex[key][beampos])
                        this._buffer[device][subkey][beampos] ++;
                }
            }
        }
        callback();
    }

    _final(callback) {
        for (let device in this._buffer) {
            // convert to percentages
            for (let key of ['ok', 'ok_without_param', 'ok_function', 'ok_device', 'ok_num_function', 'ok_syntax']) {
                for (let beampos = 0; beampos < this._buffer[device][key].length; beampos++) {
                    //this._buffer[device][key][beampos] = (this._buffer[device][key][beampos] * 100 / this._buffer[device].total).toFixed(2);
                    //this._buffer[device]['prim/' + key][beampos] = (this._buffer[device]['prim/' + key][beampos] * 100 / this._buffer[device].primitives).toFixed(2);
                    //this._buffer[device]['comp/' + key][beampos] = (this._buffer[device]['comp/' + key][beampos] * 100 / this._buffer[device].compounds).toFixed(2);

                    this._buffer[device][key][beampos] /= this._buffer[device].total;
                    this._buffer[device]['prim/' + key][beampos] /= this._buffer[device].primitives;
                    this._buffer[device]['comp/' + key][beampos] /= this._buffer[device].compounds;

                    for (let i = 0; i < 20; i++) {
                        const compkey = 'complexity_' + i + '/';
                        if (this._buffer[device][compkey + 'total']) {
                            this._buffer[device][compkey + key][beampos] /= this._buffer[device][compkey + 'total'];
                            assert(!isNaN(this._buffer[device][compkey + key][beampos]), this._buffer[device][compkey + key]);
                        }
                    }
                    if (this._maxComplexity) {
                        const compkey = 'complexity_>=' + this._maxComplexity + '/';
                        if (this._buffer[device][compkey + 'total']) {
                            this._buffer[device][compkey + key][beampos] /= this._buffer[device][compkey + 'total'];
                            assert(!isNaN(this._buffer[device][compkey + key][beampos]), this._buffer[device][compkey + key]);
                        }
                    }

                    let numerickey = 'with_numeric_';
                    if (this._buffer[device][numerickey + 'total']) {
                        this._buffer[device][numerickey + key][beampos] /= this._buffer[device][numerickey + 'total'];
                        assert(!isNaN(this._buffer[device][numerickey + key][beampos]), this._buffer[device][numerickey + key]);
                    }

                    numerickey = 'without_numeric_';
                    if (this._buffer[device][numerickey + 'total']) {
                        this._buffer[device][numerickey + key][beampos] /= this._buffer[device][numerickey + 'total'];
                        assert(!isNaN(this._buffer[device][numerickey + key][beampos]), this._buffer[device][numerickey + key]);
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
