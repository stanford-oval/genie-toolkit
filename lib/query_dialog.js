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

    describe() {
        return Describe.describeAction(this, this.kind,
                                       this.channel,
                                       this.schema,
                                       this.resolved_args,
                                       this.resolved_conditions);
    }

    codegen() {
        return ThingTalk.Generate.codegenQuery(this.manager.schemas, this);
    }

    prefix() {
        return this._("Query");
    }
}
