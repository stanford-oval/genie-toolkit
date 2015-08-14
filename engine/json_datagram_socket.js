// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const events = require('events');
const lang = require('lang');
const Q = require('q');

// Exactly what the name suggests, this class is wraps a TCP/Unix stream
// socket to send and receive (mostly receive) JSON payloads
module.exports = new lang.Class({
    Name: 'JsonDatagramSocket',
    Extends: events.EventEmitter,

    _init: function(socket, encoding) {
        // EventEmitter is a node.js class not a lang class,
        // can't chain up normally
        events.EventEmitter.call(this);

        this._socket = socket;
        this._encoding = encoding;

        this._partialMessage = '';

        // NOTE: this is for reading ONLY
        // Always specify the encoding when writing
        socket.setEncoding(encoding);
        socket.on('data', function(data) {
            if (socket != this._socket) // robustness
                return;

            this._partialMessage += data;
            this._tryReadMessage();
        }.bind(this));

        socket.on('end', function() {
            this.emit('end');
        }.bind(this));
        socket.on('close', function(hadError) {
            this.emit('close', hadError);
        }.bind(this));
    },

    end: function(callback) {
        this._socket.end(callback);
        this._socket = null;
    },

    destroy: function() {
        this._socket.destroy();
        this._socket = null;
    },

    _tryReadMessage: function() {
        var msg;

        try {
            msg = JSON.parse(this._partialMessage);
        } catch(e) {
            // Failed: does not parse as JSON
            //console.log('Partial read on control channel: ' + this._partialMessage);
            return;
        }

        this._partialMessage = '';
        this.emit('data', msg);
    },

    write: function(msg, callback) {
        this._socket.write(JSON.stringify(msg), this._encoding, callback);
    }
});
