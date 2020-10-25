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


import assert from 'assert';
import * as ThingTalk from 'thingtalk';
import * as fs from 'fs';
import * as util from 'util';

async function loadClassDef(thingpedia) {
    const library = ThingTalk.Grammar.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }));
    assert(library.isLibrary && library.classes.length === 1);
    return library.classes[0];
}

function includesAnnotation(canonicalList, canonical) {
    if (canonical.endsWith(' #'))
        canonical = canonical.replace(' #', '');

    for (let c of canonicalList) {
        if (c.endsWith(' #'))
            c = c.replace(' #', '');
        if (c === canonical)
            return true;
    }

    return false;
}

function diffAnnotation(a1, a2) {
    const diff = {};
    for (let posType in a1) {
        if (posType === 'default')
            continue;
        if (posType in a2) {
            const missingAnnotations = [];
            for (let canonical of a1[posType]) {
                if (!includesAnnotation(a2[posType], canonical))
                    missingAnnotations.push(canonical);
            }
            if (missingAnnotations.length > 0)
                diff[posType] = missingAnnotations;
        } else {
            diff[posType] = a1[posType];
        }
    }
    return diff;
}

function diffQuery(q1, q2) {
    const diff = {};
    for (let arg1 of q1.iterateArguments()) {
        const arg2 = q2.getArgument(arg1.name);
        const d = diffAnnotation(arg1.nl_annotations.canonical, arg2.nl_annotations.canonical);
        if (Object.keys(d).length > 0)
            diff[arg1.name] = d;
    }
    return diff;
}


export async function initArgparse(subparsers) {
    const parser = subparsers.add_parser('autoqa-annotation-diff', {
        add_help: true,
        description: "Find the canonical annotation difference between two classes; return annotations existed " +
            "in the first one that is not available in the second."
    });
    parser.add_argument('--thingpedia1', {
        required: true,
        help: 'Path to the first ThingTalk file containing class definitions.'
    });
    parser.add_argument('--thingpedia2', {
        required: true,
        help: 'Path to the second ThingTalk file containing class definitions.'
    });
    parser.add_argument('--queries', {
        required: false,
        help: 'Queries to include, split by comma with no space; run on all functions if absent'
    });
}

export async function execute(args) {
    const classDef1 = await loadClassDef(args.thingpedia1);
    const classDef2 = await loadClassDef(args.thingpedia2);

    const queries = args.queries ? args.queries.split(',') : Object.keys(classDef1.queries);
    const diff = {};
    for (let qname of queries) {
        const q1 = classDef1.queries[qname];
        const q2 = classDef2.queries[qname];
        diff[qname] = diffQuery(q1, q2);
    }
    console.log(JSON.stringify(diff, null, 2));
}
