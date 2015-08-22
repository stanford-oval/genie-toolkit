// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const path = require('path');
const Q = require('q');

const BaseApp = require('../../base_app');

const FilterOps = {
    '!!': function(a) {
        return !!a;
    },
    '!': function(a) {
        return !a;
    },
    '>': function(a, b) {
        return a > b;
    },
    '<': function(a, b) {
        return a < b;
    },
    '>=': function(a, b) {
        return a >= b;
    },
    '<=': function(a, b) {
        return a <= b;
    },
    '==': function(a, b) {
        return a === b;
    },
    '!=': function(a, b) {
        return a !== b;
    },
    '=~': function(a, b) {
        return a.match(b) !== null;
    }
};

function filterMatches(event, filter) {
    var name = filter[0];
    var op = filter[1];
    var param = filter[2];

    if (op in FilterOps)
        return FilterOps[op](event[name], param);
    else
        throw new Error('Invalid filter op ' + op);
}

function replaceInto(event, value) {
    for (var key in event) {
        value = value.replace('{{' + key + '}}', event[key]);
    }

    return value;
}

function computeOutput(event, type, value) {
    switch(type) {
    case 'const':
        return value;
    case 'string':
        return replaceInto(event, value);
    case 'number':
        // FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME
        // FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME
        // FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME
        // FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME FIXME
        return eval(replaceInto(event, value));
    default:
        throw new Error('Invalid output type ' + value);
    }
}

const App = new lang.Class({
    Name: 'App',
    Extends: BaseApp,

    _init: function(engine, serialized) {
        this.parent(engine, serialized);

        this._triggerChannel = null;
        this._actionChannel = null;

        // The serialized state contains:
        // - A trigger, composed of:
        //     - a source channel ID and optionally a device
        //     - a list of filter expressions
        //       (parameter, op, maybe argument)
        // - An action, composed of
        //     - a sink channel ID and optionally a device
        //     - a transform operation on the input data to generate
        //       the output data, as a list of
        //       (output name, type, output argument expression)
        // This app does not have state (if anything dies at the wrong time,
        // we'll reopen the channel and rely on it to hold on to unprocessed
        // events), so we just cache the serialization
        //
        // Example of this app:
        // { kind: '...',
        //   trigger: { channel: { id: 'twitter' },
        //              filter: [['user','=','123456'], ['date','>','1970-01-01']] },
        //   action: { channel: { id: 'sms' },
        //             output: [['to','const','555-555-5555'], ['text', 'string', '{{user}} tweeted'],
        //                      ['something','number','1 + {{input}}']] }
        // }

        this.filename = module.filename;
    },

    _triggerMatches: function(event) {
        var trigger = this.state.trigger;

        return trigger.filter.every(function(filter) {
            return filterMatches(event, filter);
        });
    },

    _executeAction: function(event) {
        var action = this.state.action;

        var output = {};
        action.output.forEach(function(item) {
            var name = item[0];
            var type = item[1];
            var value = item[2];
            output[name] = computeOutput(event, type, value);
        });

        this._actionChannel.sendEvent(output);
    },

    _onChannelEvent: function(event) {
        if (this._triggerMatches(event))
            this._executeAction(event);
    },

    _deserializeChannel: function(channel, mode) {
        if (channel.device !== undefined) {
            var device = this.engine.devices.getDevice(channel.device);
            return this.engine.channels.getDeviceChannel(channel.id, device);
        } else if (channel.id.substr(0, 5) == 'pipe-') {
            return this.engine.channels.getNamedPipe(channel.id.substr(5), mode);
        } else {
            return this.engine.channels.getChannel(channel.id);
        }
    },

    start: function() {
        if (this.state.name)
            console.log(this.state.name + ' starting');

        var serialized = this.state;
        return Q.all([this._deserializeChannel(serialized.trigger.channel, 'r'),
                      this._deserializeChannel(serialized.action.channel, 'w')])
            .spread(function(triggerChannel, actionChannel) {
                this._triggerChannel = triggerChannel;
                this._actionChannel = actionChannel;

                this._triggerChannel.on('event', this._onChannelEvent.bind(this));
            }.bind(this));
    },

    stop: function() {
        if (this._triggerChannel == null || this._actionChannel == null)
            return Q();

        return Q.all([this._triggerChannel.close(), this._actionChannel.close()]);
    },

    showUI: function(command) {
        if (command === undefined) {
            return [path.dirname(module.filename) + '/show.jade',
                    { title: "ThingEngine - " + this.state.name,
                      name: this.state.name, trigger: this.state.trigger,
                      action: this.state.action }];
        } else {
            return this.parent(command);
        }
    }
});

function createApp(engine, serializedApp) {
    return new App(engine, serializedApp);
}

module.exports.createApp = createApp;
