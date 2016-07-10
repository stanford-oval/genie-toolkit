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

module.exports = class DefaultDialog extends Dialog {
    notify(appId, messages) {
        return Helpers.notify(this, appId, messages);
    }

    handleFailed(command) {
        if (this.handleGeneric(command))
            return true;

        this.switchTo(new FallbackDialog(command.raw));
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
        else if (analyzer.isTrigger)
            return this.switchTo(new TriggerDialog(), analyzer);
        else if (analyzer.isQuery)
            return this.switchTo(new QueryDialog(), analyzer);
        else if (analyzer.isDiscovery)
            return this.switchTo(new DiscoveryDialog(), analyzer);
        else if (analyzer.isConfigure)
            return this.switchTo(new ConfigDialog(), analyzer);
        else if (analyzer.isHelp)
            return this.switchTo(new HelpDialog(), analyzer);
        else if (analyzer.isList)
            return this.switchTo(new ListDialog(), analyzer);
        else
            return false;
    }
}
