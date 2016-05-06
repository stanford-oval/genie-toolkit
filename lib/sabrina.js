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

const LambdaForm = require('./lambda');
const SemanticAnalyzer = require('./semantic');
const Dialog = require('./dialog');

module.exports = class Sabrina extends events.EventEmitter {
    constructor(engine, user, delegate) {
        super();
        this._engine = engine;
        this._user = user;

        this._raw = false;

        this._delegate = delegate;
        this._initialized = false;

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

    notify(data) {
        if (!this._dialog.notify(data[0], data[1]))
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
        this._dialog = dlg;
        dlg.manager = this;
        dlg.start();
        this._flushNotify();
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
        this.setDialog(new Dialog.InitializationDialog());
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
        console.log('Received Assistant command ' + command);

        return Q.try(function() {
            if (this._raw)
                return this._dialog.handleRaw(command);

            console.log('Analyzed message into ' + analyzed);

            var parser = new LambdaForm.Parser(analyzed);
            var parsed = parser.parse();
            console.log('Parsed lambda form into ' + parsed);

            var analyzer = new SemanticAnalyzer(parsed);
            try {
                analyzer.run();
            } catch(e) {
                this.sendReply('Sorry, semantic analyzer failed ' + e.message);
                return false;
            }

            return this._dialog.handle(analyzer);
        }.bind(this)).then(function(handled) {
            if (!handled)
                handled = this.emit('message', command);

            if (!handled)
                this._dialog.fail();
        }.bind(this)).catch(function(e) {
            console.error('Failed to process assistant command: ' + e.message);
            console.error(e.stack);
            this._dialog.failReset();
        }.bind(this));
    }

    sendReply(message) {
        console.log('Sabrina Says: ' + message);
        if (this._delegate)
            return this._delegate.send(message);
        else
            return Q();
    }

    sendPicture(url) {
        console.log('Sabrina sends picture: '+ url);
        if (this._delegate)
            return this._delegate.sendPicture(url);
        else
            return Q();
    }
}
