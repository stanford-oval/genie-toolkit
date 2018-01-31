// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
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
    constructor(engine, app, output) {
        super(engine.platform.locale, engine.platform.timezone);
        this.engine = engine;
        this.app = app;
        this._output = output;

        for (let name in this.app.state) {
            if (name.startsWith('$'))
                continue;
            var type = this.app.compiler.params[name];
            var value = this.app.state[name];
            this._scope[name] = Ast.Value.fromJSON(type, value).toJS();
        }
    }

    _doClone() {
        return new ExecWrapper(this.engine, this.app, this._output);
    }

    get icon() {
        var icon;
        if (this.currentChannel && this.currentChannel.device)
            icon = this.currentChannel.device.kind;
        if (!icon)
            icon = this.app.icon;
        return icon;
    }

    error(error) {
        this.app.error = error;
        return this._output.error(this.icon, error);
    }

    output(outputType, outputValues, currentChannel) {
        return this._output.output(this.icon, outputType, outputValues, currentChannel);
    }

    say(message) {
        return this._output.say(this.icon, message);
    }

    askQuestion(type, question) {
        return this._output.question(this.icon, type, question);
    }
}
