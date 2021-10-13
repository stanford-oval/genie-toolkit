// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import * as argparse from 'argparse';
import * as ThingTalk from 'thingtalk';
import { loadClassDef } from './lib/utils';

function includesAnnotation(canonicalList : string[], canonical : string) {
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

function diffAnnotation(a1 : Record<string, string[]>, a2 : Record<string, string[]>) {
    const diff : Record<string, string[]> = {};
    for (const posType in a1) {
        if (posType === 'default')
            continue;
        if (posType in a2) {
            const missingAnnotations : string[] = [];
            for (const canonical of a1[posType]) {
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

function diffQuery(q1 : ThingTalk.Ast.FunctionDef, q2 : ThingTalk.Ast.FunctionDef) {
    const diff : Record<string, Record<string, string[]>> = {};
    for (const arg1 of q1.iterateArguments()) {
        const arg2 = q2.getArgument(arg1.name)!;
        const d = diffAnnotation(arg1.nl_annotations.canonical, arg2.nl_annotations.canonical);
        if (Object.keys(d).length > 0)
            diff[arg1.name] = d;
    }
    return diff;
}


export function initArgparse(subparsers : argparse.SubParser) {
    const parser = subparsers.add_parser('autoqa-annotation-diff', {
        add_help: true,
        description: "Find the canonical annotation difference between two classes; return annotations existed " +
            "in the first one that is not available in the second."
    });
    parser.add_argument('-l', '--locale', {
        required: false,
        default: 'en-US',
        help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
    });
    parser.add_argument('--timezone', {
        required: false,
        default: undefined,
        help: `Timezone to use to interpret dates and times (defaults to the current timezone).`
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

export async function execute(args : any) {
    const classDef1 = await loadClassDef(args.thingpedia1, { locale: args.locale, timezone: args.timezone });
    const classDef2 = await loadClassDef(args.thingpedia2, { locale: args.locale, timezone: args.timezone });

    const queries = args.queries ? args.queries.split(',') : Object.keys(classDef1.queries);
    const diff : Record<string, Record<string, Record<string, string[]>>> = {};
    for (const qname of queries) {
        const q1 = classDef1.queries[qname];
        const q2 = classDef2.queries[qname];
        diff[qname] = diffQuery(q1, q2);
    }
    console.log(JSON.stringify(diff, null, 2));
}
