// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

module.exports = {
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

    promptConfigure(dialog, kinds) {
        return dialog.manager.thingpedia.getDeviceSetup(kinds).then((factories) => {
            for (var name in factories) {
                var factory = factories[name];

                if (factory.type === 'multiple') {
                    dialog.reply("You don't have a " + name);
                    if (factory.choices.length > 0) {
                        dialog.reply("You might want to configure one of: " + factory.choices.join(', '));
                        dialog.replyLink("Go to Dashboard", "/apps");
                    }
                } else {
                    dialog.reply("You don't have a " + factory.text);
                    switch (factory.type) {
                    case 'oauth2':
                        dialog.replyLink("Configure " + factory.text, '/devices/oauth2/' + factory.kind);
                        break;
                    case 'link':
                        dialog.replyLink("Configure " + factory.text, factory.href);
                        break;
                    case 'none':
                        dialog.replyLink("Enable " + factory.text, '/devices/create/' + factory.kind);
                    }
                }
            }
        });
    }
}
