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

function clean(name) {
    return name.replace(/_/g, ' ').replace(/([^A-Z])([A-Z])/g, '$1 $2').toLowerCase();
}

function displayLocation(dlg, loc) {
    if (loc.isAbsolute) {
        if (loc.display)
            return loc.display;
        else
            return '[Latitude: ' + Number(loc.lat).toFixed(3) + ' deg, Longitude: ' + Number(loc.lon).toFixed(3) + ' deg]'
    } else {
        switch (loc.relativeTag) {
        case 'current_location':
            return dlg._("here");
        case 'home':
            return dlg._("at home");
        case 'work':
            return dlg._("at work");
        default:
            return loc.relativeTag;
        }
    }
}

function describeArg(dlg, arg) {
    if (arg.display)
        return arg.display;
    if (arg.isVarRef)
        return clean(arg.name.startsWith('v_') ? arg.name.substr('v_'.length) : arg.name);
    if (arg.isUndefined)
        return '____';
    if (arg.isEvent) {
        switch (arg.name) {
        case null:
            return dlg._("the event");
        case 'title':
            return dlg._("the event's title");
        case 'body':
            return dlg._("the event's long description");
        default:
            return arg.name;
        }
    }
    if (arg.isLocation)
        return displayLocation(dlg, arg.value);
    if (arg.isString)
        return '"' + arg.value + '"';
    if (arg.isEntity) {
        if (arg.type === 'tt:username' || arg.type === 'tt:contact_name')
            return '@' + arg.value;
        if (arg.type === 'tt:hashtag')
            return '#' + arg.value;
        if (arg.type === 'tt:contact' && arg.value === dlg.manager.messaging.type + '-account:' + dlg.manager.messaging.account)
            return dlg._("me");
        return arg.value;
    }
    if (arg.isNumber)
        return arg.value;
    if (arg.isEnum)
        return clean(arg.value);
    if (arg.isMeasure)
        return arg.value + ' ' + arg.unit;
    if (arg.isBoolean)
        return arg.value ? dlg._("yes") : dlg._("no");
    if (arg.isDate)
        return arg.value.toLocaleString();
    if (arg.isTime)
        return "%02d:%02d".format(arg.hour, arg.minute);

    return String(arg);
}

function describePrimitive(dlg, obj) {
    var kind = obj.selector.kind;
    var owner = obj.selector.principal;
    var channel = obj.channel;
    var schema = obj.schema;

    var confirm;
    if (kind === 'remote') {
        // special case internal sending/receiving
        if (channel === 'send')
            confirm = dlg._("send it to $__principal");
        else if (channel === 'receive')
            confirm = dlg._("you receive something from $__principal");
        else
            throw TypeError('Invalid @remote channel ' + channel);
    } else if (owner) {
        confirm = schema.confirmation_remote;
        if (!confirm)
            confirm = schema.confirmation;
        if (confirm == schema.confirmation)
            confirm = confirm.replace('your', describeArg(dlg, owner) + '\'s').replace('you', describeArg(dlg, owner));
        else
            confirm = confirm.replace('$__person', describeArg(dlg, owner));
    } else {
        confirm = schema.confirmation;
        if (obj.selector.device)
            confirm = confirm.replace('$__device', obj.selector.device.name);
        else
            confirm = confirm.replace('$__device', clean(kind));
    }

    for (let inParam of obj.in_params) {
        let argname = inParam.name;
        let index = obj.schema.index[argname];
        let argcanonical = obj.schema.argcanonicals[index] || clean(argname);
        let value = describeArg(dlg, inParam.value);
        if (confirm.indexOf('$' + argname) >= 0)
            confirm = confirm.replace('$' + argname, value);
        else if (!argname.startsWith('__') && kind !== 'remote' && !inParam.value.isUndefined)
            confirm = confirm + dlg._(" and %s is %s").format(argcanonical, value);
    }

    for (let filter of obj.filters) {
        let argname = filter.name;
        if (filter.operator === '=' && confirm.indexOf('$' + argname) >= 0) {
            confirm = confirm.replace('$' + argname, describeArg(dlg, filter.value));
        } else {
            let index = obj.schema.index[argname];
            let argcanonical = obj.schema.argcanonicals[index] || clean(argname);
            let value =  describeArg(dlg, filter.value);
            switch (filter.operator) {
            case 'contains':
            case '=~':
                confirm += dlg._(" and %s contains %s").format(argcanonical, value);
                break;
            case '=':
                confirm += dlg._(" and %s is %s").format(argcanonical, value);
                break;
            case '!=':
                confirm += dlg._(" and %s is not %s").format(argcanonical, value);
                break;
            case '<':
                confirm += dlg._(" and %s is less than %s").format(argcanonical, value);
                break;
            case '>':
                confirm += dlg._(" and %s is greater than %s").format(argcanonical, value);
                break;
            case '<=':
                confirm += dlg._(" and %s is less than or equal to %s").format(argcanonical, value);
                break;
            case '>=':
                confirm += dlg._(" and %s is greater than or equal to %s").format(argcanonical, value);
                break;
            default:
                throw new TypeError('Invalid operator ' + filter.operator);
            }
        }
    }
    return confirm;
}

function describeRule(dlg, r) {
    var triggerDesc = r.trigger ? describePrimitive(dlg, r.trigger) : '';

    var queryDesc = r.queries.map((q) => describePrimitive(dlg, q)).join(dlg._(" and then "));
    var actions = r.actions.filter((a) => !a.selector.isBuiltin);
    var actionDesc = actions.map((a) => describePrimitive(dlg, a)).join(dlg._(" and "));

    var ruleDesc;
    if (actionDesc && queryDesc && triggerDesc)
        ruleDesc = dlg._("%s then %s when %s").format(queryDesc, actionDesc, triggerDesc);
    else if (actionDesc && triggerDesc)
        ruleDesc = dlg._("%s when %s").format(actionDesc, triggerDesc);
    else if (queryDesc && triggerDesc)
        ruleDesc = dlg._("%s when %s").format(queryDesc, triggerDesc);
    else if (actionDesc && queryDesc)
        ruleDesc = dlg._("%s then %s").format(queryDesc, actionDesc);
    else if (triggerDesc)
        ruleDesc = dlg._("notify when %s").format(triggerDesc);
    else if (queryDesc)
        ruleDesc = queryDesc;
    else if (actionDesc)
        ruleDesc = actionDesc;
    if (r.once)
        ruleDesc += dlg._(" (only once)");
    return ruleDesc;
}

function describeProgram(dlg, program) {
    return program.rules.map((r) => describeRule(dlg, r)).join(', ');
}

function capitalize(str) {
    return (str[0].toUpperCase() + str.substr(1)).replace(/[\-_]([a-z])/g, function(whole, char) { return char.toUpperCase(); }).replace(/[\-_]/g, '');
}

function capitalizeSelector(prim) {
    let kind = prim.selector.kind;
    let channel = prim.channel;
    if (kind === 'builtin')
        return capitalize(channel);
    else
        return capitalize(kind);
}

function getRuleName(dlg, r) {
    var triggerName = r.trigger ? capitalizeSelector(r.trigger) : '';

    var queryName = r.queries.map((q) => capitalizeSelector(q)).join(dlg._(" to "));
    var actions = r.actions.filter((a) => !a.selector.isBuiltin);
    var actionName = actions.map((a) => capitalizeSelector(a)).join(dlg._(" to "));
    if (actionName && queryName && triggerName)
        return dlg._("%s to %s to %s").format(triggerName, queryName, actionName);
    else if (actionName && triggerName)
        return dlg._("%s to %s").format(triggerName, actionName);
    else if (queryName && triggerName)
        return dlg._("%s to %s").format(triggerName, queryName);
    else if (queryName && actionName)
        return dlg._("%s to %s").format(queryName, actionName);
    else if (triggerName)
        return dlg._("Monitor %s").format(triggerName);
    else if (actionName)
        return dlg._("Execute %s").format(actionName);
    else
        return dlg._("Query %s").format(queryName);
}

function getProgramName(dlg, program) {
    return program.rules.map((r) => getRuleName(dlg, r)).join(', ');
}

module.exports = {
    describeArg: describeArg,
    describeProgram: describeProgram,
    getProgramName: getProgramName
}
