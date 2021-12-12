// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import assert from 'assert';

import { DialogueParser } from '../../lib/dataset-tools/parsers';

const DIALOGUE_PARSER_TEST_CASES = [
    [`
====
====
# foo
U: hello
UT: $dialogue @org.thingpedia.dialogue.transaction.greet;
====
`, [{
        id: 'foo',
        turns: [{
            user: 'hello',
            user_target: '$dialogue @org.thingpedia.dialogue.transaction.greet;',
            agent: '',
            agent_target: '',
            context: '',
            intermediate_context: '',
            comment: '',
        }]
    }]
    ],

    [`
====
====
# foo
U: hello
UT: $dialogue @org.thingpedia.dialogue.transaction.greet;
C: $dialogue @org.thingpedia.dialogue.transaction.greet;
A: hello! how can i help you?
AT: $dialogue @org.thingpedia.dialogue.transaction.sys_greet;
U: thank you
UT: $dialogue @org.thingpedia.dialogue.transaction.cancel;
====
`, [{
        id: 'foo',
        turns: [{
            user: 'hello',
            user_target: '$dialogue @org.thingpedia.dialogue.transaction.greet;',
            agent: '',
            agent_target: '',
            context: '',
            intermediate_context: '',
            comment: '',
        }, {
            user: 'thank you',
            user_target: '$dialogue @org.thingpedia.dialogue.transaction.cancel;',
            agent: 'hello! how can i help you?',
            agent_target: '$dialogue @org.thingpedia.dialogue.transaction.sys_greet;',
            context: '$dialogue @org.thingpedia.dialogue.transaction.greet;',
            intermediate_context: '',
            comment: '',
        }]
    }]
    ],

    [`
====
# foo
====
# bar
U: hello
UT: $dialogue @org.thingpedia.dialogue.transaction.greet;
====
`, [{
        id: 'bar',
        turns: [{
            user: 'hello',
            user_target: '$dialogue @org.thingpedia.dialogue.transaction.greet;',
            agent: '',
            agent_target: '',
            context: '',
            intermediate_context: '',
            comment: '',
        }]
    }]
    ]
];

async function dialogueParserTest(testId) {
    console.log(`# Dialogue Parser Test Case ${testId+1}`);
    const [input, expected] = DIALOGUE_PARSER_TEST_CASES[testId];

    const parser = new DialogueParser();
    for (const line of input.split('\n'))
        parser.write(line);
    parser.end();

    let i = 0;
    for await (const dlg of parser) {
        assert(i < expected.length, `too many dialogues generated`);

        assert.strictEqual(dlg.id, expected[i].id);
        assert.strictEqual(dlg.length, expected[i].turns.length);
        for (let j = 0; j < dlg.length; j++)
            assert.deepStrictEqual(dlg[j], expected[i].turns[j]);

        i++;
    }
    assert.strictEqual(i, expected.length, `not enough dialogues generated`);
}

async function main() {
    for (let i = 0; i < DIALOGUE_PARSER_TEST_CASES.length; i++)
        await dialogueParserTest(i);
}
export default main;
if (!module.parent)
    main();
