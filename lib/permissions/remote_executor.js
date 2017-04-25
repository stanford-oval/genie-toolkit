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

const ChannelOpener = require('../apps/channel_opener');

module.exports = class RemoteExecutor {
    constructor(engine, permissions) {
        this._engine = engine;
        this._permissions = permissions;
    }

    execute(principal, device, channelType, channel, args) {
        var check;
        switch (channelType) {
        case 'action':
            check = this._permissions.isAllowedAction(principal, device, channel, args);
            break;
        case 'query':
            check = this._permissions.isAllowedQuery(principal, device, channel, args);
            break;
        default:
            check = Q(false);
        }

        return check.then((allowed) => {
            if (!allowed) {
                var e = new Error('Permission denied');
                e.code = 'EPERM';
                throw e;
            }

            switch (channelType) {
            case 'action':
                return this._executeAction(principal, device, channel, args);
            case 'query':
                return this._executeQuery(principal, device, channel, args);
            }
        });
    }

    _executeAction(principal, device, channel, args) {
        var opener = new ChannelOpener(this._engine, null, 'w', device, channel);

        return opener.start().then(() => {
            return Q.all(opener.values().map((ch) => {
                return ch.sendEvent(args);
            }));
        }).finally(() => opener.stop());
    }

    _executeQuery(principal, device, channel, args) {
        var opener = new ChannelOpener(this._engine, null, 'q', device, channel);

        return opener.start().then(() => {
            return Q.all(opener.values().map((ch) => {
                return ch.invokeQuery(args);
            }));
        }).finally(() => opener.stop()).then((results) => {
            var flattened = [];
            for (var result of results) {
                if (result.length > 10)
                    result = result.slice(0, 10);
                for (var row of result)
                    flattened.push(row);
            }

            return Q.all(flattened.map((row) => {
                return this._permissions.isAllowedQueryResult(principal, device, channel, args, row);
            })).then((mask) => {
                return flattened.filter((row, i) => mask[i]);
            });
        });
    }
}
