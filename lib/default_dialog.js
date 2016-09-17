// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const Helpers = require('./helpers');
const Dialog = require('./dialog');
const QuestionDialog = require('./question_dialog');
const ActionDialog = require('./action_dialog');
const TriggerDialog = require('./trigger_dialog');
const QueryDialog = require('./query_dialog');
const RuleDialog = require('./rule_dialog');
const DiscoveryDialog = require('./discovery_dialog');
const ConfigDialog = require('./config_dialog');
const HelpDialog = require('./help_dialog');
const ListDialog = require('./list_dialog');
const FallbackDialog = require('./fallback_dialog');
const SettingDialog = require('./setting_dialog');

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
            }
        }
        if (app !== undefined && app.isRunning &&
            appId !== this._lastApp &&
            (typeof messages === 'string' && messages) ||
            (Array.isArray(messages) && messages.length === 1 && typeof messages[0] === 'string' && messages[0])) {
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

        if (app !== undefined && app.isRunning)
            this.reply(this._("%s had an error: %s.").format(app.name, errorMessage), icon);
        else
            this.reply(this._("Sorry, that did not work: %s.").format(errorMessage), icon);
        return true;
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
        return this.switchTo(new HelpDialog(), command);
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
        } else if (command.isEasterEgg) {
            this.manager.stats.hit('sabrina-command-egg');
            switch (command.egg) {
            case 'tt:root.special.hello':
                var prefs = this.manager.platform.getSharedPreferences();
                return this.reply(this._("Hi, %s.").format(prefs.get('sabrina-name')));
            case 'tt:root.special.thankyou':
                return this.reply(this._("At your service."));
            case 'tt:root.special.sorry':
                this.reply(this._("No need to be sorry."));
                this.reply(this._("Unless you're Canadian. Then I won't stop you."));
                return true;
            case 'tt:root.special.cool':
                return this.reply(this._("I know, right?"));
            default:
                return this.fail();
            }
        } else if (command.isQuestion) {
            this.manager.stats.hit('sabrina-command-question');
            return this.switchTo(new QuestionDialog(), command);
        } else if (command.isRule) {
            this.manager.stats.hit('sabrina-command-rule');
            return this.switchTo(new RuleDialog(), command);
        } else if (command.isAction) {
            this.manager.stats.hit('sabrina-command-action');
            return this.switchTo(new ActionDialog(), command);
        } else if (command.isTrigger) {
            this.manager.stats.hit('sabrina-command-trigger');
            return this.switchTo(new TriggerDialog(), command);
        } else if (command.isQuery) {
            this.manager.stats.hit('sabrina-command-query');
            return this.switchTo(new QueryDialog(), command);
        } else if (command.isDiscovery) {
            this.manager.stats.hit('sabrina-command-discovery');
            return this.switchTo(new DiscoveryDialog(), command);
        } else if (command.isConfigure) {
            this.manager.stats.hit('sabrina-command-configure');
            return this.switchTo(new ConfigDialog(), command);
        } else if (command.isList) {
            this.manager.stats.hit('sabrina-command-list');
            return this.switchTo(new ListDialog(), command);
        } else if (command.isHelp) {
            this.manager.stats.hit('sabrina-command-help');
            return this.switchTo(new HelpDialog(), command);
        } else if (command.isSetting) {
            this.manager.stats.hit('sabrina-command-setting');
            return this.switchTo(new SettingDialog(), command);
        }  else
            return false;
    }
}
