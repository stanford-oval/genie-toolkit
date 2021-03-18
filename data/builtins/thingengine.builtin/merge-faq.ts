// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

process.on('unhandledRejection', (up) => { console.error(up); throw up; });

import assert from 'assert';
import * as yaml from 'js-yaml';
import { promises as pfs } from 'fs';
import * as path from 'path';
import { Syntax, Ast, Type } from 'thingtalk';

// FIXME in some build configurations, importing { split } from misc-utils
// fails with error "TypeError: lib/utils/misc-utils.js: Emit skipped"
// because the file is not in the same build directory
// so we duplicate it here

function* split(pattern : string, regexp : RegExp|string) : Generator<string|string[], void> {
    // a split that preserves capturing parenthesis

    const clone = new RegExp(regexp, 'g');
    let match = clone.exec(pattern);

    let i = 0;
    while (match !== null) {
        if (match.index > i)
            yield pattern.substring(i, match.index);
        yield match;
        i = clone.lastIndex;
        match = clone.exec(pattern);
    }
    if (i < pattern.length)
        yield pattern.substring(i, pattern.length);
}

function expandChoices(utterances : string[]) : string[] {
    const expanded : string[] = [];

    for (const utterance of utterances) {
        const chunks = Array.from(split(utterance, /\{([^|}]+(?:\|[^|}]+)+)\}/));

        const choices : string[] = [];
        for (let i = 0; i < chunks.length; i++) {
            if (typeof chunks[i] === 'string')
                choices.push(chunks[i] as string);
            else
                choices.push('');
        }

        (function recursiveHelper(i : number) : undefined {
            if (i === chunks.length) {
                expanded.push(choices.join(''));
                return undefined;
            }

            if (typeof chunks[i] === 'string')
                return recursiveHelper(i+1);

            for (const choice of chunks[i][1].split('|')) {
                choices[i] = choice;
                recursiveHelper(i+1);
            }
            return undefined;
        })(0);
    }

    return expanded;
}

async function main() {
    const manifestfile = path.resolve(path.dirname(module.filename), './manifest.tt');
    const manifest = Syntax.parse(await pfs.readFile(manifestfile + '.in', { encoding: 'utf8' }));
    assert(manifest instanceof Ast.Library);

    const datasetfile = path.resolve(path.dirname(module.filename), './dataset.tt');
    const dataset = Syntax.parse(await pfs.readFile(datasetfile + '.in', { encoding: 'utf8' }));
    assert(dataset instanceof Ast.Library);

    const classDef = manifest.classes[0];
    const action = classDef.actions.faq_reply;
    const questionarg = action.getArgument('question')!;
    assert(questionarg.type instanceof Type.Enum && questionarg.type.entries![0] === '__faq__');

    const faqfile = path.resolve(path.dirname(module.filename), './faq.yaml');
    const faqData : any = yaml.load(await pfs.readFile(faqfile, { encoding: 'utf8' }));
    assert(typeof faqData === 'object' && !Array.isArray(faqData));

    const intents = Object.keys(faqData);
    questionarg.type.entries = intents;

    const answers : Record<string, string[]> = {};
    for (const intent of intents) {
        const q = faqData[intent].q;
        assert(Array.isArray(q), `Invalid question for ${intent}`);
        const a = faqData[intent].a;
        assert(typeof a === 'object', `Invalid answer for ${intent}`);

        const prog = new Ast.InvocationExpression(null,
            new Ast.Invocation(null,
                new Ast.DeviceSelector(null, 'org.thingpedia.builtin.thingengine.builtin', null, null),
                'faq_reply',
                [new Ast.InputParam(null, 'question', new Ast.EnumValue(intent))],
                null),
            null);
        dataset.datasets[0].examples.push(new Ast.Example(null, -1, 'program', {},
            prog, expandChoices(q), [], {}));
        answers[intent] = a;
    }

    await pfs.writeFile(manifestfile, manifest.prettyprint());
    await pfs.writeFile(datasetfile, dataset.prettyprint());

    const answerfile = path.resolve(path.dirname(module.filename), '../../../lib/engine/devices/builtins/faq.json');
    await pfs.writeFile(answerfile, JSON.stringify(answers));
}
main();
