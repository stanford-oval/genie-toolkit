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

module.exports = class DeviceChoiceDialog extends Dialog {
    constructor(kind) {
        super();

        this.kind = kind;
        this.device = null;
        this.resolving = null;
    }

    static chooseDevice(parent, obj) {
        if (obj.kind === '$builtin')
            return Q(false);

        if (obj.device !== null)
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
                this.reply("You don't have a " + name);
                return null;
            }

            if (factory.type === 'none') {
                return this.manager.devices.loadOneDevice({ kind: factory.kind });
            } else {
                if (factory.type === 'multiple') {
                    this.reply("You don't have a " + kind);
                    if (factory.choices.length > 0) {
                        this.reply("You might want to configure one of: " + factory.choices.join(', '));
                        this.replyLink("Go to Dashboard", "/apps");
                    }
                } else {
                    this.reply("You don't have a " + factory.text);
                    switch (factory.type) {
                    case 'oauth2':
                        this.replyLink("Configure " + factory.text, '/devices/oauth2/' + factory.kind);
                        break;
                    case 'link':
                        this.replyLink("Configure " + factory.text, factory.href);
                        break;
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

        this.ask(ValueCategory.MultipleChoice, "You have multiple " + kind + "s. Which one do you want to use?");
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
            this.reply("Please click on one of the provided choices");
            return true;
        } else {
            this.device = this.resolving[value];
            this.resolving = [];
            this.expecting = null;
            return false;
        }
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        if (this.device === null &&
            this.expecting === ValueCategory.MultipleChoice) {
            if (this._handleResolve(command))
                return true;
        }

        return false;
    }
}
