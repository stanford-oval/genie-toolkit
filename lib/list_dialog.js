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

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        this.listing = command.list;
        switch (this.listing) {
            case 'generic':
                this.reply("generic");
                break;
            case 'devices':
                var devices = this.manager.devices.getAllDevices();
                if (devices.length === 0) {
                    this.reply("You don't have any device set up yet.")
                } else {
                    this.reply("You have the following devices:");
                    for (var i = 0; i < devices.length; ++i) {
                        this.reply(devices[i].name);
                    }
                }
                break;
            case 'commands':
                this.reply("Here's the list of commands:");
                this.reply("list/discover/help/configure/action");
                break;
            case 'queries':
                this.reply("queries");
                break;
            default:
                this.reply("Try 'list generic/devices/commands/queries'.");
        }

        this.switchToDefault();
        return true;
    }
}
