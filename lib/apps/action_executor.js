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

module.exports = class ActionExecutor {
    constructor(engine, app, output) {
        this.engine = engine;
        this.app = app;
        this.output = output;

        if (this.output.action) {
            this.selector = new ChannelOpener(engine, this.app, 'w',
                                              this.output.action.selector,
                                              this.output.action.name);
        } else {
            this.selector = null;
        }
    }

    _getOutputKeyword() {
        var compiler = this.app.compiler;

        var scope, name, feedId;
        var decl = compiler.getKeywordDecl(this.output.keyword.name);
        if (decl.extern)
            scope = null;
        else
            scope = this.app.uniqueId;
        if (decl.feedAccess)
            feedId = this.app.feedId;
        else
            feedId = null;
        name = this.output.keyword.name;

        // if this is a feed accessible keyword, owner must be self
        return this.engine.keywords.getOpenedKeyword(scope, name, feedId, decl.feedAccess);
    }

    start() {
        if (this.selector) {
            return this.selector.start();
        } else {
            return this._getOutputKeyword().then(function(kw) {
                this._outputKeyword = kw;
            }.bind(this));
        }
    }

    stop() {
        if (this.selector) {
            return this.selector.stop();
        } else {
            return this._outputKeyword.close();
        }
    }

    execute(env) {
        var value = this.output.produce(env);

        if (this.selector) {
            var channels = this.selector.values();
            channels.forEach(function(channel) {
                Q(channel.sendEvent(value, env)).catch((e) => {
                    console.error('Failed to execute action: ' + e.message);
                    this.app.reportError(e);
                }).done();
            });
        } else {
            // ignore owner because we punched through to LocalKeyword
            this._outputKeyword.changeValue(value);
        }
    }
}
