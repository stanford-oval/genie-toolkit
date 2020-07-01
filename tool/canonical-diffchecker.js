// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');

const util = require('util');
const fs = require('fs');
const assert = require('assert');
const csvstringify = require('csv-stringify');

async function loadSchema(schema) {
    const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(schema, { encoding: 'utf8' }));
    assert(library.isLibrary && library.classes.length === 1);
    return library.classes[0];
}


// find what's new in annotations2 compare to annotations1
function findNew(canonical1, canonical2) {
    const newCanonicals = {};
    for (let ctype in canonical2) {
        if (!(ctype in canonical1)) {
            newCanonicals[ctype] = canonical2[ctype];
        } else {
            if (typeof canonical2[ctype] === 'boolean')
                continue;

            let n = [];
            for (let canonical of canonical2[ctype]) {
                if (!canonical1[ctype].includes(canonical))
                    n.push(canonical);
            }
            if (n.length > 0)
                newCanonicals[ctype] = n;
        }
    }
    return newCanonicals;
}

function normalizeCanonicals(canonicalsByArg) {
    for (let arg in canonicalsByArg) {
        // add missing property canonicals
        if (!canonicalsByArg[arg].property)
            canonicalsByArg[arg].property = canonicalsByArg[arg].base;

        // append '#'
        for (let ctype in canonicalsByArg[arg]) {
            if (Array.isArray(canonicalsByArg[arg][ctype])) {
                canonicalsByArg[arg][ctype] = canonicalsByArg[arg][ctype].map((c) => {
                    if (!c.includes('#') && ctype !== 'base')
                        return c.trim() + ' #';
                    return c.trim();
                });
            }
        }
    }

}

function diffChecker(canonicalsByArg1, canonicalsByArg2) {
    normalizeCanonicals(canonicalsByArg1);
    normalizeCanonicals(canonicalsByArg2);

    const diff = {};
    for (let arg in canonicalsByArg1) {
        diff[arg] = {
            "+": findNew(canonicalsByArg1[arg], canonicalsByArg2[arg]),
            "-": findNew(canonicalsByArg2[arg], canonicalsByArg1[arg])
        };
    }
    return diff;
}

function prettyprintObject(obj) {
    return Object.keys(obj).sort().map((key) => {
        let value = obj[key];
        return `${key}:\n  ${Array.isArray(value)? value.join('\n  ') : value}`;
    }).join('\n');
}

function prettyprintDiff(base, diff) {
    const rows = Object.keys(diff).map((arg) => {
        const columns = [arg];
        columns.push(prettyprintObject(base[arg]));
        columns.push(prettyprintObject(diff[arg]['+']));
        columns.push(prettyprintObject(diff[arg]['-']));
        return columns;
    });
    return csvstringify(rows, { delimiter: '\t' });
}


module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('canonical-diffchecker', {
            addHelp: true,
            description: "Retrieve the labels of properties from wikidata."
        });
        parser.addArgument('schemas', {
            nargs: 2,
            description: "Two schema files to compare."
        });
        parser.addArgument('--queries', {
            required: true,
            nargs: '+',
            description: "The name of queries to check."
        });
    },

    async execute(args) {
        const schemas = await Promise.all(args.schemas.map(loadSchema));
        assert.strictEqual(schemas[0].kind, schemas[1].kind);

        const canonicals = schemas.map((schema) => {
            let canonical = {};
            for (let query of args.queries) {
                for (let arg of schema.queries[query].iterateArguments()) {
                    if (arg.name !== 'id')
                        canonical[arg.name] = arg.metadata.canonical;
                }
            }
            return canonical;
        });

        const base = canonicals[0];
        const diff = diffChecker(...canonicals);
        prettyprintDiff(base, diff).pipe(process.stdout);
    }
};
