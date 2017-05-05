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
    if (arg.isEntity) {
        if (arg.type === 'tt:username')
            return '@' + arg.value;
        if (arg.type === 'tt:hashtag')
            return '#' + arg.value;
        if (arg.type === 'tt:contact' && arg.value === dlg.manager.messaging.type + '-account:' + dlg.manager.messaging.account)
            return dlg._("me");
        return arg.value;
    }
    if (arg.isNumber || arg.isEnum)
        return arg.value;
    if (arg.isMeasure)
        return arg.value + ' ' + arg.unit;
    if (arg.isBoolean)
        return arg.value ? dlg._("on") : dlg._("off");

    return String(arg);
}

function describeTrigger(dlg, obj) {
    var kind = obj.kind;
    var channel = obj.channel;
    var owner = obj.owner;
    var schema = obj.schema;
    var args = obj.resolved_args;
    var comparisons = obj.resolved_conditions;

    if (kind === 'remote') {
        // special case internal sending/receiving
        if (channel === 'send')
            return dlg._("send it to %s").format(describeArg(dlg, args[0]));
        if (channel === 'receive')
            return dlg._("you receive something from %s").format(describeArg(dlg, args[0]));
    }

    var confirm;
    if (owner) {
        confirm = schema.confirmation_remote;
        if (!confirm)
            confirm = schema.confirmation;
        if (confirm == schema.confirmation)
            confirm = confirm.replace('your', '@' + owner + '\'s').replace('you', '@' + owner);
        else
            confirm = confirm.replace('$__person', describeArg(dlg, Ast.Value.Entity(owner, 'tt:username')));
    } else {
        confirm = schema.confirmation;
        if (obj.device)
            confirm = confirm.replace('$__device', obj.device.name);
        else
            confirm = confirm.replace('$__device', kind.replace(/\-_/g, ' ').replace(/([^A-Z])([A-Z])/g, '$1 $2').toLowerCase());
    }


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

module.exports = {
    describeArg: describeArg,
    describeTrigger: describeTrigger,
    describeAction: describeTrigger,
}
