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
        default:
            return analyzed.special.substr('tt:root.special.'.length);
        }
    }
    if (analyzed.isEasterEgg) {
        return null;
        switch (analyzed.egg) {
        case 'tt:root.special.hello':
            return dlg._("hello");
        case 'tt:root.special.thankyou':
            return dlg._("thank you");
        case 'tt:root.special.sorry':
            return dlg._("sorry");
        case 'tt:root.special.cool':
            return dlg._("cool");
        default:
            return analyzed.egg.substr('tt:root.special.'.length);
        }
    }
    // differentiate true/false even if they end up with the same semantic
    // analysis
    if (analyzed.isYes)
        return parsed.answer ? dlg._("true") : dlg._("yes");
    if (analyzed.isNo)
        return parsed.answer ? dlg._("false") : dlg._("no");

    if (analyzed.isAnswer)
        return Codegen.describeArg(dlg, analyzed.value);
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
    if (analyzed.isMake && analyzed.name === 'rule')
        return dlg._("make a rule");

    var schemaRetriever = dlg.manager.schemas;

    if (analyzed.isRule) {
        var triggerMeta = analyzed.trigger !== null ? schemaRetriever.getMeta(analyzed.trigger.kind, 'triggers', analyzed.trigger.channel) : null;
        var queryMeta = analyzed.query !== null ? schemaRetriever.getMeta(analyzed.query.kind, 'queries', analyzed.query.channel) : null;
        var actionMeta = analyzed.action !== null ? schemaRetriever.getMeta(analyzed.action.kind, 'actions', analyzed.action.channel) : null;

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
                Codegen.assignSlots(triggerSlots, analyzed.trigger.args, triggerValues, triggerComparisons,
                                    false, analyzed.trigger.slots, scope, toFill);

                triggerDesc = Codegen.describeTrigger(dlg, analyzed.trigger.kind,
                                                      analyzed.trigger.channel,
                                                      trigger, triggerValues, triggerComparisons);
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
                Codegen.assignSlots(querySlots, analyzed.query.args, queryValues, queryComparisons,
                                    false, analyzed.query.slots, scope, toFill);

                queryDesc = Codegen.describeAction(dlg, analyzed.query.kind,
                                                   analyzed.query.channel,
                                                   query, queryValues, queryComparisons);
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
                Codegen.assignSlots(actionSlots, analyzed.action.args, actionValues, actionComparisons,
                                    true, analyzed.action.slots, scope, toFill);

                actionDesc = Codegen.describeAction(dlg, analyzed.action.kind,
                                                    analyzed.action.channel,
                                                    action, actionValues, actionComparisons);
            }

            if (trigger && query && action)
                return dlg._("%s then %s if %s").format(queryDesc, actionDesc, triggerDesc);
            else if (trigger && query)
                return dlg._("%s if %s").format(queryDesc, triggerDesc);
            else if (trigger && action)
                return dlg._("%s if %s").format(actionDesc, triggerDesc);
            else if (query && action)
                return dlg._("%s then %s").format(queryDesc, actionDesc);
            else
                throw new TypeError("Must have at least 2 among trigger, query and action");
        });
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
        var scope = {};
        var slots = meta.schema.map(function(type, i) {
            return { name: meta.args[i], type: type,
                     question: meta.questions[i],
                     required: (meta.required[i] || false) };
        });

        var values = new Array(slots.length);
        var comparisons = [];
        var toFill = [];
        Codegen.assignSlots(slots, analyzed.args, values, comparisons,
                            analyzed.isAction, analyzed.slots, scope, toFill);

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
