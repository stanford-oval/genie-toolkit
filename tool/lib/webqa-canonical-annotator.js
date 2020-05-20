// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";
const fs = require('fs');
const util = require('util');
const path = require('path');
const child_process = require('child_process');
const utils = require('../../lib/utils');

const { makeLookupKeys } = require('../../lib/sample-utils');
const { PROPERTY_CANONICAL_OVERRIDE } = require('./webqa-manual-annotations');

const ANNOTATED_PROPERTIES = Object.keys(PROPERTY_CANONICAL_OVERRIDE);


// extract entity type from type
function typeToEntityType(type) {
    if (type.isArray)
        return typeToEntityType(type.elem);
    else if (type.isEntity)
        return type.type;
    else
        return null;
}

class AutoCanonicalAnnotator {
    constructor(classDef, constants, queries, parameterDatasets, options) {
        this.class = classDef;
        this.constants = constants;
        this.queries = queries;

        this.algorithm = options.algorithm;
        this.pruning = options.pruning;
        this.mask = options.mask;
        this.is_paraphraser = options.is_paraphraser;
        this.model = options.model;
        this.gpt2_ordering = options.gpt2_ordering;
        this.gpt2_paraphraser = options.gpt2_paraphraser;
        this.gpt2_paraphraser_model = options.gpt2_paraphraser_model;

        this.parameterDatasets = parameterDatasets;
        this.parameterDatasetPaths = {};

        this.options = options;
    }

    async generate() {
        await this._loadParameterDatasetPaths();

        const queries = {};
        for (let qname of this.queries) {
            let query = this.class.queries[qname];
            queries[qname] = {canonical: query.canonical, args: {}};

            let typeCounts = this._getArgTypeCount(qname);
            for (let arg of query.iterateArguments()) {
                queries[qname]['args'][arg.name] = {};

                if (ANNOTATED_PROPERTIES.includes(arg.name))
                    continue;

                if (arg.name.includes('.') && ANNOTATED_PROPERTIES.includes(arg.name.slice(arg.name.indexOf('.') + 1)))
                    continue;

                // get the paths to the data
                let p = path.dirname(this.parameterDatasets) + '/' + this._getDatasetPath(qname, arg);
                if (p && fs.existsSync(p))
                    queries[qname]['args'][arg.name]['path'] = p;

                // some args don't have canonical: e.g., id, name
                if (!arg.metadata.canonical)
                    continue;

                // copy base canonical if property canonical is missing
                if (arg.metadata.canonical.base && !arg.metadata.canonical.property)
                    arg.metadata.canonical.property = [...arg.metadata.canonical.base];

                let typestr = typeToEntityType(query.getArgType(arg.name));

                // if an entity is unique, allow dropping the property name entirely
                if (typestr && typeCounts[typestr] === 1) {
                    if (!this.queries.includes(typestr.substring(typestr.indexOf(':') + 1)))
                        arg.metadata.canonical.property.push('#');
                }

                // if property is missing, try to use entity type info
                if (!('property' in arg.metadata.canonical)) {
                    // only apply this if there is only one property uses this entity type
                    if (typestr && typeCounts[typestr] === 1) {
                        let base = utils.clean(typestr.substring(typestr.indexOf(':') + 1));
                        arg.metadata.canonical['property'] = [base];
                        arg.metadata.canonical['base'] = [base];
                    }
                }

                const samples = this._retrieveSamples(qname, arg);
                if (samples) {
                    queries[qname]['args'][arg.name]['canonicals'] = arg.metadata.canonical;
                    queries[qname]['args'][arg.name]['values'] = samples;
                }
            }
        }

        if (this.algorithm === 'neural') {
            const args = [path.resolve(path.dirname(module.filename), './bert-annotator.py'), 'all'];
            if (this.is_paraphraser)
                args.push('--is-paraphraser');
            if (this.gpt2_ordering)
                args.push('--gpt2-ordering');
            if (this.pruning) {
                args.push('--pruning-threshold');
                args.push(this.pruning);
            }
            args.push('--model-name-or-path');
            args.push(this.model);
            args.push(this.mask ? '--mask' : '--no-mask');

            // call bert to generate candidates
            const child = child_process.spawn(`python3`, args, {stdio: ['pipe', 'pipe', 'inherit']});

            const output = util.promisify(fs.writeFile);
            if (this.options.debug)
                await output(`./bert-annotator-in.json`, JSON.stringify(queries, null, 2));

            const stdout = await new Promise((resolve, reject) => {
                child.stdin.write(JSON.stringify(queries));
                child.stdin.end();
                child.on('error', reject);
                child.stdout.on('error', reject);
                child.stdout.setEncoding('utf8');
                let buffer = '';
                child.stdout.on('data', (data) => {
                    buffer += data;
                });
                child.stdout.on('end', () => resolve(buffer));
            });

            if (this.options.debug)
                await output(`./bert-annotator-out.json`, JSON.stringify(JSON.parse(stdout), null, 2));

            const {synonyms, adjectives} = JSON.parse(stdout);
            this._updateCanonicals(synonyms, adjectives);
            if (this.gpt2_paraphraser)
                await this._gpt2UpdateCanonicals(synonyms, queries);
        }

        return this.class;
    }

    _getArgTypeCount(qname) {
        const schema = this.class.queries[qname];
        const count = {};
        for (let arg of schema.iterateArguments()) {
            let typestr = typeToEntityType(schema.getArgType(arg.name));
            if (!typestr)
                continue;
            count[typestr] = (count[typestr] || 0) + 1;
        }
        return count;
    }

    async _loadParameterDatasetPaths() {
        const rows = (await (util.promisify(fs.readFile))(this.parameterDatasets, { encoding: 'utf8' })).split('\n');
        for (let row of rows) {
            let key, path;
            let split = row.split('\t');
            if (split.length === 4)
                [, , key, path] = split;
            else
                [, key, path] = split;
            this.parameterDatasetPaths[key] = path;
        }
    }

    _getDatasetPath(qname, arg) {
        const keys = [];
        const stringValueAnnotation = arg.getImplementationAnnotation('string_values');
        if (stringValueAnnotation)
            keys.push(stringValueAnnotation);
        keys.push(`${this.class.kind}:${qname}_${arg.name}`);
        const elementType = arg.type.isArray ? arg.type.elem : arg.type;
        if (!elementType.isCompound)
            keys.push(elementType.isEntity ? elementType.type : elementType);

        for (let key of keys) {
            if (this.parameterDatasetPaths[key])
                return this.parameterDatasetPaths[key];
        }
        return null;
    }

    _updateCanonicals(candidates, adjectives) {
        for (let qname of this.queries) {
            for (let arg in candidates[qname]) {
                if (arg === 'id')
                    continue;
                let canonicals = this.class.queries[qname].getArgument(arg).metadata.canonical;
                if (adjectives.includes(`${qname}.${arg}`))
                        canonicals['adjective'] = ['#'];

                for (let type in candidates[qname][arg]) {
                    for (let candidate in candidates[qname][arg][type]) {
                        if (!canonicals[type].includes(candidate))
                            canonicals[type].push(candidate);
                    }
                }
            }
        }
    }

    async _paraphrase(input) {
        const args = [
            `run-paraphrase`,
            `--model_type`, `gpt2`,
            `--model_name_or_path`, this.gpt2_paraphraser_model,
            `--length`, `15`,
            `--temperature`, `0.0`,
            `--repetition_penalty`, `1.0`,
            `--num_samples`, `1`,
            `--input_column`, `1`,
            `--batch_size`, `8`,
            `--stop_tokens`, `</paraphrase>`, `?`
        ];
        const child = child_process.spawn(`genienlp`, args, { stdio: ['pipe', 'pipe', 'inherit'] });

        const output = util.promisify(fs.writeFile);
        if (this.options.debug)
            await output(`./gpt2-paraphraser-in.tsv`, input);

        const stdout = await new Promise((resolve, reject) => {
            child.stdin.write(input);
            child.stdin.end();
            child.on('error', reject);
            child.stdout.on('error', reject);
            child.stdout.setEncoding('utf8');
            let buffer = '';
            child.stdout.on('data', (data) => {
                buffer += data;
            });
            child.stdout.on('end', () => resolve(buffer));
        });

        console.log(stdout);

        if (this.options.debug)
            await output(`./gpt2-paraphraser-out.json`, JSON.stringify(JSON.parse(stdout), null, 2));

        return JSON.parse(stdout);
    }

    async _gpt2UpdateCanonicals(synonyms, queries) {
        function generateGpt2Input(candidates) {
            const input = [];
            for (let category in candidates) {
                for (let canonical in candidates[category]) {
                    for (let sentence of candidates[category][canonical])
                        input.push(`${input.length}\t${sentence}`);
                }
            }
            return input;
        }

        function extractCanonical(origin, paraphrases, values, query_canonical) {
            const canonical = {};
            let value = values.find((v) => origin.includes(v));
            if (!value) {
                // base canonical
                return canonical;
            }
            value = value.toLowerCase();

            for (let paraphrase of paraphrases) {
                if (!paraphrase.includes(value))
                    continue;

                let prefix;
                if (origin.startsWith('who '))
                    prefix = 'who ';
                else
                    prefix = origin.slice(0, origin.indexOf(query_canonical) + query_canonical.length + 1);

                if (!paraphrase.startsWith(prefix))
                    continue;

                const clause = paraphrase.slice(prefix.length);

                if (clause.startsWith('with ')) {
                    canonical['property'] = canonical['property'] || [];
                    canonical['property'].push(clause.slice('with '.length).replace(value, '#'));
                } else if (clause.startsWith('that ')) {
                    canonical['verb'] = canonical['verb'] || [];
                    canonical['verb'].push(clause.slice('that '.length).replace(value, '#'));
                }
            }
            return canonical;
        }


        for (let qname of this.queries) {
            let query_canonical = queries[qname]['canonical'];
            for (let arg in synonyms[qname]) {
                let canonicals = this.class.queries[qname].getArgument(arg).metadata.canonical;
                if (arg === 'id' || Object.keys(synonyms[qname][arg]).length === 0)
                    continue;

                let input = generateGpt2Input(synonyms[qname][arg]);
                let output = await this._paraphrase(input.join('\n'));
                let values = queries[qname]['args'][arg]['values'];
                for (let i = 0; i < input.length; i++) {
                    let newCanonicals = extractCanonical(input[i].split('\t')[1], output[i], values, query_canonical);
                    for (let typeNewCanonical in newCanonicals) {
                        for (let newCanonical of newCanonicals[typeNewCanonical]) {
                            if (canonicals[typeNewCanonical].includes(newCanonical))
                                continue;
                            if (newCanonical.endsWith(' #') && canonicals[typeNewCanonical].includes(newCanonicals.slice(0, -2)))
                                continue;
                            canonicals[typeNewCanonical].push(newCanonical);
                        }
                    }
                }


            }
        }
    }

    _retrieveSamples(qname, arg) {
        const keys = makeLookupKeys('@' + this.class.kind + '.' + qname, arg.name, arg.type);
        let samples;
        for (let key of keys) {
            if (this.constants[key]) {
                samples = this.constants[key];
                break;
            }
        }
        if (samples) {
            samples = samples.map((v) => {
                if (arg.type.isString || (arg.type.isArray && arg.type.elem.isString))
                    return v.value;
                return v.display;
            });
        }
        return samples;
    }
}

module.exports = AutoCanonicalAnnotator;
