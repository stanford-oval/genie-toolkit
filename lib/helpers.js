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

const SPECIAL_TO_CANONICAL = {
    hello: 'hello',
    debug: 'debug',
    help: 'help',
    thankyou: 'thank you',
    sorry: 'sorry',
    cool: 'cool',
    nevermind: 'never mind',
    yes: 'yes',
    no: 'no'
}

function argToCanonical(buffer, arg) {
    if (arg.type === 'Location') {
        if (arg.relativeTag === 'rel_current_location')
            buffer.push('here');
        else if (arg.relativeTag === 'rel_home')
            buffer.push('home');
        else if (arg.relativeTag === 'rel_work')
            buffer.push('work');
        else if (arg.latitude === 37.442156 && arg.longitude === -122.1634471)
            buffer.push('palo alto');
        else if (arg.latitude === 34.0543942 && arg.longitude === -118.2439408)
            buffer.push('los angeles');
        else
            buffer.push('some other place');
    } else if (arg.type === 'String') {
        buffer.push('"');
        buffer.push(arg.value.value);
        buffer.push('"');
    } else {
        buffer.push(String(arg.value.value));
        if (arg.type === 'Measure')
            buffer.push(arg.value.unit || arg.unit);
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

    // this is not translatable because it's language-model specific
    // i'm not sure how to deal with that, especially with non-segmented languages
    // like Chinese
    // sorry
    reconstructCanonical(schemaRetriever, json) {
        var parsed = JSON.parse(json);

        if (parsed.special)
            return SPECIAL_TO_CANONICAL[parsed.special.id.substr('tt:root.special.'.length)];

        var buffer = [];
        if (parsed.command) {
            buffer.push(parsed.command.type);

            if (parsed.command.value.value === 'generic')
                return buffer.join(' ');

            buffer.push(parsed.command.value.id.substr('tt:device.'.length));
            return buffer.join(' ');
        }
        if (parsed.answer) {
            argToCanonical(buffer, parsed.answer);
            return buffer.join(' ');
        }

        if (parsed.trigger)
            buffer.push('monitor if');

        var name, args, schemaType;
        if (parsed.action) {
            name = parsed.action.name;
            args = parsed.action.args;
            schemaType = 'actions';
        } else if (parsed.query) {
            name = parsed.query.name;
            args = parsed.query.args;
            schemaType = 'queries';
        } else if (parsed.trigger) {
            name = parsed.trigger.name;
            args = parsed.trigger.args;
            schemaType = 'triggers';
        } else {
            throw new TypeError('Not action, query or trigger');
        }

        var match = /^tt:([^\.]+)\.(.+)$/.exec(name.id);
        if (match === null)
            throw new TypeError('Channel name not in proper format');
        var kind = match[1];
        var channelName = match[2];

        return schemaRetriever.getMeta(kind, schemaType, channelName).then(function(meta) {
            buffer.push(meta.canonical);

            args.forEach(function(arg, i) {
                if (i === 0 && parsed.action)
                    buffer.push('with');
                else
                    buffer.push('and');

                var match = /^tt[:\.]param\.(.+)$/.exec(arg.name.id);
                if (match === null)
                    throw new TypeError('Argument name not in proper format, is ' + arg.name.id);
                var argname = match[1];
                var argcanonical = argname.replace(/_/g, ' ').replace(/([^A-Z])([A-Z])/g, '$1 $2').toLowerCase();
                buffer.push(argcanonical);
                if (parsed.action) {
                    switch(arg.operator) {
                    case 'has':
                    case 'contains':
                        buffer.push('containing');
                        break;
                    case 'is':
                        buffer.push('being');
                        break;
                    case 'is greater than':
                        buffer.push('being greater than');
                        break;
                    case 'is less than':
                        buffer.push('being less than');
                        break;
                    }
                } else {
                    buffer.push(arg.operator);
                }
                argToCanonical(buffer, arg);
            });

            return buffer.join(' ');
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
            dialog.reply(dialog._("Notification from %s: %s").format(app.name, messages));
        } else {
            if (app !== undefined)
                dialog.reply(dialog._("Notification from %s").format(app.name));
            if (Array.isArray(messages))
                messages.forEach(notifyOne);
            else
                notifyOne(messages);
        }
        return true;
    },


}
