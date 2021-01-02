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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

import assert from 'assert';
import * as ThingTalk from 'thingtalk';

import * as ThingTalkUtils from '../utils/thingtalk';

import type DialogueLoop from './dialogue-loop';


const SLOT_REGEX = /\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_]+))?})/;
function normalizeSlot(t : string) : string {
    const res = SLOT_REGEX.exec(t);
    if (!res)
        return t;
    const [match, param1, param2,] = res;
    if (match === '$$')
        return '$';
    return '$' + (param1 || param2);
}

export function formatError(dlg : DialogueLoop, error : Error|string) {
    if (typeof error === 'string')
        return error;
    else if (error.name === 'SyntaxError')
        return dlg.interpolate(dlg._("Syntax error at ${error.fileName} line ${error.lineNumber}: ${error.message}"), { error });
    else if (error.message)
        return error.message;
    else
        return String(error);
}

export function presentExample(dlg : DialogueLoop, utterance : string) {
    // on Android, we have app-level slot filling which is more powerful, so we don't
    // want to lose the argument name information
    if (dlg.conversation.platform.type === 'android' || dlg.conversation.platform.type === 'test')
        utterance = utterance.split(' ').map((t) => t.startsWith('$') ? normalizeSlot(t) : t).join(' ');
    else
        utterance = utterance.split(' ').map((t) => t.startsWith('$') ? '____' : t).join(' ');
    if (utterance.startsWith(', '))
        utterance = utterance.substring(2);
    return utterance;
}

export function loadOneExample(ex : ThingTalk.Ast.Example) {
    // refuse to slot fill pictures
    for (const name in ex.args) {
        const type = ex.args[name];
        // avoid examples such as "post __" for both text and picture (should be "post picture" without slot for picture)
        if (type instanceof ThingTalk.Type.Entity && type.type === 'tt:picture')
            return null;
    }

    // turn the declaration into a program
    const newprogram = ex.toProgram();
    const slots : string[] = [];
    const slotTypes : Record<string, string> = {};
    for (const name in ex.args) {
        slotTypes[name] = String(ex.args[name]);
        slots.push(name);
    }

    const entities = {};
    const code = ThingTalkUtils.serializeNormalized(newprogram, entities);
    let monitorable;
    if (ex.type === 'stream')
        monitorable = true;
    else if (ex.type === 'action')
        monitorable = false;
    else if (ex.type === 'query')
        monitorable = ex.value.schema!.is_monitorable;
    else
        monitorable = false;
    return { utterance: ex.utterances[0],
             type: ex.type,
             monitorable: monitorable,
             target: {
                example_id: ex.id, code, entities, slotTypes, slots } };
}

export async function loadSuggestedProgram(code : string, schemaRetriever : ThingTalk.SchemaRetriever) {
    const parsed = await ThingTalkUtils.parse(code, schemaRetriever);

    const entities = {};
    const normalized = ThingTalkUtils.serializeNormalized(parsed, entities);
    return { code: normalized, entities, slotTypes: {}, slots: [] };
}

export async function loadExamples(dataset : string,
                                   schemaRetriever : ThingTalk.SchemaRetriever,
                                   maxCount : number) {
    // use ThingTalkUtils instead of ThingTalk.Syntax so we transparently
    // fallback to old syntax in case we're talking to an old Thingpedia
    // with unported dataset.tt
    const parsed = await ThingTalkUtils.parse(dataset, schemaRetriever);
    assert(parsed instanceof ThingTalk.Ast.Library);
    const parsedDataset = parsed.datasets[0];

    if (maxCount === undefined)
        maxCount = parsedDataset.examples.length;
    else
        maxCount = Math.min(parsedDataset.examples.length, maxCount);
    const output = [];
    for (let i = 0; i < maxCount; i++) {
        const loaded = loadOneExample(parsedDataset.examples[i]);
        if (loaded !== null)
            output.push(loaded);
    }
    return output;
}

export function presentExampleList(dlg : DialogueLoop,
                                   examples : Array<{ utterance : string, target : string }>) {

}
