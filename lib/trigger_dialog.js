// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const Describe = require('./describe');
const CodegenDialog = require('./codegen_dialog');

module.exports = class TriggerDialog extends CodegenDialog {
    get CHANNEL_TYPE() {
        return 'triggers';
    }
    get slotFillAll() {
        return false;
    }
    get autoConfirm() {
        return false;
    }
    get fixConversation() {
        return false;
    }

    prefix() {
        return this._("Monitor");
    }
}
