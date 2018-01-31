// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Thingpedia
//
// Copyright 2015-2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Url = require('url');
const Q = require('q');
const events = require('events');
const Matrix = require("matrix-js-sdk");

const Tp = require('thingpedia');

const THINGPEDIA_EVENT_TYPE = 'org.thingpedia.v1.message';

class MatrixUser {
    constructor(o) {
        this.account = o.account;
        this.name = o.name;
        this.thumbnail = o.thumbnailHash;
    }
}

class Feed extends Tp.Messaging.Feed {
    constructor(messaging, room) {
        super(room.roomId);

        this._messaging = messaging;
        this._device = messaging._device;
    }

    _newMessage(o) {
        this.emit('new-message', o);
        this.emit(direction, o);
    }

    _doOpen() {
        return this._device.refMatrixClient().then((client) => {
            this._client = client;
            this._room = this._client.getRoom(this.feedId);
        });
    }

    _doClose() {
        this._device.unrefMatrixClient();
        this._client = null;
        this._room = null;
        return Q();
    }

    sendText(text) {
        return Q(this._client.sendTextMessage(this.feedId, text));
    }

    _getUploadable(url) {
        if (typeof url === 'string') {
            // the url might expire, so get it first, upload it and then send it
            let fileName = Url.parse(url).pathname;
            fileName = fileName.substring(fileName.lastIndexOf('/'));

            if (url.startsWith('http')) {
                return Tp.Helpers.Http.getStream(url).spread(function(res) {
                    let contentType = res.headers['content-type'];
                    return [res, contentType];
                });
            } else {
                return Tp.Helpers.Content.getStream(this._device.engine.platform, url).then((stream) => {
                    let contentType = stream.contentType;
                    return [stream, contentType];
                });
            }
        } else if (Buffer.isBuffer(url)) {
            return Q([url, 'application/octet-stream']);
        } else {
            throw new TypeError('Invalid type for call to sendPicture, must be string or buffer');
        }
    }

    _getMxcUrl(url) {
        // easy case: file already stored in the Matrix
        if (url.startsWith('mxc://'))
            return Q(url);

        return this._getUploadable(url).then(([stream, contentType]) => this._client.uploadContent(stream, {
            name: fileName,
            type: contentType,
            onlyContentUri: true
        }));
    }

    sendPicture(url) {
        return this._getMxcUrl(url).then((url) => {
            return this._client.sendImageMessage(this.feedId, url, {}, 'image');
        });
    }

    sendItem(item) {
        return this._client.sendEvent(this.feedId, THINGPEDIA_EVENT_TYPE, item);
    }
}

module.exports = class Messaging extends Tp.Messaging {
    constructor(device) {
        super();
        this._device = device;
        this._feeds = new WeakMap;

        this.client = null;

        this._membershipListener = this._onMembership.bind(this);
        this._timelineListener = this._onTimeline.bind(this);
        this._nameListener = this._onName.bind(this);
    }

    _onName(room) {
        let feed = this._feeds.get(room);
        if (!feed)
            return;
        feed.emit('changed');
    }

    _onMembership(event, member, old) {
        // auto join any rooms we're invited to, so we can exchange messages
        if (member.userId === this.account && member.membership === 'invite')
            this.client.joinRoom(member.roomId);
    }

    _onTimeline(event, room, toStartOfTimeline, removed, data) {
        if (removed || toStartOfTimeline || !data.liveEvent)
            return;

        let type = event.getType();
        if (type !== 'm.room.message' &&
            type !== THINGPEDIA_EVENT_TYPE)
            return;

        let obj = {
            serverTimestamp: event.getTs(),
            sender: event.getSender(),
            msgId: event.getId(),
        }

        let direction;
        if (event.sender.userId === this._device.userId)
            direction = 'outgoing-message';
        else
            direction = 'incoming-message';

        let content = event.getContent();
        let sendReceipt = false;
        if (type === 'org.thingpedia.v1.message') {
            obj.type = 'app';
            obj.json = content;
            sendReceipt = true;
        } else {
            switch (content.msgtype) {
            case 'm.text':
                obj.type = 'text';
                obj.text = content.body;
                break;
            case 'm.image':
                // FIXME check that this is what Omlet does
                obj.type = 'picture';
                obj.url = content.url;
                break;
            case 'm.emote':
            case 'm.notice':
                // ignore
                return;
            default:
                console.log('Ignored message of type ' + content.msgtype);
                return;
            }
        }

        let feed = this._feeds.get(room);
        if (feed)
            feed._newMessage(direction, obj);
        this.emit(direction, room.roomId, obj, event);

        if (direction === 'incoming-message' && sendReceipt)
            this.client.sendReadReceipt(event);
    }

    get account() {
        return this._device.userId;
    }

    getIdentities() {
        return this._device.identities;
    }

    feedClosed(identifier) {
        // nothing to do here
    }

    getFeed(feedId) {
        return this._getFeedForRoom(this.client.getRoom(feedId));
    }

    start() {
        console.log('Messaging.start');
        return this._device.refMatrixClient().then((client) => {
            this.client = client;
            this.client.startClient();
            return Q.Promise((resolve, reject) => {
                this.client.once('sync', (state, prev, data) => {
                    if (state === 'PREPARED')
                        resolve();
                    else if (state === 'ERROR')
                        reject(data.err);
                });
            }).then(() => {
                this.client.on('RoomMember.membership', this._membershipListener);
                this.client.on('Room.timeline', this._timelineListener);
                this.client.on('Room.name', this._nameListener);
            });
        });
    }

    stop() {
        console.log('Messaging.stop');
        this.client.removeListener('Room.timeline', this._timelineListener);
        this.client.removeListener('Room.name', this._nameListener);
        this.client.removeListener('RoomMember.membership', this._membershipListener);
        return this.client.store._reallySave().then(() => {
            this._device.unrefMatrixClient();
        });
    }

    getUserByAccount(account) {
        return Q(new MatrixUser(this.client.getUser(account) || new Matrix.User(account)));
    }

    _getFeedForRoom(room) {
        if (this._feeds.has(room))
            return this._feeds.get(room);

        let feed = new Feed(this, room);
        return feed;
    }

    getFeedList() {
        return Q(this.client.getRooms().map(this._getFeedForRoom, this));
    }

    createFeed() {
        return Q(this.client.createRoom({ visibility: 'private', preset: 'private_chat' })).then((obj) => {
            let room = this.client.getRoom(obj.room_id);
            let feed = this._getFeedForRoom(room);

            // enable end-to-end crypto once i figure out the configuration...
            //if (false)
            //    return this.client.setRoomEncryption()
            return feed;
        });
    }

    searchAccountByName(name) {
        return Q(this.client.searchUserDirectory({ term: name })).then((users) => {
            return users.map((u) => new Matrix.User(u));
        });
    }

    addAccountToContacts(contactId) {
        // this should trigger a sync, hopefully;
        // maybe not, not sure...
        this.client.getUser(contactId);
        return Q();
    }

    getFeedWithContact(contactId) {
        if (contactId.startsWith('matrix-account:'))
            contactId = contactId.substring('matrix-account:'.length);
        if (!contactId.startsWith('@'))
            return Q.reject(new Error('Identity hashes are not supported by MatrixMessaging.getFeedWithContact'));

        for (let room of this.client.getRooms()) {
            let joined = room.getMembersWithMembership('join');
            let invited = room.getMembersWithMembership('invite');
            if (joined.length + invited.length === 2) {
                let all = joined.concat(invited);
                if ((all[0].userId === this.account && all[1].userId === contactId) ||
                    (all[0].userId === contactId && all[1].userId === contactId)) {
                    console.log('Reusing feed ' + room.roomId + ' with ' + contactId);
                    return Q(this._getFeedForRoom(room));
                }
            }
        }

        return Q(this.client.createRoom({ visibility: 'private', preset: 'private_chat', invite: [contactId] })).then((room) => {
            console.log('room', room);
            console.log('Created feed ' + room.room_id + ' with ' + contactId);
            return this._getFeedForRoom(this.client.getRoom(room.room_id));
        });
    }

    getAccountForIdentity(identity) {
        let [medium, address] = identity.split(':');
        if (medium === 'phone') {
            medium = 'msisdn';
            address = address.replace('+', '');
        }
        if (medium === 'matrix-account')
            return this.client.getUser(address);

        return Q(this.client.lookupThreePid(medium, address)).then((response) => {
            return response.mxid;
        });
    }

    leaveFeed(feedId) {
        return Q(this.client.leave(feedId));
    }
}

