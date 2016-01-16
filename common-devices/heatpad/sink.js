// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//                Jiwon Seo <jiwon@cs.stanford.edu>
//
// See COPYING for details
//

const Tp = require('thingpedia');
const Q = require('q');
const xmppClient = require('node-xmpp-client')

var heatPadAccount = '00000c46@iunplug.co.kr'

module.exports = new Tp.ChannelClass({
    Name: 'HeatPadChannel',

    _init: function(engine, device) {
        this.parent();
        this.device = device;
    },

    _doOpen: function() {
        this._client = new xmppClient({
            jid: this.device.account,
            password: this.device.password,
            host: 'talk.google.com',
            reconnect: true,
            domain: "gmail.com"
        });

        this._client.connection.socket.setTimeout(0);
        this._client.connection.socket.setKeepAlive(true, 10000);

        return Q.Promise(function(callback, errback) {
            this._client.on('error', errback);
            this._client.on('online', callback);
        }.bind(this));
    },

    sendEvent: function(event) {
        var power = event[0];
        if (power) {
            console.log("Turning your heatpad on");
            stanza = new xmppClient.Stanza('message', {to:heatPadAccount, type:'chat'}).c('body').t(
                'R9HAUTO_JSON{"type":"request","payload":{"indexes":[{"idx":2,"heaters":[{"power":true,"htidx":1}]}],"command":"setstate","devtype":"thermomat"},"msgid":"4F95D3PE1A","version":1}');
            this._client.send(stanza)
        } else {
            console.log("Turning your heatpad off");
            stanza = new xmppClient.Stanza('message', {to:heatPadAccount, type:'chat'}).c('body').t(
                'R9HAUTO_JSON{"type":"request","payload":{"indexes":[{"idx":2,"heaters":[{"power":false,"htidx":1}]}],"command":"setstate","devtype":"thermomat"},"msgid":"F2ESTPFTG3","version":1}}');
            this._client.send(stanza)
        }
    }
});
