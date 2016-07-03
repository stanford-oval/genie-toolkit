// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Silei Xu <silei@stanford.edu>
//
// See COPYING for details
"use strict"

const Q = require('q');
const events = require('events');

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');


module.exports = class ListDialog extends Dialog {
    constructor() {
        super();
        this.listing = null;
    }

    getQueries() {
        var devices = this.manager.devices.getAllDevices()
            .filter((d) => !d.hasKind('thingengine-system'));
        if (devices.length === 0) {
            this.reply("You don't have any device set up yet.");
            this.reply("Try add some devices first.");
            return;
        }
        this.reply("Here're some examples of what I can do for you.");
        var deviceSet = new Set();
        for (var i = 0; i < Math.min(3, devices.length); ++i) {
            // in case of multiple devices of the same kind
            var device = devices[i].kind;
            if (!deviceSet.has(device)) {
                deviceSet.add(device);
                this.manager.thingpedia.getExamplesByKey(device, true).then((examples) => {
                    for (var j = 0; j < Math.min(2, examples.length); ++j)
                        this.reply(" - " + examples[j].utterance);
                }).done();
            }
        }
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        this.listing = command.list;
        switch (this.listing) {
            case 'device':
                var devices = this.manager.devices.getAllDevices()
                    .filter((d) => !d.hasKind('thingengine-system'));
                if (devices.length === 0) {
                    this.reply("You don't have any device set up yet.")
                } else {
                    this.reply("You have the following devices:");
                    for (var i = 0; i < devices.length; ++i) {
                        this.reply(devices[i].name);
                    }
                }
                break;
            case 'command':
                this.reply("Here's the list of commands:");
                this.reply("list/discover/help/configure/action");
                break;
            case 'query':
                this.getQueries();
                break;
            default:
                this.reply("Try 'list devices/commands/queries'.");
        }

        this.switchToDefault();
        return true;
    }
}
