// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
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

    presentExample(tokens) {
        return tokens.map((t) => t.startsWith('$') ? '____' : t).join(' ');
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
