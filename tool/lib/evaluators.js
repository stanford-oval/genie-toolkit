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

const { requoteProgram, getFunctions, getDevices } = require('../../lib/requoting');

const ENTITIES = {
    DURATION_0: { value: 2, unit: 'ms' },
    DURATION_1: { value: 3, unit: 'ms' },
    DURATION_3: { value: 4, unit: 'ms' },
    NUMBER_0: 2,
    NUMBER_1: 3,
    NUMBER_2: 4,
    NUMBER_3: 5,
    DATE_0: { day: 1, month: 1, year: 2018 },
    DATE_1: { day: 2, month: 1, year: 2018 },
    DATE_2: { day: 3, month: 1, year: 2018 },
    DATE_3: { day: 4, month: 1, year: 2018 },
    TIME_0: { hour: 0, minute: 1, second: 0 },
    TIME_1: { hour: 0, minute: 2, second: 0  },
    TIME_2: { hour: 0, minute: 3, second: 0  },
    TIME_3: { hour: 0, minute: 4, second: 0  },
    CURRENCY_0: { value: 2, unit: 'usd' },
    CURRENCY_1: { value: 3, unit: 'usd' },
    CURRENCY_2: { value: 4, unit: 'usd' },
    CURRENCY_3: { value: 5, unit: 'usd' },
    LOCATION_0: { latitude: 2, longitude: 2 },
    LOCATION_1: { latitude: 3, longitude: 3 },
    LOCATION_2: { latitude: 4, longitude: 4 },
    LOCATION_3: { latitude: 5, longitude: 5 },
    QUOTED_STRING_0: '"0"',
    QUOTED_STRING_1: '"1"',
    QUOTED_STRING_2: '"2"',
    QUOTED_STRING_3: '"3"',
    PATH_NAME_0: 'foo/0.png',
    PATH_NAME_1: 'foo/1.png',
    PATH_NAME_2: 'foo/2.png',
    PATH_NAME_3: 'foo/3.png',
    URL_0: 'https://0.com',
    URL_1: 'https://1.com',
    URL_2: 'https://2.com',
    URL_3: 'https://3.com',
    PHONE_NUMBER_0: '+11',
    PHONE_NUMBER_1: '+12',
    PHONE_NUMBER_2: '+13',
    PHONE_NUMBER_3: '+14',
    EMAIL_ADDRESS_0: '1@foo',
    EMAIL_ADDRESS_1: '2@foo',
    EMAIL_ADDRESS_2: '3@foo',
    EMAIL_ADDRESS_3: '4@foo',
    USERNAME_0: '@1',
    USERNAME_1: '@2',
    USERNAME_2: '@3',
    USERNAME_3: '@4',
    HASHTAG_0: '#0',
    HASHTAG_1: '#1',
    HASHTAG_2: '#2',
    HASHTAG_3: '#3'
};
Object.freeze(ENTITIES);

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

function* stripOutTypeAnnotations(tokens) {
    for (let token of tokens) {
        if (token.startsWith('param:')) {
            let name = token.split(':')[1];
            yield 'param:'+name;
        } else {
            yield token;
        }
   }
}

function normalizeKeywordParams(program) {
    const newprogram = [];
    for (let i = 0; i < program.length; ) {
        const token = program[i];
        
        if (!token.startsWith('@')) {
            newprogram.push(token);
            i++;
            continue;
        }

        newprogram.push(token);
        i++;
        
        const params = {};
        while (i < program.length) {
            if (!program[i].startsWith('param:'))
                break;
            const pn = program[i].split(':')[1]
            i++;
            assert.strictEqual(program[i], '=');
            i++;
            let in_string = program[i] === '"';
            const value = [program[i]];
            i++;

            while (i < program.length) {
                if (program[i] === '"')
                    in_string = !in_string;
                if (!in_string &&
                    (program[i].startsWith('param:') || ['on', '=>', '(', ')', '{', '}', 'filter', 'join'].indexOf(program[i]) >= 0))
                    break;
                value.push(program[i]);
                i++;
            }
            params[pn] = value;
        }
        
        const sorted = Object.keys(params);
        sorted.sort();
        for (let pname of sorted)
            newprogram.push('param:'+pname, '=', ...params[pname]);
    }
    return newprogram;
}

class SentenceEvaluator {
    constructor(parser, schemaRetriever, tokenized, debug, ex) {
        this._parser = parser;
        this._tokenized = tokenized;
        this._debug = debug;
        this._schemas = schemaRetriever;

        this._id = ex.id;
        this._preprocessed = ex.preprocessed;
        this._targetPrograms = ex.target_code;
        this._predictions = ex.predictions;
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

            is_primitive: false
        };

        let entities;
        if (this._tokenized) {
            entities = {};
            for (let token of this._preprocessed.split(' ')) {
                if (/^[A-Z]/.test(token)) {
                    if (token.startsWith('GENERIC_ENTITY_'))
                        entities[token] = { value: token, display: token };
                    else if (!(token in ENTITIES))
                        throw new Error(`missing entity ${token}`);
                    else
                        entities[token] = ENTITIES[token];
                }
            }
        } else {
            const tokenized = await this._parser.tokenize(this._preprocessed);
            entities = tokenized.entities;
        }

        assert(Array.isArray(this._targetPrograms));
        assert(this._targetPrograms.length > 0);

        let firstTargetCode = this._targetPrograms[0];
        try {
            const parsed = ThingTalk.NNSyntax.fromNN(firstTargetCode.split(' '), entities);
            await parsed.typecheck(this._schemas);
        } catch(e) {
            // if the target_code did not parse due to missing functions in thingpedia, ignore it
            if (e.message.indexOf('has no query') >= 0 || e.message.indexOf('has no action') >= 0)
                return null;
        
            console.error(this._id, this._preprocessed, this._targetPrograms);
            throw e;
        }

        // check all other target codes (sanity check)
        for (let i = 1; i < this._targetPrograms.length; i++) {
            try {
                const parsed = ThingTalk.NNSyntax.fromNN(this._targetPrograms[i].split(' '), entities);
                await parsed.typecheck(this._schemas);
            } catch(e) {
                console.error(this._id, this._preprocessed, this._targetPrograms);
                throw e;
            }
        }

        const untypedTargetCode = this._targetPrograms.map((code) => Array.from(stripOutTypeAnnotations(code.split(' '))).join(' '));
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
            const parsed = await this._parser.sendUtterance(this._preprocessed, this._tokenized);
            if (!entities)
                entities = parsed.entities;

            predictions = parsed.candidates
                .filter((beam) => beam.score !== 'Infinity') // ignore exact matches
                .map((beam) => beam.code);
        }
        
        for (let beam of predictions) {
            // first check if the program parses and typechecks (no hope otherwise)
            try {
                const parsed = ThingTalk.NNSyntax.fromNN(beam, entities);
                await parsed.typecheck(this._schemas);
            } catch(e) {
                // push the previous result, so the stats
                // stay cumulative along the beam

                result.ok_without_param.push(ok_without_param);
                result.ok_function.push(ok_function);
                result.ok_device.push(ok_device);
                result.ok_num_function.push(ok_num_function);
                result.ok_syntax.push(ok_syntax);
                if (first && this._debug)
                    console.log(`${this._id}\twrong_syntax\t${this._preprocessed}\t${untypedTargetCode[0]}\t${Array.from(stripOutTypeAnnotations(beam)).join(' ')}`);
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

            if (first && this._debug)
                console.log(`${this._id}\t${result_string}\t${this._preprocessed}\t${untypedTargetCode[0]}\t${code}`);
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

class CollectStatistics extends Stream.Writable {
    constructor() {
        super({ objectMode: true });

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
    CollectStatistics
};
