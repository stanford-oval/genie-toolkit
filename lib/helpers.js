// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

function getFeedName(messaging, f) {
    if (f.name)
        return [f.name, f.identifier];

    if (f.members.length === 1)
        return ["You", f.identifier];
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
        return ["Unnamed (multiple partecipants)", f.identifier];
    }
}

module.exports = {
    getFeedName: getFeedName,

    getFeedList: function(messaging) {
        return messaging.getFeedMetas().then(function(feeds) {
            return feeds.filter(function(f) {
                // HACK: omlet sometime will forget the hasWriteAccess field
                // treat undefined same as true in that case
                return f.hasWriteAccess !== false && f.kind === null;
            });
        }).then(function(feeds) {
            return Q.all(feeds.map(function(f) {
                return getFeedName(messaging, f);
            }));
        });
    },

    notify(dialog, appId, messages) {
        var app;
        if (appId !== undefined)
            app = dialog.manager.apps.getApp(appId);
        else
            app = undefined;

        var notifyOne = (message) => {
            if (typeof message === 'string')
                message = { type: 'text', text: message };

            if (typeof message !== 'object')
                return;

            if (message.type === 'text') {
                dialog.reply(message.text);
            } else if (message.type === 'picture') {
                dialog.replyPicture(message.url);
            } else if (message.type === 'rdl') {
                dialog.replyRDL(message);
            }
        }
        if (app !== undefined &&
            (typeof messages === 'string' && messages) ||
            (Array.isArray(messages) && messages.length === 1 && typeof messages[0] === 'string' && messages[0])) {
            dialog.reply("Notification from " + app.name + ": " + messages);
        } else {
            if (app !== undefined)
                dialog.reply("Notification from " + app.name);
            if (Array.isArray(messages))
                messages.forEach(notifyOne);
            else
                notifyOne(messages);
        }
        return true;
    },


}
