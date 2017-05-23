// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const SemanticAnalyzer = require('./semantic');
const ThingTalk = require('thingtalk');
const Describe = require('./describe');

function getMeta(schemaRetriever, obj, what) {
    if (obj === null)
        return null;
    if (obj.schema)
        return Q(obj.schema);
    return schemaRetriever.getMeta(obj.kind, what, obj.channel);
}

module.exports = function reconstructCanonical(dlg, json) {
    var analyzed = new SemanticAnalyzer(json);
    var parsed = analyzed.root;

    if (analyzed.isSpecial) {
        switch (analyzed.special) {
        case 'tt:root.special.debug':
            return 'debug';
        case 'tt:root.special.help':
            return dlg._("help");
        case 'tt:root.special.nevermind':
            return dlg._("never mind");
        case 'tt:root.special.failed':
            return dlg._("none of the above");
        case 'tt:root.special.makerule':
            return dlg._("make a command");
        default:
            return analyzed.special.substr('tt:root.special.'.length);
        }
    }
    // differentiate true/false even if they end up with the same semantic
    // analysis
    if (analyzed.isYes)
        return parsed.answer ? dlg._("true") : dlg._("yes");
    if (analyzed.isNo)
        return parsed.answer ? dlg._("false") : dlg._("no");

    if (analyzed.isAnswer)
        return Describe.describeArg(dlg, analyzed.value);
    if (analyzed.isHelp)
        return dlg._("help %s").format(analyzed.name);
    if (analyzed.isSetting)
        return dlg._("my name is %s").format(analyzed.name);

    var schemaRetriever = dlg.manager.schemas;

    if (analyzed.isRule) {
        var triggerMeta = getMeta(schemaRetriever, analyzed.trigger, 'triggers');
        var queryMeta = getMeta(schemaRetriever, analyzed.query, 'queries');
        var actionMeta = getMeta(schemaRetriever, analyzed.action, 'actions');

        return Q.all([triggerMeta, queryMeta, actionMeta]).spread(function(trigger, query, action) {
            var scope = {};
            var triggerDesc, queryDesc, actionDesc;

            // make up slots
            if (trigger !== null) {
                var triggerSlots = trigger.schema.map(function(type, i) {
                    return { name: trigger.args[i], type: type,
                             question: trigger.questions[i],
                             required: (trigger.required[i] || false) };
                });

                var triggerValues = new Array(triggerSlots.length);
                var triggerComparisons = [];
                var toFill = [];
                ThingTalk.Generate.assignSlots(triggerSlots, analyzed.trigger.args, triggerValues, triggerComparisons,
                                    false, analyzed.trigger.slots, scope, toFill);

                triggerDesc = Describe.describeTrigger(dlg, {
                    kind: analyzed.trigger.kind,
                    channel: analyzed.trigger.channel,
                    owner: analyzed.trigger.owner,
                    schema: trigger,
                    resolved_args: triggerValues,
                    resolved_conditions: triggerComparisons });
            }

            if (query !== null) {
                var querySlots = query.schema.map(function(type, i) {
                    return { name: query.args[i], type: type,
                             question: query.questions[i],
                             required: (query.required[i] || false) };
                });

                var queryValues = new Array(querySlots.length);
                var queryComparisons = [];
                var toFill = [];
                ThingTalk.Generate.assignSlots(querySlots, analyzed.query.args, queryValues, queryComparisons,
                                    false, analyzed.query.slots, scope, toFill);

                queryDesc = Describe.describeAction(dlg, {
                    kind: analyzed.query.kind,
                    channel: analyzed.query.channel,
                    owner: analyzed.query.owner,
                    schema: query,
                    resolved_args: queryValues,
                    resolved_conditions: queryComparisons });
            }

            if (action !== null) {
                var actionSlots = action.schema.map(function(type, i) {
                    return { name: action.args[i], type: type,
                             question: action.questions[i],
                             required: (action.required[i] || false) };
                });

                var actionValues = new Array(actionSlots.length);
                var actionComparisons = [];
                var toFill = [];
                ThingTalk.Generate.assignSlots(actionSlots, analyzed.action.args, actionValues, actionComparisons,
                                    true, analyzed.action.slots, scope, toFill);

                actionDesc = Describe.describeAction(dlg, {
                    kind: analyzed.action.kind,
                    channel: analyzed.action.channel,
                    owner: analyzed.action.owner,
                    schema: action,
                    resolved_args: actionValues,
                    resolved_conditions: actionComparisons });
            }

            if (trigger && query && action)
                return dlg._("%s then %s if %s").format(queryDesc, actionDesc, triggerDesc);
            else if (trigger && query)
                return dlg._("%s if %s").format(queryDesc, triggerDesc);
            else if (trigger && action)
                return dlg._("%s if %s").format(actionDesc, triggerDesc);
            else if (query && action)
                return dlg._("%s then %s").format(queryDesc, actionDesc);
            else if (trigger)
                return this._("notify if %s").format(triggerDesc);
            else if (query)
                return queryDesc;
            else if (action)
                return actionDesc;
        });
    }
}
