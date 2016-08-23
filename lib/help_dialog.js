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
const Helpers = require('./helpers');

module.exports = class HelpDialog extends Dialog {
    constructor() {
        super();
        this.name = null;
    }

    _getDeviceHelp() {
        return this.manager.thingpedia.getExamplesByKinds([this.name], true).then((examples) => {
            if (examples.length === 0) {
                return false;
            }
            this.reply(this._("Here's what I can do for you on %s.").format(this.name));

            var added = new Set();
            for (var ex of examples) {
                if (added.has(ex.target_json))
                    continue;
                added.add(ex.target_json);
                this.replyButton(Helpers.presentExample(Helpers.tokenizeExample(ex.utterance)), ex.target_json);
            }
            return true;
        }).then((response) => {
            if (!response) {
                this.reply(this._("Sorry I can't find device %s in my database.").format(this.name));
                //TODO: maybe send a link to the page showing all devies we support
                this.reply(this._("Try ‘list devices’ to see the devices you have."));
            }

            return this.switchToDefault();
        });
    }

    _replyOneDevice(title, kind) {
        return this.replyButton(title, JSON.stringify({ command: { type: 'help', value: { id: 'tt:device.' + kind }}}));
    }

    _getDeviceList() {
        this.reply(this._("Here is the list of what I support. Click on each of them to list their commands."));
        return this.manager.thingpedia.getDeviceFactories().then((devices) => {
            devices.forEach((device) => {
                if (!device.global_name)
                    return;
                this._replyOneDevice(device.name, device.global_name);
            });

            // add the builtins
            if (this.manager.devices.hasDevice('org.thingpedia.builtin.thingengine.phone'))
                this._replyOneDevice(this._("Phone"), 'phone');
            this._replyOneDevice(this._("Miscellaneous"), 'builtin');

            return this.switchToDefault();
        });
    }

    handle(command) {
        // convert back "help" to "help generic"
        if (command.isSpecial && command.special === 'tt:root.special.help') {
            console.log('Converting back help special to help null');
            command.isSpecial = false;
            command.isHelp = true;
            command.name = null;
        }

        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            this.name = command.name;
            if (this.name === 'advanced') {
                this.reply(this._("Here's what you can also try:"));
                this.reply(this._("‘list devices’: get the devices you have."));
                this.reply(this._("‘list commands’: list the commands available for the devices you have."));
                this.reply(this._("‘help ____’: give you some example commands you can do with a device or services."));
                this.reply(this._("‘discover ____’: search for devices match the name or type you give me."));
                this.reply(this._("‘configure ____’: set up and configure devices."));
                return this.switchToDefault();
            } else if (this.name === null) {
                return this._getDeviceList();
            } else {
                return this._getDeviceHelp();
            }
        });
    }
}
