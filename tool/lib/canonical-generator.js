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
const stemmer = require('stemmer');
const Inflectors = require('en-inflectors').Inflectors;
const child_process = require('child_process');
const utils = require('../../lib/utils');

const CanonicalExtractor = require('./canonical-extractor');
const { makeLookupKeys } = require('../../lib/sample-utils');
const { PROPERTY_CANONICAL_OVERRIDE } = require('../autoqa/manual-annotations');
const { posTag } = require('../../lib/i18n/american-english');

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

class AutoCanonicalGenerator {
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
        this.paraphraser_model = options.paraphraser_model;

        this.parameterDatasets = parameterDatasets;
        this.parameterDatasetPaths = {};

        this.options = options;

        if (['all', 'bert', 'no-adj', 'no-bart'].includes(this.algorithm))
            this.bert = true;
        if (['all', 'bart', 'no-adj', 'no-bert'].includes(this.algorithm))
            this.bart = true;
        if (['all', 'adj', 'no-bert', 'no-bart'].includes(this.algorithm))
            this.adj = true;
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

                if (ANNOTATED_PROPERTIES.includes(arg.name) || arg.name === 'id')
                    continue;

                // TODO: bert on counted object only for these args
                if (arg.metadata.counted_object)
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

                // remove query name in arg name, normally it's repetitive
                for (let type in arg.metadata.canonical) {
                    if (Array.isArray(arg.metadata.canonical[type])) {
                        arg.metadata.canonical[type] = arg.metadata.canonical[type].map((c) => {
                            if (c.startsWith(qname.toLowerCase() + ' '))
                                return c.slice(qname.toLowerCase().length + 1);
                            return c;
                        });
                    }
                }

                // copy base canonical if property canonical is missing
                if (arg.metadata.canonical.base && !arg.metadata.canonical.property)
                    arg.metadata.canonical.property = [...arg.metadata.canonical.base];

                let typestr = typeToEntityType(query.getArgType(arg.name));

                if (typestr && typeCounts[typestr] === 1) {
                    // if an entity is unique, allow dropping the property name entirely
                    if (!this.queries.includes(typestr.substring(typestr.indexOf(':') + 1)))
                        arg.metadata.canonical.property.push('#');

                    // if it's the only people entity, adding adjective form
                    // E.g., author for review - bob's review
                    //       byArtist for MusicRecording - bob's song
                    if (typestr.endsWith(':Person'))
                        arg.metadata.canonical.adjective = ["# 's", '#'];
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

        if (this.algorithm !== 'heuristics-only') {
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
            if (this.options.debug)
                await output(`./bert-canonical-annotator-in.json`, JSON.stringify(queries, null, 2));

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
                await output(`./bert-canonical-annotator-out.json`, JSON.stringify(JSON.parse(stdout), null, 2));

            const {synonyms, adjectives } = JSON.parse(stdout);
            if (this.bert || this.adj)
                this._updateCanonicals(synonyms, adjectives);
            if (this.bart) {
                const extractor = new CanonicalExtractor(this.class, this.queries, this.paraphraser_model, this.options);
                await extractor.run(synonyms, queries);
            }
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
            let [, key, path] = row.split('\t');
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

                if (this.adj && adjectives.includes(`${qname}.${arg}`))
                    canonicals['adjective'] = ['#'];

                if (this.bert) {
                    for (let type in candidates[qname][arg]) {
                        for (let candidate in candidates[qname][arg][type]) {
                            if (this._hasConflict(qname, arg, type, candidate))
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

    _isVerb(candidate) {
        if (candidate === 'is' || candidate === 'are')
            return false;

        return ['VBP', 'VBZ', 'VBD'].includes(posTag([candidate])[0]);
    }

    _hasConflict(query, currentArg, currentPos, currentCanonical) {
        currentArg = this.class.queries[query].getArgument(currentArg);
        const currentStringset = currentArg.getImplementationAnnotation('string_values');
        for (let arg of this.class.queries[query].iterateArguments()) {
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
