// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const stream = require('stream');
const Tp = require('thingpedia');

// The phone running this instance of ThingEngine, and its
// phone specific channels (like sms and popup notifications)
module.exports = class ThingEnginePhoneDevice extends Tp.BaseDevice {
    constructor(engine, state) {
        super(engine, state);

        // This is a built-in device so we're allowed some
        // "friendly" API access
        this._tierManager = engine.tiers;

        this.uniqueId = 'org.thingpedia.builtin.thingengine.phone';

        this.name = this.engine._("Phone");
        this.description = this.engine._("Access your phone capabilities from Almond.");

        this._smsstream = null;
        this._gpsstream = null;
    }

    get ownerTier() {
        return Tp.Tier.PHONE;
    }

    checkAvailable() {
        if (Tp.Tier.PHONE === this._tierManager.ownTier) {
            return Tp.Availability.AVAILABLE;
        } else {
            return (this._tierManager.isConnected(Tp.Tier.PHONE) ?
                    Tp.Availability.AVAILABLE :
                    Tp.Availability.OWNER_UNAVAILABLE);
        }
    }

    // FIXME receive_sms
    get_receive_sms() {
        return [];
    }
    subscribe_receive_sms() {
        let sms = this.engine.platform.getCapability('sms');

        let smsstream = new stream.Readable({ objectMode: true, read() {} });
        sms.onsmsreceived = (error, sms) => {
            if (error)
                smsstream.emit('error', error);
            else
                smsstream.push({ from: sms.from, body: sms.body });
        };
        smsstream.destroy = () => sms.stop();
        sms.start();
        return smsstream;
    }

    get_get_gps() {
        let gps = this.engine.platform.getCapability('gps');
        return gps.getCurrentLocation().then((location) => {
            if (location) {
                return [{ location: { x: location.longitude, y: location.latitude, display: location.display },
                          altitude: location.altitude,
                          bearing: location.bearing,
                          speed: location.speed }];
            } else {
                return [{ location: { x: 0, y: 0, display: this.engine._("Unknown") },
                          altitude: 0,
                          bearing: 0,
                          speed: 0 }];
            }
        });
    }
    subscribe_get_gps() {
        let gps = this.engine.platform.getCapability('gps');
        let gpsstream = new stream.Readable({ objectMode: true, read() {} });

        gps.onlocationchanged = (error, location) => {
            if (error) {
                gpsstream.emit('error', error);
            } else if (location !== null) {
                gpsstream.push({ location: { x: location.longitude, y: location.latitude, display: location.display },
                                 altitude: location.altitude,
                                 bearing: location.bearing,
                                 speed: location.speed });
            }
        };
        gps.start();
        gpsstream.destroy = () => gps.stop();
        return gpsstream;
    }

    do_call(args) {
        const telephone = this.engine.platform.getCapability('telephone');
        return telephone.call(String(args.number));
    }
    do_call_emergency() {
        const telephone = this.engine.platform.getCapability('telephone');
        return telephone.callEmergency();
    }
    do_notify(args) {
        const notify = this.engine.platform.getCapability('notify');
        return notify.showMessage(args.title, args.message);
    }
    do_set_ringer(args) {
        const audio = this.engine.platform.getCapability('audio-manager');
        return audio.setRingerMode(args.mode);
    }
    do_send_sms(args) {
        const sms = this.engine.platform.getCapability('sms');
        return sms.sendMessage(String(args.to), args.body);
    }
};
