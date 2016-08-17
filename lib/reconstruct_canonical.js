// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const SemanticAnalyzer = require('./semantic');
const Codegen = require('./codegen');

const SPECIAL_TO_CANONICAL = {
    hello: 'hello',
    debug: 'debug',
    help: 'help',
    thankyou: 'thank you',
    sorry: 'sorry',
    cool: 'cool',
    nevermind: 'never mind',
    yes: 'yes',
    no: 'no'
}

module.exports = function reconstructCanonical(dlg, json) {
    var parsed = JSON.parse(json);
    var analyzed = new SemanticAnalyzer(parsed);

    if (analyzed.isSpecial) {
        switch (analyzed.special) {
        case 'tt:root.special.hello':
            return dlg._("hello");
        case 'tt:root.special.debug':
            return 'debug';
        case 'tt:root.special.help':
            return dlg._("help");
        case 'tt:root.special.thankyou':
            return dlg._("thank you");
        case 'tt:root.special.sorry':
            return dlg._("sorry");
        case 'tt:root.special.cool':
            return dlg._("cool");
        case 'tt:root.special.nevermind':
            return dlg._("never mind");
        default:
            return analyzer.special.substr('tt:root.special.'.length);
        }
    }
    if (analyzed.isYes)
        return dlg._("yes");
    if (analyzed.isNo)
        return dlg._("no");
    if (analyzed.isAnswer)
        return Codegen.describeArg(dlg, analyzer.value);
    if (analyzed.isDiscovery)
        return dlg._("search for devices");
    if (analyzed.isList) {
        switch (analyzed.list) {
        case 'device':
            return dlg._("list devices");
        case 'query':
        case 'command':
            return dlg._("list commands");
        default:
            return 'list ' + analyzed.list;
        }
    }
    if (analyzed.isHelp)
        return dlg._("help %s").format(analyzed.name);
    if (analyzed.isConfigure)
        return dlg._("configure %s").format(analyzed.name);
    if (analyzed.isSetting)
        return dlg._("my name is %s").format(analyzed.name);

    var schemaRetriever = dlg.manager.schemas;

    if (analyzed.isRule) {
        if (analyzed.query) {
            return Q.all([schemaRetriever.getMeta(analyzed.trigger.kind, 'triggers', analyzed.trigger.channel),
                          schemaRetriever.getMeta(analyzed.query.kind, 'queries', analyzed.query.channel)])
                .spread(function(trigger, query) {
                // make up slots
                var triggerSlots = trigger.schema.map(function(type, i) {
                    return { name: trigger.args[i], type: type,
                             question: trigger.questions[i],
                             required: (trigger.required[i] || false) };
                });

                var triggerValues = new Array(triggerSlots.length);
                var triggerComparisons = [];
                var toFill = [];
                Codegen.assignSlots(triggerSlots, analyzed.trigger.args, triggerValues, triggerComparisons,
                                    false, analyzed.trigger.slots, toFill);

                var querySlots = query.schema.map(function(type, i) {
                    return { name: query.args[i], type: type,
                             question: query.questions[i],
                             required: (query.required[i] || false) };
                });

                var queryValues = new Array(querySlots.length);
                var queryComparisons = [];
                var toFill = [];
                Codegen.assignSlots(querySlots, analyzed.query.args, queryValues, queryComparisons,
                                    false, analyzed.query.slots, toFill);

                return dlg._("%s if %s").format(Codegen.describeAction(dlg, analyzed.query.kind,
                                                                        analyzed.query.channel,
                                                                        query, queryValues, queryComparisons),
                                                Codegen.describeTrigger(dlg, analyzed.trigger.kind,
                                                                        analyzed.trigger.channel,
                                                                        trigger, triggerValues, triggerComparisons));
            });
        } else {
            return Q.all([schemaRetriever.getMeta(analyzed.trigger.kind, 'triggers', analyzed.trigger.channel),
                          schemaRetriever.getMeta(analyzed.action.kind, 'actions', analyzed.action.channel)])
                .spread(function(trigger, action) {
                // make up slots
                var triggerSlots = trigger.schema.map(function(type, i) {
                    return { name: trigger.args[i], type: type,
                             question: trigger.questions[i],
                             required: (trigger.required[i] || false) };
                });

                var triggerValues = new Array(triggerSlots.length);
                var triggerComparisons = [];
                var toFill = [];
                Codegen.assignSlots(triggerSlots, analyzed.trigger.args, triggerValues, triggerComparisons,
                                    false, analyzed.trigger.slots, toFill);

                var actionSlots = action.schema.map(function(type, i) {
                    return { name: action.args[i], type: type,
                             question: action.questions[i],
                             required: (action.required[i] || false) };
                });

                var actionValues = new Array(actionSlots.length);
                var actionComparisons = [];
                var toFill = [];
                Codegen.assignSlots(actionSlots, analyzed.action.args, actionValues, actionComparisons,
                                    true, analyzed.action.slots, toFill);

                return dlg._("%s if %s").format(Codegen.describeAction(dlg, analyzed.action.kind,
                                                                        analyzed.action.channel,
                                                                        action, actionValues, actionComparisons),
                                                Codegen.describeTrigger(dlg, analyzed.trigger.kind,
                                                                        analyzed.trigger.channel,
                                                                        trigger, triggerValues, triggerComparisons));
            });
        }
    }

    // action, trigger, query
    var name, args, schemaType;
    if (parsed.action) {
        schemaType = 'actions';
    } else if (parsed.query) {
        schemaType = 'queries';
    } else if (parsed.trigger) {
        schemaType = 'triggers';
    } else {
        throw new TypeError('Not action, query or trigger');
    }

    return schemaRetriever.getMeta(analyzed.kind, schemaType, analyzed.channel).then(function(meta) {
        // make up slots
        var slots = meta.schema.map(function(type, i) {
            return { name: meta.args[i], type: type,
                     question: meta.questions[i],
                     required: (meta.required[i] || false) };
        });

        var values = new Array(slots.length);
        var comparisons = [];
        var toFill = [];
        Codegen.assignSlots(slots, analyzed.args, values, comparisons,
                            analyzed.isAction, analyzed.slots, toFill);

        if (analyzed.isTrigger) {
            return dlg._("notify if %s").format(Codegen.describeTrigger(dlg, analyzed.kind,
                                                                        analyzed.channel,
                                                                        meta, values, comparisons));
        } else {
            return Codegen.describeAction(dlg, analyzed.kind,
                                          analyzed.channel,
                                          meta, values, comparisons);
        }
    });
}
