// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');
const events = require('events');
const lang = require('lang');

// The abstract interface that all ObjectSets must conform to
//
// Some ObjectSets are read-only, in which case the mutator methods will fail
// XXX: This is really bad OOP, should we have two interfaces instead?
// CounterXXX: this is too much OOP!
const ObjectSet = new lang.Class({
    Name: 'ObjectSet',
    Extends: events.EventEmitter,
    Abstract: true,
    // events: object-added(object), object-removed(object)

    _init: function() {
        events.EventEmitter.call(this);
    },

    objectAdded: function(o) {
        this.emit('object-added', o);
    },

    objectRemoved: function(o) {
        this.emit('object-removed', o);
    },

    promise: function() {
        throw new Error('Not Implemented');
    },

    keys: function() {
        throw new Error('Not Implemented');
    },

    values: function() {
        throw new Error('Not Implemented');
    },

    addOne: function(o) {
        throw new Error('Not Implemented');
    },

    addMany: function(objs) {
        throw new Error('Not Implemented');
    },

    removeOne: function(o) {
        throw new Error('Not Implemented');
    },

    removeIf: function(predicate) {
        throw new Error('Not Implemented');
    },

    removeAll: function() {
        throw new Error('Not Implemented');
    },
});

const SimpleObjectSet = new lang.Class({
    Name: 'SimpleObjectSet',
    Extends: ObjectSet,

    _init: function(readonly) {
        this.parent();

        this._readonly = readonly;
        this._promises = [];
        this._objects = {};
        this._keys = null;
    },

    promise: function() {
        return Q.all(this._promises);
    },

    keys: function() {
        if (this._keys !== null)
            return this._keys;
        this._keys = Object.keys(this._objects);
        return this._keys;
    },

    values: function() {
        return this.keys().map(function(k) { return this._objects[k]; }, this);
    },

    freeze: function() {
        this._readonly = true;
    },

    addOne: function(o) {
        if (this._readonly)
            throw new Error('ObjectSet is readonly');

        var promise = Q(o);
        this._promises.push(promise);
        return promise.then(function(o) {
            if (o.uniqueId in this._objects)
                return;
            this._objects[o.uniqueId] = o;
            this._keys = null;
            this.objectAdded(o);
        }.bind(this));
    },

    addMany: function(objs) {
        if (this._readonly)
            throw new Error('ObjectSet is readonly');

        var promise = Q.all(objs);
        this._promises.push(promise);
        return promise.then(function(objs) {
            objs.forEach(function(o) {
                this.addOne(o);
            }, this);
        }.bind(this));
    },

    removeOne: function(o) {
        if (this._readonly)
            throw new Error('ObjectSet is readonly');

        return Q(o).then(function(o) {
            if (!(o.uniqueId in this._objects))
                return;
            delete this._objects[o.uniqueId];
            this._keys = null;
            this.objectRemoved(o);
        }.bind(this));
    },

    removeIf: function(predicate) {
        if (this._readonly)
            throw new Error('ObjectSet is readonly');

        var removed = [];
        for (var key in this._objects) {
            var o = this._objects[key];
            if (predicate(o)) {
                removed.push(o);
                delete this._objects[key];
                this._keys = null;
                this.objectRemoved(o);
            }
        }

        return removed;
    },

    removeAll: function() {
        if (this._readonly)
            throw new Error('ObjectSet is readonly');

        var removed = this.values();
        this._objects = {};
        this._keys = null;
        for (var i = 0; i < removed.length; i++)
            this.objectRemoved(removed[i]);
        return removed;
    },
});

module.exports = {
    Simple: SimpleObjectSet,
    Base: ObjectSet
};
