// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;

const Dialog = require('./dialog');
const ValueCategory = require('./semantic').ValueCategory;
const Helpers = require('./helpers');
const ContactSearchDialog = require('./contact_search_dialog');

module.exports = class DeviceChoiceDialog extends Dialog {
    constructor(kind, owner) {
        super();

        this.kind = kind;
        this.owner = owner;
        this.device = null;
        this.resolving = null;
        this.principal = null;
        this.contactSearch = [null];
    }

    static chooseDevice(parent, obj) {
        if (obj.device !== null)
            return Q(false);
        if (obj.kind_type === 'app')
            return Q(false);

        // if we get here, either we never pushed the DeviceChoiceDialog,
        // or the DeviceChoiceDialog returned false from .handle(), which
        // implies it is done
        if (parent.subdialog === null) {
            parent.push(new DeviceChoiceDialog(obj.kind, obj.owner));
            return parent.subdialog.continue().then((waiting) => {
                if (waiting) {
                    return waiting;
                } else {
                    obj.owner = parent.subdialog.owner;
                    obj.principal = parent.subdialog.principal;
                    obj.device = parent.subdialog.device;
                    obj.id = obj.device.uniqueId;
                    parent.pop();
                    return false;
                }
            });
        } else {
            obj.device = parent.subdialog.device;
            obj.owner = parent.subdialog.owner;
            obj.principal = parent.subdialog.principal;
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
        if (this.owner !== null) {
            return this._continueForeign();
        } else {
            return this._continueOwn();
        }
    }

    _continueForeign() {
        if (this.contactSearch[0] !== null && !this.contactSearch[0].isVarRef) {
            this.owner = this.contactSearch[0];
            this.principal = this.owner.value;
            this.device = this.manager.devices.getDevice('org.thingpedia.builtin.thingengine.remote');
            return false;
        }

        this.contactSearch[0] = this.owner;
        return ContactSearchDialog.resolve(this, null, this.contactSearch, 0).then((waiting) => {
            if (waiting) {
                return waiting;
            } else {
                return this._continueForeign();
            }
        });
    }

    _continueOwn() {
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
            if (this.device !== null)
                return false;

            return this.continue();
        });
    }
}
