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

// The abstract interface that all ObjectSets must conform to
//
// Some ObjectSets are read-only, in which case the mutator methods will fail
class ObjectSet extends events.EventEmitter {
    // events: object-added(object), object-removed(object)

    objectAdded(o) {
        this.emit('object-added', o);
    }

    objectRemoved(o) {
        this.emit('object-removed', o);
    }

    values() {
        throw new Error('Not Implemented');
    }

    start() {
        throw new Error('Not Implemented');
    }

    stop() {
        throw new Error('Not Implemented');
    }
}

class SimpleObjectSet extends ObjectSet {
    constructor(readonly) {
        super();

        this._objects = new Map();
    }

    values() {
        return Array.from(this._objects.values());
    }

    start() {
    }

    stop() {
    }

    addOne(o) {
        var promise = Q(o);
        promise.catch((e) => { return null; }).then((o) => {
            if (o === null)
                return;
            if (this._objects.has(o.uniqueId))
                return;
            this._objects.set(o.uniqueId, o);
            this.objectAdded(o);
        }).done();
        return promise;
    }

    addMany(objs) {
        objs.forEach((o) => this.addOne(o));
    }

    removeOne(o) {
        if (!this._objects.has(o.uniqueId))
            return;
        this._objects.delete(o.uniqueId);
        this.objectRemoved(o);
    }

    removeIf(predicate) {
        var removed = [];
        for (var entry of this._objects) {
            var key = entry[0];
            var value = entry[1];
            if (predicate(o)) {
                removed.push(o);
                this._objects.delete(key);
                this.objectRemoved(o);
            }
        }

        return removed;
    }

    removeAll() {
        var removed = this.values();
        this._objects.clear();
        for (var o of removed)
            this.objectRemoved(o);
        return removed;
    }
}

module.exports = {
    Simple: SimpleObjectSet,
    Base: ObjectSet
};
