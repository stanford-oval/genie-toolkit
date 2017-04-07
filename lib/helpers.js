// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

function getFeedName(dlg, messaging, f) {
    if (f.name)
        return [f.name, f.identifier];

    if (f.members.length === 1)
        return [dlg._("You"), f.identifier];
    if (f.members.length === 2) {
        if (f.members[0] === 1) {
            return messaging.getUserById(f.members[1]).then(function(u) {
                return [u.name, f.identifier];
            });
        } else {
            return messaging.getUserById(f.members[0]).then(function(u) {
                return [u.name, f.identifier];
            });
        }
    } else {
        return [dlg._("Unnamed (multiple partecipants)"), f.identifier];
    }
}

function tokenize(string) {
    var tokens = string.split(/(\s+|[,\.\"\'])/g);
    return tokens.filter((t) => !(/^\s*$/).test(t)).map((t) => t.toLowerCase());
}

module.exports = {
    getFeedName: getFeedName,

    getFeedList: function(dlg, messaging) {
        return messaging.getFeedMetas().then(function(feeds) {
            return feeds.filter(function(f) {
                // HACK: omlet sometime will forget the hasWriteAccess field
                // treat undefined same as true in that case
                return f.hasWriteAccess !== false && f.kind === null;
            });
        }).then(function(feeds) {
            return Q.all(feeds.map(function(f) {
                return getFeedName(dlg, messaging, f);
            }));
        });
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
