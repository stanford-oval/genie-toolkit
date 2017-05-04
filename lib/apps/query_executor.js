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
                                           query.invocation.selector,
                                           query.invocation.name);
    }

    invoke(env, cont) {
        // keep our parent alive for the duration of the call
        return this._parent.open().then(() => {
            var args = this._query.invocation.params.map(function(f) {
                return f(env);
            });

            return Q.all(this._selector.values().map((ch) => {
                return Q.try(() => {
                    return Q(ch.invokeQuery(args, env)).then((rows) => {
                        var max = 10;
                        rows.forEach((row) => {
                            var clone = env.clone();
                            clone.currentChannel = ch;
                            clone.queryInput = args;
                            clone.queryValue = row;
                            this._query.caller(clone, () => {
                                max--;
                                if (max < 0)
                                    return;
                                return cont(clone);
                            });
                        });

                        // pass a null to signify that the query is done now
                        // if there are more queries, they will drop this value on the floor
                        // if the next step is actions, ActionExecutor will do the right thing
                        // with it
                        var clone = env.clone();
                        clone.currentChannel = ch;
                        clone.queryInput = args;
                        clone.queryValue = null;
                        cont(clone);
                    });
                }).catch((e) => {
                    if (e.code === 'ECANCELLED')
                        return;
                    console.error('Error during query run in ' + this.app.uniqueId + ': ' + e.message);
                    this.app.reportError(e);
                });
            }));
        }).finally(() => {
            return this._parent.close();
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
