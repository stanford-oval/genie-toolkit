// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const ThingTalk = require('thingtalk');

const Dialog = require('./dialog');
const ValueCategory = require('./semantic').ValueCategory;
const Helpers = require('./helpers');

const ICONS = {
google: 'com.google',
bodytrace: 'com.bodytrace.scale',
twitter: 'com.twitter',
omlet: 'org.thingpedia.builtin.omlet',
linkedin: 'com.linkedin',
parklon_heatpad: 'com.parklonamerica.heatpad',
facebook: 'com.facebook',
jawbone_up: 'com.jawbone.up',
sportradar: 'us.sportradar',
slack: 'com.slack',
yahoofinance: 'com.yahoo.finance',
weatherapi: 'org.thingpedia.weather',
xkcd: 'com.xkcd',
tumblr: 'com.tumblr',
nasa: 'gov.nasa',
onedrive: 'com.live.onedrive',
youtube: 'com.youtube',
ytranslate: 'com.yandex.translate',
uber: 'com.uber',
holidays: 'org.thingpedia.holidays',
instagram: 'com.instagram',
reddit_front_page: 'com.reddit.frontpage',
github: 'com.github',
thecatapi: 'com.thecatapi',
giphy: 'com.giphy',
dropbox: 'com.dropbox',
phone: 'org.thingpedia.builtin.thingengine.phone',
nest: 'com.nest',
bluetooth_speaker: 'org.thingpedia.bluetooth.speaker.a2dp',
bing: 'com.bing',
rss: 'org.thingpedia.rss',
builtin: 'org.thingpedia.builtin.thingengine.builtin',
hue: 'com.hue',
gmail: 'com.gmail',
google_drive: 'com.google.drive',
icalendar: 'org.thingpedia.icalendar',
imgflip: 'com.imgflip',
wall_street_journal: 'com.wsj',
washington_post: 'com.washingtonpost',
phdcomics: 'com.phdcomics',
lg_webos_tv: 'com.lg.tv.webos2',
'thermostat': 'com.nest',
'light-bulb': 'com.hue',
'security-camera': 'com.nest',
'speaker': 'org.thingpedia.bluetooth.speaker.a2dp',
'scale': 'com.bodytrace.scale',
'heatpad': 'com.parklonamerica.heatpad',
'activity-tracker': 'com.jawbone.up',
'fitness-tracker': 'com.jawbone.up',
'heartrate-monitor': 'com.jawbone.up',
'sleep-tracker': 'com.jawbone.up',
'tumblr-blog': 'com.tumblr'
}

module.exports = class DeviceChoiceDialog extends Dialog {
    constructor(kind) {
        super();

        this.kind = kind;
        this.device = null;
        this.resolving = null;
    }

    static chooseDevice(parent, obj) {
        // don't choose a device for these, there is only ever going to be one
        // so we can just use the @-syntax
        if (obj.kind === 'builtin' || obj.kind === 'phone')
            return Q(false);

        if (obj.device !== null)
            return Q(false);

        // XXX FOR USER TESTING ONLY
        obj.device = {
             uniqueId: 'thingengine-fake-' + (Math.floor(Math.random() * 10000))
        };
        if (obj.kind in ICONS)
            obj.device.kind = ICONS[obj.kind];
        else
            obj.device.kind = 'org.thingpedia.builtin.thingengine.builtin';
        obj.id = obj.device.uniqueId;
        return Q(false);

        // if we get here, either we never pushed the DeviceChoiceDialog,
        // or the DeviceChoiceDialog returned false from .handle(), which
        // implies it is done
        if (parent.subdialog === null) {
            parent.push(new DeviceChoiceDialog(obj.kind));
            return parent.subdialog.continue().then((waiting) => {
                if (waiting) {
                    return waiting;
                } else {
                    obj.device = parent.subdialog.device;
                    obj.id = obj.device.uniqueId;
                    parent.pop();
                    return false;
                }
            });
        } else {
            obj.device = parent.subdialog.device;
            obj.id = obj.device.uniqueId;
            parent.pop();
            return Q(false);
        }
    }

    _promptConfigure(kind) {
        return this.manager.thingpedia.getDeviceSetup([kind]).then((factories) => {
            var factory = factories[kind];
            if (!factory) {
                // something funky happened or thingpedia did not recognize the kind
                this.reply(this._("You don't have a %s").format(kind));
                return null;
            }

            if (factory.type === 'none') {
                return this.manager.devices.loadOneDevice({ kind: factory.kind }, true);
            } else {
                if (factory.type === 'multiple') {
                    this.reply(this._("You don't have a %s").format(kind));
                    if (factory.choices.length > 0) {
                        this.reply(this._("You might want to configure one of: %s").format(factory.choices.join(', ')));
                        this.replyLink(this._("Go to Dashboard"), "/apps");
                    }
                } else {
                    this.reply(this._("You don't have a %s").format(factory.text));
                    switch (factory.type) {
                    case 'oauth2':
                        this.replyLink(this._("Configure %s").format(factory.text),
                                        '/devices/oauth2/%s?name=%s'.format(factory.kind, factory.text));
                        break;
                    case 'link':
                        this.replyLink(this._("Configure %s").format(factory.text), factory.href);
                        break;
                    case 'form':
                        this.replyLink(this._("Configure %s").format(factory.text || kind),
                                       '/devices/configure/%s?name=%s&controls=%s'.format(factory.kind, factory.text || kind,
                                       JSON.stringify(factory.fields)));
                    }
                }

                return null;
            }
        });
    }

    continue() {
        var kind = this.kind;
        var devices = this.manager.devices.getAllDevicesOfKind(kind);

        if (devices.length === 0) {
            console.log('No device of kind ' + this.kind + ' available, attempting configure...');
            return this._promptConfigure(kind).then((device) => {
                if (device !== null) {
                    this.device = device;
                    return false;
                } else {
                    this.switchToDefault();
                    return true;
                }
            });
        }

        if (devices.length === 1) {
            this.device = devices[0];
            return Q(false);
        }

        this.ask(ValueCategory.MultipleChoice, this._("You have multiple devices of type %s. Which one do you want to use?").format(this.kind));
        for (var i = 0; i < devices.length; i++)
            this.replyChoice(i, "device", devices[i].name);
        this.resolving = devices;
        return Q(true);
    }

    _handleResolve(command) {
        var value = command.value;
        if (value !== Math.floor(value) ||
            value < 0 ||
            value >= this.resolving.length) {
            this.reply(this._("Please click on one of the provided choices."));
            return true;
        } else {
            this.device = this.resolving[value];
            this.resolving = [];
            return false;
        }
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.device === null &&
                this.expecting === ValueCategory.MultipleChoice) {
                if (this._handleResolve(command))
                    return true;
            }

            return false;
        });
    }
}
