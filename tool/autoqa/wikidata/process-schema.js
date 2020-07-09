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
const assert = require('assert');

const ThingTalk = require('thingtalk');
const StreamUtils = require('../../../lib/stream-utils');
const genBaseCanonical = require('../lib/base-canonical-generator');

class SchemaProcessor {
    constructor(args) {
        this._output = args.output;
        this._thingpedia = args.thingpedia;
    }

    async run() {
        const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(this._thingpedia, { encoding: 'utf8' }));
        assert(library.isLibrary && library.classes.length === 1);
        const classDef = library.classes[0];
        for (let fn in classDef.queries) {
            const fndef = classDef.queries[fn];
            for (let arg of fndef.iterateArguments()) {
                const wikidata_label = arg.impl_annotations.wikidata_label;
                if (wikidata_label) {
                    arg.nl_annotations.canonical = {};
                    genBaseCanonical(arg.nl_annotations.canonical, wikidata_label.value, arg.type);
                }
            }
        }


        this._output.end(classDef.prettyprint());
        await StreamUtils.waitFinish(this._output);
    }
}


module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('wikidata-process-schema', {
            addHelp: true,
            description: "Generate base canonical for given a wikidata schema.tt"
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to original ThingTalk file containing class definitions.'
        });
    },

    async execute(args) {
        const schemaProcessor = new SchemaProcessor(args);
        schemaProcessor.run();
    }
};
