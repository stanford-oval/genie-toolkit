// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const adt = require('adt');

const ThingTalk = require('thingtalk');

const SemanticAnalyzer = require('./semantic');
const DefaultDialog = require('./default_dialog');
const InitializationDialog = require('./init_dialog');

module.exports = class Sabrina extends events.EventEmitter {
    constructor(engine, user, delegate, debug) {
        super();
        this._engine = engine;
        this._user = user;

        this._raw = false;
        this._debug = debug;

        this._delegate = delegate;
        this._initialized = false;
        this._dialog = null;

        this._notifyQueue = [];
    }

    get user() {
        return this._user;
    }

    get platform() {
        return this._engine.platform;
    }

    get apps() {
        return this._engine.apps;
    }

    get devices() {
        return this._engine.devices;
    }

    get sparql() {
        return this._engine.sparql;
    }

    get schemas() {
        return this._engine.schemas;
    }

    get thingpedia() {
        return this._engine.thingpedia;
    }

    get discovery() {
        return this._engine.discovery;
    }

    notify(data) {
        if (!this._dialog || !this._dialog.notify(data[0], data[1]))
            this._notifyQueue.push(data);
    }

    _flushNotify() {
        var queue = this._notifyQueue;
        this._notifyQueue = [];
        queue.forEach(function(data) {
            this.notify(data);
        }, this);
    }

    setDialog(dlg) {
        if (this._dialog)
            this._dialog.stop();
        this._dialog = dlg;
        dlg.manager = this;
        dlg.start();
        this._flushNotify();
    }

    switchToDefault() {
        this._dialog.switchTo(new DefaultDialog());
        return true;
    }

    setRaw(raw) {
        this._raw = raw;
    }

    start() {
        this._initialize();
    }

    _initialize() {
        if (this._initialized)
            return;

        this._initialized = true;
        this.setDialog(new InitializationDialog());
    }

    handlePicture(url) {
        console.log('Received Assistant picture ' + url);

        return Q.try(function() {
            return this._dialog.handlePicture(url);
        }.bind(this)).then(function(handled) {
            if (!handled)
                handled = this.emit('picture', url);

            if (!handled)
                this._dialog.unexpected();
        }.bind(this)).catch(function(e) {
            console.error('Failed to process assistant picture: ' + e.message);
            console.error(e.stack);
            this._dialog.failReset();
        }.bind(this));
    }

    handleCommand(command, analyzed) {
        if (command === null)
            console.log('Received pre-parsed assistant command');
        else
            console.log('Received assistant command ' + command);

        return Q.try(function() {
            if (this._raw && command !== null)
                return this._dialog.handleRaw(command);

            if (analyzed === null) {
                console.log('Failed to analyze message');
                return this._dialog.handleFailed(SemanticAnalyzer.makeFailed(command));
            } else {
                console.log('Analyzed message into ' + analyzed);

                var parsed = JSON.parse(analyzed);
                var analyzer = new SemanticAnalyzer(parsed);
                return this._dialog.handle(analyzer);
            }
        }.bind(this)).then(function(handled) {
            if (!handled && command !== null)
                handled = this.emit('message', command);

            if (!handled)
                this._dialog.fail();
        }.bind(this)).catch(function(e) {
            this.sendReply('Sorry, I had an error processing your command: ' + e.message);
            console.error(e.stack);
            this._dialog.failReset();
        }.bind(this));
    }

    sendReply(message) {
        if (this._debug)
            console.log('Sabrina Says: ' + message);
        if (this._delegate)
            return this._delegate.send(message);
        else
            return Q();
    }

    sendPicture(url) {
        if (this._debug)
            console.log('Sabrina sends picture: '+ url);
        if (this._delegate)
            return this._delegate.sendPicture(url);
        else
            return Q();
    }

    sendRDL(rdl) {
        if (this._debug)
            console.log('Sabrina sends RDL: '+ rdl.callback);
        if (this._delegate)
            return this._delegate.sendRDL(rdl);
        else
            return Q();
    }

    sendChoice(idx, what, title, text) {
        if (this._debug)
            console.log('Sabrina sends multiple choice button: '+ title);
        if (this._delegate)
            return this._delegate.sendChoice(idx, what, title, text);
        else
            return Q();
    }

    sendButton(title, json) {
        if (this._debug)
            console.log('Sabrina sends generic button: '+ title);
        if (this._delegate)
            return this._delegate.sendButton(title, json);
        else
            return Q();
    }

    sendLink(title, url) {
        if (this._debug)
            console.log('Sabrina sends link: '+ url);
        if (this._delegate)
            return this._delegate.sendLink(title, url);
        else
            return Q();
    }

    sendAskSpecial(what) {
        if (this._debug)
            console.log('Sabrina sends a special request');
        if (this._delegate)
            return this._delegate.sendAskSpecial(what);
        else
            return Q();
    }
}
