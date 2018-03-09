// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const uuid = require('uuid');

const ThingTalk = require('thingtalk');
const Describe = ThingTalk.Describe;

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
    findPrimaryIdentity(identities) {
        var other = null;
        var email = null;
        var phone = null;
        for (var i = 0; i < identities.length; i++) {
            var id = identities[i];
            if (id.startsWith('email:')) {
                if (email === null)
                    email = id;
            } else if (id.startsWith('phone:')) {
                if (phone === null)
                    phone = id;
            } else {
                if (other === null)
                    other = id;
            }
        }
        if (phone !== null)
            return phone;
        if (email !== null)
            return email;
        if (other !== null)
            return other;
        return null;
    },

    sendRules(dlg, programs, app) {
        if (programs.length === 0)
            return Promise.resolve();
        const identities = dlg.manager.messaging.getIdentities();
        const identity = this.findPrimaryIdentity(identities);
        if (!identity)
            return Promise.reject(new Error("Failed to find a suitable messaging identity"));

        for (let program of programs) {
            //console.log('program: ' + Ast.prettyprint(program));
            let principal = program.principal;
            program.principal = null;
            const reconstructed = Describe.describeProgram(dlg.manager.gettext, program);
            dlg.reply(dlg._("Sending rule to %s: %s").format(Describe.describeArg(dlg.manager.gettext, principal), reconstructed));
            const uniqueId = app ? app.uniqueId : 'uuid-' + uuid.v4();
            dlg.manager.remote.installProgramRemote(principal.toJS(), identity, uniqueId, program).catch((e) => {
                if (app) {
                    app.reportError(e);
                    // destroy the app if we failed to send the message
                    dlg.manager.apps.removeApp(app);
                } else {
                    console.log('Ignored error from permission control request: ' + e.code + ': ' + e.message);
                    console.log(e.stack);
                }
            });
        }
        return Promise.resolve();
    },

    presentExample(dlg, utterance) {
        // on Android, we have app-level slot filling which is more powerful, so we don't
        // want to lose the argument name information
        if (dlg.manager.platform.type === 'android')
            return utterance.split(' ').map((t) => t.startsWith('$') ? normalizeSlot(t) : t).join(' ');
        else
            return utterance.split(' ').map((t) => t.startsWith('$') ? '____' : t).join(' ');
    },

    loadOneExample(dlg, ex) {
        return ThingTalk.Grammar.parseAndTypecheck(ex.target_code, dlg.manager.schemas).then((program) => {
            if (program.declarations.length + program.rules.length !== 1) {
                console.error(`Confusing example ${ex.id}: more than one rule or declaration`);
                return null;
            }

            if (program.rules.length === 1) {
                // easy case: just emit whatever
                let code = ThingTalk.NNSyntax.toNN(program, {});
                return { utterance: ex.utterance,
                         target: { example_id: ex.id, type: 'rule', code: code, entities: {},
                                   slotTypes: {}, slots: [] } };
            } else {
                // refuse to slot fill pictures
                for (let name in program.declarations[0].args) {
                    let type = program.declarations[0].args[name];
                    if (type.isEntity && type.type === 'tt:picture')
                        return null;
                }

                // turn the declaration into a program
                let newprogram = ThingTalk.Generate.declarationProgram(program.declarations[0]);
                let slots = [];
                let slotTypes = {};
                for (let name in program.declarations[0].args) {
                    slotTypes[name] = String(program.declarations[0].args[name]);
                    slots.push(name);
                }

                let code = ThingTalk.NNSyntax.toNN(newprogram, {});
                return { utterance: ex.utterance,
                         target: {
                            example_id: ex.id, type: program.declarations[0].type,
                            code: code, entities: {}, slotTypes: slotTypes, slots: slots } };
            }
        });
    },

    loadExamples(dlg, examples) {
        return Promise.all(examples.map((ex) => this.loadOneExample(dlg, ex)));
    },

    filterExamples(examples) {
        var added = new Set();
        var filtered = [];
        for (var ex of examples) {
            if (added.has(ex.target_code))
                continue;
            added.add(ex.target_code);
            filtered.push(ex);
        }
        return filtered;
    },

    presentExampleList(dlg, examples) {
        for (let ex of examples)
            dlg.replyButton(this.presentExample(dlg, ex.utterance), ex.target);
    },

    presentSingleExample(dlg, utterance, target_code) {
        return this.loadOneExample(dlg, { utterance, target_code }).then((ex) => {
            // if we have slots to fill, show the template to the user, otherwise just run
            // the example right away

            if (ex.target.slots && ex.target.slots.length > 0) {
                dlg.replyButton(this.presentExample(dlg, ex.utterance), ex.target);
            } else {
                // handle the command at the next event loop iteration
                // to avoid reentrancy
                //
                // FIXME: instead, we should run this immediately, inside this promise, and not return
                // until the whole task is done
                //
                setImmediate(() => {
                    dlg.manager.handleParsedCommand(ex.target);
                });
            }
        });
    },

    getIcon(prim) {
        if (prim.selector.kind !== 'remote' &&
            !prim.selector.kind.startsWith('__dyn')
            && prim.selector.device)
            return prim.selector.device.kind;
        else
            return null;
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
