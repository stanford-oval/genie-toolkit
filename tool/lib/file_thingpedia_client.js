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
const Grammar = ThingTalk.Grammar;
const fs = require('fs');
const util = require('util');

const { uniform } = require('../../lib/random');

function exampleToCode(example) {
    const clone = example.clone();
    clone.id = -1;
    clone.utterances = [];
    clone.preprocessed = [];
    clone.metadata = {};
    return clone.prettyprint();
}

module.exports = class FileThingpediaClient {
    constructor(args) {
        this._locale = args.locale;
        this._devices = null;
        this._entities = null;
        this._examples = null;
        this._datasets = null;

        this._thingpediafilename = args.thingpedia;
        this._entityfilename = args.entities;
        this._datasetfilename = args.dataset;
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
    async clickExample() {
        throw new Error(`Cannot click examples using FileThingpediaClient`);
    }
    async lookupEntity() {
        throw new Error(`Cannot lookup entity using FileThingpediaClient`);
    }

    async _load() {
        this._devices = (await util.promisify(fs.readFile)(this._thingpediafilename)).toString();

        if (this._entityfilename)
            this._entities = JSON.parse(await util.promisify(fs.readFile)(this._entityfilename)).data;
        else
            this._entities = null;

        this._examples = await util.promisify(fs.readFile)(this._datasetfilename, { encoding: 'utf8' });
        this._datasets = await Grammar.parse(this._examples).datasets;
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

        // ignore kinds, just return the full file, SchemaRetriever will take care of the rest
        return this._devices;
    }
    async getDeviceCode(kind) {
        // we don't have the full class, so we just return the meta info
        return this.getSchemas([kind], true);
    }

    getMixins() {
        // no mixins through this ThingpediaClient
        return Promise.resolve({});
    }

    async getAllExamples() {
        await this._ensureLoaded();
        return this._examples;
    }

    async getExamplesByKinds(kind) {
        if (kind.includes(','))
            throw new Error(`Cannot get examples for multiple devices using FileThingpediaClient`);
        await this._ensureLoaded();
        return this._datasets.find((d) => d.name === kind || d.name === '@' + kind);
    }

    async getAllDeviceNames() {
        await this._ensureLoaded();

        const parsed = ThingTalk.Grammar.parse(this._devices);
        let names = [];
        for (let classDef of parsed.classes) {
            names.push({
                kind: classDef.kind,
                kind_canonical: classDef.metadata.canonical
            });
        }
        return names;
    }

    async getAllEntityTypes() {
        await this._ensureLoaded();
        return this._entities;
    }

    async genCheatsheet(random = true, options = {}) {
        await this._ensureLoaded();
        const parsed = ThingTalk.Grammar.parse(this._devices);

        const devices = [];
        const devices_rev = {};
        for (let classDef of parsed.classes) {
            devices_rev[classDef.kind] = devices.length;
            devices.push({
                primary_kind: classDef.kind,
                name: classDef.metadata.canonical
            });
        }
        devices.sort((a, b) => {
            return a.name.localeCompare(b.name);
        });

        let parsedExamples = this._datasets[0].examples;
        const examples = parsedExamples.map((e) => {
            let kind;
            for (let [, invocation] of e.iteratePrimitives())
                kind = invocation.selector.kind;
            if (kind in devices_rev) {
                let utterance = random ? uniform(e.utterances, options.rng) : e.utterances[0];
                return {
                    kind: kind,
                    utterance: utterance,
                    target_code: exampleToCode(e)
                };
            } else {
                return null;
            }
        }).filter((e) => !!e);
        return [devices, examples];
    }
};
