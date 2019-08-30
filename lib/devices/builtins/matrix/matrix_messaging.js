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
const Matrix = require("matrix-js-sdk");

const Tp = require('thingpedia');

const THINGPEDIA_EVENT_TYPE = 'org.thingpedia.v1.message';

function arrayEqual(a, b) {
    if (a.length !== b.length)
        return false;
    for (var i = 0; i < a.length; i++) {
        if (a[i] !== b[i])
            return false;
    }
    return true;
}


class MatrixUser {
    constructor(o) {
        this.account = 'matrix-account:' + o.user_id;
        this.name = o.display_name;
        this.thumbnail = o.avatar_url;
    }
}

class Feed extends Tp.Messaging.Feed {
    constructor(messaging, room) {
        super('matrix:' + room.roomId);

        this._roomId = room.roomId;
        this._messaging = messaging;
        this._device = messaging._device;
    }

    getMembers() {
        let members = [];
        let room = this._messaging.client.getRoom(this._roomId);
        for (let state of ['join', 'invite']) {
            for (let member of room.getMembersWithMembership(state))
                members.push('matrix-account:' + member.userId);
        }
        members.sort();
        return members;
    }

    _newMessage(direction, o) {
        this.emit('new-message', o);
        this.emit(direction, o);
    }

    _doOpen() {
        return this._device.refMatrixClient().then((client) => {
            this._client = client;
            this._room = this._client.getRoom(this._roomId);
        });
    }

    _doClose() {
        this._device.unrefMatrixClient();
        this._client = null;
        this._room = null;
        return Q();
    }

    sendText(text) {
        return Q(this._client.sendTextMessage(this._roomId, text));
    }

    _getUploadable(url) {
        if (typeof url === 'string') {
            // the url might expire, so get it first, upload it and then send it

            if (url.startsWith('http')) {
                return Tp.Helpers.Http.getStream(url).spread((res) => {
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
        if (typeof url === 'string' && url.startsWith('mxc://'))
            return Q(url);
        let fileName;
        if (typeof url === 'string') {
            fileName = Url.parse(url).pathname;
            fileName = fileName.substring(fileName.lastIndexOf('/'));
        }

        return this._getUploadable(url).then(([stream, contentType]) => this._client.uploadContent(stream, {
            name: fileName,
            type: contentType,
            onlyContentUri: true
        }));
    }

    sendPicture(url) {
        return this._getMxcUrl(url).then((url) => {
            return this._client.sendImageMessage(this._roomId, url, {}, 'image');
        });
    }

    sendItem(item) {
        return this._client.sendEvent(this._roomId, THINGPEDIA_EVENT_TYPE, item);
    }
}

module.exports = class MatrixMessaging extends Tp.Messaging {
    constructor(device) {
        super();
        this._device = device;
        this._feeds = new WeakMap;

        this.client = null;
        this._stopped = false;

        this._membershipListener = this._onMembership.bind(this);
        this._timelineListener = this._onTimeline.bind(this);
        this._nameListener = this._onName.bind(this);

        this._roomAliasCache = new Map;
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

        let feed = this._feeds.get(event.room);
        if (!feed)
            return;

        if (old === null && (member.membership === 'join' || member.membership === 'invite'))
            feed.emit('member-joined', member.userId);
        else if ((old === 'join' || old === 'invite') && member.membership !== 'join' && member.membership !== 'invite')
            feed.emit('member-left', member.userId);
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
            sender: 'matrix-account:' + event.getSender(),
            msgId: event.getId(),
        };

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
        this.emit(direction, 'matrix:' + room.roomId, obj, event);

        if (direction === 'incoming-message' && sendReceipt)
            this.client.sendReadReceipt(event);
    }

    get account() {
        return 'matrix-account:' + this._device.userId;
    }

    get type() {
        return 'matrix';
    }

    getIdentities() {
        return this._device.identities;
    }

    getFeed(feedId) {
        if (feedId.startsWith('matrix:'))
            feedId = feedId.substring('matrix:'.length);
        return this._getFeedForRoom(this.client.getRoom(feedId), feedId);
    }

    async start() {
        this._stopped = false;
        const client = await this._device.refMatrixClient();
        if (this._stopped) {
            await this._device.unrefMatrixClient();
            return false;
        }
        this.client = client;
        this.client.startClient();
        const ok = await new Promise((resolve, reject) => {
            this.client.once('sync', (state, prev, data) => {
                if (state === 'PREPARED') {
                    resolve(true);
                } else if (state === 'ERROR') {
                    console.error('SYNC ERROR', data);

                    // remove ourselves quietly if the error is due to an invalid (revoked) token
                    if (data.error && data.error.errcode === 'M_UNKNOWN_TOKEN') {
                        this._device.engine.devices.removeDevice(this._device);
                        resolve(false);
                        return;
                    }

                    reject(new Error('Sync error: ' + data.error.message));
                }
            });
        });
        if (!ok)
            return false;
        this.client.on('RoomMember.membership', this._membershipListener);
        this.client.on('Room.timeline', this._timelineListener);
        this.client.on('Room.name', this._nameListener);
        return true;
    }

    stop() {
        this._stopped = true;
        if (!this.client)
            return Q();

        this.client.removeListener('Room.timeline', this._timelineListener);
        this.client.removeListener('Room.name', this._nameListener);
        this.client.removeListener('RoomMember.membership', this._membershipListener);
        return this.client.store._reallySave().then(() => {
            this._device.unrefMatrixClient();
        });
    }

    getUserByAccount(account) {
        if (account.startsWith('matrix-account:'))
            account = account.substring('matrix-account:'.length);
        return Q(new MatrixUser(this.client.getUser(account) || new Matrix.User(account)));
    }

    _getFeedForRoom(room, feedId) {
        if (this._feeds.has(room))
            return this._feeds.get(room);

        let feed = new Feed(this, room);
        this._feeds.set(room, feed);
        return feed;
    }

    getFeedList() {
        return Q(this.client.getRooms().map(this._getFeedForRoom, this));
    }

    createFeed() {
        return Q(this.client.createRoom({ visibility: 'private', preset: 'private_chat' })).then(async (obj) => {
            let room = this.client.getRoom(obj.room_id);
            if (room === null) {
                // HACK
                await Q.delay(100);
                room = this.client.getRoom(obj.room_id);
            }
            let feed = this._getFeedForRoom(room, obj.room_id);

            // enable end-to-end crypto once i figure out the configuration...
            //if (false)
            //    return this.client.setRoomEncryption()
            return feed;
        });
    }

    searchAccountByName(name) {
        return Q(this.client.searchUserDirectory({ term: name })).then((users) => {
            return users.results.map((u) => new MatrixUser(u));
        });
    }

    addAccountToContacts(contactId) {
        // this should trigger a sync, hopefully;
        // maybe not, not sure...
        this.client.getUser(contactId);
        return Q();
    }

    getFeedByAlias(aliasId) {
        if (aliasId.startsWith('matrix:'))
            aliasId = aliasId.substring('matrix:'.length);
    
        if (aliasId.startsWith('!'))
            return Q(this.getFeed(aliasId));

        if (this._roomAliasCache.has(aliasId))
            return Q(this.getFeed(this._roomAliasCache.get(aliasId)));

        return Q(this.client.getRoomIdForAlias(aliasId).then((result) => {
            let roomId = result.room_id;
            this._roomAliasCache.set(aliasId, roomId);
            return this.getFeed(roomId);
        }));
    }

    _findExistingFeedWithContact(contacts) {
        let searchKey = [this._device.userId].concat(contacts);
        searchKey.sort();

        for (let room of this.client.getRooms()) {
            let joined = room.getMembersWithMembership('join');
            let invited = room.getMembersWithMembership('invite');
            if (joined.length + invited.length === searchKey.length) {
                let all = joined.concat(invited).map((u) => u.userId);
                all.sort();
                if (arrayEqual(all, searchKey)) {
                    console.log('Reusing feed ' + room.roomId + ' with ' + contacts);
                    return Q(this._getFeedForRoom(room, room.roomId));
                }
            }
        }

        return null;
    }

    getFeedWithContact(contactIds) {
        if (!Array.isArray(contactIds))
            contactIds = [contactIds];

        contactIds = contactIds.map((contactId) => {
            if (contactId.startsWith('matrix-account:'))
                contactId = contactId.substring('matrix-account:'.length);
            if (!contactId.startsWith('@'))
                return Q.reject(new Error('Identity hashes are not supported by MatrixMessaging.getFeedWithContact'));
            return contactId;
        });

        let existing = this._findExistingFeedWithContact(contactIds);
        if (existing)
            return Q(existing);

        return Q(this.client.createRoom({ visibility: 'private', preset: 'private_chat', invite: contactIds })).then((room) => {
            console.log('room', room);
            console.log('Created feed ' + room.room_id + ' with ' + contactIds);
            return this._getFeedForRoom(this.client.getRoom(room.room_id), room.room_id);
        });
    }

    getAccountForIdentity(identity) {
        let [medium, address] = identity.split(':');
        if (medium === 'phone') {
            medium = 'msisdn';
            address = address.replace('+', '');
        }
        if (medium === 'matrix-account')
            return Q(this.client.getUser(address)).then((user) => user ? 'matrix-account:' + user.user_id : null);
        if (medium !== 'msisdn' && medium !== 'email')
            return Q(null);

        return Q(this.client.lookupThreePid(medium, address)).then((response) => {
            return response.mxid ? 'matrix-account:' + response.mxid : null;
        });
    }

    leaveFeed(feedId) {
        return Q(this.client.leave(feedId));
    }
};

