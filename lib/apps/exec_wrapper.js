// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const ExecEnvironment = ThingTalk.ExecEnvironment;
const ChannelOpener = require('./channel_opener');

module.exports = class ExecWrapper extends ExecEnvironment {
    constructor(engine, app, keywordAsts) {
        super(app.state, engine.platform.locale, engine.platform.timezone);
        this.engine = engine;
        this.app = app;

        // apply care in choosing property names to avoid clashes
        // with the parent class ExecEnvironment
        this._keywordAsts = keywordAsts;
        this.keywords = [];
    }

    stop() {
        return Q.all(this.keywords.map(function(kw) {
            return kw.close();
        }));
    }

    _getInputKeyword(kw) {
        return this.engine.keywords.getOpenedKeyword(this.app.uniqueId, kw);
    }

    start() {
        return Q.all(this._keywordAsts.map(function(kw) {
            return this._getInputKeyword(kw);
        }, this)).then((kws) => {
            this.keywords = kws;
            kws.forEach(function(k) {
                this.addKeyword(k.name, k);
            }.bind(this));
        });
    }
}
