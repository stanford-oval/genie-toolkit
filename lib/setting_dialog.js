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

const Dialog = require('./dialog');

module.exports = class settingDialog extends Dialog {
    constructor() {
        super();
    }

    // only from settings or \r command, not triggerable from dialog for now
    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            var name = command.name;
            var prefs = this.manager.platform.getSharedPreferences();
            prefs.set('sabrina-name', name);
            this.reply(this._("Hi %s, nice to meet you.").format(name));
            prefs.set('sabrina-initialized', true);
            return this.switchToDefault();
        });
    }
}