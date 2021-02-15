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


import assert from 'assert';
import * as fs from 'fs';
import util from 'util';
import path from 'path';
import * as ThingTalk from 'thingtalk';
import csvstringify from 'csv-stringify';

import * as I18N from '../../lib/i18n';
import * as StreamUtils from '../../lib/utils/stream-utils';

import { makeMetadata } from './lib/metadata';

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


        this._propertiesNoFilter = [];
        const file = path.resolve(path.dirname(module.filename), `../${dataset}/manual-annotations.js`);
        if (dataset !== 'custom' && fs.existsSync(file)) {
            // FIXME refactor to use import() instead (must be async)
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const manualAnnotations = require(`../${dataset}/manual-annotations`);
            if (manualAnnotations.PROPERTIES_NO_FILTER)
                this._propertiesNoFilter = manualAnnotations.PROPERTIES_NO_FILTER;
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
        const library = ThingTalk.Syntax.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }));
        assert(library instanceof ThingTalk.Ast.Library && library.classes.length === 1);
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

        // if this entity has a name, add it to the string file (one-shot QA format)
        if (type !== 'Thing' && type !== 'Intangible' && value.name)
            this._getStringFile(type, true).push({ name: value.name, value: value['@id'] });

        // if this entity has id and its value contains display, add it to the string file (dialogue format)
        if (value.id && value.id.display && value.id.display !== value.id.value)
            this._getStringFile(type, true).push({ name: value.id.display, value: value.id.value });

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

            if (!expectedType.type.startsWith('tt:') && value.display && value.display !== value.value)
                this._getStringFile(expectedType.type, true).push({ name: value.display, value: value.value });
        } else {
            // compound type

            for (let field in expectedType.type) {
                path.push(field);
                this._processField(value[field], path, expectedType.type[field]);
                path.pop();
            }
        }
    }

    run(data, fn) {
        if (Array.isArray(data)) {
            // normalized data format for dialogues
            for (let d of data)
                this._processObject(d, fn.slice(`${this._className}:`.length));
        } else {
            // normalized data format for one-shot QA
            for (let type in data) {
                for (let objId in data[type])
                    this._processObject(data[type][objId], data[type][objId]['@type']);
            }
        }
    }

    _tokenizeAll(strings) {
        return strings.map((str) => this._tokenizer.tokenize(str));
    }

    async output(outputDir, manifestFile, appendManifest) {
        await util.promisify(fs.mkdir)(outputDir, { recursive: true });

        const manifestDir = path.dirname(manifestFile);
        const manifest = fs.createWriteStream(manifestFile, { flags: appendManifest ? 'a' : 'w' });

        function isNotCapital(token) {
            return !/^[A-Z]/.test(token);
        }

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
                    let value = strings[i];
                    const weight = weights[i];
                    let tokens = tokenized[i].tokens;

                    // clean up value
                    value = value.replace(/\n/g, ' ');
                    if (value === 'unspecified')
                        continue;

                    // sometimes locations are in "street_address, county, country" or "town, city, country" format
                    // in those cases we remove everything after first comma and return the rest
                    if (['address', 'location', 'geo'].some((v) => fileId.includes(v)) && value.indexOf(',') !== -1 && value.split(',') >= 3)
                        value = value.slice(0, value.indexOf(',')).trim();

                    if (tokens.length === 0 || tokens.some((tok) => /^[A-Z]/.test(tok)))
                        tokens = tokens.filter(isNotCapital);

                    const tokenizedString = tokens.join(' ');
                    if (this._maxValueLength >= 0 && tokenizedString.length > this._maxValueLength)
                        continue;

                    let spans = [tokenizedString];
                    // if string contains several cuisines break them apart
                    if (fileId.endsWith('servesCuisine'))
                        spans = tokenizedString.split(/[,;]/);

                    for (let span of spans) {
                        if (/\S/.test(span))
                            output.write([value, span.trim(), weight]);
                    }
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

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('make-string-datasets', {
        add_help: true,
        description: "Extract string datasets from a AutoQA normalized data file."
    });
    parser.add_argument('--dataset', {
        required: true,
        choices: ['schemaorg', 'sgd', 'wikidata', 'multiwoz', 'custom'],
        help: 'The dataset to run autoQA on.'
    });
    parser.add_argument('-d', '--output-dir', {
        required: true,
    });
    parser.add_argument('--thingpedia', {
        required: true,
        help: 'Path to ThingTalk file containing class definitions.'
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to generate (defaults to 'en-US', English)`
    });
    parser.add_argument('--manifest', {
        required: true,
        help: `Write a parameter dataset manifest to this location`
    });
    parser.add_argument('--append-manifest', {
        required: false,
        action: 'store_true',
        help: `append to the manifest instead of replacing`
    });
    parser.add_argument('--data', {
        required: true,
        help: 'Path to JSON file with normalized AutoQA data, or to the database map TSV file.'
    });
    parser.add_argument('--max-value-length', {
        required: false,
        default: 500,
        help: 'Ignore values longer than this (unit: number of UTF-16 code points after tokenization).'
    });
    parser.add_argument('--class-name', {
        required: false,
        help: 'The name of the device class, used to decide class-specific types'
    });
    parser.add_argument('--debug', {
        action: 'store_true',
        help: 'Enable debugging.',
        default: true
    });
    parser.add_argument('--no-debug', {
        action: 'store_false',
        dest: 'debug',
        help: 'Disable debugging.',
    });
}

export async function execute(args) {
    const generator = new ParamDatasetGenerator(args.locale, args.debug,
        args.max_value_length, args.class_name, args.dataset);
    await generator.init(args.thingpedia);

    if (args.data.endsWith('database-map.tsv')) {
        const dir = path.dirname(args.data);
        const lines = await util.promisify(fs.readFile)(args.data, { encoding: 'utf8' });
        for (let line of lines.trim().split('\n')) {
            const [fn, dbPath] = line.split('\t');
            const resolvedPath = path.resolve(dir, dbPath);
            const data = JSON.parse(await util.promisify(fs.readFile)(resolvedPath, { encoding: 'utf8' }));
            generator.run(data, fn);
        }
    } else {
        const data = JSON.parse(await util.promisify(fs.readFile)(args.data, { encoding: 'utf8' }));
        generator.run(data);
    }

    await generator.output(args.output_dir, args.manifest, args.append_manifest);
}
