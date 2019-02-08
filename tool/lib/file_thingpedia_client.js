// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const fs = require('fs');
const util = require('util');

// Parse the semi-obsolete JSON format for schemas used
// by Thingpedia into a FunctionDef
function makeSchemaFunctionDef(functionType, functionName, schema, isMeta) {
    const args = [];
    // compat with Thingpedia API quirks
    const types = schema.types || schema.schema;

    types.forEach((type, i) => {
        type = Type.fromString(type);
        const argname = schema.args[i];
        const argrequired = !!schema.required[i];
        const arginput = !!schema.is_input[i];

        let direction;
        if (argrequired)
            direction = Ast.ArgDirection.IN_REQ;
        else if (arginput)
            direction = Ast.ArgDirection.IN_OPT;
        else
            direction = Ast.ArgDirection.OUT;
        const metadata = {};
        if (isMeta) {
            metadata.prompt = schema.questions[i] || '';
            metadata.canonical = schema.argcanonicals[i] || argname;
        }
        const annotations = {};
        if (isMeta && schema.string_values[i])
            annotations.string_values = Ast.Value.String(schema.string_values[i]);

        args.push(new Ast.ArgumentDef(direction, argname,
            type, metadata, annotations));
    });

    const metadata = {};
    if (isMeta) {
        metadata.canonical = schema.canonical || '';
        metadata.confirmation = schema.confirmation || '';
    }
    const annotations = {};

    return new Ast.FunctionDef(functionType,
                               functionName,
                               args,
                               schema.is_list,
                               schema.is_monitorable,
                               metadata,
                               annotations);
}

function makeSchemaClassDef(kind, schema, isMeta) {
    const queries = {};
    for (let name in schema.queries)
        queries[name] = makeSchemaFunctionDef('query', name, schema.queries[name], isMeta);
    const actions = {};
    for (let name in schema.actions)
        actions[name] = makeSchemaFunctionDef('action', name, schema.actions[name], isMeta);

    const imports = [];
    const metadata = {};
    const annotations = {};
    return new Ast.ClassDef(kind, null, queries, actions,
                            imports, metadata, annotations);
}

module.exports = class FileThingpediaClient {
    constructor(locale, thingpediafilename, datasetfilename) {
        this._locale = locale;
        this._schema = {};
        this._meta = {};
        this._entities = {};

        this._thingpediafilename = thingpediafilename;
        this._datasetfilename = datasetfilename;
        this._loaded = null;
    }

    get developerKey() {
        return null;
    }
    get locale() {
        return this._locale;
    }

    async getModuleLocation() {
        throw new Error(`Cannot download module using FileThingpediaClient`);
    }
    async getDeviceList() {
        throw new Error(`Cannot access device list using FileThingpediaClient`);
    }
    async getDeviceFactories() {
        throw new Error(`Cannot access device factories using FileThingpediaClient`);
    }
    async getDeviceSetup() {
        throw new Error(`Cannot access device setup using FileThingpediaClient`);
    }
    async getKindByDiscovery(id) {
        throw new Error(`Cannot perform device discovery using FileThingpediaClient`);
    }
    async getExamplesByKey() {
        throw new Error(`Cannot search examples using FileThingpediaClient`);
    }
    async getExamplesByKinds() {
        throw new Error(`Cannot search examples using FileThingpediaClient`);
    }
    async clickExample() {
        throw new Error(`Cannot click examples using FileThingpediaClient`);
    }
    async lookupEntity() {
        throw new Error(`Cannot lookup entity using FileThingpediaClient`);
    }

    async _load() {
        const data = JSON.parse(await util.promisify(fs.readFile)(this._thingpediafilename));

        this._entities = data.entities;
        for (let dev of data.devices) {
            this._meta[dev.kind] = dev;
            this._schema[dev.kind] = {
                queries: {},
                actions: {}
            };
            for (let what of ['queries', 'actions']) {
                for (let name in dev[what]) {
                    let from = dev[what][name];
                    this._schema[dev.kind][what][name] = {
                        types: from.types,
                        args: from.args,
                        required: from.required,
                        is_input: from.is_input,
                        is_list: from.is_list,
                        is_monitorable: from.is_monitorable
                    };
                }
            }
        }
    }

    _ensureLoaded() {
        if (this._loaded)
            return this._loaded;
        else
            return this._loaded = this._load();
    }

    // The Thingpedia APIs were changed to return ThingTalk class
    // definitions rather than JSON
    // We convert our JSON datafiles into ThingTalk code here

    async getSchemas(kinds, useMeta) {
        await this._ensureLoaded();
        const source = useMeta ? this._meta : this._schema;

        const classes = [];
        for (let kind of kinds) {
            // emulate Thingpedia's behavior of creating an empty class
            // for invalid/unknown/invisible devices
            if (!source[kind])
                source[kind] = { queries: {}, actions: {} };
            classes.push(makeSchemaClassDef(kind, source[kind], useMeta));
        }
        const input = new Ast.Input.Meta(classes, []);
        return input.prettyprint();
    }
    async getDeviceCode(kind) {
        // we don't have the full class, so we just return the meta info
        return this.getSchemas([kind], true);
    }

    getMixins() {
        // no mixins through this ThingpediaClient
        return Promise.resolve({});
    }

    getAllExamples() {
        return util.promisify(fs.readFile)(this._datasetfilename, { encoding: 'utf8' });
    }

    async getAllDeviceNames() {
        await this._ensureLoaded();
        let names = [];
        for (let kind in this._meta)
            names.push({ kind, kind_canonical: this._meta[kind].kind_canonical });
        return names;
    }

    async getAllEntityTypes() {
        await this._ensureLoaded();
        return this._entities;
    }
};
