// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const events = require('events');
const Tp = require('thingpedia');

const DeviceView = require('../devices/device_view');

const MESSAGING_ACCOUNT_REGEX = /^([A-Za-z.0-9]+)-account:/;

class VirtualFeed extends Tp.Messaging.Feed {
    constructor(subfeeds) {
        const id = 'virtual:[' + subfeeds.map((f) => encodeURIComponent(f.feedId)).join(',') + ']';
        super(id);

        this._subfeeds = subfeeds;
    }

    getMembers() {
        const members = [];
        for (let f of this._subfeeds)
            members.push(...f.getMembers());
        return members;
    }

    _doOpen() {
        return Promise.all(this._subfeeds.map((f) => f.open()));
    }
    _doClose() {
        return Promise.all(this._subfeeds.map((f) => f.close()));
    }

    sendText(text) {
        return Promise.all(this._subfeeds.map((f) => f.sendText(text)));
    }

    sendItem(item) {
        return Promise.all(this._subfeeds.map((f) => f.sendItem(item)));
    }

    sendPicture(url) {
        return Promise.all(this._subfeeds.map((f) => f.sendPicture(url)));
    }
}

// This module observes the addition and removal of messaging devices,
// and controls the lifetime of additional modules that depend on
// a specific messaging device

// It also provides an implementation of the Messaging interface
// based on whatever is the current device
// (which fails with Error('Device Not Available') if there is no
// configured messaging device
module.exports = class MessagingDeviceManager extends events.EventEmitter {
    constructor(platform, devices) {
        super();
        this._platformMessaging = platform.getCapability('messaging');
        this._messagingIfaces = [];

        this._incomingMessageListener = this._onIncomingMessage.bind(this);
        this._outgoingMessageListener = this._onOutgoingMessage.bind(this);
        this._feedAddedListener = this._onFeedAdded.bind(this);
        this._feedRemovedListener = this._onFeedRemoved.bind(this);
        this._feedChangedListener = this._onFeedChanged.bind(this);

        // @messaging
        this._view = new DeviceView(devices, 'messaging', {});
    }

    get isAvailable() {
        return this._messagingIfaces.length > 0;
    }

    isSelf(account) {
        for (let iface of this._messagingIfaces) {
            if (iface.account === account)
                return true;
        }
        return false;
    }

    getSelf(sendTo) {
        this._checkAvailable();

        if (!sendTo)
            return this._messagingIfaces[0].account;

        if (Array.isArray(sendTo)) {
            const match = MESSAGING_ACCOUNT_REGEX.exec(sendTo[0]);
            if (match === null)
                throw new Error(`Invalid account format: ${sendTo[0]}`);

            return this._findIface(match[1]).account;
        } else {
            sendTo = String(sendTo);
            const match = MESSAGING_ACCOUNT_REGEX.exec(sendTo);
            if (match !== null) {
                return this._findIface(match[1]).account;
            } else {
                const colon = sendTo.indexOf(':');
                const type = sendTo.substring(0, colon);
                return this._findIface(type).account;
            }
        }
    }

    getIdentities() {
        const identities = [];
        for (let iface of this._messagingIfaces)
            identities.push(...iface.getIdentities());
        return identities;
    }

    _checkAvailable() {
        if (this._messagingIfaces.length === 0)
            throw new Error('Messaging Not Available');
    }

    _findIface(type) {
        for (let iface of this._messagingIfaces) {
            if (iface.type === type)
                return iface;
        }
        throw new Error(`Invalid messaging type ${type}`);
    }

    getUserByAccount(account) {
        this._checkAvailable();

        const match = MESSAGING_ACCOUNT_REGEX.exec(account);
        if (match === null)
            throw new Error(`Invalid account format: ${account}`);

        return this._findIface(match[1]).getUserByAccount(account);
    }

    getFeedList() {
        return Promise.all(this._messagingIfaces.map((iface) => {
            return iface.getFeedList();
        })).then((lists) => {
            // flatten the array of arrays
            return [].concat(...lists);
        });
    }

    getFeed(feedId) {
        this._checkAvailable();

        if (feedId.startsWith('virtual:')) {
            const ids = feedId.substring('virtual:'.length).split(',').map((id) => decodeURIComponent(id));
            return new VirtualFeed(ids.map((id) => this.getFeed(id)));
        } else {
            const colon = feedId.indexOf(':');
            const type = feedId.substring(0, colon);
            return this._findIface(type).getFeed(feedId);
        }
    }

    getFeedByAlias(aliasId) {
        this._checkAvailable();

        const colon = aliasId.indexOf(':');
        const type = aliasId.substring(0, colon);
        return this._findIface(type).getFeedByAlias(aliasId);
    }

    getFeedWithContact(contactIds) {
        this._checkAvailable();

        if (!Array.isArray(contactIds))
            contactIds = [contactIds];

        let types = {};
        for (let contactId of contactIds) {
            const match = MESSAGING_ACCOUNT_REGEX.exec(contactId);
            if (match === null)
                throw new Error(`Invalid account format: ${contactId}`);
            if (match[1] in types) {
                types[match[1]].contactIds.push(contactId);
            } else {
                types[match[1]] = {
                    iface: this._findIface(match[1]),
                    contactIds: [contactId]
                };
            }
        }
        return Promise.all(Object.values(types).map(({iface, contactIds}) => {
            return iface.getFeedWithContact(contactIds);
        })).then((feeds) => {
            if (feeds.length === 1)
                return feeds[0];
            else
                return new VirtualFeed(feeds);
        });
    }

    searchAccountByName(name) {
        return Promise.all(this._messagingIfaces.map((iface) => {
            return iface.searchAccountByName(name);
        })).then((lists) => {
            // flatten the array of arrays
            return [].concat(...lists);
        });
    }

    async getAccountForIdentity(identity) {
        for (let iface of this._messagingIfaces) {
            const candidate = await iface.getAccountForIdentity(identity);
            if (candidate !== null)
                return candidate;
        }
        return null;
    }

    _onFeedAdded(feed) {
        this.emit('feed-added', feed);
    }

    _onFeedRemoved(feed) {
        this.emit('feed-removed', feed);
    }

    _onFeedChanged(feed) {
        this.emit('feed-changed', feed);
    }

    _onIncomingMessage(...args) {
        this.emit('incoming-message', ...args);
    }

    _onOutgoingMessage(...args) {
        this.emit('outgoing-message', ...args);
    }

    _tryAddMessagingDevice(device) {
        const iface = device.queryInterface('messaging');

        console.log('Found Messaging Device ' + device.uniqueId);
        this._initMessagingIface(iface);
    }

    _initMessagingIface(iface) {
        this._messagingIfaces.push(iface);
        return iface.start().then(() => {
            return iface.getFeedList();
        }).then((feeds) => {
            iface.on('feed-added', this._feedAddedListener);
            iface.on('feed-removed', this._feedRemovedListener);
            iface.on('feed-changed', this._feedChangedListener);
            iface.on('incoming-message', this._incomingMessageListener);
            iface.on('outgoing-message', this._outgoingMessageListener);

            feeds.forEach((feedId) => {
                this.emit('feed-added', feedId);
            });
        });
    }

    _closeMessagingDevice(device, iface) {
        iface.removeListener('feed-added', this._feedAddedListener);
        iface.removeListener('feed-removed', this._feedRemovedListener);
        iface.removeListener('feed-changed', this._feedChangedListener);
        iface.removeListener('incoming-message', this._incomingMessageListener);
        iface.removeListener('outgoing-message', this._outgoingMessageListener);

        console.log('Lost Messaging Device ' + device.uniqueId);
        const index = this._messagingIfaces.indexOf(iface);
        if (index >= 0)
            this._messagingIfaces.splice(index, 1);

        Promise.resolve(iface.getFeedList()).then((feeds) => {
            feeds.forEach((feedId) => {
                this.emit('feed-removed', feedId);
            });
        }).then(() => {
            return iface.stop();
        });
    }

    _onDeviceAdded(device) {
        // wrap into a native promise so we crash if unhandled
        Promise.resolve(this._tryAddMessagingDevice(device));
    }

    _onDeviceRemoved(device) {
        const iface = device.queryInterface('messaging');
        this._closeMessagingDevice(device, iface);
    }

    async start() {
        if (this._platformMessaging !== null)
            this._initMessagingIface(this._platformMessaging);

        this._deviceAddedListener = this._onDeviceAdded.bind(this);
        this._deviceRemovedListener = this._onDeviceRemoved.bind(this);
        this._view.start();
        this._view.on('object-added', this._deviceAddedListener);
        this._view.on('object-removed', this._deviceRemovedListener);

        for (let device of this._view.values())
            this._tryAddMessagingDevice(device);
    }

    async stop() {
        this._view.removeListener('object-added', this._deviceAddedListener);
        this._view.removeListener('object-removed', this._deviceRemovedListener);
        this._deviceAddedListener = null;
        this._deviceRemovedListener = null;

        this._view.stop();

        await Promise.all(this._messagingIfaces.map((iface) => iface.stop()));
    }
};
