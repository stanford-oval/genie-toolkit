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
const fs = require('fs');
const util = require('util');
const path = require('path');
const ThingTalk = require('thingtalk');
const csvstringify = require('csv-stringify');

const I18N = require('../../lib/i18n');
const StreamUtils = require('../../lib/stream-utils');
const { makeMetadata } = require('./lib/metadata');

class ParamDatasetGenerator {
    constructor(locale, debug, maxValueLength, className, dataset) {
        this._locale = locale;
        this._debug = debug;
        this._className = className;
        this._maxValueLength = maxValueLength;
        this._prefix = `${className}:`;
        this._dataset = dataset;

        this._meta = {};
        this._stringFiles = new Map;

        this._tokenizer = I18N.get(locale).getTokenizer();


        if (fs.existsSync(`../${dataset}/manual-annotations`)) {
            let manualAnnotations = require(`../${dataset}/manual-annotations`);
            this._propertiesNoFilter = manualAnnotations.PROPERTIES_NO_FILTER;
        } else {
            this._propertiesNoFilter = [];
        }
    }

    _getStringFile(stringFileName, isEntity) {
        if (this._stringFiles.has(stringFileName))
            return this._stringFiles.get(stringFileName).file;
        const file = isEntity ? [] : new Map;
        this._stringFiles.set(stringFileName, { file, isEntity });
        return file;
    }

    _addString(stringFileName, value) {
        const stringFile = this._getStringFile(stringFileName, false);
        stringFile.set(value, (stringFile.get(value) || 0) + 1);
    }

    async init(thingpedia) {
        const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }));
        assert(library.isLibrary && library.classes.length === 1);
        const classDef = library.classes[0];

        for (let fn in classDef.queries) {
            const fndef = classDef.queries[fn];
            const args = [];
            for (let arg of fndef.iterateArguments())
                args.push(arg);
            this._meta[fn] = {
                extends: fndef.extends,
                fields: makeMetadata(this._className, args)
            };
        }
    }

    _processObject(value, type, visitedTypes = new Set) {
        const typemeta = this._meta[type];
        if (!typemeta)
            return;

        // sgd dataset, field is per-service instead of per function
        if (this._dataset === 'sgd')
            type = type.substring(0, type.lastIndexOf('_'));

        // if the same base class comes through multiple paths, avoid
        // visiting twice and duplicating the objects
        if (visitedTypes.has(type))
            return;
        visitedTypes.add(type);

        for (let base of typemeta.extends)
            this._processObject(value, base, visitedTypes);

        // if this entity has a name, add it to the string file
        if (type !== 'Thing' && type !== 'Intangible' && value.name)
            this._getStringFile(type, true).push({ name: value.name, value: value['@id'] });

        for (let field in typemeta.fields) {
            const expectedType = typemeta.fields[field];
            this._processField(value[field], [type, field], expectedType);
        }
    }

    _processField(value, path, expectedType) {
        if (!value)
            return;
        if (expectedType.isArray) {
            assert(Array.isArray(value));
            const innerExpected = { isArray: false, type: expectedType.type };
            for (let elem of value)
                this._processField(elem, path, innerExpected);
            return;
        }

        if (typeof expectedType.type === 'string') {
            // entity of builtin type

            const key = path[path.length-1];

            // no string set needed if the field is not filterable
            if (this._propertiesNoFilter.includes(key))
                return;

            if (expectedType.type === 'tt:String') {
                assert(typeof value === 'string');
                this._addString(path.join('_'), value);
            }
        } else {
            // compound type

            for (let field in expectedType.type) {
                path.push(field);
                this._processField(value[field], path, expectedType.type[field]);
                path.pop();
            }
        }
    }

    run(data) {
        for (let type in data) {
            for (let objId in data[type])
                this._processObject(data[type][objId], data[type][objId]['@type']);
        }
    }

    _tokenizeAll(strings) {
        return strings.map((str) => this._tokenizer.tokenize(str));
    }

    async output(outputDir, manifestFile, appendManifest) {
        await util.promisify(fs.mkdir)(outputDir, { recursive: true });

        const manifestDir = path.dirname(manifestFile);
        const manifest = fs.createWriteStream(manifestFile, { flags: appendManifest ? 'a' : 'w' });

        for (let [fileId, fileContent] of this._stringFiles) {
            const outputpath = path.resolve(outputDir, this._prefix + fileId + (fileContent.isEntity ? '.json' : '.tsv'));

            if (fileContent.isEntity) {
                if (this._debug)
                    console.log(`Found ${fileContent.file.length} examples for entity file ${fileId}`);

                const tokenized = this._tokenizeAll(fileContent.file.map((entity) => entity.name));
                const data = [];
                for (let i = 0; i < fileContent.file.length; i++) {
                    const entity = fileContent.file[i];
                    const tokens = tokenized[i].tokens;

                    // if some tokens are uppercase, they are entities, like NUMBER_0,
                    // in which case we ignore this value
                    if (tokens.length === 0 || tokens.some((tok) => /^[A-Z]/.test(tok)))
                        continue;

                    entity.canonical = tokens.join(' ');
                    if (this._maxValueLength >= 0 && entity.canonical.length > this._maxValueLength)
                        continue;

                    data.push(entity);
                }

                await util.promisify(fs.writeFile)(outputpath, JSON.stringify({
                    result: 'ok', data
                }, undefined, 2), { encoding: 'utf8' });

                manifest.write(`entity\t${this._locale}\t${this._prefix}${fileId}\t${path.relative(manifestDir, outputpath)}\n`);
            } else {
                if (this._debug)
                    console.log(`Found ${fileContent.file.size} examples for string file ${fileId}`);

                const outputfile = fs.createWriteStream(outputpath);
                const output = csvstringify({ header: false, delimiter: '\t' });
                output.pipe(outputfile);

                const strings = Array.from(fileContent.file.keys());
                const weights = Array.from(fileContent.file.values());
                const tokenized = this._tokenizeAll(strings);

                for (let i = 0; i < strings.length; i++) {
                    const value = strings[i];
                    const weight = weights[i];
                    const tokens = tokenized[i].tokens;

                    // if some tokens are uppercase, they are entities, like NUMBER_0,
                    // in which case we ignore this value
                    if (tokens.length === 0 || tokens.some((tok) => /^[A-Z]/.test(tok)))
                        continue;

                    const tokenizedString = tokens.join(' ');
                    if (this._maxValueLength >= 0 && tokenizedString.length > this._maxValueLength)
                        continue;

                    output.write([value, tokenizedString, weight]);
                }

                output.end();
                manifest.write(`string\t${this._locale}\t${this._prefix}${fileId}\t${path.relative(manifestDir, outputpath)}\n`);

                //await StreamUtils.waitFinish(output);
                console.log(`completed ${fileId}`);
            }
        }

        manifest.end();
        await StreamUtils.waitFinish(manifest);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('make-string-datasets', {
            addHelp: true,
            description: "Extract string datasets from a AutoQA normalized data file."
        });
        parser.addArgument('--dataset', {
            required: true,
            choices: ['schemaorg', 'sgd', 'wikidata', 'multiwoz'],
            help: 'The dataset to run autoQA on.'
        });
        parser.addArgument(['-d', '--output-dir'], {
            required: true,
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
        });
        parser.addArgument('--manifest', {
            required: true,
            help: `Write a parameter dataset manifest to this location`
        });
        parser.addArgument('--append-manifest', {
            required: false,
            action: 'storeTrue',
            help: `append to the manifest instead of replacing`
        });
        parser.addArgument('--data', {
            required: true,
            help: 'Path to JSON file with normalized WebQA data.'
        });
        parser.addArgument('--max-value-length', {
            required: false,
            defaultValue: 500,
            help: 'Ignore values longer than this (unit: number of UTF-16 code points after tokenization).'
        });
        parser.addArgument('--class-name', {
            required: false,
            help: 'The name of the device class, used to decide class-specific types'
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
        const generator = new ParamDatasetGenerator(args.locale, args.debug,
            args.max_value_length, args.class_name, args.dataset);
        await generator.init(args.thingpedia);

        const data = JSON.parse(await util.promisify(fs.readFile)(args.data, { encoding: 'utf8' }));
        generator.run(data);

        await generator.output(args.output_dir, args.manifest, args.append_manifest);
    }
};
