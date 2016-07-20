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
        this.options = ["devices", "commands", "queries"];
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
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.listing === 'generic' &&
                this.expecting === ValueCategory.MultipleChoice) {
                this._handleResolve(command);
                return true;
            }

            this.listing = command.list;
            this._listContent();
            return true;
        });
    }

    _handleResolve(command) {
        var value = command.value;
        if (value !== Math.floor(value) || value < 0 || value > 2) {
            this.reply("Please click on one of the provided choices");
            return true;
        } else {
            this.listing = this.options[value];
            this.expecting = null;
            console.log(this.listing);
            this._listContent();
            return true;
        }
    }

    _listContent() {
        console.log(this.listing);
        switch (this.listing) {
            case 'device':
            case 'devices':
                console.log("adfsdf");
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
            case 'commands':
                this.reply("Alright, here's a list of commands you can try:");
                this.reply("'list devices/queries/commands': get the devices you have, " +
                    "example queries, or available commands.");
                this.reply("'discover $device': search for devices match the name or type you give me.");
                this.reply("'help $device': give you some example queries you can do with the device.")
                this.reply("'configure $device': set up and configure devices.");
                break;
            case 'query':
            case 'queries':
                this.getQueries();
                break;
            default:
                this.ask(ValueCategory.MultipleChoice, "What do you want to me to list?");
                for (var i = 0; i < 3; ++i) {
                    this.replyChoice(i, "list", this.options[i]);
                }
                return true;
        }
        this.switchToDefault();
        return true;
    }
}
