// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const CodegenDialog = require('./codegen_dialog');

module.exports = class QueryDialog extends CodegenDialog {
    get CHANNEL_TYPE() {
        return 'queries';
    }
    get slotFillAll() {
        return false;
    }
    get autoConfirm() {
        return true;
    }
    get fixConversation() {
        return true;
    }

    prefix() {
        return this._("Query");
    }
}
