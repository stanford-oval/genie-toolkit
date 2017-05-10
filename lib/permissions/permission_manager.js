// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const Config = require('../config');

const ThingTalk = require('thingtalk');
const ThingTalkUtils = ThingTalk.Utils;

function checkTypeCompatible(jsArg, type) {
    if (type.isNumber || type.isMeasure)
        return typeof jsArg === 'number';
    if (type.isEnum)
        return type.entries.indexOf(jsArgs) >= 0;
    if (type.isBoolean)
        return typeof jsArg === 'boolean';
    if (type.isDate)
        return jsArg instanceof Date;
    if (type.isLocation)
        return typeof jsArg === 'object' && jsArg.hasOwnProperty('x') && jsArg.hasOwnProperty('y');
    if (type.isString || type.isEntity || type.isTime)
        return typeof jsArg === 'string';
    if (type.isArray)
        return Array.isArray(jsArg) && jsArg.every((a) => checkTypeCompatible(a, type.elem));
    return false;
}

function parseTime(jsArg) {
    var split = jsArg.split(':');
    return { hour: parseInt(split[0]), minute: parseInt(split[1]), second: 0,
        year: -1, month: -1, day: -1 };
}
function parseDate(jsArg) {
    return { year: jsArg.getFullYear(), month: jsArg.getMonth() + 1, day: jsArg.getDate(),
        hour: jsArg.getHours(), minute: jsArg.getMinutes(), second: jsArg.getSeconds() };
}

function makeJSONValue(jsArg, type) {
    if (type.isBoolean)
        return ['Bool', { value: jsArg }];
    if (type.isString)
        return ['String', { value: jsArg }];
    if (type.isNumber)
        return ['Number', { value: jsArg }];
    if (type.isEntity)
        return [String(type), { value: jsArg }];
    if (type.isMeasure)
        return ['Measure', { value: jsArg, unit: type.unit }];
    if (type.isEnum)
        return ['Enum', { value: jsArg }];
    if (type.isTime)
        return ['Time', parseTime(jsArg)];
    if (type.isDate)
        return ['Date', parseDate(jsArg)];
    if (type.isLocation)
        return ['Location', { relativeTag: 'absolute', latitude: jsArg.y, longitude: jsArg.x, display: jsArg.display }];
    throw new TypeError('Unhandled type ' + type);
}

class TypeChecker {
    constructor(schemaRetriever) {
        this._schemas = schemaRetriever;
    }

    typeCheck(selector, channelType, channel, args, allRequired, wrapArgs) {
        var type;

        return ThingTalkUtils.getSchemaForSelector(this._schemas, selector, channel, {}, {}, '', channelType)
        .then((schema) => {
            var argnames = schema.args;
            var types = schema.types;
            var argrequired = schema.required;

            if (args.length !== types.length)
                throw new TypeError('Wrong number of arguments');

            var wrappedArgs = [];
            args.forEach((arg, i) => {
                var required;
                if (allRequired)
                    required = true;
                else
                    required = argrequired[i];
                if (required && arg == null)
                    throw new TypeError('Argument ' + argnames[i] + ' is required');
                if (arg == null)
                    return;
                if (!checkTypeCompatible(arg, types[i]))
                    throw new TypeError('Argument ' + argnames[i] + ' is of wrong type');
                if (wrapArgs) {
                    var [type, value] = makeJSONValue(arg, types[i]);
                    wrappedArgs.push({
                        name: { id: 'tt:param.' + argnames[i] },
                        type: type,
                        value: value,
                        operator: 'is'
                    });
                }
            });

            return wrappedArgs;
        });
    }
}

function throwCode(code, message) {
    var e = new Error(message);
    e.code = code;
    return e;
}

module.exports = class PermissionManager {
    constructor(platform, messaging, schemaRetriever) {
        this._platform = platform;
        this._messaging = messaging;
        this._typeChecker = new TypeChecker(schemaRetriever);

        this._nextId = 0;
        this._interactiveRequests = {};
    }

    _askForPermission(principal, identity, invocation) {
        var assistant = this._platform.getCapability('assistant');
        if (!assistant)
            throw throwCode('ENOTSUP', 'Interaction not supported');
        var conversation = assistant.getConversation();
        if (!conversation)
            throw throwCode('EPERM', 'User not available to confirm');

        return conversation.askForPermission([principal, identity, invocation]);
    }

    _setPrincipalDisplayInvocation(principal, invocation) {
        if (!invocation)
            return;
        invocation.args.forEach((a) => {
            if (a.type === 'Entity(tt:contact)' && a.value.value === principal)
                a.value.display = "them";
        });
    }

    _setPrincipalDisplay(principal, rule) {
        if (rule.setup)
            return this._setPrincipalDisplay(principal, rule.setup);
        if (rule.rule) {
            this._setPrincipalDisplayInvocation(principal, rule.rule.trigger);
            this._setPrincipalDisplayInvocation(principal, rule.rule.query);
            this._setPrincipalDisplayInvocation(principal, rule.rule.action);
        } else {
            this._setPrincipalDisplayInvocation(principal, rule.trigger);
            this._setPrincipalDisplayInvocation(principal, rule.query);
            this._setPrincipalDisplayInvocation(principal, rule.action);
        }
    }

    _verifyIdentity(principal, identity) {
        if (!identity)
            return Q();
        if (!identity.startsWith('phone:') && !identity.startsWith('email:') && !identity.startsWith('omlet:'))
            return Q.reject(throwCode('EINVAL', 'Invalid identity ' + identity));
        return this._messaging.getAccountForIdentity(identity).then((account) => {
            if (!account)
                throw throwCode('EINVAL', 'Invalid identity ' + identity);
            if (this._messaging.type + '-account:' + account !== principal)
                throw throwCode('EPERM', 'Identity does not match principal');
        });
    }

    isAllowedRule(principal, identity, rule) {
        // for rules, we always ask the user
        this._setPrincipalDisplay(principal, rule);
        return this._verifyIdentity(principal, identity).then(() => {
            return this._askForPermission(principal, identity, rule);
        });
    }

    isAllowedFormatQuery(principal, device, channel, args) {
        if (device.isBuiltin)
            return Q(false);
        // format requests are always allowed as long as they typecheck
        return this._typeChecker.typeCheck(device, 'queries', channel, args, false, false).then(() => true);
    }

    isAllowedFormatTrigger(principal, device, channel, args) {
        if (device.isBuiltin)
            return Q(false);
        // format requests are always allowed as long as they typecheck
        return this._typeChecker.typeCheck(device, 'triggers', channel, args, false, false).then(() => true);
    }

    isAllowedAction(principal, device, channel, args) {
        if (device.isBuiltin)
            return Q(false);
        return this._typeChecker.typeCheck(device, 'actions', channel, args, true, true).then((wrappedArgs) => {
            if (device.isGlobalName) {
                return this._askForPermission(principal, {
                    action: {
                        name: { id: 'tt:' + device.name + '.' + channel },
                        args: wrappedArgs
                    }
                });
            }
            return Q(false);
        });
    }

    isAllowedQuery(principal, device, channel, args) {
        if (device.isBuiltin)
            return Q(false);
        return this._typeChecker.typeCheck(device, 'queries', channel, args, false, true).then((wrappedArgs) => {
            if (device.isGlobalName) {
                return this._askForPermission(principal, {
                    query: {
                        name: { id: 'tt:' + device.name + '.' + channel },
                        args: wrappedArgs
                    }
                });
            }
            return Q(false);
        });
    }

    isAllowedQueryResult(principal, device, channel, args, result) {
        // allow everything for now
        return Q(true);
    }
}
