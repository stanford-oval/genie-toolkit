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
const RuleDialog = require('./rule_dialog');
const DiscoveryDialog = require('./discovery_dialog');
const CommandDialog = require('./command_dialog');

module.exports = class DefaultDialog extends Dialog {
    notify(appId, event) {
        var app = this.manager.apps.getApp(appId);
        if (!app)
            return true;
        this.reply("Notification from " + app.name + ": " + event.join(', '));
        return true;
    }

    handleFailed(raw) {
        this.manager.thingpedia.getExamplesByKey(raw, true).then((examples) => {
            if (examples.length === 0)
                return this.fail();

            this.failWithOptions();
            examples.forEach((ex, i) => {
                if (i >= 5)
                    return;

                var tokens = ex.utterance.split(/\s+/);
                tokens = tokens.map((t) => t.startsWith('$') ? '_____' : t);

                this.replyButton((i+1) + ") " + tokens.join(' '), ex.target_json);
            });
        }).done();
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
        else if (analyzer.isCommand) 
            return this.switchTo(new CommandDialog(), analyzer);
        else
            return false;
    }
}
