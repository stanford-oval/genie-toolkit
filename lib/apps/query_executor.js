// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015-2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const ChannelOpener = require('./channel_opener');

module.exports = class QueryExecutor {
    constructor(engine, app, parent, query) {
        this.engine = engine;
        this.app = app;

        this._query = query;
        this._parent = parent;
        this._selector = new ChannelOpener(this.engine, this.app, 'q',
                                           query.selector,
                                           query.channel);
    }

    invoke(env, cont) {
        // keep our parent alive for the duration of the call
        return this._parent.open().then(() => {
            return Q.all(this._query.input(env));
        }).then((params) => {
            var filtered = [];
            var max = 10;
            return Q.all(this._selector.values().map((ch) => {
                if (filtered.length >= max)
                    return;
                return Q.try(() => {
                    return Q(ch.invokeQuery(params, env)).then((rows) => {
                        for (var row of rows) {
                            if (filtered.length >= max)
                                break;
                            var clone = env.clone();
                            clone.currentChannel = ch;
                            clone.queryInput = params;
                            clone.queryValue = row;
                            if (this._query.filter(clone)) {
                                filtered.push(clone);

                                // once query get a return value, add it ibase
                                var args = clone.getMeta().args;
                                var value = clone.getCurrentEvent();
                                var filters = {};
                                args.forEach((arg, i) => {
                                    if (arg.is_input && params[i] !== null)
                                        filters[arg.name] = params[i];
                                });
                                var time = new Date();
                                var channel = clone.getChannelName();
                                var device = clone.getDeviceId();
                                args.forEach((arg, i) => {
                                    if (arg.is_input)
                                        return;
                                    var record = {
                                        '_id': [device, channel, arg.name, time.getTime().toString()].join('-'),
                                        'date': new Date(),
                                        'name': arg.name,
                                        'type': arg.type,
                                        'value': value[i],
                                        'channel': channel,
                                        'device': device,
                                        'filters': filters
                                    };
                                    this.engine.ibase.insertOne(record);
                                });
                                this.engine.ibase.showAll();
                            }
                        }
                    });
                });
            })).then(() => {
                return Q.all(filtered.map((clone) => {
                    this._query.output(clone);

                    return cont(clone);
                }));
            }).catch((e) => {
                if (e.code === 'ECANCELLED')
                    return;
                console.error('Error during query run in ' + this.app.uniqueId + ': ' + e.message);
                env.error(e);
            });
        }).finally(() => {
            return this._parent.close();
        });
    }

    stop() {
        return this._selector.stop();
    }

    start() {
        return this._selector.start();
    }
}
