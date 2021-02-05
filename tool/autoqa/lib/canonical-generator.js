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

import * as fs from 'fs';
import util from 'util';
import path from 'path';
import stemmer from 'stemmer';
import { Inflectors } from 'en-inflectors';
import * as child_process from 'child_process';

import * as utils from '../../../lib/utils/misc-utils';
import { makeLookupKeys } from '../../../lib/dataset-tools/mturk/sample-utils';
import EnglishLanguagePack from '../../../lib/i18n/english';
import { clean } from '../../../lib/utils/misc-utils';

import CanonicalExtractor from './canonical-extractor';
import genBaseCanonical from './base-canonical-generator';

const topk_property_synonyms = 3;
const topk_domain_synonyms = 5;
const topk_adjectives = 500;

function getElemType(type) {
    if (type.isArray)
        return getElemType(type.elem);
    return type;
}

function typeToString(type) {
    const elemType = getElemType(type);

    if (elemType.isEntity)
        return elemType.type;

    if (elemType.isCompound)
        return null;

    return type.toString();
}

export default class AutoCanonicalGenerator {
    constructor(classDef, constants, functions, parameterDatasets, options) {
        this.class = classDef;
        this.constants = constants;
        this.functions = functions ? functions : Object.keys(classDef.queries).concat(Object.keys(classDef.actions));

        this.algorithms = options.algorithms;
        this.pruning = options.pruning;
        this.mask = options.mask;
        this.language_model = options.language_model;
        this.gpt2_ordering = options.gpt2_ordering;
        this.paraphraser_model = options.paraphraser_model;

        this.parameterDatasets = parameterDatasets;
        this.parameterDatasetPaths = {};

        this.options = options;

        this.annotatedProperties = [];
        const file = path.resolve(path.dirname(module.filename), `../${options.dataset}/manual-annotations.js`);
        if (options.dataset !== 'custom' && fs.existsSync(file)) {
            // FIXME refactor to use import() instead (must be async)
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const manualAnnotations = require(`../${options.dataset}/manual-annotations`);
            if (manualAnnotations.PROPERTY_CANONICAL_OVERRIDE)
                this.annotatedProperties = Object.keys(manualAnnotations.PROPERTY_CANONICAL_OVERRIDE);
        }
        this._langPack = new EnglishLanguagePack('en-US');
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

                let typestr = typeToString(func.getArgType(arg.name));

                if (typestr && typeCounts[typestr] === 1) {
                    // if an entity is unique, allow dropping the property name entirely
                    if (canonical.property && !this.functions.includes(typestr.substring(typestr.indexOf(':') + 1))) {
                        if (!canonical.property.includes('#'))
                            canonical.property.push('#');
                    }

                    // if it's the only people entity, adding adjective form
                    // E.g., author for review - bob's review
                    //       byArtist for MusicRecording - bob's song
                    if (typestr.endsWith(':Person'))
                        canonical.adjective = ["# 's", '#'];

                    // if it's the only date, adding argmin/argmax/base_projection
                    if (typestr === 'Date') {
                        canonical.adjective_argmax = ["most recent", "latest", "last", "newest"];
                        canonical.adjective_argmin = ["earliest", "first", "oldest"];
                        canonical.base_projection = ['date'];
                    }
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

        if (this.algorithms.length > 0) {
            const args = [path.resolve(path.dirname(module.filename), './bert-canonical-annotator.py'), 'all'];
            args.push('--k-synonyms', topk_property_synonyms);
            args.push('--k-domain-synonyms', topk_domain_synonyms);
            args.push('--k-adjectives', topk_adjectives);
            if (this.gpt2_ordering)
                args.push('--gpt2-ordering');
            if (this.pruning) {
                args.push('--pruning-threshold');
                args.push(this.pruning);
            }
            args.push('--model-name-or-path');
            args.push(this.language_model);
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
                } catch(e) {
                     await output(`./bert-canonical-annotator-out.json`, stdout);
                }
            }

            const { domains, synonyms, adjectives } = JSON.parse(stdout);
            if (this.algorithms.includes('bert-domain-synonyms'))
                this._updateFunctionCanonicals(domains);
            if (this.algorithms.includes('bert-property-synonyms') || this.algorithms.includes('bert-adjectives'))
                this._updateCanonicals(synonyms, adjectives);
            if (this.algorithms.includes('bart-paraphrase')) {
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
            let typestr = typeToString(arg.type);
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

    _updateFunctionCanonicals(canonicals) {
        for (let fname of this.functions) {
            let func = this.class.queries[fname] || this.class.actions[fname];
            const canonical = Array.isArray(func.nl_annotations.canonical) ? func.nl_annotations.canonical : [func.nl_annotations.canonical];
            const candidates = canonicals[fname];
            const maxCount = Object.values(candidates).reduce((a, b) => a + b, 0) / topk_domain_synonyms;
            for (let candidate in candidates) {
                if (candidates[candidate] > maxCount * this.pruning)
                    canonical.push(candidate);
            }

            func.nl_annotations.canonical = canonical;
        }
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

                if (this.algorithms.includes('bert-adjectives') && adjectives.includes(`${fname}.${arg}`))
                    canonicals['adjective'] = ['#'];

                if (this.algorithms.includes('bert-property-synonyms')) {
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
                if (arg.type.isBoolean)
                    continue;

                let canonicals = arg.metadata.canonical;
                if (!canonicals)
                    continue;
                if (typeof canonicals === 'string' || Array.isArray(canonicals))
                    continue;

                for (let cat in canonicals) {
                    if (['default', 'adjective', 'implicit_identity', 'property', 'projection_pronoun'].includes(cat))
                        continue;
                    if (cat.endsWith('_projection'))
                        continue;
                    if (cat.endsWith('_argmin') || cat.endsWith('_argmax'))
                        continue;
                    if (`${cat}_projection` in canonicals)
                        continue;

                    if (cat === 'passive_verb' || cat === 'verb') {
                        canonicals[cat + '_projection'] = canonicals[cat].map((canonical) => {
                            return this._processProjectionCanonical(canonical, cat);
                        }).filter(Boolean).map((c) => {
                            let tokens = c.split(' ');
                            if (tokens.length === 1)
                                return c;
                            if (['IN', 'TO', 'PR'].includes(this._langPack.posTag(tokens)[tokens.length - 1]))
                                return [...tokens.slice(0, -1), '|', tokens[tokens.length - 1]].join(' ');
                            return c;
                        }).filter(this._dedup);
                    } else {
                        canonicals[cat + '_projection'] = canonicals[cat].map((canonical) => {
                            return this._processProjectionCanonical(canonical, cat);
                        }).filter(Boolean).filter(this._dedup);
                    }
                }
            }
        }
    }

    _processProjectionCanonical(canonical, cat) {
        if (canonical.includes('#') && !canonical.endsWith(' #'))
            return null;
        canonical = canonical.replace(' #', '');

        if (canonical.endsWith(' a') || canonical.endsWith(' an') || canonical.endsWith(' the'))
            canonical = canonical.substring(0, canonical.lastIndexOf(' '));

        if (canonical.split(' ').length > 1 && cat === 'preposition')
            return null;

        return canonical;
    }

    _dedup(value, index, self) {
        return self.indexOf(value) === index;
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
