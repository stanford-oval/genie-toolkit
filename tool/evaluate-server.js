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

const FileThingpediaClient = require('./lib/file_thingpedia_client');
const { DatasetParser } = require('../lib/dataset-parsers');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const ParserClient = require('./lib/parserclient');
const { requoteProgram, getFunctions, getDevices } = require('../lib/requoting');

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

class SentenceEvaluator {
    constructor(parser, schemaRetriever, tokenized, debug, ex) {
        this._parser = parser;
        this._tokenized = tokenized;
        this._debug = debug;
        this._schemas = schemaRetriever;

        this._id = ex.id;
        this._preprocessed = ex.preprocessed;
        this._targetCode = ex.target_code;
    }

    async evaluate() {
        const parsed = await this._parser.sendUtterance(this._preprocessed, this._tokenized);

        const result = {
            id: this._id,
            preprocessed: this._preprocessed,
            target_code: this._targetCode,
            ok: [],
            ok_without_param: [],
            ok_function: [],
            ok_device: [],
            ok_num_function: [],
            ok_syntax: [],

            is_primitive: false
        };

        const requotedGold = Array.from(requoteProgram(this._targetCode));
        const goldFunctions = Array.from(getFunctions(this._targetCode));
        const goldDevices = Array.from(getDevices(this._targetCode));
        result.is_primitive = goldFunctions.length === 1;

        let first = true;
        let ok = false, ok_without_param = false, ok_function = false,
            ok_device = false, ok_num_function = false, ok_syntax = false;
        for (let beam of parsed.candidates) {
            if (beam.score === 'Infinity') // ignore exact matches
                continue;

            const code = beam.code.join(' ');
            if (ok || code === this._targetCode) {
                // we have a match!

                result.ok.push(true);
                result.ok_without_param.push(true);
                result.ok_function.push(true);
                result.ok_device.push(true);
                result.ok_num_function.push(true);
                result.ok_syntax.push(true);

                if (first && this._debug)
                    console.log(`${this._id} ok`);
                first = false;
                ok = true;
                continue;
            }

            // no match...
            result.ok.push(false);

            // first check if the program parses and typechecks (no hope otherwise)
            try {
                const parsed = ThingTalk.NNSyntax.fromNN(beam.code, this._tokenized ? ENTITIES : parsed.entities);
                await parsed.typecheck(this._schemas);
            } catch(e) {
                result.ok_without_param.push(false);
                result.ok_function.push(false);
                result.ok_device.push(false);
                result.ok_num_function.push(false);

                // push the previous result ok_syntax, not the current one, so the stats
                // stay cumulative along the beam
                result.ok_syntax.push(ok_syntax);
                if (first && this._debug)
                    console.log(`${this._id} wrong_syntax`);
                first = false;
                continue;
            }
            ok_syntax = true;
            result.ok_syntax.push(true);

            let this_ok_without_param = iterEquals(requotedGold, requoteProgram(beam.code));
            ok_without_param = ok_without_param || this_ok_without_param;
            result.ok_without_param.push(ok_without_param);
            if (this_ok_without_param && first && this._debug)
                console.log(`${this._id} ok_without_param`);

            let functions = Array.from(getFunctions(beam.code));
            let this_ok_function = this_ok_without_param || iterEquals(goldFunctions, functions);
            ok_function = ok_function || this_ok_function;
            result.ok_function.push(ok_function);
            if (this_ok_function && !this_ok_without_param && first && this._debug)
                console.log(`${this._id} ok_function`);

            let this_ok_device = this_ok_function || iterEquals(goldDevices, getDevices(beam.code));
            ok_device = ok_device || this_ok_device;
            result.ok_device.push(ok_device);
            if (this_ok_device && !this_ok_function && first && this._debug)
                console.log(`${this._id} ok_device`);

            let this_ok_num_function = this_ok_device || goldFunctions.length === functions.length;
            ok_num_function = ok_num_function || this_ok_num_function;
            result.ok_num_function.push(ok_num_function);
            if (this_ok_num_function && !this_ok_device && first && this._debug)
                console.log(`${this._id} ok_num_function`);

            first = false;
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
                this._buffer[key][beampos] = (this._buffer[key][beampos] * 100 / this._buffer.total).toFixed(2);
                this._buffer['prim/' + key][beampos] = (this._buffer['prim/' + key][beampos] * 100 / this._buffer.primitives).toFixed(2);
                this._buffer['comp/' + key][beampos] = (this._buffer['comp/' + key][beampos] * 100 / this._buffer.compounds).toFixed(2);
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
    initArgparse(subparsers) {
        const parser = subparsers.addParser('evaluate-server', {
            addHelp: true,
            description: "Evaluate a trained model on a Genie-generated dataset, by contacting a running Genie server."
        });
        parser.addArgument('--url', {
            required: false,
            help: "URL of the server to evaluate.",
            defaultValue: 'http://127.0.0.1:8400',
        });
        parser.addArgument('--tokenized', {
            required: false,
            action: 'storeTrue',
            defaultValue: true,
            help: "The dataset is already tokenized (this is the default)."
        });
        parser.addArgument('--no-tokenized', {
            required: false,
            dest: 'tokenized',
            action: 'storeFalse',
            help: "The dataset is not already tokenized."
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to JSON file containing signature, type and mixin definitions.'
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to augment (in TSV format); use - for standard input'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
        });
        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
            defaultValue: true
        });
        parser.addArgument('--no-debug', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'debug',
            help: 'Disable debugging.',
        });
    },

    async execute(args) {
        const tpClient = new FileThingpediaClient(args.locale, args.thingpedia);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
        const parser = new ParserClient(args.url, args.locale);

        const output = readAllLines(args.input_file)
            .pipe(new DatasetParser())
            .pipe(new SentenceEvaluatorStream(parser, schemas, args.tokenized, args.debug))
            .pipe(new CollectStatistics());

        const result = await output.read();
        for (let key in result) {
            if (Array.isArray(result[key]))
                console.log(`${key} = [${result[key].join(', ')}]`);
            else
                console.log(`${key} = ${result[key]}`);
        }
    }
};
