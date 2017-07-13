// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const ThingTalk = require('thingtalk');

const Config = require('../config');

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

class TypeChecker {
    constructor(schemaRetriever) {
        this._schemas = schemaRetriever;
    }

    typeCheck(selector, channelType, channel, args) {
        return this._schemas.getSchemaAndNames(selector.kind, channelType, channel).then((schema) => {
            var argnames = schema.args;
            var types = schema.types;
            var argrequired = schema.required;

            if (args.length !== types.length)
                throw new TypeError('Wrong number of arguments');

            args.forEach((arg, i) => {
                var required = argrequired[i];
                if (required && arg == null)
                    throw new TypeError('Argument ' + argnames[i] + ' is required');
                if (arg == null)
                    return;
                if (!checkTypeCompatible(arg, types[i]))
                    throw new TypeError('Argument ' + argnames[i] + ' is of wrong type');
            });
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

    _askForPermission(principal, identity, program) {
        var assistant = this._platform.getCapability('assistant');
        if (!assistant)
            throw throwCode('ENOTSUP', 'Interaction not supported');
        var conversation = assistant.getConversation();
        if (!conversation)
            throw throwCode('EPERM', 'User not available to confirm');

        return conversation.askForPermission(principal, identity, program);
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

    isAllowedProgram(principal, identity, program) {
        // always ask the user
        return this._verifyIdentity(principal, identity).then(() => {
            return this._askForPermission(principal, identity, rule);
        });
    }

    isAllowedFormatQuery(principal, device, channel, args) {
        if (device.isBuiltin)
            return Q(false);
        // format requests are always allowed as long as they typecheck
        return this._typeChecker.typeCheck(device, 'queries', channel, args).then(() => true);
    }

    isAllowedFormatTrigger(principal, device, channel, args) {
        if (device.isBuiltin)
            return Q(false);
        // format requests are always allowed as long as they typecheck
        return this._typeChecker.typeCheck(device, 'triggers', channel, args).then(() => true);
    }
}
