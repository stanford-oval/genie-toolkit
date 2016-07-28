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


module.exports = class HelpDialog extends Dialog {
    constructor() {
        super();
        this.value = null;
        this.name = null;
    }

    getDeviceHelp() {
        //get device help
        this.manager.thingpedia.getExamplesByKey(this.value, true).then((examples) => {
            if (examples.length === 0) {
                return false;
            }
            this.reply(this._("Here's what I can do for you on %s.").format(this.name));
            for (var ex of examples) {
                this.reply(' - ' + ex.utterance);
            }
            this.reply(this._("Try it now!"));
            return true;
        }).then((response) => {
            if (!response) {
                this.reply(this._("Sorry I cant't find device %s in my database.").format(this.name));
                //TODO: maybe send a link to the page showing all devies we support
                this.reply(this._("Try ‘list devices’ to see the devices you have."));
            }
        }).done();
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            this.value = command.help;
            //TODO: need a thingpedia api to get the name
            this.name = this.value.split(".").pop();
            this.getDeviceHelp();

            this.switchToDefault();
            return true;
        });
    }
}
