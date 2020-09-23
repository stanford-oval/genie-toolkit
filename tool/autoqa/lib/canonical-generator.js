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
"use strict";
const fs = require('fs');
const util = require('util');
const path = require('path');
const stemmer = require('stemmer');
const Inflectors = require('en-inflectors').Inflectors;
const child_process = require('child_process');

const utils = require('../../../lib/utils/misc-utils');
const { makeLookupKeys } = require('../../../lib/dataset-tools/mturk/sample-utils');
const EnglishLanguagePack = require('../../../lib/i18n/american-english');
const { clean } = require('../../../lib/utils/misc-utils');

const CanonicalExtractor = require('./canonical-extractor');
const genBaseCanonical = require('./base-canonical-generator');

// extract entity type from type
function typeToEntityType(type) {
    if (type.isArray)
        return typeToEntityType(type.elem);
    else if (type.isEntity)
        return type.type;
    else
        return null;
}

class AutoCanonicalGenerator {
    constructor(classDef, constants, functions, parameterDatasets, options) {
        this.class = classDef;
        this.constants = constants;
        this.functions = functions ? functions : Object.keys(classDef.queries).concat(Object.keys(classDef.actions));

        this.algorithm = options.algorithm ? options.algorithm.split(',') : [];
        this.pruning = options.pruning;
        this.mask = options.mask;
        this.is_paraphraser = options.is_paraphraser;
        this.model = options.model;
        this.gpt2_ordering = options.gpt2_ordering;
        this.paraphraser_model = options.paraphraser_model;

        this.parameterDatasets = parameterDatasets;
        this.parameterDatasetPaths = {};

        this.options = options;

        this.annotatedProperties = [];
        const file = path.resolve(path.dirname(module.filename), `../${options.dataset}/manual-annotations.js`);
        if (options.dataset !== 'custom' && fs.existsSync(file)) {
            const manualAnnotations = require(`../${options.dataset}/manual-annotations`);
            if (manualAnnotations.PROPERTY_CANONICAL_OVERRIDE)
                this.annotatedProperties = Object.keys(manualAnnotations.PROPERTY_CANONICAL_OVERRIDE);
        }
        this._langPack = new EnglishLanguagePack();
    }

    async generate() {
        await this._loadParameterDatasetPaths();
        const functions = {};
        for (let fname of this.functions) {
            let func = this.class.queries[fname] || this.class.actions[fname];
            functions[fname] = {
                type: this.class.queries[fname] ? 'query' : 'action',
                canonical: func.canonical || clean(fname),
                args: {}
            };
            if (Array.isArray(functions[fname].canonical))
                functions[fname].canonical = functions[fname].canonical[0];

            let typeCounts = this._getArgTypeCount(func);
            for (let arg of func.iterateArguments()) {
                const argobj = {};

                if (this.annotatedProperties.includes(arg.name) || arg.name === 'id')
                    continue;

                // TODO: bert on counted object only for these args
                if (arg.metadata.counted_object)
                    continue;

                if (arg.name.includes('.') && this.annotatedProperties.includes(arg.name.slice(arg.name.indexOf('.') + 1)))
                    continue;

                // some args don't have canonical: e.g., id, name
                if (!arg.metadata.canonical)
                    continue;

                // skip compound types
                if (arg.type.isCompound)
                    continue;

                // get the paths to the data
                let datasetTypeAndPath = this._getDatasetPath(fname, arg);
                if (datasetTypeAndPath) {
                    let [datasetType, datasetPath] = datasetTypeAndPath;
                    datasetPath = path.dirname(this.parameterDatasets) + '/' + datasetPath;
                    if (datasetPath && fs.existsSync(datasetPath))
                        argobj['path'] = [datasetType, datasetPath];
                }

                let canonical = arg.metadata.canonical;
                if (this.options.remove_existing_canonicals) {
                    canonical = {};
                    genBaseCanonical(canonical, arg.name, arg.type);
                } else {
                    if (typeof canonical === 'string')
                        canonical = { base: [canonical] };
                    else if (Array.isArray(canonical))
                        canonical = { base: canonical };
                }
                arg.metadata.canonical = canonical;
                for (let type in canonical) {
                    if (!Array.isArray(canonical[type]))
                        canonical[type] = [canonical[type]];
                }

                // remove function name in arg name, normally it's repetitive
                for (let type in canonical) {
                    canonical[type] = canonical[type].map((c) => {
                        if (c.startsWith(fname.toLowerCase() + ' '))
                            return c.slice(fname.toLowerCase().length + 1);
                        return c;
                    });
                }

                // copy base canonical if property canonical is missing
                if (canonical.base && !canonical.property)
                    canonical.property = [...canonical.base];

                let typestr = typeToEntityType(func.getArgType(arg.name));

                if (typestr && typeCounts[typestr] === 1) {
                    // if an entity is unique, allow dropping the property name entirely
                    if (!this.functions.includes(typestr.substring(typestr.indexOf(':') + 1)))
                        canonical.property.push('#');

                    // if it's the only people entity, adding adjective form
                    // E.g., author for review - bob's review
                    //       byArtist for MusicRecording - bob's song
                    if (typestr.endsWith(':Person'))
                        canonical.adjective = ["# 's", '#'];
                }

                // if property is missing, try to use entity type info
                if (!('property' in canonical)) {
                    // only apply this if there is only one property uses this entity type
                    if (typestr && typeCounts[typestr] === 1) {
                        let base = utils.clean(typestr.substring(typestr.indexOf(':') + 1));
                        canonical['property'] = [base];
                        canonical['base'] = [base];
                    }
                }
                argobj['canonicals'] = canonical;

                const samples = this._retrieveSamples(fname, arg);
                if (samples)
                    argobj['values'] = samples;

                functions[fname]['args'][arg.name] = argobj;
            }
        }

        if (this.algorithm.length > 0) {
            const args = [path.resolve(path.dirname(module.filename), './bert-canonical-annotator.py'), 'all'];
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
            const startTime = new Date();
            if (this.options.debug)
                await output(`./bert-canonical-annotator-in.json`, JSON.stringify(functions, null, 2));

            const stdout = await new Promise((resolve, reject) => {
                child.stdin.write(JSON.stringify(functions));
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

            if (this.options.debug) {
                try {
                    await output(`./bert-canonical-annotator-out.json`, JSON.stringify(JSON.parse(stdout), null, 2));
                    const time = Math.round((new Date() - startTime) / 1000);
                    console.log(`Bert annotator took ${time} seconds to run.`);
                } catch (e) {
                     await output(`./bert-canonical-annotator-out.json`, stdout);
                }
            }

            const { synonyms, adjectives } = JSON.parse(stdout);
            if (this.algorithm.includes('bert') || this.algorithm.includes('adj'))
                this._updateCanonicals(synonyms, adjectives);
            if (this.algorithm.includes('bart')) {
                const startTime = new Date();
                const extractor = new CanonicalExtractor(this.class, this.functions, this.paraphraser_model, this.options);
                await extractor.run(synonyms, functions);
                if (this.options.debug) {
                    const time = Math.round((new Date() - startTime) / 1000);
                    console.log(`Bart annotator took ${time} seconds to run.`);
                }
            }
            this._addProjectionCanonicals();
        }

        return this.class;
    }

    _getArgTypeCount(schema) {
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
            let [type, /*locale*/, key, path] = row.split('\t');
            this.parameterDatasetPaths[key] = [type, path];
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
        for (let fname of this.functions) {
            let func = this.class.queries[fname] || this.class.actions[fname];
            for (let arg in candidates[fname]) {
                if (arg === 'id')
                    continue;
                let canonicals = func.getArgument(arg).metadata.canonical;
                if (!canonicals)
                    throw new Error(`Missing canonical form for ${arg} in @${func.class.name}.${func.name}`);
                if (typeof canonicals === 'string')
                    canonicals = { base: [canonicals] };
                else if (Array.isArray(canonicals))
                    canonicals = { base: canonicals };

                if (this.algorithm.includes('adj') && adjectives.includes(`${fname}.${arg}`))
                    canonicals['adjective'] = ['#'];

                if (this.algorithm.includes('bert')) {
                    for (let type in candidates[fname][arg]) {
                        for (let candidate in candidates[fname][arg][type]) {
                            if (this._hasConflict(fname, arg, type, candidate))
                                continue;
                            if (type === 'reverse_verb' && !this._isVerb(candidate))
                                continue;
                            if (!canonicals[type].includes(candidate))
                                canonicals[type].push(candidate);
                        }
                    }

                    if (canonicals.reverse_verb && canonicals.reverse_verb.length === 1) {
                        // FIXME: a hack, when there is only one candidate for reverse verb, it means the inflector noun
                        //  to verb doesn't work, add the following heuristics
                        const base = (new Inflectors(canonicals.base[0])).toSingular();
                        if (base.endsWith('or') || base.endsWith('er'))
                            canonicals.reverse_verb.push(base.slice(0, -2) + 'ed');
                        canonicals.reverse_verb.push(base);
                    }
                }
            }
        }
    }

    _addProjectionCanonicals() {
        for (let fname of this.functions) {
            let func = this.class.queries[fname] || this.class.actions[fname];
            for (let arg of func.iterateArguments()) {
                if (this.annotatedProperties.includes(arg.name) || arg.name === 'id')
                    continue;

                let canonicals = arg.metadata.canonical;
                if (!canonicals)
                    continue;
                if (typeof canonicals === 'string' || Array.isArray(canonicals))
                    continue;

                for (let cat in canonicals) {
                    if (['default', 'adjective', 'implicit_identity', 'property'].includes(cat))
                        continue;
                    if (cat.endsWith('_projection'))
                        continue;
                    if (cat.endsWith('_true') || cat.endsWith('_false'))
                        continue;
                    if (cat === 'passive_verb' || cat === 'verb') {
                        canonicals[cat + '_projection'] = canonicals[cat].map((c) => {
                            let tokens = c.split(' ');
                            if (tokens.length === 1)
                                return c;
                            if (['IN', 'TO', 'PR'].includes(this._langPack.posTag(tokens)[tokens.length - 1]))
                                return [...tokens.slice(0, -1), '|', tokens[tokens.length - 1]].join(' ');
                            return c;
                        });
                    } else {
                        canonicals[cat + '_projection'] = canonicals[cat];
                    }
                }
            }
        }
    }

    _isVerb(candidate) {
        if (candidate === 'is' || candidate === 'are')
            return false;

        return ['VBP', 'VBZ', 'VBD'].includes(this._langPack.posTag([candidate])[0]);
    }

    _hasConflict(fname, currentArg, currentPos, currentCanonical) {
        const func = this.class.queries[fname] || this.class.actions[fname];
        currentArg = func.getArgument(currentArg);
        const currentStringset = currentArg.getImplementationAnnotation('string_values');
        for (let arg of func.iterateArguments()) {
            if (arg.name === currentArg.name)
                continue;

            // for non base, we only check conflict between arguments of the same type, or same string set
            if (currentPos !== 'base') {
                if (currentStringset) {
                    let stringset = arg.getImplementationAnnotation('string_values');
                    if (stringset && stringset !== currentStringset)
                        continue;
                }
                let currentType = currentArg.type.isArray ? currentArg.type.elem : currentArg.type;
                let type = arg.type.isArray ? arg.type.elem : arg.type;
                if (!currentType.equals(type))
                    continue;
            }

            const canonicals = arg.metadata.canonical;

            for (let pos in canonicals) {
                // if current pos is base, only check base
                if (currentPos === 'base' && pos !== 'base')
                    continue;
                // if current pos is not base, only check non-base
                if (currentPos !== 'base' && pos === 'base')
                    continue;
                let conflictFound = false;
                let todelete = [];
                for (let i = 0; i < canonicals[pos].length; i++) {
                    let canonical = canonicals[pos][i];
                    if (stemmer(canonical) === stemmer(currentCanonical)) {
                        // conflict with the base canonical phrase of another parameter, return true directly
                        if (i === 0)
                            return true;
                        // conflict with generate canonicals of another parameter, remove conflicts, then return true
                        conflictFound = true;
                        todelete.push(canonical);
                    }
                }
                if (conflictFound) {
                    for (let canonical of todelete) {
                        let index = canonicals[pos].indexOf(canonical);
                        canonicals[pos].splice(index, 1);
                    }
                    return true;
                }
            }
        }

        //TODO: also consider conflicts between candidates

        return false;
    }

    _retrieveSamples(qname, arg) {
        //TODO: also use enum canonicals?
        if (arg.type.isEnum)
            return arg.type.entries.slice(0, 10).map(clean);

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

module.exports = AutoCanonicalGenerator;
