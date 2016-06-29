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
    }

    getDeviceHelp() {
        //get device help
        this.manager.thingpedia.getExamplesByKey(this.value, true).then((examples) => {
            if (examples.length === 0) {
                return false;
            }

            this.reply("Here's what I can do for you on " + this.value + ".");
            for (var ex of examples) {
                this.reply(" - " + ex.utterance); 
            }
            this.reply("Try it now!");
            return true;
        }).then((response) => {
            if (!response) {
                this.reply("Sorry I cant't find device " + this.value + " in my database.");
                this.reply("Try 'list devices' to see the devices you have");
            }
        }).done();
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        this.value = command.help;
        this.getDeviceHelp();

        this.switchToDefault();
        return true;
    }
}
