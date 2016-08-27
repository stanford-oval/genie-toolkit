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
    constructor(engine, app, query) {
        this.engine = engine;
        this.app = app;

        this._keywords = [];
        this._keywordAsts = {};
        this._query = query;
        this._selector = new ChannelOpener(this.engine, this.app, 'q',
                                           query.invocation.selector,
                                           query.invocation.name);
    }

    invoke(env, cont) {
        var args = this._query.invocation.params.map(function(f) {
            return f(env);
        });

        return this._selector.values().map((ch) => {
            return Q.try(() => {
                return Q(ch.invokeQuery(args)).then((rows) => {
                    rows.forEach((row) => {
                        var clone = env.clone();
                        clone.currentChannel = ch;
                        clone.queryInput = args;
                        clone.queryValue = row;
                        this._query.caller(clone, () => {
                            return cont(clone);
                        });
                    });
                });
            }).catch((e) => {
                console.error('Error during query run in ' + this.app.uniqueId + ': ' + e.message);
                this.app.reportError(e);
            });
        });
    }

    stop() {
        return this._selector.stop();
    }

    start() {
        return this._selector.start().catch(function(e) {
            console.error('Error while setting up query: ' + e.message);
            console.error(e.stack);
            this.app.reportError(e);
        }.bind(this));
    }
}
