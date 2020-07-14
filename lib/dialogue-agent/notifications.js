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

const Helpers = require('./helpers');

async function showNotification(dlg, appId, icon, outputType, outputValue, lastApp) {
    let app;
    if (appId !== undefined)
        app = dlg.manager.apps.getApp(appId);
    else
        app = undefined;

    let messages;
    if (outputType !== null)
        messages = await dlg.formatter.formatForType(outputType, outputValue, 'messages');
    else
        messages = outputValue;
    if (!Array.isArray(messages))
        messages = [messages];

    let notifyOne = async (message) => {
        if (typeof message === 'string')
            message = { type: 'text', text: message };

        if (typeof message !== 'object')
            return;

        if (message.type === 'text') {
            await dlg.reply(message.text, icon);
        } else if (message.type === 'picture') {
            if (message.url === undefined)
                await dlg.reply("Sorry, I can't find the picture you want.", icon);
            else
                await dlg.replyPicture(message.url, icon);
        } else if (message.type === 'rdl') {
            await dlg.replyRDL(message, icon);
        } else if (message.type === 'button') {
            await dlg.replyButton(message.text, message.json);
        } else if (message.type === 'program') {
            const loaded = Helpers.loadOneExample(dlg, message.program);
            await dlg.replyButton(Helpers.presentExample(dlg, loaded.utterance), loaded.target);
        } else {
            await dlg.replyResult(message, icon);
        }
    };
    if (app !== undefined && app.isRunning && appId !== lastApp &&
        (messages.length === 1 && (typeof messages[0] === 'string' || messages[0].type === 'text'))) {
        const msg = typeof messages[0] === 'string' ? messages[0] : messages[0].text;
        await dlg.replyInterp(dlg._("Notification from ${app}: ${message}"), {
            app: app.name,
            message: msg
        }, icon);
    } else {
        if (app !== undefined && app.isRunning && appId !== lastApp)
            await dlg.replyInterp(dlg._("Notification from ${app}"), { app: app.name }, icon);
        for (let msg of messages)
            await notifyOne(msg);
    }
}

async function showError(dlg, appId, icon, error, lastApp) {
    let app;
    if (appId !== undefined)
        app = dlg.manager.apps.getApp(appId);
    else
        app = undefined;

    let errorMessage = Helpers.formatError(dlg, error);
    console.log('Error from ' + appId, error);

    if (app !== undefined && app.isRunning)
        await dlg.replyInterp(dlg._("${app} had an error: ${error}."), { app: app.name, error: errorMessage }, icon);
    else
        await dlg.replyInterp(dlg._("Sorry, that did not work: ${error}."), { error: errorMessage }, icon);
}

module.exports = {
    showNotification,
    showError
};
