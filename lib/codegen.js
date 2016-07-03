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

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

const Dialog = require('./dialog');
const SlotFillingDialog = require('./slot_filling_dialog');

function describeArg(arg) {
    if (arg.isString || arg.isNumber)
        return arg.value;
    if (arg.isMeasure)
        return arg.value + ' ' + arg.unit;
    if (arg.isBoolean)
        return arg.value ? 'on' : 'off';
    return String(arg);
}

function describeTrigger(kind, channel, schema, args) {
    var confirm = schema.confirmation || (channel + ' on ' + kind);

    schema.schema.forEach(function(type, i) {
        if (args[i] !== undefined)
            confirm += ' and ' + schema.args[i] + ' is ' + describeArg(args[i]);
    });

    return confirm;
}

function describeAction(kind, channel, schema, args) {
    var confirm = schema.confirmation;
    if (confirm && (confirm.indexOf('$') >= 0 || args.length === 0)) {
        schema.schema.forEach(function(type, i) {
            confirm = confirm.replace('$' + schema.args[i], describeArg(args[i]));
        });
        return confirm;
    } else {
        return describeTrigger(kind, channel, schema, args);
    }
}

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}

function capitalizeSelector(kind, channel) {
    if (kind === '$builtin')
        return capitalize(channel);
    else
        return capitalize(kind);
}

function codegen(schemas, trigger, action) {
    var triggerParams = [];
    var triggerPredicates = [];
    var triggerConditions = [];
    var triggerParams = trigger.resolved_args.map(function(arg, i) {
        if (arg === undefined) {
            return Ast.Expression.VarRef(trigger.schema.args[i]);
        } else {
            return Ast.Expression.Constant(arg);
        }
    }, this);
    trigger.resolved_conditions.map(function(cond) {
        var varRef = Ast.Expression.VarRef(cond.name);
        var value = Ast.Expression.Constant(cond.value);

        const BINARY_OPS = { 'is': '=', '>': '>', '<': '<' };
        const FUNCTION_OPS = { 'has': 'contains' };

        if (cond.operator === 'contains') {
            value = Ast.Expression.Constant(Ast.Value.String(regexify(cond.value.value)));
            var flags = Ast.Expression.Constant(Ast.Value.String("i"));
            triggerPredicates.push(Ast.Expression.FunctionCall('regex', [varRef, value, flags]));
        } else if (cond.operator in BINARY_OPS)
            triggerConditions.push(Ast.Expression.BinaryOp(varRef, value, BINARY_OPS[cond.operator]));
        else if (cond.operator in FUNCTION_OPS)
            triggerConditions.push(Ast.Expression.FunctionCall(FUNCTION_OPS[cond.operator], [varRef, value]));
        else
            throw new Error('Unsupported operator ' + cond.operator);
    });
    if (trigger.kind === '$builtin') {
        var triggerSel = Ast.Selector.Builtin(trigger.channel);
        var triggerPart = Ast.RulePart.Invocation(triggerSel, null,
                                                  triggerParams);
    } else {
        var triggerSel = Ast.Selector.GlobalName(trigger.kind);
        var triggerPart = Ast.RulePart.Invocation(triggerSel, trigger.channel,
                                                  triggerParams);
    }
    var actionParams = action.resolved_args.map(function(arg) {
        if (arg.isVarRef)
            return Ast.Expression.VarRef(arg.name);
        else
            return Ast.Expression.Constant(arg);
    });
    if (action.kind === '$builtin') {
        var actionSel = Ast.Selector.Builtin(action.channel);
        var actionPart = Ast.RulePart.Invocation(actionSel, null,
                                                 actionParams);
    } else {
        var actionSel = Ast.Selector.GlobalName(action.kind);
        var actionPart = Ast.RulePart.Invocation(actionSel, action.channel,
                                                 actionParams);
    }

    triggerConditions = triggerConditions.map((c) => Ast.RulePart.Condition(c));
    triggerPredicates = triggerPredicates.map((c) => Ast.RulePart.BuiltinPredicate(c));
    var rule = Ast.Statement.Rule([[triggerPart].concat(triggerPredicates).concat(triggerConditions),
                                   [actionPart]]);

    var progName = 'SabrinaGenerated' +
            capitalizeSelector(trigger.kind, trigger.channel) +
            'To' +
            capitalizeSelector(action.kind, action.channel);
    var program = Ast.Program(Ast.Keyword(progName, false), [], [rule]);

    // check that this program compiles
    var compiler = new ThingTalk.Compiler();
    compiler.setSchemaRetriever(schemas);
    return compiler.compileProgram(program).then(() => {
        return ThingTalk.codegen(program);
    });
}

function assignSlots(slots, prefilled, values, comparisons, fillAll, toFill) {
    slots.forEach((slot, i) => {
        var found = false;
        for (var pre of prefilled) {
            if (pre.name !== slot.name)
                continue;

            if (pre.operator === 'is') {
                Type.typeUnify(slot.type, Ast.typeForValue(pre.value));

                values[i] = pre.value;
                pre.assigned = true;
                found = true;
                break;
            }
        }

        if (!found) {
            values[i] = undefined;
            if (fillAll)
                toFill.push(i);
        }
    });

    prefilled.forEach((pre) => {
        var found = false;
        for (var slot of slots) {
            if (slot.name === pre.name) {
                found = true;
                break;
            }
        }

        if (!found)
            throw new Error("I don't know what to do with " + pre.name + " " + pre.operator + " " + pre.value);

        if (pre.assigned)
            return;

        comparisons.push(pre);
    });
    if (fillAll && comparisons.length > 0)
        throw new Error("Actions cannot have conditions");
}

module.exports = {
    codegen: codegen,
    assignSlots: assignSlots,
    describeTrigger: describeTrigger,
    describeAction: describeAction,
}
