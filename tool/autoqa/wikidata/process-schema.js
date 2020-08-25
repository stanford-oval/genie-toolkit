// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Silei Xu <silei@cs.stanford.edu>
"use strict";

const fs = require('fs');
const util = require('util');
const assert = require('assert');
const ThingTalk = require('thingtalk');

const StreamUtils = require('../../../lib/utils/stream-utils');

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
        const parser = subparsers.add_parser('wikidata-process-schema', {
            add_help: true,
            description: "Generate base canonical for given a wikidata schema.tt"
        });
        parser.add_argument('-o', '--output', {
            required: true,
            type: fs.createWriteStream
        });
        parser.add_argument('--thingpedia', {
            required: true,
            help: 'Path to original ThingTalk file containing class definitions.'
        });
    },

    async execute(args) {
        const schemaProcessor = new SchemaProcessor(args);
        schemaProcessor.run();
    }
};
