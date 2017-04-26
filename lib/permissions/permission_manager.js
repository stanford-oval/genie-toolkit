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

    typeCheck(selector, channelType, channel, args) {
        var type;

        return ThingTalkUtils.getSchemaForSelector(this._schemas, selector, channel, {}, {}, '', channelType)
        .then((schema) => {
            var argnames = schema.args;
            var types = schema.types;

            if (args.length !== types.length)
                throw new TypeError('Wrong number of arguments');

            var wrappedArgs = [];
            args.forEach((arg, i) => {
                if (!checkTypeCompatible(arg, types[i]))
                    throw new TypeError('Argument ' + argnames[i] + ' is of wrong type');
                var [type, value] = makeJSONValue(arg, types[i]);
                wrappedArgs.push({
                    name: { id: 'tt:param.' + argnames[i] },
                    type: type,
                    value: value,
                    operator: 'is'
                });
            });

            return wrappedArgs;
        });
    }
}

function throwCode(code, message) {
    var e = new Error(message);
    e.code = code;
    throw e;
}

module.exports = class PermissionManager {
    constructor(platform, schemaRetriever) {
        this._platform = platform;
        this._typeChecker = new TypeChecker(schemaRetriever);

        this._nextId = 0;
        this._interactiveRequests = {};
    }

    _askForPermission(principal, invocation) {
        var assistant = platform.getCapability('assistant');
        if (!assistant)
            throwCode('ENOTSUP', 'Interaction not supported');
        var conversation = assistant.getConversation();
        if (!conversation)
            throwCode('EPERM', 'User not available to confirm');

        return conversation.askForPermission([principal, invocation]);
    }

    isAllowedRule(principal, rule) {
        // for rules, we always ask the user
        return this._askForPermission(principal, rule);
    }

    isAllowedAction(principal, device, channel, args) {
        if (device.isBuiltin)
            return Q(false);
        return this._typeChecker.typeCheck(device, 'actions', channel, args).then((wrappedArgs) => {
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
        return Q(false);
    }

    isAllowedQueryResult(principal, device, channel, args, result) {
        return Q(false);
    }
}
