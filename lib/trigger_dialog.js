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

    describe() {
        return this._("notify if %s").format(Describe.describeTrigger(this, this.kind,
                                                                      this.channel,
                                                                      this.schema,
                                                                      this.resolved_args,
                                                                      this.resolved_conditions));
    }

    codegen() {
        return ThingTalk.Generate.codegenMonitor(this.manager.schemas, this);
    }

    prefix() {
        return this._("Monitor");
    }
}
