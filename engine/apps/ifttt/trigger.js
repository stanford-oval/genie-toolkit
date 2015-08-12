// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const event = require('./event');
const Params = require('./params');

const Trigger = new lang.Class({
    Name: 'Trigger',

    _init: function(engine, channel, getChannel, event, params) {
        var channelMeta = engine.channelFactory.createIFTTTChannel(channel);
        if (!channelMeta.objectId)
            throw new Error('Channels that don\'t have a predefined URI are not supported');
        this._channelState = getChannel(channelMeta.objectId);

        var eventMeta = channelMeta.events.find(function(e) {
            return e.id == event;
        });
        if (eventMeta === undefined)
            throw new Error('Invalid event ' + event);
        if (!eventMeta.script)
            throw new Error('Events without a script are not supported');

        this._triggerFn = eval('(' + eventMeta.script + ')');
        var eventSources = triggerMeta['event-sources'];
        var eventSources = eventSources.concat(eventMeta);

        function getPollingInterval(interval) {
            if (interval.startsWith('{{')) {
                var pname = interval.substring(2, interval.length-2);
                return parseInt(params[pname]);
            } else {
                return parseInt(interval);
            }
        }

        this._eventSources = {};
        eventSources.forEach(function(e) {
            switch(e.type) {
            case 'polling':
                this._eventSources[e.id] =
                    new event.TimeoutEventSource(getPollingInterval(e['polling-interval']));
                break;

            case 'polling-http':
            case 'sse':
            case 'broadcast-receiver':
                throw new Error('Event of type ' + e.type + ' is no longer supported');
            default:
                throw new Error('Invalid event type ' + e.type);
            }
        }.bind(this));

        this._params = Params.parseParams(params);
    },

    getEventSources: function() {
        var sources = [];
        for (var id in this._eventSources)
            sources.push(this._eventSources[id]);
        return sources;
    },

    isFiring: function(context) {
        var events = {};
        for (var id in this._eventSources)
            events[id] = this._eventSources[id].currentEvent;

        // the global object is supposed to be the channel state
        // too bad...
        return this._triggerFn.call(this._channelState, this._params, events, context);
    }
});

const CompoundTrigger = new lang.Class({
    Name: 'CompoundTrigger',

    _init: function(children, combine, initial) {
        this._children = children;
        this._combine = combine;
        this._initial = initial;
    },

    getEventSources: function() {
        var sources = [];
        this._children.forEach(function(t) {
            sources = sources.concat(t.getEventSources());
        });
    },

    isFiring: function(context) {
        return this._children.reduce(function(state, trigger) {
            return this._combine(state, trigger.isFiring(context));
        }.bind(this), this._initial);
    },
});

function createTrigger(engine, getChannel, serializedTrigger) {
    if (serializedTrigger.combinator) {
        switch(serializedTrigger.combinator) {
        case 'and':
            return new CompoundTrigger(serializedTrigger.operands.map(function(s) { return createTrigger(engine, getChannel, s) }),
                                       function(a, b) { return a && b; }, true);
        case 'or':
            return new CompoundTrigger(serializedTrigger.operands.map(function(s) { return createTrigger(engine, getChannel, s) }),
                                       function(a, b) { return a || b; }, false);
        default:
            throw new Error('Invalid trigger combinator');
        }
    } else {
        return new Trigger(engine, serializedTrigger.channel, getChannel, serializedTrigger.event, serializedTrigger.params)
    }
}

module.exports.createTrigger = createTrigger;
