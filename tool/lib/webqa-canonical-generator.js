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

const { makeLookupKeys } = require('../../lib/sample-utils');

const ANNOTATED_PROPERTIES = [
    'url', 'name', 'description',
    'geo', 'address.streetAddress', 'address.addressCountry', 'address.addressRegion', 'address.addressLocality'
];

// split the canonical into prefix and suffix
function splitCanonical(canonical) {
    let prefix, suffix;
    if (!canonical.includes('#'))
        [prefix, suffix] = [canonical, ''];
    else if (canonical.includes('#') && !canonical.startsWith('#'))
        [prefix, suffix] = canonical.split('#').map((span) => span.trim());
    else
        [prefix, suffix] = ['', canonical.slice(1).trim()];
    return [prefix, suffix];
}


class CanonicalGenerator {
    constructor(classDef, constants, queries, parameterDatasets, options) {
        this.class = classDef;
        this.constants = constants;
        this.queries = queries;

        this.pruning = options.pruning;
        this.mask = options.mask;
        this.is_paraphraser = options.is_paraphraser;
        this.model = options.model;

        this.parameterDatasets = parameterDatasets;
        this.parameterDatasetPaths = {};

        this.sampleSize = {};
    }


    async generate() {
        await this._loadParameterDatasetPaths();

        const examples = {};
        const paths = {};
        for (let qname of this.queries) {
            examples[qname] = {};
            paths[qname] = { canonical: this.class.queries[qname].canonical, params: {} };
            let query = this.class.queries[qname];
            for (let arg of query.iterateArguments()) {
                if (ANNOTATED_PROPERTIES.includes(arg.name))
                    continue;

                // get the paths to the data
                let p = path.dirname(this.parameterDatasets) + '/'  + this._getDatasetPath(qname, arg);
                if (p && fs.existsSync(p))
                    paths[qname]['params'][`${arg.name}`] = p;

                // some args don't have canonical: e.g., id, name
                if (!arg.metadata.canonical)
                    continue;

                // copy base canonical if npp canonical is missing
                if (arg.metadata.canonical.base && !arg.metadata.canonical.npp)
                    arg.metadata.canonical.npp = [...arg.metadata.canonical.base];

                const samples = this._retrieveSamples(qname, arg);
                if (samples) {
                    this.sampleSize[`${qname}.${arg.name}`] = samples.length;
                    examples[qname][arg.name] = this._generateExamples(query.canonical, arg.metadata.canonical, samples);
                }
            }
        }

        const args = [path.resolve(path.dirname(module.filename), './bert-canonical-generator.py'), 'all'];
        if (this.is_paraphraser)
            args.push('--is-paraphraser');
        args.push('--model-name-or-path');
        args.push(this.model);
        args.push(this.mask ? '--mask' : '--no-mask');

        // call bert to generate candidates
        const child = child_process.spawn(`python3`, args, { stdio: ['pipe', 'pipe', 'inherit'] });

        const stdout = await new Promise((resolve, reject) => {
            child.stdin.write(JSON.stringify( { examples, paths } ));
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

        const { synonyms, adjectives } = JSON.parse(stdout);
        this._updateCanonicals(synonyms, adjectives);
        return this.class;
    }

    async _loadParameterDatasetPaths() {
        const rows = (await (util.promisify(fs.readFile))(this.parameterDatasets, { encoding: 'utf8' })).split('\n');
        for (let row of rows) {
            let [, key, path] = row.split('\t');
            this.parameterDatasetPaths[key] = path;
        }
    }

    _getDatasetPath(qname, arg) {
        const keys = [
            `${this.class.kind}:${qname}_${arg.name}`,
            `${arg.type.isEntity ? arg.type.type : arg.type}`
        ];
        for (let key of keys) {
            if (this.parameterDatasetPaths[key])
                return this.parameterDatasetPaths[key];
        }
        return null;
    }

    _updateCanonicals(candidates, adjectives) {
        for (let qname of this.queries) {
            for (let arg in candidates[qname]) {
                let canonicals = this.class.queries[qname].getArgument(arg).metadata.canonical;
                if (adjectives.includes(`${qname}.${arg}`))
                        canonicals['apv'] = true;

                for (let type in candidates[qname][arg]) {
                    let count = candidates[qname][arg][type].candidates;
                    let max = candidates[qname][arg][type].examples.length;
                    for (let candidate in count) {
                        if (count[candidate] > max * this.pruning) {
                            if (!canonicals[type].includes(candidate))
                                canonicals[type].push(candidate);
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
                if (arg.type.isString)
                    return v.value;
                return v.display;
            });
        }
        return samples;
    }



    _generateExamples(tableName, canonicals, valueSample) {
        let examples = {};
        for (let cat of ['npp', 'avp', 'pvp', 'nni', 'npv', 'apv']) {
            if (cat in canonicals)
                examples[cat] = { examples: [], candidates: [] } ;
        }
        for (let value of valueSample) {
            for (let canonical of canonicals['npp']) {
                let [prefix, suffix] = splitCanonical(canonical);
                let query = `show me ${tableName} with ${prefix} ${value} ${suffix} .`.split(/\s+/g);
                let prefixIndices = prefix ? prefix.split(' ').map((w) => query.indexOf(w)) : [];
                let suffixIndices = suffix ? suffix.split(' ').map((w) => query.indexOf(w)) : [];
                examples['npp']['examples'].push({
                    query: query.join(' '),
                    masks: { prefix: prefixIndices, suffix: suffixIndices }
                });
            }

            if ('avp' in canonicals) {
                for (let canonical of canonicals['avp']) {
                    let [prefix, suffix] = splitCanonical(canonical);
                    let query = `which ${tableName} ${prefix} ${value} ${suffix} ?`.split(/\s+/g);
                    let prefixIndices = prefix ? prefix.split(' ').map((w) => query.indexOf(w)) : [];
                    let suffixIndices = suffix ? suffix.split(' ').map((w) => query.indexOf(w)) : [];
                    examples['avp']['examples'].push({
                        query: query.join(' '),
                        masks: { prefix: prefixIndices, suffix: suffixIndices }
                    });
                }
            }

            if ('pvp' in canonicals) {
                for (let canonical of canonicals['pvp']) {
                    let [prefix, suffix] = splitCanonical(canonical);
                    let query = `show me a ${tableName} ${prefix} ${value} ${suffix} ?`.split(/\s+/g);
                    let prefixIndices = prefix ? prefix.split(' ').map((w) => query.indexOf(w)) : [];
                    let suffixIndices = suffix ? suffix.split(' ').map((w) => query.indexOf(w)) : [];
                    examples['pvp']['examples'].push({
                        query: query.join(' '),
                        masks: { prefix: prefixIndices, suffix: suffixIndices }
                    });
                }
            }

            if ('nni' in canonicals) {
                // TODO
            }

            if ('npv' in canonicals) {
                // TODO
            }

            if ('apv' in canonicals) {
                // TODO
            }

        }
        return examples;
    }
}

module.exports = CanonicalGenerator;
