// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See LICENSE for details
"use strict";

const Tp = require('thingpedia');

const Base = require('./base_generic');
const Utils = require('./utils');

function invokeQuery(device, auth, url) {
    return Tp.Helpers.Rss.get(url, { auth: auth, useOAuth2: device });
}

module.exports = class RSSModule extends Base {
    constructor(kind, ast) {
        super(kind, ast);

        const authfn = Utils.makeAuth(ast);
        for (let query in ast.queries) {
            const block = ast.queries[query];
            let pollInterval = ast.queries[query].poll_interval;
            if (!pollInterval)
                pollInterval = ast.queries[query]['poll-interval'];

            this._loaded.prototype['get_' + query] = function(params, count, filter) {
                // ignore count and filter

                let url = Utils.formatString(block.url, this.state, params);
                return invokeQuery(this, authfn(this), url);
            };
            this._loaded.prototype['subscribe_' + query] = function(params, state, filter) {
                return new Tp.Helpers.PollingStream(state, pollInterval, () => this['get_' + query](params));
            };
            this._loaded.prototype['history_' + query] = function(params, base, delta, filters) {
                return null; // no history
            };
            this._loaded.prototype['sequence_' + query] = function(params, base, limit, filters) {
                return null; // no sequence history
            };
        }
    }
};
