// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
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

function describeArg(dlg, arg) {
    // arg.display is half-broken for var refs
    if (arg.isVarRef) {
        if (arg.name.startsWith('$contact('))
            return arg.name.substring('$contact('.length, arg.name.length-1);
        switch (arg.name) {
        case '$context.location.current_location':
            return dlg._("here");
        case '$context.location.home':
            return dlg._("at home");
        case '$context.location.work':
            return dlg._("at work");
        case '$event':
            return dlg._("the event");
        case '$event.title':
            return dlg._("the event's title");
        case '$event.body':
            return dlg._("the event's long description");
        default:
            if (!arg.display)
                arg.display = arg.name.replace(/_/g, ' ').replace(/([^A-Z])([A-Z])/g, '$1 $2').toLowerCase();
            // continue
        }
    }
    if (arg.display)
        return arg.display;
    if (arg.isString)
        return '"' + arg.value + '"';
    if (arg.isEntity)
        return arg.value;
    if (arg.isNumber || arg.isEnum || arg.isPhoneNumber || arg.isEmailAddress || arg.isURL)
        return arg.value;
    if (arg.isMeasure)
        return arg.value + ' ' + arg.unit;
    if (arg.isBoolean)
        return arg.value ? dlg._("on") : dlg._("off");

    return String(arg);
}

function describeTrigger(dlg, kind, channel, schema, args, comparisons) {
    var confirm = schema.confirmation || (dlg._("%s on %s").format(channel, kind));

    var substitutedArgs = new Set;
    if (confirm.indexOf('$') >= 0) {
        schema.schema.forEach(function(type, i) {
            if (confirm.indexOf('$' + schema.args[i]) >= 0)
                substitutedArgs.add(schema.args[i]);
            if (args[i] !== undefined)
                confirm = confirm.replace('$' + schema.args[i], describeArg(dlg, args[i]));
            else
                confirm = confirm.replace('$' + schema.args[i], '____');
        });
    }

    schema.schema.forEach(function(type, i) {
        if (substitutedArgs.has(schema.args[i]))
            return;
        if (args[i] !== undefined)
            confirm += dlg._(" and %s is %s").format(schema.argcanonicals[i] || schema.args[i], describeArg(dlg, args[i]));
    });
    comparisons.forEach(function(comp) {
        var argcanonical = undefined;
        for (var i = 0; i < schema.args.length; i++) {
            if (schema.args[i] === comp.name) {
                argcanonical = schema.argcanonicals[i];
                break;
            }
        }
        if (!argcanonical)
            argcanonical = comp.name;

        switch (comp.operator) {
        case 'has':
            confirm += dlg._(" and %s has %s").format(argcanonical, describeArg(dlg, comp.value));
            break;
        case 'contains':
            confirm += dlg._(" and %s contains %s").format(argcanonical, describeArg(dlg, comp.value));
            break;
        case 'is':
            confirm += dlg._(" and %s is %s").format(argcanonical, describeArg(dlg, comp.value));
            break;
        case '<':
            confirm += dlg._(" and %s is less than %s").format(argcanonical, describeArg(dlg, comp.value));
            break;
        case '>':
            confirm += dlg._(" and %s is greater than %s").format(argcanonical, describeArg(dlg, comp.value));
            break;
        }
    });

    return confirm;
}

function capitalize(str) {
    return (str[0].toUpperCase() + str.substr(1)).replace(/[\-_]([a-z])/g, function(whole, char) { return char.toUpperCase(); }).replace(/[\-_]/g, '');
}

function capitalizeSelector(kind, channel) {
    if (kind === 'builtin')
        return capitalize(channel);
    else
        return capitalize(kind);
}

function codegenInvocation(invocation, params) {
    var sel, part;
    var typeAttr = Ast.Attribute('type', invocation.kind);
    if (invocation.id) {
        var idAttr = Ast.Attribute('id', invocation.id);
        sel = Ast.Selector.Attributes([typeAttr, idAttr]);
    } else {
        sel = Ast.Selector.Attributes([typeAttr]);
    }
    part = Ast.RulePart.Invocation(sel, invocation.channel, params);

    return part;
}

function codegenValue(arg) {
    if (arg.isVarRef) {
        switch (arg.name) {
        case '$event':
            return Ast.Expression.FunctionCall('eventToString', []);
        case '$event.title':
            return Ast.Expression.FunctionCall('eventToString', [Ast.Expression.Constant(Ast.Value.String('string-title'))]);
        case '$event.body':
            return Ast.Expression.FunctionCall('eventToString', [Ast.Expression.Constant(Ast.Value.String('string-body'))]);
        default:
            return Ast.Expression.VarRef(arg.name);
        }
    } else {
        return Ast.Expression.Constant(arg);
    }
}

function codegenTrigger(schemas, trigger) {
    var triggerParams = [];
    var triggerPredicates = [];
    var triggerConditions = [];
    var triggerParams = trigger.resolved_args.map(function(arg, i) {
        if (arg === undefined)
            return Ast.Expression.VarRef(trigger.schema.args[i]);
        else
            return codegenValue(arg);
    }, this);
    trigger.resolved_conditions.map(function(cond) {
        var varRef = Ast.Expression.VarRef(cond.name);
        var value;
        if (cond.value.isVarRef)
            value = Ast.Expression.VarRef(conv.value.name);
        else
            value = Ast.Expression.Constant(cond.value);

        const BINARY_OPS = { 'is': '=', 'contains': '=~', '>': '>', '<': '<' };
        const FUNCTION_OPS = { 'has': 'contains' };

        if (cond.operator in BINARY_OPS)
            triggerConditions.push(Ast.Expression.BinaryOp(varRef, value, BINARY_OPS[cond.operator]));
        else if (cond.operator in FUNCTION_OPS)
            triggerConditions.push(Ast.Expression.FunctionCall(FUNCTION_OPS[cond.operator], [varRef, value]));
        else
            throw new Error('Unsupported operator ' + cond.operator);
    });

    var triggerPart = codegenInvocation(trigger, triggerParams);
    triggerConditions = triggerConditions.map((c) => Ast.RulePart.Condition(c));
    triggerPredicates = triggerPredicates.map((c) => Ast.RulePart.BuiltinPredicate(c));
    return [triggerPart].concat(triggerPredicates).concat(triggerConditions);
}

function codegenActionPart(schemas, action) {
    var actionParams = action.resolved_args.map(codegenValue);
    var actionPart = codegenInvocation(action, actionParams);
    return [actionPart];
}

function checkProgram(schemas, program) {
    // check that this program compiles
    var compiler = new ThingTalk.Compiler();
    compiler.setSchemaRetriever(schemas);
    return compiler.compileProgram(program).then(() => {
        return ThingTalk.codegen(program);
    });
}

function codegenRule(schemas, trigger, query, action) {
    var triggerAst = null;
    if (trigger !== null)
        triggerAst = codegenTrigger(schemas, trigger);
    var queryAst = null;
    if (query !== null)
        queryAst = codegenTrigger(schemas, query);

    var actionAst;
    if (action !== null) {
        actionAst = codegenActionPart(schemas, action);
    } else {
        var actionPart = Ast.RulePart.Invocation(Ast.Selector.Builtin, 'notify', []);
        actionAst = [actionPart];
    }

    if (triggerAst !== null) {
        var rule = Ast.Statement.Rule(triggerAst, queryAst !== null ? [queryAst] : [], actionAst);
    } else {
        var rule = Ast.Statement.Command(queryAst !== null ? [queryAst] : [], actionAst);
    }

    var progName = 'AlmondGenerated';
    var first = true;
    if (trigger !== null) {
        progName += (first ? '' : 'To') + capitalizeSelector(trigger.kind, trigger.channel);
        first = false;
    }
    if (query !== null) {
        progName += (first ? '' : 'To') + capitalizeSelector(query.kind, query.channel);
        first = false;
    }
    if (action !== null) {
        progName += (first ? '' : 'To') + capitalizeSelector(action.kind, action.channel);
        first = false;
    }
    var program = Ast.Program(progName, [], [rule]);
    return checkProgram(schemas, program);
}

function codegenMonitor(schemas, trigger) {
    var triggerAst = codegenTrigger(schemas, trigger);

    var actionPart = Ast.RulePart.Invocation(Ast.Selector.Builtin, 'notify', []);

    var rule = Ast.Statement.Rule(triggerAst, [], [actionPart]);

    var progName = 'AlmondGeneratedMonitor' +
            capitalizeSelector(trigger.kind, trigger.channel);
    var program = Ast.Program(progName, [], [rule]);
    return checkProgram(schemas, program);
}

function codegenQuery(schemas, query) {
    // triggers and queries are the same, at the AST level
    // it's their position in the Rule/Command that determines their
    // behavior (and the different compilation)
    var queryAst = codegenTrigger(schemas, query);

    var actionPart = Ast.RulePart.Invocation(Ast.Selector.Builtin, 'notify', []);

    var command = Ast.Statement.Command([queryAst], [actionPart]);

    var progName = 'AlmondGeneratedQuery' +
            capitalizeSelector(query.kind, query.channel);
    var program = Ast.Program(progName, [], [command]);
    return checkProgram(schemas, program);
}

function codegenAction(schemas, action) {
    var actionAst = codegenActionPart(schemas, action);

    var rule = Ast.Statement.Command([], actionAst);

    var progName = 'AlmondImmediate' +
            capitalizeSelector(action.kind, action.channel);
    var program = Ast.Program(progName, [], [rule]);
    return checkProgram(schemas, program);
}

function typeCompat(t1, t2) {
    try {
        Type.typeUnify(t1, t2);
        return true;
    } catch(e) {
        return false;
    }
}

function assignSlots(slots, prefilled, values, comparisons, fillAll, mustFill, scope, toFill) {
    var newScope = {};

    slots.forEach((slot, i) => {
        var found = false;
        for (var pre of prefilled) {
            if (pre.name !== slot.name)
                continue;

            if (pre.operator === 'is') {
                if (!pre.value.isVarRef)
                    Type.typeUnify(slot.type, Ast.typeForValue(pre.value));

                values[i] = pre.value;
                pre.assigned = true;
                found = true;
                break;
            }
        }

        if (!found) {
            values[i] = undefined;
            if (fillAll || mustFill.has(slot.name) || slot.required)
                toFill.push(i);
            else
                newScope[slot.name] = slot;
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

    for (var name in newScope)
        scope[name] = newScope[name];
}

module.exports = {
    capitalizeSelector: capitalizeSelector,
    codegenRule: codegenRule,
    codegenMonitor: codegenMonitor,
    codegenQuery: codegenQuery,
    codegenAction: codegenAction,
    assignSlots: assignSlots,
    describeArg: describeArg,
    describeTrigger: describeTrigger,
    describeAction: describeTrigger,
}
