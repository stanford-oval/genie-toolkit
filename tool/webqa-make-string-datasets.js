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

const Tokenizer = require('../lib/tokenizer');
const StreamUtils = require('../lib/stream-utils');
const { makeMetadata } = require('./lib/webqa-metadata');

class ParamDatasetGenerator {
    constructor(locale, debug, className) {
        this._locale = locale;
        this._debug = debug;
        this._prefix = className ? `org.schema.${className}:` : `org.schema:`;

        this._meta = {};
        this._stringFiles = new Map;

        this._tokenizer = Tokenizer.get('local', true);
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
        assert(library.isLibrary && library.classes.length === 1 && library.classes[0].kind.startsWith('org.schema'));
        const classDef = library.classes[0];

        for (let fn in classDef.queries) {
            const fndef = classDef.queries[fn];
            const args = [];
            for (let arg of fndef.iterateArguments())
                args.push(arg);
            this._meta[fn] = {
                extends: fndef.extends,
                fields: makeMetadata(args)
            };
        }
    }

    _processObject(value, type, visitedTypes = new Set) {
        const typemeta = this._meta[type];
        if (!typemeta)
            return;

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
            if (key === 'description')
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

    async _tokenizeAll(strings) {
        let output = [];
        for (let i = 0; i < strings.length; i += 100) {
            console.log(`${i}/${strings.length}`);
            const slice = strings.slice(i, i+100);
            const tokenized = await Promise.all(slice.map((str) => this._tokenizer.tokenize(this._locale, str)));
            output.push(...tokenized);
        }
        return output;
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

                const tokenized = await this._tokenizeAll(fileContent.file.map((entity) => entity.name));
                const data = [];
                for (let i = 0; i < fileContent.file.length; i++) {
                    const entity = fileContent.file[i];
                    const tokens = tokenized[i].tokens;

                    // if some tokens are uppercase, they are entities, like NUMBER_0,
                    // in which case we ignore this value
                    if (tokens.length === 0 || tokens.some((tok) => /^[A-Z]/.test(tok)))
                        continue;

                    entity.canonical = tokens.join(' ');
                    data.push(entity);
                }

                await util.promisify(fs.writeFile)(outputpath, JSON.stringify({
                    result: 'ok', data
                }, undefined, 2), { encoding: 'utf8' });

                manifest.write(`entity\t${this._prefix}${fileId}\t${path.relative(manifestDir, outputpath)}\n`);
            } else {
                if (this._debug)
                    console.log(`Found ${fileContent.file.size} examples for string file ${fileId}`);

                const outputfile = fs.createWriteStream(outputpath);
                const output = csvstringify({ header: false, delimiter: '\t' });
                output.pipe(outputfile);

                const strings = Array.from(fileContent.file.keys());
                const weights = Array.from(fileContent.file.values());
                const tokenized = await this._tokenizeAll(strings);

                for (let i = 0; i < strings.length; i++) {
                    const value = strings[i];
                    const weight = weights[i];
                    const tokens = tokenized[i].tokens;

                    // if some tokens are uppercase, they are entities, like NUMBER_0,
                    // in which case we ignore this value
                    if (tokens.some((tok) => /^[A-Z]/.test(tok)))
                        continue;

                    output.write([value, tokens.join(' '), weight]);
                }

                output.end();
                manifest.write(`string\t${this._prefix}${fileId}\t${path.relative(manifestDir, outputpath)}\n`);

                //await StreamUtils.waitFinish(output);
                console.log(`completed ${fileId}`);
            }
        }

        manifest.end();
        await StreamUtils.waitFinish(manifest);
        await this._tokenizer.end();
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('webqa-make-string-datasets', {
            addHelp: true,
            description: "Extract string datasets from a WebQA normalized data file."
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
        parser.addArgument('--class-name', {
            required: false,
            help: 'The name of the generated class, this will also affect the entity names'
        });
    },

    async execute(args) {
        const generator = new ParamDatasetGenerator(args.locale, args.debug, args.class_name);
        await generator.init(args.thingpedia);

        const data = JSON.parse(await util.promisify(fs.readFile)(args.data, { encoding: 'utf8' }));
        generator.run(data);

        await generator.output(args.output_dir, args.manifest, args.append_manifest);
    }
};
