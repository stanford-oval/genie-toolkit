// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const fs = require('fs');
const net = require('net');

function ControlChannel(delegate) {
    if (!(this instanceof ControlChannel)) return new ControlChannel();

    this._server = net.createServer({ allowHalfOpen: true });

    this._delegate = delegate;

    this._server.on('connection', this._handleConnection.bind(this));
    this._closeOk = true;
    this._socket = null;
    this._partialMessage = '';
}
exports.ControlChannel = ControlChannel;

ControlChannel.prototype.open = function() {
    var controlPath = platform.getWritableDir() + '/control';
    try {
        fs.unlinkSync(controlPath);
    } catch(e) {
        if (e.code != 'ENOENT')
            throw e;
    }
    return Q.ninvoke(this._server, 'listen', controlPath);
};

ControlChannel.prototype.close = function() {
    this._closeOk = true;
    this._socket.end();
    this._socket = null;
    this._server.close();
};

ControlChannel.prototype._handleConnection = function(socket) {
    if (this._socket != null) {
        console.error('Unexpected new connection on communication channel');
        this._socket.end();
    }

    // NOTE: this is for reading ONLY
    // Always specify the encoding when writing
    socket.setEncoding(platform.encoding);
    socket.on('end', function() {
        if (!this._closeOk) {
            console.error('Unexpected closure on communication channel');
            socket.end();
        }

        this._socket = null;
    }.bind(this));
    socket.on('data', function(data) {
        if (socket != this._socket) // robustness
            return;

        this._partialMessage += data;
        this._tryReadMessage();
    }.bind(this));
    this._socket = socket;
    this._closeOk = false;
};

ControlChannel.prototype._tryReadMessage = function() {
    var msg;

    try {
        msg = JSON.parse(this._partialMessage);
    } catch(e) {
        // Failed: does not parse as JSON
        console.log('Partial read on control channel: ' + this._partialMessage);
        return;
    }

    this._partialMessage = '';

    if (!msg.method || !msg.args) {
        console.error('Malformed message on control channel');
        return;
    }

    Q.mapply(this._delegate, msg.method, msg.args).then(function(result) {
        if (this._socket)
            return Q.ninvoke(this._socket, 'write', JSON.stringify({reply:result}), platform.encoding);
    }.bind(this), function(error) {
        if (this._socket)
            return Q.ninvoke(this._socket, 'write', JSON.stringify({error:error.message}), platform.encoding);
    }.bind(this)).done();
};

