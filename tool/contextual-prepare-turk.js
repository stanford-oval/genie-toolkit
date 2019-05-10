// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Stream = require('stream');
const seedrandom = require('seedrandom');
const fs = require('fs');
const csv = require('csv');

const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;

const { coin, uniform } = require('../lib/random');
const i18n = require('../lib/i18n');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const { parseConstantFile } = require('./lib/constant-file');

class UnassignableEntity extends Error {}
class SkippedEntity extends Error {}

const TYPES = {
    QUOTED_STRING: Type.String,
    NUMBER: Type.Number,
    CURRENCY: Type.Currency,
    DURATION: Type.Measure('ms'),
    LOCATION: Type.Location,
    DATE: Type.Date,
    TIME: Type.Time,

    EMAIL_ADDRESS: Type.Entity('tt:email_address'),
    PHONE_NUMBER: Type.Entity('tt:phone_number'),
    HASHTAG: Type.Entity('tt:hashtag'),
    USERNAME: Type.Entity('tt:username'),
    URL: Type.Entity('tt:url'),
    PATH_NAME: Type.Entity('tt:path_name'),
};

function entityTypeToTTType(entityType, unit) {
    if (entityType === 'NUMBER' && !!unit)
        return Type.Measure(unit);
    else if (entityType.startsWith('GENERIC_ENTITY_'))
        return Type.Entity(entityType.substring('GENERIC_ENTITY_'.length));
    else
        return TYPES[entityType];
}

function makeLookupKeys(deviceFunctionName, param, type) {
    const keys = [];
    keys.push(String(type));
    if (param)
        keys.push(`param:${param}:${type}`);
    if (param && deviceFunctionName) {
        const dot = deviceFunctionName.lastIndexOf('.');
        const deviceName = deviceFunctionName.substring(0, dot);
        const functionName = deviceFunctionName.substring(dot+1);

        keys.push(`param:${deviceName}.*:${param}:${type}`);
        keys.push(`param:${deviceName}.${functionName}:${param}:${type}`);
    }
    keys.reverse();
    return keys;
}

class SentenceProcessor {
    constructor(constants, detokenizer, options, id1, sent1, code1, id2, sent2, code2) {
        this._constants = constants;
        this._detokenizer = detokenizer;
        this._rng = options.rng;
        this._compoundOnly = options.compoundOnly;
        this._debug = options.debug;
        this._locale = options.locale;

        if (coin(0.5, this._rng)) {
            this._id1 = id1;
            this._sent1 = sent1;
            this._code1 = code1;
            this._id2 = id2;
            this._sent2 = sent2;
            this._code2 = code2;
        } else {
            this._id1 = id2;
            this._sent1 = sent2;
            this._code1 = code2;
            this._id2 = id1;
            this._sent2 = sent1;
            this._code2 = code1;
        }

        this._assignedEntities = {};
        this._usedValues = new Set;
    }

    _entityRetriever(entity, param, functionname, unit) {
        if (this._assignedEntities[entity])
            return this._assignedEntities[entity].value;

        const underscoreindex = entity.lastIndexOf('_');
        const entitytype = entity.substring(0, underscoreindex);

        // special handling for PATH_NAME (HACK)
        if (entitytype === 'PATH_NAME' && (param === 'repo_name' || param === 'folder_name'))
            throw new SkippedEntity;

        const ttType = entityTypeToTTType(entitytype, unit);
        const keys = makeLookupKeys(functionname, param, ttType);

        let choices;
        for (let key of keys) {
            if (this._constants[key]) {
                choices = this._constants[key];
                break;
            }
        }
        if (!choices)
            throw new Error('unrecognized entity type ' + entitytype);

        // special handling for NUMBER followed by a unit (measure) because the unit is chosen
        // by the construct template
        if (ttType.isMeasure && entitytype !== 'DURATION')
            choices = choices.filter((c) => c.unit === unit);

        let index = parseInt(entity.substring(underscoreindex+1));
        if (choices.length > 0) {
            for (let i = 0; i < 10; i++) {
                let choice = uniform(choices, this._rng);
                let value = choice.value;

                if (entitytype === 'NUMBER' && this._assignedEntities['NUMBER_' + (index-1)] && this._assignedEntities['NUMBER_' + (index-1)].value >= value)
                    continue;
                if (entitytype === 'NUMBER' && this._assignedEntities['NUMBER_' + (index+1)] && this._assignedEntities['NUMBER_' + (index+1)].value <= value)
                    continue;
                if (!this._usedValues.has(choice.key)) {
                    let display;
                    // ignore display for measure/NUMBER, and just the value for measure/DURATION
                    if (ttType.isMeasure) {
                        if (entitytype === 'NUMBER') {
                            display = value.toLocaleString(this._locale);
                        } else if (entitytype === 'DURATION') {
                            value = { value, unit: choice.unit };
                            display = choice.display;
                        } else {
                            throw new TypeError('???');
                        }
                    } else {
                        display = choice.display;
                    }

                    this._assignedEntities[entity] = { value, display };
                    this._usedValues.add(choice.key);
                    return value;
                }
            }
        }

        throw new UnassignableEntity(`Run out of values for ${entity} (unit ${unit}, param name ${param})`);
    }

    _detokenize(tokenized) {
        let sentence = '';
        let prevtoken = null;
        for (let token of tokenized.split(' ')) {
            // replace entities and undo penn tree bank tokenization
            if (/^[A-Z]/.test(token)) { // entity
                if (!this._assignedEntities[token])
                    throw new Error(`Missing entity ${token} (present in the sentence, not in the code)`);
                token = this._assignedEntities[token].display;
            }
            sentence = this._detokenizer(sentence, prevtoken, token);
            prevtoken = token;
        }

        return sentence;
    }

    process() {
        let program1, program2;
        try {
            program1 = ThingTalk.NNSyntax.fromNN(this._code1.split(' '), this._entityRetriever.bind(this));
            program2 = ThingTalk.NNSyntax.fromNN(this._code2.split(' '), this._entityRetriever.bind(this));
        } catch(e) {
            if (e instanceof SkippedEntity)
                return null;
            if (!(e instanceof UnassignableEntity))
                throw e;
            if (this._debug)
                console.log(`Skipped ${this._id1}-${this._id2}: ${e.message}`);
            return null;
        }

        const sentence1 = this._detokenize(this._sent1);
        const sentence2 = this._detokenize(this._sent2);

        return {
            id1: this._id1,
            utterance1: sentence1,
            target_code1: program1.prettyprint(true),
            id2: this._id2,
            utterance2: sentence2,
            target_code2: program2.prettyprint(true)
        };
    }
}

class SentenceSampler extends Stream.Transform {
    constructor(constants, options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });
        this._constants = constants;

        this._options = options;

        this._detokenizer = i18n.get(options.locale).detokenize;
    }

    _transform(input, encoding, callback) {
        const { id1, utterance1, target_code1, id2, utterance2, target_code2 } = input;
        const processor = new SentenceProcessor(this._constants, this._detokenizer, this._options, id1, utterance1, target_code1, id2, utterance2, target_code2);

        const result = processor.process();
        if (result !== null)
            this.push(result);
        callback();
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('contextual-prepare-turk', {
            addHelp: true,
            description: "Choose which sentences to paraphrase, given a synthetic set."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--constants', {
            required: true,
            help: 'TSV file containing constant values to use.'
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input datasets to augment (in TSV format); use - for standard input'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
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
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
    },

    async execute(args) {
        const constants = await parseConstantFile(args.locale, args.constants);

        const options = {
            rng: seedrandom.alea(args.random_seed),
            locale: args.locale,

            debug: args.debug
        };

        readAllLines(args.input_file)
            .pipe(new Stream.Transform({
                objectMode: true,

                transform(line, encoding, callback) {
                    const parts = line.trim().split('\t');
                    if (parts.length < 6)
                        throw new Error(`malformed line ${line}`);

                    const [id1, utterance1, target_code1, id2, utterance2, target_code2] = parts;
                    callback(null, { id1, utterance1, target_code1, id2, utterance2, target_code2 });
                },

                flush(callback) {
                    process.nextTick(callback);
                }
            }))
            .pipe(new SentenceSampler(constants, options))
            .pipe(csv.stringify({ header: true, delimiter: ',' }))
            .pipe(args.output);

        return new Promise((resolve, reject) => {
            args.output.on('finish', resolve);
            args.output.on('error', reject);
        });
    }
};
