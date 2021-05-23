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
import { SchemaRetriever } from 'thingtalk';

import * as ThingTalkUtils from '../../lib/utils/thingtalk';
import SlotExtractor from '../../lib/dataset-tools/evaluation/slot_extractor';

import _tpClient from './mock_schema_delegate';
const _schemaRetriever = new SchemaRetriever(_tpClient, null, true);

const TEST_CASES : Array<[string, Record<string, string>]> = [
    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
     @org.thingpedia.builtin.thingengine.builtin.configure(device="io.home-assistant"^^tt:device("home assistant"));`,
     { 'builtin-device': 'home assistant' }],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
     @org.thingpedia.builtin.thingengine.builtin.configure(device=null^^tt:device("home assistant"));`,
     { 'builtin-device': 'home assistant' }],

    [`$dialogue @org.thingpedia.dialogue.transaction.execute;
     @org.thingpedia.builtin.thingengine.builtin.configure(device="io.home-assistant"^^tt:device("home"));`,
     { 'builtin-device': 'home assistant' }],
];

async function test(i : number) {
    console.log(`Test case #${i+1}`);

    const [input, expected] = TEST_CASES[i];

    const extractor = new SlotExtractor('en-US', _tpClient, _schemaRetriever, undefined);
    const parsed = await ThingTalkUtils.parse(input, _schemaRetriever);
    const extracted = await extractor.extractSlots(parsed);

    assert.deepStrictEqual(extracted, expected);
}

export default async function main() {
    for (let i = 0; i < TEST_CASES.length; i++)
        await test(i);
}
if (!module.parent)
    main();
