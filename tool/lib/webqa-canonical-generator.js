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
const exec = util.promisify(require('child_process').exec);
const { makeLookupKeys } = require('../../lib/sample-utils');

class Example {
    constructor(type, query, masks) {
        this.type = type; // POS-based category
        this.query = query; // command in list form
        this.masks = masks; // array of indices of consecutive canonical tokens
                            // e.g.: 'serves chinese cuisine' -> [[0], [2]]
                            //       'chinese cuisine' -> [[1]]
        this.masked = []; // masked queries
        this._maskQuery();
    }

    _maskQuery() {
        for (let span of this.masks) {
            for (let index of span) {
                let masked = [...this.query];
                masked[index] = '[MASK]';
                this.masked.push(masked.join(' '));
            }
        }
    }
}

class CanonicalGenerator {
    constructor(classDef, constants, queries, pruningOptions) {
        this.class = classDef;
        this.constants = constants;
        this.queries = queries;
        this.pruningOptions = pruningOptions;

        this.sampleSize = {};
    }


    async generate() {
        const examples = {};
        for (let qname of this.queries) {
            examples[qname] = {};
            let query = this.class.queries[qname];
            for (let arg of query.iterateArguments()) {
                // some args don't have canonical: e.g., id, name
                if (!arg.metadata.canonical)
                    continue;

                const samples = this._retrieveSamples(qname, arg);
                if (samples) {
                    this.sampleSize[`${qname}.${arg.name}`] = samples.length;
                    let generated = this._generateExamples(query.canonical, arg.metadata.canonical, samples);
                    examples[qname][arg.name] = generated.map((e) => {
                        return { masked: e.masked, type: e.type, masks: e.masks };
                    });
                }
            }
        }

        console.log(this.sampleSize);

        // dump the examples to a json file for the python script to consume
        fs.writeFileSync('./examples.json', JSON.stringify(examples, null, 2));

        // call bert to generate candidates
        await exec(`python3 ${__dirname}/bert.py`, { maxBuffer: 1024*1024*100 });

        // load exported result from the python script
        const candidates = JSON.parse(fs.readFileSync('./bert-predictions.json'));
        this._updateCanonicals(candidates);
        return this.class;
    }

    _updateCanonicals(candidates) {
        for (let qname of this.queries) {
            let total = {};
            for (let arg in candidates[qname]) {
                total[arg] = { sum: 0 };
                for (let item of candidates[qname][arg]) {
                    if (item.type in total[arg])
                        total[arg][item.type] += 1;
                    else
                        total[arg][item.type] = 1;
                    total[arg].sum += 1;
                }

                let count = {};
                for (let item of candidates[qname][arg]) {
                    let canonicals = this.class.queries[qname].getArgument(arg).metadata.canonical;

                    for (let canonical of item.canonicals) {
                        // only keep canonical uses letters and #
                        if (!(/^[a-zA-Z# ]+$/.test(canonical)))
                            continue;

                        // at most one # is allowed
                        if ((canonical.match(/#/g) || []).length > 1)
                            continue;

                        if (canonical in count)
                            count[canonical] += 1;
                        else
                            count[canonical] = 1;

                        let numOccurrences = count[canonical];
                        let numSamples = this.sampleSize[`${qname}.${arg}`];
                        let numExamplesOfType = total[arg][item.type];
                        let numExamples = total[arg].sum;
                        console.log('**********************')
                        console.log(arg, canonical)
                        if (this._isFrequent(numOccurrences, numSamples, numExamplesOfType, numExamples)) {
                            if (!canonicals[item.type].includes(canonical))
                                canonicals[item.type].push(canonical);
                        }
                    }
                }
            }
        }
    }

    _isFrequent(numOccurrences, numSamples, numExamplesOfType, numExamples) {
        console.log(numOccurrences, numSamples, numExamplesOfType, numExamples);
        console.log(this.pruningOptions.occurrence * numExamplesOfType / numSamples);
        console.log(this.pruningOptions.fraction * numExamples * numExamplesOfType / numSamples);

        // numExamplesOfType / numSamples gives us the num of different template of this type
        // the canonical should at least appear in one template $occurrence times
        // i.e., the canonical appears with different value $occurrence times
        if (numOccurrences < this.pruningOptions.occurrence * numExamplesOfType / numSamples)
            return false;
        else if (numOccurrences < this.pruningOptions.fraction * numExamples * numExamplesOfType / numSamples)
            return false;
        return true;
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
        let examples = [];
        for (let value of valueSample) {
            for (let canonical of canonicals['npp']) {
                let query = `show me ${tableName} with ${value} ${canonical} .`;
                query = query.split(' ');
                let maskIndices = canonical.split(' ').map((w) => query.indexOf(w));
                examples.push(new Example('npp', query, [maskIndices]));
            }

            if ('avp' in canonicals) {
                for (let canonical of canonicals['avp']) {
                    if (canonical.includes('#')) {
                        let [prefix, suffix] = canonical.split('#').map((span) => span.trim());
                        let query = `which ${tableName} ${prefix} ${value} ${suffix} ?`.split(' ');
                        let prefixIndices = prefix.split(' ').map((w) => query.indexOf(w));
                        let suffixIndices = suffix.split(' ').map((w) => query.indexOf(w));
                        examples.push(new Example('avp', query, [prefixIndices, suffixIndices]));
                    } else {
                        let query = `which ${tableName} ${canonical} ${value} ?`.split(' ');
                        let maskedIndices = canonical.split(' ').map((w) => query.indexOf(w));
                        examples.push(new Example('avp', query, [maskedIndices]));
                    }
                }
            }

            if ('pvp' in canonicals) {
                for (let canonical of canonicals['pvp']) {
                    let query, maskedIndices;
                    query = `show me ${tableName} ${canonical} ${value} .`.split(' ');
                    maskedIndices = canonical.split(' ').map((w) => query.indexOf(w));
                    examples.push(new Example('pvp', query, [maskedIndices]));
                    query = `which ${tableName} is ${canonical} ${value}`.split(' ');
                    maskedIndices = canonical.split(' ').map((w) => query.indexOf(w));
                    examples.push(new Example('pvp', query, [maskedIndices]));
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

async function main() {
    const generator = new CanonicalGenerator('restaurant');
    const canonicals = await generator.generate(
        {
            npp: ['cuisine', 'serves cuisine'],
            avp: ['serves', 'serves #cuisine'],
            pvp: ['lalala', 'aaa bbb']
        },
        [`Chinese`, `Italian`, `seafood`, `Mexican`, `Indian`, `dim sum`, `BBQ`]
    );
    console.log(canonicals);
}

if (!module.parent) return main();
