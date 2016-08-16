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
    notify(appId, messages) {
        return Helpers.notify(this, appId, messages);
    }

    handle(command) {
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
        if (command.isFailed || command.isFallback)
            return this.switchTo(new FallbackDialog(), command);
        else if (command.isYes)
            return this.reply(this._("I agree, but to what?"));
        else if (command.isNo)
            return this.reply(this._("No way!"));
        else if (command.isQuestion) {
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
