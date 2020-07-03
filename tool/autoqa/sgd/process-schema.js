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
const fs = require('fs');
const util = require('util');

const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;
const Ast = ThingTalk.Ast;

const { clean } = require('../../../lib/utils');
const StreamUtils = require('../../../lib/stream-utils');
const baseCanonical = require('../lib/base-canonical-generator');
const { PROPERTY_TYPE_OVERRIDE } = require('./manual-annotations');
const { cleanEnumValue }  = require('./utils');

function predictType(slot) {
    if (slot.name in PROPERTY_TYPE_OVERRIDE)
        return PROPERTY_TYPE_OVERRIDE[slot.name];
    if (slot.is_categorical && slot.possible_values.length > 0) {
        if (slot.possible_values.length === 2
            && slot.possible_values.includes('True')
            && slot.possible_values.includes('False'))
            return Type.Boolean;
        if (slot.possible_values.every((v) => !isNaN(v)))
            return Type.Number;
        return Type.Enum(slot.possible_values.map(cleanEnumValue));
    }
    if (slot.name === 'phone_number')
        return Type.Entity('tt:phone_number');
    if (slot.name.startsWith('number_of_') || slot.name.endsWith('_number') || slot.name === 'number' ||
        slot.name.endsWith('_size') || slot.name === 'size' ||
        slot.name.endsWith('_rating') || slot.name === 'rating')
        return Type.Number;
    if (slot.name.endsWith('_time') || slot.name === 'time')
        return Type.Time;
    if (slot.name.endsWith('_date') || slot.name === 'date')
        return Type.Date;
    if (slot.name.endsWith('_location') || slot.name === 'location' ||
        slot.name.endsWith('_address') || slot.name === 'address')
        return Type.Location;
    if (slot.name.endsWith('_fare') || slot.name === 'fare' ||
        slot.name.endsWith('_price') || slot.name === 'price')
        return Type.Currency;

    return Type.String;
}

class SchemaProcessor {
    constructor(args) {
        this._output = args.output;
        this._cache = args.cache_file;
        this._url = args.url;
        this._manual = args.manual;
    }

    async run() {
        let schema;
        if (await util.promisify(fs.exists)(this._cache)) {
            schema = await util.promisify(fs.readFile)(this._cache, { encoding: 'utf8' });
        } else {
            schema = await Tp.Helpers.Http.get(this._url);
            await util.promisify(fs.writeFile)(this._cache, schema);
        }

        let queries = {};
        let actions = {};
        for (let service of JSON.parse(schema)) {
            let slots = {};
            for (let slot of service.slots) {
                let type = predictType(slot);
                slots[slot.name] = {
                    type,
                    annotations: {
                        nl: { canonical: baseCanonical({}, slot.name, type)},
                        impl: { description: new Ast.Value.String(slot.description)}
                    }
                };
                if (type.isNumber && slot.possible_values.length > 0) {
                    let min_number = parseInt(slot.possible_values[0]);
                    let max_number = parseInt(slot.possible_values[slot.possible_values.length - 1]);
                    slots[slot.name].annotations.impl['min_number'] = new Ast.Value.Number(min_number);
                    slots[slot.name].annotations.impl['max_number'] = new Ast.Value.Number(max_number);
                }
            }

            for (let intent of service.intents) {
                let name = service.service_name + '_' + intent.name;

                let functionType = intent.is_transactional ? 'action' : 'query';
                let args = [];
                for (let arg of intent.required_slots) {
                    let type = slots[arg].type;
                    let annotations = slots[arg].annotations;
                    args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.IN_REQ, arg, type, annotations));
                }
                for (let arg of Object.keys(intent.optional_slots)) {
                    let type = slots[arg].type;
                    let annotations = slots[arg].annotations;
                    args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.IN_OPT, arg, type, annotations));
                }
                for (let arg of intent.result_slots) {
                    // results_slots also includes args in required/optional slots, skip them
                    if (intent.required_slots.includes(arg) || Object.keys(intent.optional_slots).includes(arg))
                        continue;
                    let type = slots[arg].type;
                    let annotations = slots[arg].annotations;
                    args.push(new Ast.ArgumentDef(null, Ast.ArgDirection.OUT, arg, type, annotations));
                }

                let functionDef = new Ast.FunctionDef(null, functionType, null, name, null, {
                        is_list: true,
                        is_monitorable: false,
                    }, args, {
                        nl: { canonical: clean(intent.name), confirmation: clean(intent.name) },
                        impl: { description: new Ast.Value.String(intent.description) }
                    });
                if (functionType === 'query')
                    queries[name] = functionDef;
                else
                    actions[name] = functionDef;
            }
        }

        const imports = [
            new Ast.ImportStmt.Mixin(null, ['loader'], 'org.thingpedia.v2', []),
            new Ast.ImportStmt.Mixin(null, ['config'], 'org.thingpedia.config.none', [])
        ];

        const classdef = new Ast.ClassDef(null, 'com.google.sgd', null,
            { imports, queries, actions }, {
                nl: {
                    name: `Google SDG`,
                    description: 'Services in Google schema-guided dialog dataset'
                },
            }, {
                is_abstract: false
            });

        this._output.end(classdef.prettyprint());
        await StreamUtils.waitFinish(this._output);
    }
}


module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('sgd-process-schema', {
            addHelp: true,
            description: "Process a schema JSON definition into a Thingpedia class."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['--cache-file'], {
            required: false,
            defaultValue: './schema.json',
            help: 'Path to a cache file containing the schema definitions.'
        });
        parser.addArgument(['--url'], {
            required: false,
            defaultValue: 'https://raw.githubusercontent.com/google-research-datasets/dstc8-schema-guided-dialogue/master/train/schema.json',
            help: 'The URL to retrieve the schema.'
        });
        parser.addArgument('--manual', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable manual annotations.',
            defaultValue: false
        });
    },

    async execute(args) {
        const schemaProcessor = new SchemaProcessor(args);
        schemaProcessor.run();
    }
};
