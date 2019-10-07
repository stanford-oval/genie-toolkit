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
const Tp = require('thingpedia');
const qs = require('qs');
const assert = require('assert');
const seedrandom = require('seedrandom');
const POS = require("en-pos");
const Inflectors = require('en-inflectors').Inflectors;
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const { choose } = require('../lib/random');
const { clean } = require('../lib/utils');
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
                valueList.add(value);
            }
        }
    }

    const chosen = choose(Array.from(valueList), 10, rng);
    return chosen.map((c) => String(c));
}

function getEdIng(propertyCanonical) {
    const words = propertyCanonical.split(' ');
    if (words.length > 1)
        return [null, null];

    const inflector = new Inflectors(words[0]);
    return [inflector.toPast(), inflector.toGerund()];
}

function posTag(tokens) {
    return new POS.Tag(tokens)
        .initial() // initial dictionary and pattern based tagging
        .smooth() // further context based smoothing
        .tags;
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

const DO_THE_SEARCH = true;

async function bingSearchSingle(query, cache) {
    if (query in cache)
        return cache[query];

    if (DO_THE_SEARCH) {
        const url = 'https://api.cognitive.microsoft.com/bing/v5.0/search';
        const payload = {'q': '"' + query + '"'};
        const key = process.env.BING_KEY;
        const headers = {'Ocp-Apim-Subscription-Key': key};

        const response = JSON.parse(await Tp.Helpers.Http.get(url + '?' + qs.stringify(payload), {
            extraHeaders: headers
        }));
        return cache[query] = (response.webPages || {}).totalEstimatedMatches || 0;
    } else {
        console.log(`would search for ${query}`);

        return 100000 + Math.random() * 50000;
    }
}

async function bingSearch(query, valueList, cache) {
    let tot = 0;
    for (const value of valueList) {
        assert(typeof value === 'string');
        const newQuery = query.replace('${value}', value); //'

        let result = await bingSearchSingle(newQuery, cache);
        result = result * Math.pow(10, query.split(/\s+/g).length); // length factor

        tot += result;
    }
    console.error(`search ${query}: ${tot}`);
    return tot;
}

const EQUAL_PATTERNS = [
    ['${value} ${table}', (table, propertyName, propertyType) => !propertyType.isNumeric()],
    ['${table} ${value}', (table, propertyName, propertyType) => !propertyType.isNumeric()],
    ['${table} with ${value}', (table, propertyName, propertyType) => !propertyType.isNumeric()],

    ['${table} with ${value} ${property}'],
    ['${table} ${property} ${value}'],
    ['${value} ${property} ${table}'],

    ['${table} ${propEd} ${value}'],
    ['${value} ${propEd} ${table}'],

    ['${table} ${propIng} ${value}'],
    ['${value} ${propIng} ${value}'],

    ['${table} ${propVerb} ${value}'],
    ['${table} with ${value} ${propNoun}'],
    ['${table} ${propVerb} ${value} ${propNoun}'],
    ['${table} ${propNoun} ${table}'],

    ['${table} in ${value}', (table, propertyName, propertyType) => /^address\.?/.test(propertyName)],
    ['${table} in ${value} ${property}', (table, propertyName, propertyType) => /^address\.?/.test(propertyName)],
];

const COMPARATIVE_MORE_PATTERNS = [
    ['${table} with at least ${value} ${property}'],
    ['${table} with more than ${value} ${property}'],

    ['${table} ${propEd} at least ${value}'],
    ['${table} ${propEd} more than ${value}'],

    ['${table} ${propIng} at least ${value}'],
    ['${table} ${propIng} more than ${value}'],
];

const COMPARATIVE_LESS_PATTERNS = [
    ['${table} with at most ${value} ${property}'],
    ['${table} with less than ${value} ${property}'],

    ['${table} ${propEd} at most ${value}'],
    ['${table} ${propEd} less than ${value}'],

    ['${table} ${propIng} at most ${value}'],
    ['${table} ${propIng} less than ${value}'],
];

const THRESHOLD = 10000;

async function applyPatterns(functionDef, argDef, valueList, patternList, operator, dataset, cache) {
    /*if (propertyName === 'name')
        return [['value', 2], ['value_table', 1]];

    if (propertyName === 'geo')
        return [['table_near_value', 2], ['table_around_value', 1]];*/

    const tableCanonical = functionDef.metadata.canonical || clean(functionDef.name);
    const propertyName = argDef.name;
    const propertyType = argDef.type;
    const propertyCanonical = argDef.canonical;

    const patterns = (await Promise.all(patternList.map(async ([pattern, condition]) => {
        if (condition && !condition(functionDef.name, propertyName, propertyType))
            return null;

        pattern = pattern.replace('${table}', tableCanonical);
        pattern = pattern.replace('${property}', propertyCanonical);

        const [propEd, propIng] = getEdIng(propertyCanonical);
        const [propVerb, propNoun] = phraseStartWithVerb(propertyCanonical);

        const variants = { propEd, propIng, propVerb, propNoun };
        for (let variantKey in variants) {
            const variant = variantKey[variants];
            if (variant)
                pattern = pattern.replace('${' + variantKey + '}', variant);
            else if (pattern.indexOf('${' + variantKey + '}') >= 0)
                return null;
        }

        return {
            template: pattern.replace('${value}', '${p_' + propertyName + '}'),
            score: await bingSearch(pattern, valueList, cache)
        };
    }))).filter((pattern) => pattern !== null && pattern.score >= THRESHOLD);

    patterns.sort((p1, p2) => p2.score - p1.score);

    if (patterns.length === 0)
        return;

    const dot = propertyName.lastIndexOf('.');
    const lastProp = propertyName.substring(dot+1);
    dataset.examples.push(new Ast.Example(-1, 'query', { ['p_' + lastProp]: propertyType }, new Ast.Table.Filter(
        new Ast.Table.Invocation(new Ast.Invocation(new Ast.Selector.Device('org.schema', null, null), functionDef.name, [], functionDef), functionDef),
        new Ast.BooleanExpression.Atom(propertyName, operator === '==' && propertyType.isString ? '=~' : operator, Ast.Value.VarRef('p_' + lastProp)), null
    ), patterns.slice(0, 4).map((p) => p.template), [] /* preprocessed */, {}));
}

async function main(args) {
    const table = args.table_name;

    let cache = {};
    try {
        cache = JSON.parse(await util.promisify(fs.readFile)(args.cache, { encoding: 'utf8' }));
    } catch(e) {
        if (e.name !== 'SyntaxError' && e.code !== 'ENOENT')
            throw e;
    }

    const data = JSON.parse(await util.promisify(fs.readFile)(args.data, { encoding: 'utf8' }));
    const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(args.thingpedia, { encoding: 'utf8' }));
    assert(library.isLibrary && library.classes.length === 1 && library.classes[0].kind === 'org.schema');

    const classDef = library.classes[0];
    const queryDef = classDef.queries[table];
    const rng = seedrandom.alea(args.random_seed);
    const dataset = new Ast.Dataset('org.schema.' + table, 'en', [], {});

    const seen = new Set;
    for (const argDef of queryDef.iterateArguments()) {
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

        await applyPatterns(queryDef, argDef, valueList, EQUAL_PATTERNS, '==', dataset, cache);
        if (argDef.type.isNumeric()) {
            await applyPatterns(queryDef, argDef, valueList, COMPARATIVE_MORE_PATTERNS, '>=', dataset, cache);
            await applyPatterns(queryDef, argDef, valueList, COMPARATIVE_LESS_PATTERNS, '<=', dataset, cache);
        }
    }

    await util.promisify(fs.writeFile)(args.cache, JSON.stringify(cache), { encoding: 'utf8' });

    args.output.end(dataset.prettyprint());
    await StreamUtils.waitFinish(args.output);
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
        parser.addArgument('--random-seed', {
            defaultValue: 'almond is awesome',
            help: 'Random seed'
        });
    },

    execute: main,
};
