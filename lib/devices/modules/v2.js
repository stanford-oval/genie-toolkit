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

module.exports = class ThingpediaModuleV2 extends BaseJavascriptModule {
    static get [Symbol.species]() {
        return ThingpediaModuleV2;
    }

    _completeLoading(module) {
        super._completeLoading(module);

        for (let query in this.manifest.queries) {
            if (!module.prototype['subscribe_' + query]) {
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
            }
            if (!module.prototype['history_' + query]) {
                module.prototype['history_' + query] = function(params, base, delta, filters) {
                    return null; // no history
                };
            }
            if (!module.prototype['sequence_' + query]) {
                module.prototype['sequence_' + query] = function(params, base, limit, filters) {
                    return null; // no sequence history
                };
            }
        }
    }
};