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
const RuleDialog = require('./rule_dialog');
const DiscoveryDialog = require('./discovery_dialog');
const ConfigDialog = require('./config_dialog');
const HelpDialog = require('./help_dialog');
const FallbackDialog = require('./fallback_dialog');
const MakeDialog = require('./make_dialog');
const PermissionGrantDialog = require('./permission_grant_dialog');
const AskAnythingDialog = require('./ask_anything_dialog');
const SetupDialog = require('./setup_dialog');

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

    askForPermission(principal, identity, invocation) {
        var defer = Q.defer();
        var dialog = new PermissionGrantDialog(principal, identity, invocation, defer);

        Q(this.switchTo(dialog)).then((handled) => {
            if (!handled)
                throw new Error('Internal Error');
        }).catch((e) => defer.reject(e)).done();
        return defer.promise;
    }

    askQuestion(appId, icon, type, question) {
        var defer = Q.defer();
        var dialog = new AskAnythingDialog(appId, icon, type, question, defer);

        Q(this.switchTo(dialog)).then((handled) => {
            if (!handled)
                throw new Error('Internal Error');
        }).catch((e) => defer.reject(e)).done();
        return defer.promise;
    }

    interactiveConfigure(kind) {
        var dialog;
        if (kind !== null)
            dialog = new ConfigDialog(kind);
        else
            dialog = new DiscoveryDialog();
        this.switchTo(dialog);
        return dialog.continue();
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
            return this.switchTo(new RuleDialog(), command);
        } else if (command.isHelp) {
            this.manager.stats.hit('sabrina-command-help');
            return this.switchTo(new HelpDialog(), command);
        } else if (command.isMake) {
            this.manager.stats.hit('sabrina-command-make');
            return this.switchTo(new MakeDialog(), command);
        } else if (command.isSetup) {
            this.manager.stats.hit('sabrina-command-setup');
            return this.switchTo(new SetupDialog(), command);
        } else
            return this.fail();
    }
}
