// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Jian Li <jianli19@cs.stanford.edu>
//         Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const fs = require('fs');
const util = require('util');
//const Tp = require('thingpedia');
//const qs = require('qs');
const child_process = require('child_process');
const path = require('path');
const assert = require('assert');
const seedrandom = require('seedrandom');
const POS = require("en-pos");
const Inflectors = require('en-inflectors').Inflectors;
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const BinaryPPDB = require('../lib/binary_ppdb');
const { choose } = require('../lib/random');
const { clean, posTag } = require('../lib/utils');
const StreamUtils = require('../lib/stream-utils');
//const Tokenizer = require('../lib/tokenizer');

function* get(obj, propertyList, offset) {
    if (offset === propertyList.length) {
        yield obj;
        return;
    }

    const prop = propertyList[offset];
    if (!obj[prop])
        return;

    if (Array.isArray(obj[prop])) {
        for (let elem of obj[prop])
            yield* get(elem, propertyList, offset+1);
    } else {
        yield* get(obj[prop], propertyList, offset+1);
    }
}

function sample(table, data, propertyChain, propertyType, rng) {
    const valueList = new Set;
    if (propertyChain === 'id') {
        propertyChain = 'name';
        propertyType = ThingTalk.Type.String;
    }

    const propertyList = propertyChain.split(/\./g);
    const isEntity = propertyType.isEntity && propertyType.type.startsWith('org.schema:');
    const entityType = isEntity ? propertyType.type.split(':')[1] : null;

    for (const itemId in data[table]) {
        const item = data[table][itemId];

        for (const value of get(item, propertyList, 0)) {
            if (isEntity) {
                if (data[entityType][value] && data[entityType][value].name)
                    valueList.add(data[entityType][value].name);
            } else if (value) {
                if (typeof value === 'string' && value.startsWith('http'))
                    continue;
                if (propertyType.isString)
                    valueList.add(value.split(' ').slice(0, 4).join(' '));
                else
                    valueList.add(value);
            }
        }
    }

    const chosen = choose(Array.from(valueList), 10, rng);
    return chosen.map((c) => String(c));
}

function toPlural(word) {
    const inflector = new Inflectors(word);
    const plural = inflector.toPlural();
    return plural;
}

function getPlural(propertyCanonical) {
    const words = propertyCanonical.split(' ');
    if (words.length !== 2 || words[1] !== 'count')
        return null;

    return toPlural(words[0]);
}

function getEdIng(propertyCanonical) {
    const words = propertyCanonical.split(' ');
    if (words.length > 1)
        return [null, null];

    const inflector = new Inflectors(words[0]);
    return [inflector.toPast(), inflector.toGerund()];
}

function phraseStartWithVerb(propertyCanonical) {
    const tokens = propertyCanonical.split(' ');
    const tags = posTag(tokens);

    if (tokens.length < 2) // not a phrase
        return [null, null];

    /*if (!tags[0].startsWith('NN') && !tags[0].startsWith('VB')) {
        console.error(`${propertyCanonical} has POS ${tags.join(' ')}`);
        return [null, null];
    }*/

    if (!tags[0].startsWith('VB')) {
        // does not start with a verb
        //console.error(tokens, tags);
        return [null, null];
    }

    const propVerb = tokens[0];
    const propNoun = tokens.slice(1).join(' ');
    //console.error(`propVerb: ${propVerb}`);
    //console.error(`propNoun: ${propNoun}`);

    return [propVerb, propNoun];
}

async function gptQuery(query, valueList, cache) {
    if (query in cache)
        return cache[query];

    const child = child_process.spawn('python3',
        [path.resolve(path.dirname(module.filename), '../scripts/score_sentence.py')],
        { stdio: ['pipe', 'pipe', 'inherit'] });

    const stdout = await new Promise((resolve, reject) => {
        for (let value of valueList)
            child.stdin.write(query.replace('${value}', value) + '\n');
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

    let tot = stdout.trim().split('\n').map((line) => parseFloat(line)).reduce((x, y) => x + y, 0);
    tot /= valueList.length;
    cache[query] = tot;
    console.error(`search ${query}: ${tot}`);
    return tot;
}

const EQUAL_PATTERNS = [
    ['${value} ${table}', (table, propertyName, propertyType) => !propertyType.isNumeric()],
    ['${table} ${value}', (table, propertyName, propertyType) => !propertyType.isNumeric()],
    ['${table} with ${value}', (table, propertyName, propertyType) => !propertyType.isNumeric()],

    ['${table} with ${value} ${property}'],
    ['${table} that ${property} ${value}'],
    ['${value} that ${property} ${table}'],

    ['${table} ${propEd} ${value}'],
    ['${value} ${propEd} ${table}'],

    ['${table} ${propIng} ${value}'],
    ['${value} ${propIng} ${table}'],
    ['${table} containing ${value}'],
    ['${value} in ${table}'],

    ['${table} that ${propVerb} ${value}'],
    ['${table} with ${value} ${propNoun}'],
    ['${table} with ${value} ${propPlural}'],
    ['${table} that ${propVerb} ${value} ${propNoun}'],
    ['${table} ${propNoun} ${value}'],

    ['${table} in ${value}', (table, propertyName, propertyType) => /^address\.?/.test(propertyName)],
    ['${table} in ${value} ${property}', (table, propertyName, propertyType) => /^address\.?/.test(propertyName)],
];

const COMPARATIVE_MORE_PATTERNS = [
    ['${table} with at least ${value} ${property}'],
    ['${table} with more than ${value} ${property}'],
    ['${table} with more than ${value} ${propPlural}'],

    ['${table} ${propEd} at least ${value}'],
    ['${table} ${propEd} more than ${value}'],

    ['${table} ${propIng} at least ${value}'],
    ['${table} ${propIng} more than ${value}'],
];

const COMPARATIVE_LESS_PATTERNS = [
    ['${table} with at most ${value} ${property}'],
    ['${table} with less than ${value} ${property}'],
    ['${table} with less than ${value} ${propPlural}'],

    ['${table} ${propEd} at most ${value}'],
    ['${table} ${propEd} less than ${value}'],

    ['${table} ${propIng} at most ${value}'],
    ['${table} ${propIng} less than ${value}'],
];

function getPPDBCandidates(ppdb, canonicals) {
    if (!ppdb)
        return Array.from(canonicals);

    const output = [...canonicals];

    for (let canonical of canonicals) {
        const words = canonical.split(' ');

        for (let i = 0; i < words.length; i++) {
            for (let j = i+1; j <= words.length; j++) {
                const span = words.slice(i, j).join(' ');
                const paraphrases = ppdb.get(span);
                console.error(`ppdb ${span}:`, paraphrases);
                if (paraphrases) {
                    for (let paraphrase of paraphrases)
                        output.push([...words.slice(0, i), paraphrase, ...words.slice(j)].join(' '));
                }
            }
        }
    }

    return output;
}

function *getAllCanonicals(argDef) {
    if (!argDef.metadata.canonical) {
        yield argDef.canonical;
        return;
    }
    if (typeof argDef.metadata.canonical === 'string') {
        yield argDef.canonical;
        return;
    }

    for (const pos in argDef.metadata.canonical) {
        if (pos === 'default')
            continue;
        if (typeof argDef.metadata.canonical[pos] === 'boolean')
            continue;

        if (typeof argDef.metadata.canonical[pos] === 'string')
            yield argDef.metadata.canonical[pos].replace(/#/g, '').replace(/_/g, ' ');
        else
            yield* (argDef.metadata.canonical[pos].map((str) => str.replace(/#/g, '').replace(/_/g, ' ')));
    }
}

const THRESHOLD = 100;

async function applyPatterns(className, ppdb, functionDef, argDef, valueList, patternList, operator, dataset, cache) {
    /*if (propertyName === 'name')
        return [['value', 2], ['value_table', 1]];

    if (propertyName === 'geo')
        return [['table_near_value', 2], ['table_around_value', 1]];*/

    const tableCanonicals = getPPDBCandidates(ppdb, [functionDef.canonical || clean(functionDef.name)]).map(toPlural);
    const propertyName = argDef.name;
    const propertyType = argDef.type;
    const propertyCanonicals = getPPDBCandidates(ppdb, getAllCanonicals(argDef));

    // special properties we don't want to handle
    if (propertyName === 'name' || propertyName === 'geo' || /^address\.?/.test(propertyName))
        return;

    const dot = propertyName.lastIndexOf('.');
    const lastProp = propertyName.substring(dot+1);

    const patterns = [];
    for (let [pattern, condition] of patternList) {
        if (condition && !condition(functionDef.name, propertyName, propertyType))
            continue;

        for (let tableCanonical of tableCanonicals) {
            for (let propertyCanonical of propertyCanonicals) {
                let searchQuery = pattern;

                searchQuery = searchQuery.replace('${table}', tableCanonical);
                searchQuery = searchQuery.replace('${property}', propertyCanonical);

                const propPlural = getPlural(propertyCanonical);
                const [propEd, propIng] = getEdIng(propertyCanonical);
                const [propVerb, propNoun] = phraseStartWithVerb(propertyCanonical);

                const variants = { propEd, propIng, propVerb, propNoun, propPlural };

                let ok = true;
                for (let variantKey in variants) {
                    const variant = variants[variantKey];
                    if (variant) {
                        searchQuery = searchQuery.replace('${' + variantKey + '}', variant);
                    } else if (searchQuery.indexOf('${' + variantKey + '}') >= 0) {
                        //console.log('missing ' + variantKey + ' for ' + propertyCanonical);
                        ok = false;
                        break;
                    }
                }
                if (!ok)
                    continue;

                const score = await gptQuery(searchQuery, valueList, cache);
                if (score > THRESHOLD)
                    continue;

                patterns.push({
                    template: searchQuery.replace('${value}', '${p_' + lastProp + '}').replace(/ +/g, ' '),
                    score
                });
            }
        }
    }

    if (patterns.length === 0)
        return;

    patterns.sort((p1, p2) => p1.score - p2.score);

    dataset.examples.push(new Ast.Example(null, -1, 'query', { ['p_' + lastProp]: propertyType },
        new Ast.Table.Filter(null,
            new Ast.Table.Invocation(null,
                new Ast.Invocation(null, new Ast.Selector.Device(null, className, null, null), functionDef.name, [], functionDef),
            functionDef),
        new Ast.BooleanExpression.Atom(null, propertyName, operator === '==' && propertyType.isString ? '=~' : operator, new Ast.Value.VarRef('p_' + lastProp)), null
    ), patterns.slice(0, 4).map((p) => p.template), patterns.slice(0, 4).map((p) => p.template), {}));
}

async function main(args) {
    let cache = {};
    try {
        cache = JSON.parse(await util.promisify(fs.readFile)(args.cache, { encoding: 'utf8' }));
    } catch(e) {
        if (e.name !== 'SyntaxError' && e.code !== 'ENOENT')
            throw e;
    }

    try {
        const data = JSON.parse(await util.promisify(fs.readFile)(args.data, { encoding: 'utf8' }));
        const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(args.thingpedia, { encoding: 'utf8' }));
        assert(library.isLibrary && library.classes.length === 1 && library.classes[0].kind.startsWith('org.schema'));

        const rng = seedrandom.alea(args.random_seed);
        const className = args.class_name ? 'org.schema.' + args.class_name : 'org.schema';
        const dataset = new Ast.Dataset(null, '@' + className, 'en', [], {});

        const tables = args.table_name;
        for (let table of tables)
            await processTable(className, data, library, dataset, table, args, rng, cache);

        args.output.end(dataset.prettyprint());
        await StreamUtils.waitFinish(args.output);
    } finally {
        await util.promisify(fs.writeFile)(args.cache, JSON.stringify(cache, undefined, 2), { encoding: 'utf8' });
    }
}

async function processTable(className, data, library, dataset, table, args, rng, cache) {
    const classDef = library.classes[0];
    const queryDef = classDef.queries[table];
    const ppdb = args.ppdb ? await BinaryPPDB.mapFile(args.ppdb) : null;

    const seen = new Set;
    for (const argDef of queryDef.iterateArguments()) {
        if (argDef.name === 'id')
            continue;
        if (argDef.name === 'name')
            continue;
        if (argDef.type.isCompound)
            continue;
        if (seen.has(argDef.name))
            continue;
        seen.add(argDef.name);
        const valueList = sample(table, data, argDef.name, argDef.type, rng);
        if (valueList.length === 0)
            continue;

        await applyPatterns(className, ppdb, queryDef, argDef, valueList, EQUAL_PATTERNS, '==', dataset, cache);
        if (argDef.type.isNumeric()) {
            await applyPatterns(className, ppdb, queryDef, argDef, valueList, COMPARATIVE_MORE_PATTERNS, '>=', dataset, cache);
            await applyPatterns(className, ppdb, queryDef, argDef, valueList, COMPARATIVE_LESS_PATTERNS, '<=', dataset, cache);
        }
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('webqa-auto-primitive', {
            addHelp: true,
            description: "Automatically generate primitive templates for schema.org classes based on Bing search results."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--table-name', {
            required: true,
            action: 'append',
            defaultValue: [],
            help: 'Name of the schema.org table to generate primitive templates for.'
        });
        parser.addArgument('--data', {
            required: true,
            help: 'Path to JSON file with normalized schema.org data.'
        });
        parser.addArgument('--cache', {
            required: false,
            defaultValue: './auto-primitive-cache.json',
            help: 'Cache results of Bing search in this file.'
        });
        parser.addArgument('--ppdb', {
            required: false,
            help: 'Path to the compiled binary PPDB file',
        });
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
        parser.addArgument('--class-name', {
            required: false,
            help: 'The name of the generated class, this will also affect the entity names'
        });
    },

    execute: main,
};
