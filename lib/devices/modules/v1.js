// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See LICENSE for details
"use strict";

const Tp = require('thingpedia');

const BaseJavascriptModule = require('./base_js');

module.exports = class ThingpediaModuleV1 extends BaseJavascriptModule {
    _completeLoading(module) {
        super._completeLoading(module);

        console.log('ModuleType org.thingpedia.v1 is deprecated, switch to v2');

        for (let query in this.manifest.queries) {
            const queryArgs = this.manifest.queries[query].args;

            module.prototype['get_' + query] = function(params, count, filter) {
                // replicate what ChannelFactory used to do, in a simplified best effort way
                let channelClass = this.getQueryClass(query);
                let channel = new channelClass(this._engine, this);

                let linearParams = queryArgs.map((a) => params[a.name]);
                // ignore count and filter
                return channel.invokeQuery(linearParams).then((results) => results.map((r) => {
                    let obj = {};
                    queryArgs.forEach((arg, i) => {
                        obj[arg.name] = r[i];
                    });
                    return obj;
                }));
            };

            const pollInterval = this.manifest.queries[query].poll_interval;
            if (pollInterval > 0) {
                module.prototype['subscribe_' + query] = function(params, state, filter) {
                    return new Tp.Helpers.PollingStream(state, pollInterval, () => this['get_' + query](params));
                };
            } else if (pollInterval === 0) {
                throw new Error('Misconfiguration: poll interval === 0 but no subscribe function was found');
            } else {
                module.prototype['subscribe_' + query] = function(params, state, filter) {
                    throw new Error('This query is non-deterministic and cannot be monitored');
                };
            }
            module.prototype['history_' + query] = function(params, base, delta, filters) {
                return null; // no history
            };
            module.prototype['sequence_' + query] = function(params, base, limit, filters) {
                return null; // no sequence history
            };
        }
        for (let action in this.manifest.actions) {
            const actionArgs = this.manifest.actions[action].args;

            module.prototype['do_' + action] = function(params) {
                // replicate what ChannelFactory used to do, in a simplified best effort way

                let channelClass = this.getActionClass(action);
                let channel = new channelClass(this._engine, this);

                let linearParams = actionArgs.map((a) => params[a.name]);
                return channel.sendEvent(linearParams);
            };
        }
    }
};
