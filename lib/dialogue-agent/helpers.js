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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const SLOT_REGEX = /\$(?:\$|([a-zA-Z0-9_]+(?![a-zA-Z0-9_]))|{([a-zA-Z0-9_]+)(?::([a-zA-Z0-9_]+))?})/;
function normalizeSlot(t) {
    let res = SLOT_REGEX.exec(t);
    if (!res)
        return t;
    let [match, param1, param2,] = res;
    if (match === '$$')
        return '$';
    return '$' + (param1 || param2);
}

function capitalize(str) {
    return (str[0].toUpperCase() + str.substr(1)).replace(/[.\-_]([a-z])/g, (whole, char) => ' ' + char.toUpperCase()).replace(/[.\-_]/g, '');
}

module.exports = {
    formatError(dlg, error) {
        if (typeof error === 'string')
            return error;
        else if (error.name === 'SyntaxError')
            return dlg.interpolate(dlg._("Syntax error at ${error.fileName} line ${error.lineNumber}: ${error.message}"), { error });
        else if (error.message)
            return error.message;
        else
            return String(error);
    },

    presentExample(dlg, utterance) {
        // on Android, we have app-level slot filling which is more powerful, so we don't
        // want to lose the argument name information
        if (dlg.manager.platform.type === 'android' || dlg.manager.platform.type === 'test')
            utterance = utterance.split(' ').map((t) => t.startsWith('$') ? normalizeSlot(t) : t).join(' ');
        else
            utterance = utterance.split(' ').map((t) => t.startsWith('$') ? '____' : t).join(' ');
        if (utterance.startsWith(', '))
            utterance = utterance.substring(2);
        return utterance;
    },

    loadOneExample(ex) {
        // refuse to slot fill pictures
        for (let name in ex.args) {
            let type = ex.args[name];
            // avoid examples such as "post __" for both text and picture (should be "post picture" without slot for picture)
            if (type.isEntity && type.type === 'tt:picture')
                return null;
        }

        // turn the declaration into a program
        let newprogram = ex.toProgram();
        let slots = [];
        let slotTypes = {};
        for (let name in ex.args) {
            slotTypes[name] = String(ex.args[name]);
            slots.push(name);
        }

        let code = ThingTalk.NNSyntax.toNN(newprogram, {});
        let monitorable;
        if (ex.type === 'stream')
            monitorable = true;
        else if (ex.type === 'action')
            monitorable = false;
        else if (ex.type === 'query')
            monitorable = ex.value.schema.is_monitorable;
        else
            monitorable = false;
        return { utterance: ex.utterances[0],
                 type: ex.type,
                 monitorable: monitorable,
                 target: {
                    example_id: ex.id, code: code, entities: {}, slotTypes: slotTypes, slots: slots } };
    },

    async loadExamples(dataset, schemaRetriever, maxCount) {
        const parsed = await ThingTalk.Grammar.parseAndTypecheck(dataset, schemaRetriever);
        const parsedDataset = parsed.datasets[0];

        if (maxCount === undefined)
            maxCount = parsedDataset.examples.length;
        else
            maxCount = Math.min(parsedDataset.examples.length, maxCount);
        let output = [];
        for (let i = 0; i < maxCount; i++) {
            const loaded = this.loadOneExample(parsedDataset.examples[i]);
            if (loaded !== null)
                output.push(loaded);
        }
        return output;
    },

    presentExampleList(dlg, examples, isLocal=true) {
        for (let ex of examples) {
            if (!isLocal)
                ex.utterance = ex.utterance.replace(/\b(my)\b/g, 'their').replace(/\b(me)\b/, 'them').replace(/\b(i|I)\b/g, 'they').replace(/\bnotify them\b/g, 'notify me');
            dlg.replyButton(this.presentExample(dlg, ex.utterance), ex.target);
        }
    },

    presentSingleExample(dlg, utterance, target) {
        // if we have slots to fill, show the template to the user, otherwise just run
        // the example right away

        if (target.slots && target.slots.length > 0) {
            dlg.replyButton(this.presentExample(dlg, utterance), target);
        } else {
            // handle the command at the next event loop iteration
            // to avoid reentrancy
            //
            // FIXME: instead, we should run this immediately, inside this promise, and not return
            // until the whole task is done
            //
            setImmediate(() => {
                dlg.manager.handleParsedCommand(target);
            });
        }
    },

    isPlatformBuiltin(kind) {
        return kind.startsWith('org.thingpedia.builtin.thingengine');
    },

    getProgramIcon(program) {
        let icon = null;
        for (let [, prim] of program.iteratePrimitives()) {
            if (prim.selector.isBuiltin)
                continue;
            let newIcon = this.getIcon(prim);
            // ignore builtin/platform devices when choosing the icon
            if (!newIcon || this.isPlatformBuiltin(newIcon))
                continue;
            icon = newIcon;
        }
        return icon;
    },

    getIcon(prim) {
        let kind;
        if (prim === null)
            return null;
        if (prim instanceof Ast.PermissionFunction)
            kind = prim.kind;
        else if (prim.selector.isDevice)
            kind = prim.selector.kind;

        if (kind && kind !== 'remote' && !kind.startsWith('__dyn')) {
            if (prim.selector && prim.selector.device)
                return prim.selector.device.kind;
            else
                return kind;
        } else {
            return null;
        }
    },

    cleanKind(kind) {
        if (kind.startsWith('org.thingpedia.builtin.thingengine.'))
            kind = kind.substr('org.thingpedia.builtin.thingengine.'.length);
        // org.thingpedia.builtin.omlet -> omlet
        if (kind.startsWith('org.thingpedia.builtin.'))
            kind = kind.substr('org.thingpedia.builtin.'.length);
        // org.thingpedia.weather -> weather
        if (kind.startsWith('org.thingpedia.'))
            kind = kind.substr('org.thingpedia.'.length);
        // com.xkcd -> xkcd
        if (kind.startsWith('com.'))
            kind = kind.substr('com.'.length);
        if (kind.startsWith('gov.'))
            kind = kind.substr('gov.'.length);
        if (kind.startsWith('org.'))
            kind = kind.substr('org.'.length);
        if (kind.startsWith('uk.co.'))
            kind = kind.substr('uk.co.'.length);

        return capitalize(kind);
    }
};
