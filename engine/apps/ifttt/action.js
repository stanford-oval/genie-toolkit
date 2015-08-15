// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const url = require('url');
const http = require('http');
const https = require('https');
const lang = require('lang');
const Q = require('q');

const Params = require('./params');

const Action = new lang.Class({
    Name: 'Action',

    _init: function(engine, channel, getChannel, method, params) {
        var channelMeta = engine.channels.createIFTTTChannel(channel);
        if (!channelMeta.objectId)
            throw new Error('Channels that don\'t have a predefined URI are not supported');
        this._channelState = getChannel(channelMeta.objectId);

        var methodMeta = channelMeta.methods.find(function(m) {
            return m.id == method;
        });
        if (methodMeta === undefined)
            throw new Error('Invalid method ' + event);
        if (!methodMeta.script)
            throw new Error('Methods without a script are not supported');

        this._actionFn = eval('(' + methodMeta.script + ')');
        this._params = Params.parseParams(params);
    },

    _resolveParam: function(context, paramValue) {
        for (var id in context)
            paramValue = paramValue.replace('{{' + id + '}}', context[id]);
        return paramValue;
    }

    execute: function(context) {
        var resolved = {};
        for (var id in this._params)
            resolved[id] = this._resolveParam(this._params[id]);

        // the global object is supposed to be the channel state
        // too bad...
        var result = this._actionFn.call(this._channelState, resolved);

        switch (result.type) {
        case 'http':
            var module = result.url.startsWith('https') ? https : http;
            var options = url.parse(result.url);
            options.method = result.method;
            var request = module.request(options);
            request.write(result.data);
            request.end();
            break;

        case 'intent':
        case 'email':
            throw new Error('Action result of type ' + result.type + ' is no longer supported');
        default:
            throw new Error('Invalid result type ' + result.type);
        }
    }
});

function createAction(engine, getChannel, serializedAction) {
    return new Action(engine, serializedAction.channel, getChannel, serializedAction.method, serializedAction.params);
}

module.exports.createAction = createAction;
