// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const Dialog = require('./dialog');
const StateMachineDialog = require('./state_machine');

const RuleDialog = require('./dialogs/rule');
const DiscoveryDialog = require('./dialogs/discovery');
const AskAnythingDialog = require('./dialogs/ask_anything');
const ConfigDialog = require('./dialogs/config');
const HelpDialog = require('./dialogs/help');
const PermissionGrantDialog = require('./dialogs/permission_grant');
const SetupDialog = require('./dialogs/setup');
const MakeDialog = require('./dialogs/make');

const FallbackDialog = require('./fallback_dialog');


module.exports = class DefaultDialog extends Dialog {
    constructor() {
        super();

        this._lastApp = null;
    }

    notify(appId, icon, messages) {
        var app;
        if (appId !== undefined)
            app = this.manager.apps.getApp(appId);
        else
            app = undefined;

        var notifyOne = (message) => {
            if (typeof message === 'string')
                message = { type: 'text', text: message };

            if (typeof message !== 'object')
                return;

            if (message.type === 'text') {
                this.reply(message.text, icon);
            } else if (message.type === 'picture') {
                if (message.url === undefined)
                    this.reply("Sorry, I can't find the picture you want.", icon);
                else
                    this.replyPicture(message.url, icon);
            } else if (message.type === 'rdl') {
                this.replyRDL(message, icon);
            } else if (message.type === 'button') {
                this.replyButton(message.text, message.json);
            }
        };
        if (app !== undefined && app.isRunning &&
            appId !== this._lastApp &&
            ((typeof messages === 'string' && messages) ||
             (Array.isArray(messages) && messages.length === 1 && typeof messages[0] === 'string' && messages[0]))) {
            this.reply(this._("Notification from %s: %s").format(app.name, messages), icon);
        } else {
            if (app !== undefined && app.isRunning
                && appId !== this._lastApp)
                this.reply(this._("Notification from %s").format(app.name), icon);
            if (Array.isArray(messages))
                messages.forEach(notifyOne);
            else
                notifyOne(messages);
        }
        this._lastApp = appId;

        return true;
    }

    notifyError(appId, icon, error) {
        var app;
        if (appId !== undefined)
            app = this.manager.apps.getApp(appId);
        else
            app = undefined;

        var errorMessage;
        if (typeof error === 'string')
            errorMessage = error;
        else if (error.name === 'SyntaxError')
            errorMessage = this._("Syntax error at %s line %d: %s").format(error.fileName, error.lineNumber, error.message);
        else if (error.message)
            errorMessage = error.message;
        else
            errorMessage = String(error);
        console.log('Error from ' + appId, error);

        if (app !== undefined && app.isRunning)
            return this.reply(this._("%s had an error: %s.").format(app.name, errorMessage), icon);
        else
            return this.reply(this._("Sorry, that did not work: %s.").format(errorMessage), icon);
    }

    askForPermission(principal, identity, program) {
        let dialog = new StateMachineDialog(PermissionGrantDialog, identity, program);
        // bypass this.switchTo() so we get the promise out of .start()
        return this.manager.switchTo(dialog);
    }

    askQuestion(appId, icon, type, question) {
        let dialog = new StateMachineDialog(AskAnythingDialog, appId, icon, type, question);
        // bypass this.switchTo() so we get the promise out of .start()
        return this.manager.switchTo(dialog);
    }

    interactiveConfigure(kind) {
        let dialog;
        if (kind !== null)
            dialog = new StateMachineDialog(ConfigDialog, kind);
        else
            dialog = new StateMachineDialog(DiscoveryDialog);
        // bypass this.switchTo() so we get the promise out of .start()
        return this.manager.switchTo(dialog);
    }

    handle(command) {
        this._lastApp = null;

        if (command.isTrain)
            return this.switchTo(new FallbackDialog(), command);
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;
            else
                return this._continue(command);
        });
    }

    handleContextualHelp(command) {
        return this.switchTo(new MakeDialog(), command);
    }

    _continue(command) {
        if (command.isFailed || command.isFallback || command.isTrain) {
            return this.switchTo(new FallbackDialog(), command);
        } else if (command.isYes) {
            this.manager.stats.hit('sabrina-command-egg');
            return this.reply(this._("I agree, but to what?"));
        } else if (command.isNo) {
            this.manager.stats.hit('sabrina-command-egg');
            return this.reply(this._("No way!"));
        } else if (command.isProgram || command.isPrimitive) {
            this.manager.stats.hit('sabrina-command-rule');
            return this.switchTo(new StateMachineDialog(RuleDialog, command));
        } else if (command.isHelp) {
            this.manager.stats.hit('sabrina-command-help');
            return this.switchTo(new StateMachineDialog(HelpDialog, command));
        } else if (command.isMake) {
            this.manager.stats.hit('sabrina-command-make');
            return this.switchTo(new StateMachineDialog(MakeDialog, command));
        } else if (command.isSetup) {
            this.manager.stats.hit('sabrina-command-setup');
            return this.switchTo(new StateMachineDialog(SetupDialog, command));
        } else
            return this.fail();
    }
}
