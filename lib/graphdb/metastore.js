// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of DataShare
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const Stream = require('stream');
const Tp = require('thingpedia');
const TripleStore = Tp.TripleStore;

const Config = require('../config');
const Constants = require('./constants');
const LocalStore = require('./local_store');
const OmletStore = require('./omletstore');
const UserStore = OmletStore.User;
const FeedStore = OmletStore.Feed;
const UnionStream = require('./unionstream');

class EmptyStore extends TripleStore {
    constructor(uri) {
        super();
        this._uri = uri;
    }

    get uri() {
        return this._uri;
    }

    get() {
        var stream = new Stream.Readable({ objectMode: true, read: function() {} });
        stream.push(null);
        return stream;
    }
}

class UnionStore extends TripleStore {
    constructor(children, uri) {
        super();
        this._children = children;
        this._uri = uri;
    }

    get uri() {
        return this._uri;
    }

    ref() {
        this._children.forEach((c) => c.ref());
    }

    unref() {
        this._children.forEach((c) => c.unref());
    }

    get(patterns) {
        // FIXME THIS IS NOT CORRECT
        var streams = this._children.map((c) => c.get(patterns));
        return new UnionStream(streams);
    }
}

class WrapperStore extends TripleStore {
    constructor(wrapped, uri) {
        super();
        this._wrapped = wrapped;
        this._uri = uri;
    }

    get uri() {
        return this._uri;
    }

    ref() {
        this._wrapped.ref();
    }

    unref() {
        this._wrapped.unref();
    }

    get(patterns) {
        return this._wrapped.get(patterns);
    }

    put(triples) {
        return this._wrapped.put(triples);
    }
}

module.exports = class MetaStore {
    constructor(platform, messaging, devices) {
        // it somewhat important that feed/user stores are cached because they listen
        // to messages sent on the feeds
        this._omletstores = {};

        this._messaging = messaging;
        this._devices = devices;

        this.local = new LocalStore(platform.getGraphDB());

        this._meRegex = new RegExp(Config.RDF_BASE_REGEX + 'me(\\/.+)?$');
        this._userRegex = new RegExp(Config.RDF_BASE_REGEX + 'user\\/([A-Za-z0-9]+)(\\/.+)?$');
        this._feedRegex = new RegExp(Config.RDF_BASE_REGEX + 'feed\\/([^/]+)(\\/.+)?$');
    }

    start() {
        return Q();
    }

    stop() {
        return Q();
    }

    _getDevices(by) {
        if (by.startsWith('@'))
            return this._devices.getDevicesByGlobalName(by.substr(1));
        else
            return this._devices.getDevice(by) ? [this._devices.getDevice(by)] : [];
    }

    _getDeviceStore(devices, uri) {
        var stores = devices.map(function(d) { return d.queryInterface('rdf'); }).filter((s) => s !== null);
        if (stores.length === 0)
            return new EmptyStore(uri);
        else if (stores.length === 1)
            return stores[0];
        else
            return new UnionStore(stores, uri);
    }

    _getMeStore() {
        // thingpedia://me is the graph union of the local store and all the device stores
        var deviceStores = this._devices.getAllDevices().map(function(d) { return d.queryInterface('rdf'); });
        deviceStores.push(this.local);
        if (deviceStores.length === 1)
            return new WrapperStore(deviceStores[0], Constants.ME);
        else
            return new UnionStore(deviceStores, Constants.ME);
    }

    _getMyStore(rest) {
        if (rest === undefined || rest === null || rest.length === 1)
            return this._getMeStore();
        else
            return this._getDeviceStore(this._getDevices(rest.substr(1)), Constants.ME + rest);
    }

    getStore(uri) {
        if (uri === Constants.LOCAL)
            return this.local;

        var match = uri.match(this._meRegex);
        if (match !== null)
            return this._getMyStore(match[1]);

        if (this._omletstores[uri])
            return this._omletstores[uri];

        match = uri.match(this._userRegex);
        if (match !== null) {
            if (match[1] === this._messaging.account)
                return this._getMyStore(match[2]);
            else
                return this._omletstores[uri] = new UserStore(this._messaging, match[1], match[2] || '');
        }

        match = uri.match(this._feedRegex);
        if (match !== null)
            return this._omletstores[uri] = new FeedStore(this._messaging, match[1], match[2] || '');

        return new EmptyStore(uri);
    }
}
