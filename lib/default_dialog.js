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

const Dialog = require('./dialog');
const QuestionDialog = require('./question_dialog');
const ActionDialog = require('./action_dialog');
const TriggerDialog = require('./trigger_dialog');
const RuleDialog = require('./rule_dialog');
const DiscoveryDialog = require('./discovery_dialog');
const ConfigDialog = require('./config_dialog');
const HelpDialog = require('./help_dialog');
const ListDialog = require('./list_dialog');
const FallbackDialog = require('./fallback_dialog');

module.exports = class DefaultDialog extends Dialog {
    notify(appId, messages) {
        var app = this.manager.apps.getApp(appId);
        if (!app)
            return true;

        var notifyOne = (message) => {
            if (typeof message === 'string')
                message = { type: 'text', text: message };

            if (typeof message !== 'object')
                return;

            if (message.type === 'text') {
                this.reply(message.text);
            } else if (message.type === 'picture') {
                this.replyPicture(message.url);
            } else if (message.type === 'rdl') {
                this.replyRDL(message);
            }
        }
        if ((typeof messages === 'string' && messages) ||
            (Array.isArray(messages) && messages.length === 1 && typeof messages[0] === 'string' && messages[0])) {
            this.reply("Notification from " + app.name + ": " + messages);
        } else {
            this.reply("Notification from " + app.name);
            if (Array.isArray(messages))
                messages.forEach(notifyOne);
            else
                notifyOne(messages);
        }
        return true;
    }

    handleFailed(raw) {
        this.switchTo(new FallbackDialog(raw));
        return true;
    }

    handle(analyzer) {
        if (this.handleGeneric(analyzer))
            return true;

        if (analyzer.isYes)
            return this.reply("I agree, but to what?");
        else if (analyzer.isNo)
            return this.reply("No way!");
        else if (analyzer.isQuestion)
            return this.switchTo(new QuestionDialog(), analyzer);
        else if (analyzer.isRule)
            return this.switchTo(new RuleDialog(), analyzer);
        else if (analyzer.isAction)
            return this.switchTo(new ActionDialog(), analyzer);
        else if (analyzer.isDiscovery)
            return this.switchTo(new DiscoveryDialog(), analyzer);
        else if (analyzer.isConfigure)
            return this.switchTo(new ConfigDialog(), analyzer);
        else if (analyzer.isHelp)
            return this.switchTo(new HelpDialog(), analyzer);
        else if (analyzer.isList)
            return this.switchTo(new ListDialog(), analyzer);
        else if (analyzer.isTrigger)
            return this.switchTo(new TriggerDialog(), analyzer);
        else
            return false;
    }
}
