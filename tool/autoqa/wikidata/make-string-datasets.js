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
// Author: Silei Xu <silei@cs.stanford.edu>

import assert from 'assert';
import * as fs from 'fs';
import * as util from 'util';
import * as path from 'path';
import * as ThingTalk from 'thingtalk';
import csvstringify from 'csv-stringify';

import * as I18N from '../../../lib/i18n';
import * as StreamUtils from '../../../lib/utils/stream-utils';

import {
    wikidataQuery,
    getEquivalent,
    getItemLabel
} from './utils';

function getElemType(type) {
    if (type.isArray)
        return getElemType(type.elem);
    return type;
}

class ParamDatasetGenerator {
    constructor(options) {
        this._locale = options.locale;
        this._debug = options.debug;
        this._maxValueLength = options.max_value_length;
        this._targetSize = options.target_size;
        this._stringFiles = new Map;
        this._tokenizer = I18N.get(options.locale).getTokenizer();
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
        this._classDef = library.classes[0];
    }

    async _downloadSubjectValues(fn, klass, filters, targetSize) {
        const predicate = klass === 'Q5' ? 'wdt:P31' : 'p:P31/ps:P31/wdt:P279*';
        const query = `
            SELECT DISTINCT ?subject
            WHERE {
              ?subject ${predicate} wd:${klass}; ${filters.join('; ')}.
            }
            LIMIT ${targetSize}
        `;
        const results = await wikidataQuery(query);
        for (let result of results) {
            const value = result.subject.value;
            const label = await getItemLabel(value.slice('http://www.wikidata.org/entity/'.length));
            if (!label)
                continue;
            if (/Q[0-9]+/.test(label))
                continue;
            this._getStringFile(fn, true).push({ name: label, value: value });
        }

    }

    async _downloadPropertyValues(fn, arg, klass, filters, targetSize) {
        if (arg.name === 'id')
            return ;
        const elemType = getElemType(arg.type);
        if (!elemType.isString && !(elemType.isEntity && elemType.type.startsWith('org.wikidata:')))
            return;

        const id = arg.getImplementationAnnotation('wikidata_id');

        const predicate = klass === 'Q5' ? 'wdt:P31' : 'p:P31/ps:P31/wdt:P279*';
        const query = `
            SELECT DISTINCT ?value
            WHERE {
              ?subject ${predicate} wd:${klass}; ${filters.join('; ')}.
              ?subject wdt:${id} ?value.
            }
            LIMIT ${targetSize}
        `;
        const results = await wikidataQuery(query);
        for (let result of results) {
            const value = result.value.value;
            let label;
            if (value.startsWith('http://www.wikidata.org/entity/'))
                label = await getItemLabel(value.slice('http://www.wikidata.org/entity/'.length));
            else
                label = value;
            if (!label)
                continue;
            if (/Q[0-9]+/.test(label))
                continue;
            if (elemType.isString)
                this._addString(`${fn}_${arg.name}`, label);
            else if (elemType.isEntity && elemType.type.startsWith('org.wikidata:'))
                this._getStringFile(elemType.type.slice('org.wikidata:'.length), true).push({ name: label, value: value });
        }
    }

    async _tryDownloadSubjectValues(fn, klass, triples, targetSize) {
        while (targetSize > 30) {
            try {
                await this._downloadSubjectValues(fn, klass, triples, Math.ceil(targetSize));
                return;
            } catch(e) {
                if (e.code !== 500)
                    throw e;
                targetSize /= 2;
            }
        }
    }

    async _tryDownloadPropertyValues(fn, arg, klass, triples, targetSize) {
        while (targetSize > 30) {
            try {
                await this._downloadPropertyValues(fn, arg, klass, triples, Math.ceil(targetSize));
                return;
            } catch(e) {
                if (e.code !== 500)
                    throw e;
                targetSize /= 2;
            }
        }
    }

    async run() {
        for (let fn in this._classDef.queries) {
            const fndef = this._classDef.queries[fn];
            const klass = fndef.getImplementationAnnotation('wikidata_subject');
            const equivalentClasses = klass === 'Q5' ? null : await getEquivalent(klass);
            const classes =  equivalentClasses ? [klass, ...equivalentClasses] : [klass];
            const triples = [];
            for (let arg of fndef.getImplementationAnnotation('required_properties') || [])
                triples.push(`wdt:${arg} ?${arg}`);
            for (let klass of classes) {
                await this._tryDownloadSubjectValues(fn, klass, triples, Math.ceil(this._targetSize / classes.length));
                for (let arg of fndef.iterateArguments())
                    await this._tryDownloadPropertyValues(fn, arg, klass, triples, Math.ceil(this._targetSize / classes.length));
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

        for (let [fileId, fileContent] of this._stringFiles) {
            const outputpath = path.resolve(outputDir, 'org.wikidata:' + fileId + (fileContent.isEntity ? '.json' : '.tsv'));

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

                manifest.write(`entity\t${this._locale}\torg.wikidata:${fileId}\t${path.relative(manifestDir, outputpath)}\n`);
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
                manifest.write(`string\t${this._locale}\torg.wikidata:${fileId}\t${path.relative(manifestDir, outputpath)}\n`);

                //await StreamUtils.waitFinish(output);
                console.log(`completed ${fileId}`);
            }
        }

        manifest.end();
        await StreamUtils.waitFinish(manifest);
    }
}

export function initArgparse(subparsers) {
    const parser = subparsers.add_parser('wikidata-make-string-datasets', {
        add_help: true,
        description: "Extract string datasets from a AutoQA normalized data file."
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
    parser.add_argument('--max-value-length', {
        required: false,
        default: 500,
        help: 'Ignore values longer than this (unit: number of UTF-16 code points after tokenization).'
    });
    parser.add_argument('--target-size', {
        required: false,
        default: 1000,
        help: 'target number of examples for each property'
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
    const generator = new ParamDatasetGenerator(args);
    await generator.init(args.thingpedia);
    await generator.run();
    await generator.output(args.output_dir, args.manifest, args.append_manifest);
}
