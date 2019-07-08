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

const seedrandom = require('seedrandom');
const fs = require('fs');
const byline = require('byline');
const csv = require('csv');
const Stream = require('stream');
const ThingTalk = require('thingtalk');

const { DatasetParser } = require('../lib/dataset-parsers');
const SentenceSampler = require('../lib/sampler');
const StreamUtils = require('../lib/stream-utils');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');
const { parseConstantFile } = require('./lib/constant-file');
const FileThingpediaClient = require('./lib/file_thingpedia_client');

function parseSamplingControlFile(filename) {
    const functionBlackList = new Set;
    const deviceBlackList = new Set;
    const functionHighValueList = new Set;
    let functionWhiteList;
    let deviceWhiteList;

    if (!filename)
        return Promise.resolve([functionBlackList, deviceBlackList, functionHighValueList, functionWhiteList, deviceWhiteList]);

    const file = fs.createReadStream(filename);
    file.setEncoding('utf8');
    const input = byline(file);


    input.on('data', (line) => {
        if (/^\s*(#|$)/.test(line))
            return;

        const [attribute, functionName] = line.trim().split('\t');

        switch (attribute) {
        case 'whitelist':
            if (functionName.endsWith('.*')) {
                if (!deviceWhiteList)
                    deviceWhiteList = new Set;
                deviceWhiteList.add(functionName);
            } else {
                if (!functionWhiteList)
                    functionWhiteList = new Set;
                functionWhiteList.add(functionName);
            }
            break;
        case 'blacklist':
            if (functionName.endsWith('.*'))
                deviceBlackList.add(functionName);
            else
                functionBlackList.add(functionName);
            break;
        case 'high':
            // ignore high value whole devices
            if (!functionName.endsWith('.*'))
                functionHighValueList.add(functionName);
            break;
        case 'low':
            // ignore low value entry (everything is low-value by default)
            break;
        default:
            throw new Error(`Invalid function attribute ${attribute}`);
        }
    });

    return new Promise((resolve, reject) => {
        input.on('end', () => resolve([functionBlackList, deviceBlackList, functionHighValueList, functionWhiteList, deviceWhiteList]));
        input.on('error', reject);
    });
}

const ENTITY_MATCH_REGEX = /^([A-Z].*)_[0-9]+$/;

class ContextSourceLoader extends Stream.Writable {
    constructor() {
        super({ objectMode: true });
        
        this._buffer = new Map;
    }
    
    // renumber entities so they are assigned in program order rather than sentence order
    _normalizeEntities(ex) {
        let renameMap = Object.create(null);
        let countMap = Object.create(null);
        
        let inString = false;
        let anyRename = false;
        const newCode = [];
        const code = ex.target_code.split(' ');
        for (let i = 0; i < code.length; i++) {
            const token = code[i];
            if (token === '"') {
                inString = !inString;
                newCode.push(token);
                continue;
            }
            if (inString) {
                newCode.push(token);
                continue;
            }
            if (token in renameMap) {
                newCode.push(renameMap[token]);
                
                // if we renamed a number into a measure, skip the unit
                if (token.startsWith('NUMBER_') && renameMap[token].startsWith('MEASURE_'))
                    i++;
            }
            
            const match = ENTITY_MATCH_REGEX.exec(token);
            if (match === null) {
                newCode.push(token);
                continue;
            }
            
            let [,type,idx] = match;
            
            // collapse NUMBER_ followed by unit into measure or duration
            if (type === 'NUMBER' && i < code.length-1 && code[i+1].startsWith('unit:')) {
                const unit = code[i+1].substring('unit:'.length);
                const baseunit = ThingTalk.Type.Measure(unit).unit;
                if (baseunit === 'ms')
                    type = 'DURATION';
                else
                    type = 'MEASURE_' + baseunit;
                // skip the unit
                i++;
            }
            
            let newIdx;
            if (type in countMap)
                newIdx = countMap[type] + 1;
            else
                newIdx = 0;
            countMap[type] = newIdx;
            
            const newToken = type + '_' + newIdx;
            if (newToken !== token)
                anyRename = true;
            renameMap[token] = newToken;
            newCode.push(newToken);
        }
        ex.target_code = newCode.join(' ');
        if (!anyRename)
            return;
        ex.preprocessed = ex.preprocessed.split(' ').map((token) => {
            if (token in renameMap)
                return renameMap[token];
            else
                return token;
        }).join(' ');
    }
    
    _write(ex, encoding, callback) {
        /*let yes = false;
        if (ex.target_code === 'now => @com.foradb.findBP param:edate:Date = end_of unit:week - DURATION_1 param:patient:String = QUOTED_STRING_0 param:sdate:Date = end_of unit:mon + DURATION_0 => notify')
            yes = true;*/
        this._normalizeEntities(ex);
        //if (yes)
        //    console.log(ex);
    
        if (this._buffer.has(ex.target_code))
            this._buffer.get(ex.target_code).push(ex.preprocessed);
        else
            this._buffer.set(ex.target_code, [ex.preprocessed]);
        callback();
    }
    
    _finish(callback) {
        callback();
    }
    
    async read() {
        await StreamUtils.waitFinish(this);
        return this._buffer;
    }
};

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('sample', {
            addHelp: true,
            description: "Choose which sentences to paraphrase, given a synthetic set."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to JSON file containing signature, type and mixin definitions.'
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
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
        });
        parser.addArgument('--contextual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Process a contextual dataset.',
            defaultValue: false
        });
        parser.addArgument('--context-source', {
            help: 'Source dataset from where contexts were extracted; used to choose a context sentence for each context.',
        });
        parser.addArgument('--sampling-strategy', {
            required: false,
            choices: ['byCode', 'bySentence', 'bySignature'],
            help: 'Which sampling strategy to use (defaults: bySignature).'
        });
        parser.addArgument('--sampling-control', {
            required: false,
            help: 'TSV file controlling sampling based on functions in the programs. Defaults to treating all functions equally.'
        });
        parser.addArgument('--compound-only', {
            help: 'Keep only compound programs. (False if omitted)',
            action: 'storeTrue'
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
        let contexts;
        if (args.contextual) {
            if (!args.context_source)
                throw new Error(`--context-source is required if --contextual`);

            contexts = await readAllLines([fs.createReadStream(args.context_source)])
                .pipe(new DatasetParser({ preserveId: true }))
                .pipe(new ContextSourceLoader())
                .read();
        }

        const constants = await parseConstantFile(args.locale, args.constants);
        const [functionBlackList, deviceBlackList, functionHighValueList, functionWhiteList, deviceWhiteList] =
            await parseSamplingControlFile(args.sampling_control);

        const tpClient = new FileThingpediaClient(args.locale, args.thingpedia, null);
        const schemaRetriever = new ThingTalk.SchemaRetriever(tpClient, null, args.debug);

        const options = {
            rng: seedrandom.alea(args.random_seed),
            locale: args.locale,

            samplingStrategy: args.sampling_strategy,
            functionBlackList,
            deviceBlackList,
            functionHighValueList,
            functionWhiteList,
            deviceWhiteList,
            contexts,

            compoundOnly: !!args.compound_only,
            debug: args.debug
        };

        readAllLines(args.input_file)
            .pipe(new DatasetParser({ contextual: args.contextual, preserveId: true }))
            .pipe(new SentenceSampler(schemaRetriever, constants, options))
            .pipe(csv.stringify({ header: true, delimiter: '\t' }))
            .pipe(args.output);

        return new Promise((resolve, reject) => {
            args.output.on('finish', resolve);
            args.output.on('error', reject);
        });
    }
};
