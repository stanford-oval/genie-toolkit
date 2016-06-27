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
        this.reply("help of " + this.value);
        return true;
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        this.value = command.help;
        if (!this.getDeviceHelp()) {
            this.reply("cant't find device " + this.value);
        }

        this.switchToDefault();
        return true;
    }
}
