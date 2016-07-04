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

    invoke(env, cont, onerr) {
        var args = this._query.invocation.params.map(function(f) {
            return f(env);
        });

        this._selector.values().forEach(function(ch) {
            Q.try(function() {
                return Q(ch.invokeQuery(args)).then(function(rows) {
                    rows.forEach(function(row) {
                        var clone = env.clone();
                        clone.currentChannel = ch;
                        clone.queryInput = args;
                        clone.queryValue = row;
                        this._query.caller(clone, function() {
                            return cont(clone);
                        });
                    }, this);
                }.bind(this));
            }.bind(this)).catch(function(e) {
                console.error('Error during query run in ' + this.app.uniqueId + ': ' + e.message);
                console.error(e.stack);
                this.app.reportError(e);
                if (onerr)
                    onerr(e);
            }.bind(this));
        }, this);
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
