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
const fs = require('fs');
const util = require('util');

const StreamUtils = require('../lib/stream-utils');

async function loadClassDef(thingpedia) {
    const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }));
    assert(library.isLibrary && library.classes.length === 1 && library.classes[0].kind === 'org.schema');
    return library.classes[0];
}

function markHasData(annotations) {
    if (!annotations.org_schema_has_data)
        annotations.org_schema_has_data = new Ast.Value.Boolean(true);
}

function markTableHasData(tabledef) {
    markHasData(tabledef.annotations);
    markHasData(tabledef.getArgument('id').annotations);

    // if a table has data, then recursively all parents have data (= they should be included)
    for (let _extend of tabledef.extends)
        markTableHasData(tabledef.class.queries[_extend]);
}

function markArgumentHasData(arg, value) {
    if (value === null || value === undefined ||
        (Array.isArray(value) && value.length === 0))
        return false;

    if (Array.isArray(value)) {
        for (let elem of value) {
            if (markArgumentHasData(arg, elem))
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
            if (markArgumentHasData(type.fields[fieldname], value[fieldname]))
                hasAny = true;
        }
        if (hasAny) {
            markHasData(arg.annotations);
            return true;
        } else {
            return false;
        }
    } else {
        markHasData(arg.annotations);
        return true;
    }
}

function markObjectHasData(tabledef, obj) {
    for (let key in obj) {
        if (key === '@id' || key === '@type' || key === '@context')
            continue;

        const arg = tabledef.getArgument(key);
        if (!arg)
            throw new Error(`Unexpected field ${key} in ${tabledef.name}, data is not normalized`);
        markArgumentHasData(arg, obj[key]);
    }
}

function maybeMarkTableWithData(tabledef, alldata) {
    const data = alldata[tabledef.name];

    for (let objId in data) {
        // if we enter the loop, we have at least one element of this table
        markTableHasData(tabledef);

        const obj = data[objId];
        markObjectHasData(tabledef, obj);
    }
}

function removeFieldsWithoutData(arg) {
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

        removeFieldsWithoutData(field);
    }
}

function removeArgumentsWithoutData(classDef, tablename) {
    let tabledef = classDef.queries[tablename];
    if (!tabledef.annotations['org_schema_has_data'] || !tabledef.annotations['org_schema_has_data'].value) {
        delete classDef.queries[tablename];
        return;
    }

    let newArgs = [];
    for (let argname of tabledef.args) {
        if (argname.indexOf('.') >= 0)
            continue;
        const arg = tabledef.getArgument(argname);
        if (!arg.annotations['org_schema_has_data'] || !arg.annotations['org_schema_has_data'].value)
            continue;

        removeFieldsWithoutData(arg);
        newArgs.push(arg);
    }

    classDef.queries[tablename] = new Ast.FunctionDef('query', tablename, tabledef.extends, newArgs, tabledef.is_list, tabledef.is_monitorable,
        tabledef.metadata, tabledef.annotations, classDef);
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

        for (let tablename in classDef.queries)
            maybeMarkTableWithData(classDef.queries[tablename], data);

        for (let tablename in classDef.queries)
            removeArgumentsWithoutData(classDef, tablename);

        args.output.end(classDef.prettyprint());
        await StreamUtils.waitFinish(args.output);
    }
};
