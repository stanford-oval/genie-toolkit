// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const fs = require('fs');
const util = require('util');

const StreamUtils = require('../lib/stream-utils');

const DEFAULT_ENTITIES = [
    {"type":"tt:contact","name":"Contact Identity","is_well_known":1,"has_ner_support":0},
    {"type":"tt:contact_name","name":"Contact Name","is_well_known":1,"has_ner_support":0},
    {"type":"tt:device","name":"Device Name","is_well_known":1,"has_ner_support":0},
    {"type":"tt:email_address","name":"Email Address","is_well_known":1,"has_ner_support":0},
    {"type":"tt:flow_token","name":"Flow Identifier","is_well_known":1,"has_ner_support":0},
    {"type":"tt:function","name":"Function Name","is_well_known":1,"has_ner_support":0},
    {"type":"tt:hashtag","name":"Hashtag","is_well_known":1,"has_ner_support":0},
    {"type":"tt:path_name","name":"Unix Path","is_well_known":1,"has_ner_support":0},
    {"type":"tt:phone_number","name":"Phone Number","is_well_known":1,"has_ner_support":0},
    {"type":"tt:picture","name":"Picture","is_well_known":1,"has_ner_support":0},
    {"type":"tt:program","name":"Program","is_well_known":1,"has_ner_support":0},
    {"type":"tt:url","name":"URL","is_well_known":1,"has_ner_support":0},
    {"type":"tt:username","name":"Username","is_well_known":1,"has_ner_support":0}
];


async function loadClassDef(thingpedia) {
    const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }));
    assert(library.isLibrary && library.classes.length === 1 && library.classes[0].kind.startsWith('org.schema'));
    return library.classes[0];
}

function titleCase(str) {
    return str.split(' ').map((word) => word[0].toUpperCase() + word.substring(1)).join(' ');
}

class SchemaTrimmer {
    constructor(classDef, data, entities) {
        this._classDef = classDef;
        this._className = classDef.name;
        this._data = data;
        this._entities = entities;
    }

    get class() {
        return this._classDef;
    }

    trim() {
        for (let tablename in this._classDef.queries)
            this._maybeMarkTableWithData(tablename);

        for (let tablename in this._classDef.queries)
            this._removeArgumentsWithoutData(tablename);
    }

    _markHasData(annotations) {
        if (!annotations.org_schema_has_data)
            annotations.org_schema_has_data = new Ast.Value.Boolean(true);
    }

    _markTableHasData(tabledef) {
        this._markHasData(tabledef.annotations);
        this._markHasData(tabledef.getArgument('id').annotations);

        // if a table has data, then recursively all parents have data (= they should be included)
        for (let _extend of tabledef.extends)
            this._markTableHasData(tabledef.class.queries[_extend]);
    }

    _markTableHasName(tabledef) {
        if (!tabledef.annotations.org_schema_has_name)
            tabledef.annotations.org_schema_has_name = new Ast.Value.Boolean(true);

        // if a table has data, then recursively all parents have data (= they should be included)
        for (let _extend of tabledef.extends)
            this._markTableHasName(tabledef.class.queries[_extend]);
    }

    _markArgumentHasData(arg, value) {
        if (value === null || value === undefined ||
            (Array.isArray(value) && value.length === 0))
            return false;

        if (Array.isArray(value)) {
            for (let elem of value) {
                if (this._markArgumentHasData(arg, elem))
                    return true;
            }
            return false;
        }

        let type = arg.type;
        while (type.isArray)
            type = type.elem;

        if (type.isCompound) {
            let hasAny = false;
            for (let fieldname in type.fields) {
                if (this._markArgumentHasData(type.fields[fieldname], value[fieldname]))
                    hasAny = true;
            }
            if (hasAny) {
                this._markHasData(arg.annotations);
                return true;
            } else {
                return false;
            }
        } else {
            this._markHasData(arg.annotations);
            return true;
        }
    }

    _markObjectHasData(tabledef, obj) {
        for (let key in obj) {
            if (key === '@id' || key === '@type' || key === '@context')
                continue;
            if (key === 'name' && obj[key] && obj[key].length)
                this._markTableHasName(tabledef);

            const arg = tabledef.getArgument(key);
            if (!arg)
                throw new Error(`Unexpected field ${key} in ${tabledef.name}, data is not normalized`);
            this._markArgumentHasData(arg, obj[key]);
        }
    }

    _maybeMarkTableWithData(tablename) {
        let tabledef = this._classDef.queries[tablename];
        const data = this._data[tabledef.name];

        for (let objId in data) {
            // if we enter the loop, we have at least one element of this table
            this._markTableHasData(tabledef);

            const obj = data[objId];
            this._markObjectHasData(tabledef, obj);
        }
    }

    _removeFieldsWithoutData(arg) {
        let type = arg.type;
        while (type.isArray)
            type = type.elem;

        if (!type.isCompound)
            return;

        for (let fieldname in type.fields) {
            const field = type.fields[fieldname];
            if (!field.annotations['org_schema_has_data'] || !field.annotations['org_schema_has_data'].value) {
                delete type.fields[fieldname];
                continue;
            }

            this._removeFieldsWithoutData(field);
        }
    }

    _removeArgumentsWithoutData(tablename) {
        let tabledef = this._classDef.queries[tablename];
        if (!tabledef.annotations['org_schema_has_data'] || !tabledef.annotations['org_schema_has_data'].value) {
            this._entities.push({
                type: this._className + ':' + tablename,
                name: titleCase(tabledef.canonical),
                is_well_known: false,
                has_ner_support: false
            });
            delete this._classDef.queries[tablename];
            return;
        }

        this._entities.push({
            type: this._className + ':' + tablename,
            name: titleCase(tabledef.canonical),
            is_well_known: false,
            has_ner_support: tabledef.annotations['org_schema_has_name'] && tabledef.annotations['org_schema_has_name'].value
        });

        let newArgs = [];
        let hasAddress = false;
        let hasGeo = false;
        for (let argname of tabledef.args) {
            if (argname.indexOf('.') >= 0)
                continue;
            const arg = tabledef.getArgument(argname);
            if (!(arg.annotations['org_schema_has_data'] && arg.annotations['org_schema_has_data'].value))
                continue;

            this._removeFieldsWithoutData(arg);
            newArgs.push(arg);

            if (argname === 'address')
                hasAddress = arg;
            if (argname === 'geo')
                hasGeo = arg;
        }

        if (tabledef.args.includes('geo') && hasAddress && !hasGeo) {
            newArgs.push(new Ast.ArgumentDef(null, 'out', 'geo', Type.Location, {
                nl: {
                    canonical: { default:"npp", npp:["location", "address"] }
                },
                impl: {
                    org_schema_type: new Ast.Value.String('GeoCoordinates'),
                    org_schema_has_data: new Ast.Value.Boolean(false)
                }
            }));
        }

        this._classDef.queries[tablename] = new Ast.FunctionDef(null, 'query', this._classDef,
            tablename, tabledef.extends, tabledef._qualifiers, newArgs, {
                nl: tabledef.metadata,
                impl: tabledef.annotations,
            });
    }

}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('webqa-trim-class', {
            addHelp: true,
            description: "Reduce a WebQA class file to the subset of fields that have data."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['--entities'], {
            required: true,
            help: 'Where to store the generated entities.json file',
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--data', {
            required: true,
            help: 'Path to JSON file with normalized WebQA data.'
        });

        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
            defaultValue: true
        });
        parser.addArgument('--no-debug', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'debug',
            help: 'Disable debugging.',
        });
    },

    async execute(args) {
        const classDef = await loadClassDef(args.thingpedia);
        const data = JSON.parse(await util.promisify(fs.readFile)(args.data, { encoding: 'utf8' }));
        const entities = DEFAULT_ENTITIES.slice();

        const trimmer = new SchemaTrimmer(classDef, data, entities);
        trimmer.trim();

        args.output.end(trimmer.class.prettyprint());
        await StreamUtils.waitFinish(args.output);
        await util.promisify(fs.writeFile)(args.entities, JSON.stringify({
            result: 'ok',
            data: entities
        }, undefined, 2));
    }
};
