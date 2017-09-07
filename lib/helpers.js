// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const uuid = require('uuid');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Describe = ThingTalk.Describe;

function tokenize(string) {
    var tokens = string.split(/(\s+|[,\.\"\'])/g);
    return tokens.filter((t) => !(/^\s*$/).test(t)).map((t) => t.toLowerCase());
}

module.exports = {
    findPrimaryIdentity(identities) {
        var omletId = null;
        var email = null;
        var phone = null;
        for (var i = 0; i < identities.length; i++) {
            var id = identities[i];
            if (id.startsWith('omlet:') && omletId === null)
                omletId = id;
            else if (id.startsWith('email:') && email === null)
                email = id;
            else if (id.startsWith('phone:') && phone === null)
                phone = id;
        }
        if (phone !== null)
            return phone;
        if (email !== null)
            return email;
        if (omletId !== null)
            return omletId;
        return null;
    },

    sendRules(dlg, principalAndPrograms, app) {
        if (principalAndPrograms.length === 0)
            return Q();
        const identities = dlg.manager.messaging.getIdentities();
        const identity = this.findPrimaryIdentity(identities);
        if (!identity)
            return Q.reject("Failed to find a suitable messaging identity");

        for (let [principal, program] of principalAndPrograms) {
            //console.log('program: ' + Ast.prettyprint(program));
            const reconstructed = Describe.describeProgram(dlg.manager.gettext, program);
            dlg.reply(dlg._("Sending rule to %s: %s").format(Describe.describeArg(dlg.manager.gettext, principal), reconstructed));
            const uniqueId = app ? app.uniqueId : 'uuid-' + uuid.v4();
            dlg.manager.remote.installProgramRemote(principal.value, identity, uniqueId, program).catch((e) => {
                if (app) {
                    app.reportError(e);
                    // destroy the app if we failed to send the message
                    dlg.manager.apps.removeApp(app);
                } else {
                    console.log('Ignored error from permission control request: ' + e.code + ': ' + e.message);
                    console.log(e.stack);
                }
            });
            return Q();
        }
    },

    tokenize: tokenize,

    tokenizeExample(utterance) {
        return tokenize(utterance);
    },

    presentExample(dlg, tokens) {
        // on Android, we have app-level slot filling which is more powerful, so we don't
        // want to lose the argument name information
        if (dlg.manager.platform.type === 'android')
            return tokens.join(' ');
        else
            return tokens.map((t) => t.startsWith('$') ? '____' : t).join(' ');
    },

    filterExamples(examples) {
        var added = new Set();
        var filtered = [];
        for (var ex of examples) {
            // ignore sentences from user
            if (ex.target_json.indexOf("\"slots\":\[") < 0)
                continue;

            if (added.has(ex.target_json))
                continue;
            added.add(ex.target_json);

            var parsed = JSON.parse(ex.target_json);
            if (!parsed.rule && !parsed.trigger && !parsed.query && !parsed.action)
                continue;

            parsed.example_id = ex.id;
            ex.target_json = JSON.stringify(parsed);
            filtered.push(ex);
        }
        return filtered;
    },

    filterExamplesByTypes(examples, types, withSlot) {
        var added = new Set();
        var filtered = [];
        for (var ex of examples) {
            if (withSlot) {
                if (ex.target_json.indexOf("\"slots\":\[") < 0)
                    continue;
            }

            if (added.has(ex.target_json))
                continue;
            added.add(ex.target_json);

            var parsed = JSON.parse(ex.target_json);
            var type = Object.keys(parsed)[0];
            if (types.indexOf(type) == -1)
                continue;

            parsed.example_id = ex.id;
            ex.target_json = JSON.stringify(parsed);
            filtered.push(ex);
        }
        return filtered;
    },

    augmentExamplesWithSlotTypes(schemas, examples) {
        return Q.all(examples.map((ex) => {
            var parsed = JSON.parse(ex.target_json);
            var invocation;
            var schemaType;
            if (parsed.trigger) {
                invocation = parsed.trigger;
                schemaType = 'triggers';
            } else if (parsed.query) {
                invocation = parsed.query;
                schemaType = 'queries';
            } else if (parsed.action) {
                invocation = parsed.action;
                schemaType = 'actions';
            } else
                return;

            if (!invocation.slots)
                return;
            if (invocation.slots.length === 0) {
                parsed.slotTypes = {};
                ex.target_json = JSON.stringify(parsed);
                return;
            }

            var match = /^tt:([^\.]+)\.(.+)$/.exec(invocation.name.id);
            if (match === null)
                return;

            return schemas.getMeta(match[1], schemaType, match[2]).then((meta) => {
                var argmap = {};
                meta.args.forEach((argname, i) => {
                    argmap[argname] = String(meta.schema[i]);
                });
                parsed.slotTypes = argmap;
                ex.target_json = JSON.stringify(parsed);
            });
        }));
    },

    presentExampleList(dlg, examples) {
        for (var ex of examples) {
            dlg.replyButton(this.presentExample(dlg, this.tokenizeExample(ex.utterance)), ex.target_json);
        }
    },

    presentSingleExample(dlg, utterance, targetJson) {
        var ex = {
            utterance: utterance,
            target_json: targetJson
        };

        return this.augmentExamplesWithSlotTypes(dlg.manager.schemas, [ex]).then(() => {
            this.presentExampleList(dlg, [ex]);
            return true;
        });
    },

    getIcon(obj) {
        if (obj.device)
            return obj.device.kind;
        else if (obj.kind === 'phone')
            return 'org.thingpedia.builtin.thingengine.phone';
        else
            return null;
    }
}
