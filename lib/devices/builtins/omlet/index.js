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

const Q = require('q');
const crypto = require('crypto');
const fs = require('fs');
const Url = require('url');
const Tp = require('thingpedia');
const Omlib = require('omlib');

const LDProto = require('omlib/src/longdan/ldproto');
const LDIdentityType = require('omlib/src/longdan/ldproto/LDIdentityType');
const OmletMessaging = require('./omlet_messaging');
const InMessageChannel = require('./inmessage');

const API_KEY = '00109b1ea59d9f46d571834870f0168b5ed20005871d8752ff';
const API_SECRET = 'bccb852856c462e748193d6211c730199d62adcf0ba963416fcc715a2db4d76f';

class IncomingMessageChannel extends InMessageChannel {
    get signal() {
        return 'incoming-message';
    }
}

class NewMessageChannel extends InMessageChannel {
    get signal() {
        return 'new-message';
    }
}

class DeviceStateStorage {
    constructor(device, backingObject) {
        this._device = device;
        this._storage = backingObject || {};
        this._stateChangedQueued = false;
    }

    _queueStateChanged() {
        if (this._stateChangedQueued)
            return;

        this._stateChangedQueued = true;
        setTimeout(() => {
            if (this._device !== null)
                this._device.stateChanged();
        }, 0);
    }

    serialize() {
        return this._storage;
    }

    setBackingStorage(storage) {
        this._storage = storage;
    }

    key(idx) {
        return Object.keys(this._storage)[idx];
    }
    getItem(key) {
        return this._storage[key];
    }
    setItem(key, value) {
        this._storage[key] = value;
        this._queueStateChanged();
    }
    removeItem(key) {
        delete this._storage[key];
        this._queueStateChanged();
    }
    clear() {
        this._storage = {};
        this._queueStateChanged();
    }
}

function safeMkdirSync(dir) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

function makeOmletClient(instance, platform, storage, chatObjectProcessor, sync) {
    var dbpath = platform.getWritableDir() + '/omlet';
    safeMkdirSync(dbpath);
    var client = new Omlib({ instance: instance,
                             storage: storage,
                             storagePath: dbpath,
                             history: 'none',
                             sync: sync,
                             apiKey: { Id: API_KEY, Secret: API_SECRET },
                             processorOptions: { chatObjectProcessor: chatObjectProcessor,
                                                 enabledProcessors: ['text', 'picture', 'rdl', 'app'] }});
    client._ldClient.longdanMessageConsumer.DEBUG = false;
    return client;
}

function findPrimaryIdentity(client) {
    if (!client._ldClient._details)
        return undefined;
    var account = client.auth.getAccount();
    var identities = client._ldClient._details.Identities;
    var omletId = null;
    var email = null;
    var phone = null;
    for (var i = 0; i < identities.length; i++) {
        var id = identities[i];
        if (id.Type === 'omlet')
            omletId = id.Principal;
        else if (id.Type === 'email' && email === null)
            email = id.Principal;
        else if (id.Type === 'phone' && phone === null)
            phone = id.Principal;
    }
    if (omletId !== null)
        return omletId;
    if (email !== null)
        return email;
    if (phone !== null)
        return phone;
    return account;
}

function runOAuth2Phase1(engine) {
    var buf = crypto.randomBytes(8).toString('hex');
    var storage = new DeviceStateStorage(null, undefined);
    var client = makeOmletClient(buf, engine.platform, storage, null, false);

    return Q.try(() => {
        client.connect();

        var origin = engine.platform.getOrigin();
        return Q.ninvoke(client._ldClient.auth, 'getAuthPage',
                         origin + '/devices/oauth2/callback/org.thingpedia.builtin.omlet',
                         ['PublicProfile', 'OmletChat']);
    }).then((resp) => {
        var parsed = Url.parse(resp.Link, true);
        return [resp.Link, { 'omlet-query-key': parsed.query.k,
                             'omlet-instance': buf,
                             'omlet-storage': JSON.stringify(storage.serialize()) }];
    }).finally(() => {
        return client.disable();
    }).catch((e) => {
        console.error(e);
        throw e;
    });
}

function runOAuth2Phase2(engine, req) {
    if (!req.session['omlet-storage'])
        throw new Error('Failed to connect to Omlet. This occurs if you press the back button or refresh. You should try again from Add New Account.');
    var storageState = JSON.parse(req.session['omlet-storage']);
    var instance = req.session['omlet-instance'];
    var storage = new DeviceStateStorage(null, storageState);
    var client = makeOmletClient(instance, engine.platform, storage, null, false);

    var code = req.query.code;
    var key = req.session['omlet-query-key'];

    return Q.Promise((callback, errback) => {
        client.connect();

        client._ldClient.onSignedUp = callback;
        client._ldClient.auth.confirmAuth(code, key);
    }).then(() => {
        return engine.devices.loadOneDevice({ kind: 'org.thingpedia.builtin.omlet',
                                              omletId: findPrimaryIdentity(client),
                                              instance: instance,
                                              storage: storage.serialize() }, true);
    }).finally(() => {
        client.disable();
    });
}

class SendFeedAction extends Tp.BaseChannel {
    sendEvent(event) {
        if (event.length < 3)
            throw new TypeError('Invalid arguments to @omlet.send(), expected feed, type, message');

        var feed = event[0];
        var msgType = event[1];
        var msg = event[2];

        return feed.open().then(() => {
            if (msgType === 'text')
                return feed.sendText(msg);
            else if (msgType === 'picture')
                return feed.sendPicture(msg);
            else
                throw new TypeError('Invalid message type, expected text or picture');
        }).finally(() => {
            return feed.close();
        });
    }
}

class SendTextAction extends Tp.BaseChannel {
    sendEvent(event) {
        var to = event[0];
        var msg = event[1];
        var identityHash = null;

        if (to.indexOf(':') >= 0) {
            // already encoded
            identityHash = to;
        } else if (to.indexOf('@') >= 0) {
            identityHash = 'email:' + to;
        } else if (/^[+0-9]+$/.exec(to) !== null) {
            identityHash = 'phone:' + to;
        } else {
            identityHash = 'omlet:' + to;
        }

        return this.device.queryInterface('messaging').getFeedWithContact(identityHash).then((feed) => {
            return feed.open().then(() => {
                return feed.sendText(msg);
            }).finally(() => {
                return feed.close();
            });
        });
    }
}

class SendPictureAction extends Tp.BaseChannel {
    sendEvent(event) {
        var to = event[0];
        var url = event[1];
        var identityHash = null;

        if (to.indexOf(':') >= 0) {
            // already encoded
            identityHash = to;
        } else if (to.indexOf('@') >= 0) {
            identityHash = 'email:' + to;
        } else if (/^[+0-9]+$/.exec(to) !== null) {
            identityHash = 'phone:' + to;
        } else {
            identityHash = 'omlet:' + to;
        }

        return this.device.queryInterface('messaging').getFeedWithContact(identityHash).then((feed) => {
            return feed.open().then(() => {
                return feed.sendPicture(url);
            }).finally(() => {
                return feed.close();
            });
        });
    }
}

function configureFromAlmond(engine, delegate) {
    var instance = crypto.randomBytes(8).toString('hex');
    var storage = new DeviceStateStorage(null, undefined);
    var client = makeOmletClient(instance, engine.platform, storage, null, false);
    console.log('Obtained omlet Client');

    client.connect();
    return Q(delegate.requestCode(engine._("Insert your phone number or email address:")).then((identity) => {
        let identityType = LDIdentityType.Phone;
        if (identity.indexOf('@') >= 0)
            identityType = LDIdentityType.Email;
        else if (!identity.startsWith('+1'))
            identity = '+1' + identity.replace(/^[0-9]/g, '');

        let ldidentity = new LDProto.LDIdentity();
        ldidentity.Type = identityType;
        ldidentity.Principal = identity;

        // .auth.connectIdentity is broken (as usual), bypass it
        let req = new LDProto.LDRegisterWithTokenRequest();
        req.Identity = ldidentity;
        // ignore errors
        client._ldClient.idpCall(req, () => {});

        if (identityType === LDIdentityType.Email) {
            delegate.reply(engine._("Please click the confirmation link that was just sent you."));
            return new Promise(((callback) => {
                client._ldClient.onSignedUp = callback;
            }));
        } else {
            return delegate.requestCode(engine._("Insert the confirmation code you received in the SMS.")).then((code) => {
                return new Promise(((callback) => {
                    client._ldClient.onSignedUp = callback;
                    client._ldClient.auth.confirmPinForIdentity(ldidentity, code.trim(),
                                                                client._ldClient.auth._onAuthenticationComplete.bind(client._ldClient.auth));
                }));
            });
        }
    }).then(() => {
        return engine.devices.loadOneDevice({ kind: 'org.thingpedia.builtin.omlet',
                                              omletId: findPrimaryIdentity(client),
                                              instance: instance,
                                              storage: storage.serialize() }, true);
    })).finally(() => {
        client.disable();
    });
}

module.exports = class OmletDevice extends Tp.BaseDevice {
    static runOAuth2(engine, req) {
        if (req === null)
            return runOAuth2Phase1(engine);
        else
            return runOAuth2Phase2(engine, req);
    }
    static configureFromAlmond(engine, delegate) {
        return configureFromAlmond(engine, delegate);
    }

    constructor(engine, state) {
        super(engine, state);

        this._updateNameAndDescription();
        this.uniqueId = 'omlet-' + this.omletInstance;

        this._omletStorage = null;
        this._omletClient = null;
        this._omletClientCount = 0;
        this._omletStorage = new DeviceStateStorage(this, this.state.storage);
        this._omletMessaging = new OmletMessaging(this);
    }

    get ownerTier() {
        return Tp.Tier.GLOBAL;
    }

    _updateNameAndDescription() {
        this.name = this.engine._("Omlet Account of %s").format(this.omletId);
        this.description = this.engine._("This is your Omlet Account. You can use it to communicate and share data with your friends!");
    }

    updateState(newstate) {
        super.updateState(newstate);
        if (this._omletStorage !== null)
            this._omletStorage.setBackingStorage(this.state.storage);
    }

    get omletInstance() {
        return this.state.instance;
    }

    get omletId() {
        return this.state.omletId;
    }

    refOmletClient() {
        if (this._omletClientCount > 0) {
            this._omletClientCount++;
            return this._omletClient;
        }

        this._omletClient = makeOmletClient(this.omletInstance, this.engine.platform, this._omletStorage, this._chatObjectProcessor, true);
        var client = this._omletClient;

        var identity = findPrimaryIdentity(client);
        if (identity !== undefined && identity !== this.state.omletId) {
            console.log('Omlet ID of ' + this.uniqueId + ' changed to ' + identity);
            this.state.omletId = identity;
            this._updateNameAndDescription();
            this.stateChanged();
        }
        this._omletClientCount ++;
        return client;
    }

    unrefOmletClient() {
        setTimeout(() => {
            this._omletClientCount --;
            if (this._omletClientCount === 0) {
                this._omletClient.disable();
                this._omletClient = null;
            }
        }, 5000);
    }

    queryInterface(iface) {
        switch(iface) {
        case 'omlet':
            return this._omletClient;
        case 'messaging':
            return this._omletMessaging;
        default:
            return null;
        }
    }

    checkAvailable() {
        return Tp.Availability.AVAILABLE;
    }

    getTriggerClass(name) {
        if (name === 'incomingmessage')
            return IncomingMessageChannel;
        else if (name === 'newmessage')
            return NewMessageChannel;
        else
            throw new Error('Invalid channel name ' + name);
    }

    getActionClass(name) {
        switch (name) {
        case 'send':
            return SendFeedAction;
        case 'send_to':
            return SendTextAction;
        case 'send_picture':
            return SendPictureAction;
        default:
            throw new Error('Invalid channel name ' + name);
        }
    }
};
