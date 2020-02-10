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

let count = 0;

class Example {
    constructor(type, query, masks) {
        this.id = count;
        this.type = type; // POS-based category
        this.query = query; // command in list form
        this.masks = masks; // array of indices of consecutive canonical tokens
                            // e.g.: 'serves chinese cuisine' -> [[0], [2]]
                            //       'chinese cuisine' -> [[1]]
        this.masked = []; // masked queries
        this._maskQuery();
        count ++;
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

function dumpExamples(examples) {
    fs.writeFileSync(
        './examples.json',
        JSON.stringify(examples.map((e) => {
            return { id: e.id, masked: e.masked, type: e.type, masks: e.masks };
        }), null, 2)
    );
}

function loadPredictions() {
    const predictions = fs.readFileSync('./bert-predictions.json');
    return JSON.parse(predictions);
}

class CanonicalGenerator {
    constructor(className) {
        this.className = className;
    }

    async generate(canonicals, valueSample) {
        if (typeof canonicals === 'string')
            canonicals = { default: 'npp', npp: [canonicals] };
        const examples = this._generateExamples(canonicals, valueSample);
        dumpExamples(examples);
        await exec('/home/silei/.virtualenvs/python36/bin/python ./tool/lib/bert.py', { maxBuffer: 1024*1024*100 });
        const generated = loadPredictions();

        for (let c of generated)
            canonicals[c.type] = canonicals[c.type].concat(c.canonicals);

        // deduplicate
        for (let type in canonicals) {
            if (Array.isArray(canonicals[type]))
                canonicals[type] = [...new Set(canonicals[type])];
        }
        return canonicals;
    }

    _generateExamples(canonicals, valueSample) {
        let examples = [];
        for (let value of valueSample) {
            for (let canonical of canonicals['npp']) {
                let query = `show me ${this.className} with ${value} ${canonical} .`;
                query = query.split(' ');
                let maskIndices = canonical.split(' ').map((w) => query.indexOf(w));
                examples.push(new Example('npp', query, [maskIndices]));
            }

            if ('avp' in canonicals) {
                for (let canonical of canonicals['avp']) {
                    if (canonical.includes('#')) {
                        let [prefix, suffix] = canonical.split('#').map((span) => span.trim());
                        let query = `which ${this.className} ${prefix} ${value} ${suffix} ?`.split(' ');
                        let prefixIndices = prefix.split(' ').map((w) => query.indexOf(w));
                        let suffixIndices = suffix.split(' ').map((w) => query.indexOf(w));
                        examples.push(new Example('avp', query, [prefixIndices, suffixIndices]));
                    } else {
                        let query = `which ${this.className} ${canonical} ${value} ?`.split(' ');
                        let maskedIndices = canonical.split(' ').map((w) => query.indexOf(w));
                        examples.push(new Example('avp', query, [maskedIndices]));
                    }
                }
            }

            if ('pvp' in canonicals) {
                for (let canonical of canonicals['pvp']) {
                    let query, maskedIndices;
                    query = `show me ${this.className} ${canonical} ${value} .`.split(' ');
                    maskedIndices = canonical.split(' ').map((w) => query.indexOf(w));
                    examples.push(new Example('pvp', query, [maskedIndices]));
                    query = `which ${this.className} is ${canonical} ${value}`.split(' ');
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
