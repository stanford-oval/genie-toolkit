// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const Intent = require('./semantic').Intent;
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
    var intent = Intent.parse(json);
    var parsed = json;

    if (intent.isFailed || intent.isFallback || intent.isTrain ||
        intent.isBack || intent.isEmpty || intent.isFilter || intent.isDebug)
        throw new Error('Invalid internal intent ' + intent);

    if (intent.isNeverMind)
        return dlg._("never mind");
    if (intent.isHelp && intent.name === null)
        return dlg._("help");
    if (intent.isHelp)
        return dlg._("help %s").format(intent.name);
    if (intent.isMake)
        return dlg._("make a command");
    if (intent.isAnswer)
        return Describe.describeArg(dlg, intent.value);

    if (intent.isSetup) {
        return reconstructCanonical(dlg, intent.rule).then((reconstructed) => {
            return dlg._("ask %s to %s").format(Describe.describeArg(dlg, intent.person), reconstructed);
        });
    }

    var schemaRetriever = dlg.manager.schemas;

    if (!intent.isRule && !intent.isPrimitive)
        throw new Error('Invalid intent ' + intent);

    var triggerMeta = getMeta(schemaRetriever, intent.trigger, 'triggers');
    var queryMeta = getMeta(schemaRetriever, intent.query, 'queries');
    var actionMeta = getMeta(schemaRetriever, intent.action, 'actions');

    return Q.all([triggerMeta, queryMeta, actionMeta]).then(function([trigger, query, action]) {
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
            ThingTalk.Generate.assignSlots(triggerSlots, intent.trigger.args, triggerValues, triggerComparisons,
                                false, intent.trigger.slots, scope, toFill);

            triggerDesc = Describe.describeTrigger(dlg, {
                kind: intent.trigger.kind,
                channel: intent.trigger.channel,
                owner: intent.trigger.owner,
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
            ThingTalk.Generate.assignSlots(querySlots, intent.query.args, queryValues, queryComparisons,
                                false, intent.query.slots, scope, toFill);

            queryDesc = Describe.describeAction(dlg, {
                kind: intent.query.kind,
                channel: intent.query.channel,
                owner: intent.query.owner,
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
            ThingTalk.Generate.assignSlots(actionSlots, intent.action.args, actionValues, actionComparisons,
                                true, intent.action.slots, scope, toFill);

            actionDesc = Describe.describeAction(dlg, {
                kind: intent.action.kind,
                channel: intent.action.channel,
                owner: intent.action.owner,
                schema: action,
                resolved_args: actionValues,
                resolved_conditions: actionComparisons });
        }

        var desc;
        if (trigger && query && action)
            desc = dlg._("%s then %s if %s").format(queryDesc, actionDesc, triggerDesc);
        else if (trigger && query)
            desc = dlg._("%s if %s").format(queryDesc, triggerDesc);
        else if (trigger && action)
            desc = dlg._("%s if %s").format(actionDesc, triggerDesc);
        else if (query && action)
            desc = dlg._("%s then %s").format(queryDesc, actionDesc);
        else if (trigger)
            desc = dlg._("notify if %s").format(triggerDesc);
        else if (query)
            desc = queryDesc;
        else if (action)
            desc = actionDesc;
        if (intent.once)
            desc += dlg._(" (only once)");
        return desc;
    });
}
