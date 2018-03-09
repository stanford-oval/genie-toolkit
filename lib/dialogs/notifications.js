// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Helpers = require('../helpers');

function* showNotification(dlg, appId, icon, outputType, outputValue, currentChannel, lastApp) {
    let app;
    if (appId !== undefined)
        app = dlg.manager.apps.getApp(appId);
    else
        app = undefined;

    let messages = yield dlg.formatter.formatForType(outputType, outputValue, 'messages');

    let notifyOne = (message) => {
        if (typeof message === 'string')
            message = { type: 'text', text: message };

        if (typeof message !== 'object')
            return Promise.resolve();

        if (message.type === 'text') {
            return dlg.reply(message.text, icon);
        } else if (message.type === 'picture') {
            if (message.url === undefined)
                return dlg.reply("Sorry, I can't find the picture you want.", icon);
            else
                return dlg.replyPicture(message.url, icon);
        } else if (message.type === 'rdl') {
            return dlg.replyRDL(message, icon);
        } else if (message.type === 'button') {
            return dlg.replyButton(message.text, message.json);
        } else if (message.type === 'program') {
            return Helpers.loadOneExample(dlg, message.program).then((loaded) => {
                if (loaded === null)
                    return;
                dlg.replyButton(Helpers.presentExample(dlg, loaded.utterance), loaded.target);
            });
        } else {
            return Promise.resolve();
        }
    };
    if (app !== undefined && app.isRunning &&
        appId !== lastApp &&
        ((typeof messages === 'string' && messages) ||
         (Array.isArray(messages) && messages.length === 1 && typeof messages[0] === 'string' && messages[0]))) {
        dlg.reply(dlg._("Notification from %s: %s").format(app.name, messages), icon);
    } else {
        if (app !== undefined && app.isRunning
            && appId !== lastApp)
            dlg.reply(dlg._("Notification from %s").format(app.name), icon);
        if (Array.isArray(messages))
            messages.forEach(notifyOne);
        else
            yield notifyOne(messages);
    }
}

function* showError(dlg, appId, icon, error, lastApp) {
    let app;
    if (appId !== undefined)
        app = dlg.manager.apps.getApp(appId);
    else
        app = undefined;

    let errorMessage;
    if (typeof error === 'string')
        errorMessage = error;
    else if (error.name === 'SyntaxError')
        errorMessage = dlg._("Syntax error at %s line %d: %s").format(error.fileName, error.lineNumber, error.message);
    else if (error.message)
        errorMessage = error.message;
    else
        errorMessage = String(error);
    console.log('Error from ' + appId, error);

    if (app !== undefined && app.isRunning)
        yield dlg.reply(dlg._("%s had an error: %s.").format(app.name, errorMessage), icon);
    else
        yield dlg.reply(dlg._("Sorry, that did not work: %s.").format(errorMessage), icon);
}

module.exports = {
    showNotification,
    showError
};
