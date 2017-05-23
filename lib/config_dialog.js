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

const Dialog = require('./dialog');
const DiscoveryDialog = require('./discovery_dialog');
const ValueCategory = require('./semantic').ValueCategory;

module.exports = class ConfigDialog extends Dialog {
    constructor(kind) {
        super();

        this.kind = kind;
    }

    continue() {
        return this.manager.thingpedia.getDeviceSetup([this.kind]).then((factories) => {
            var factory = factories[this.kind];
            if (!factory) {
                this.reply(this._("I'm so sorry, I can't find %s in my database.").format(this.kind));
            } else if (factory.type === 'none') {
                this.reply(this._("%s doesn't need configuration.").format(this.kind));
            } else if (factory.type === 'multiple') {
                if (factory.choices.length > 0) {
                    this.reply(this._("You might want to configure one of: %s").format(factory.choices.join(', ')));
                    this.replyLink(this._("Go to My Goods"), "/apps");
                } else {
                    this.reply(this._("Sorry, I don't know how to configure %s.").format(this.kind));
                }
            } else if (factory.type === 'discovery') {
                var dlg = new DiscoveryDialog(factory.discoveryType, factory.kind, factory.text);
                this.switchTo(dlg);
                return dlg.continue();
            } else {
                this.reply(this._("OK, here's the link to configure %s.").format(this.kind));
                switch (factory.type) {
                    case 'oauth2':
                        this.replyLink(this._("Configure %s").format(factory.text),
                                        '/devices/oauth2/%s?name=%s'.format(factory.kind, factory.text));
                        break;
                    case 'link':
                        this.replyLink(this._("Configure %s").format(factory.text, factory.href));
                        break;
                    case 'form':
                        this.replyLink(this._("Configure %s").format(factory.text || this.kind),
                                       '/devices/configure/%s?name=%s&controls=%s'.format(factory.kind, factory.text || this.kind,
                                       JSON.stringify(factory.fields)));
                }
            }

            this.switchToDefault();
            return true;
        });
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            return this.continue();
        })
    }
}
