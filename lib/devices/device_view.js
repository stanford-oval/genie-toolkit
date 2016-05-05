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

const ObjectSet = require('../util/object_set');

// A "view" of a set of devices, as a set of selectors matching
// in specific context (which must be an ObjectSet of Devices)
module.exports = class DeviceView extends ObjectSet.Base {
    constructor(context, selector) {
        super();

        this.context = context;
        this.selector = selector;

        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;
    }

    values() {
        return this.context.values().filter((o) => this._matchSelector(o));
    }

    _matchSelector(device) {
        if (this.selector.isAny) {
            return true;
        } else if (this.selector.isAttributes) {
            return this.selector.attributes.every(function(a) {
                if (a.name === 'type')
                    return device.hasKind(a.value.value);
                else if (a.name === 'id')
                    return device.uniqueId === a.value.value;
                else
                    return device.state[a.name] === a.value.value;
            });
        } else if (this.selector.isGlobalName) {
            return device.kind === this.selector.name ||
                device.globalName === this.selector.name;
        } else if (this.selector.isId) {
            return device.uniqueId === this.selector.name;
        } else {
            throw new Error('Invalid selector ' + this.selector);
        }
    }

    _onDeviceAdded(o) {
        if (this._matchSelector(o))
            this.objectAdded(o);
    }

    _onDeviceRemoved(o) {
        if (this._matchSelector(o))
            this.objectRemoved(o);
    }

    start() {
        this._deviceAddedListener = (o) => this._onDeviceAdded(o);
        this._deviceRemovedListener = (o) => this._onDeviceRemoved(o);
        this.context.on('object-added', this._deviceAddedListener);
        this.context.on('object-removed', this._deviceRemovedListener);
    }

    stop() {
        this.context.removeListener('object-added', this._deviceAddedListener);
        this.context.removeListener('object-removed', this._deviceRemovedListener);
    }
}
