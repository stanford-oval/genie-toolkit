// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Codegen = require('./codegen');
const CodegenDialog = require('./codegen_dialog');

module.exports = class ActionDialog extends CodegenDialog {
    get CHANNEL_TYPE() {
        return 'actions';
    }
    get slotFillAll() {
        return true;
    }
    get autoConfirm() {
        return this.kind === 'builtin';
    }
    get fixConversation() {
        return true;
    }

    describe() {
        return Codegen.describeAction(this, this.kind,
                                      this.channel,
                                      this.schema,
                                      this.resolved_args,
                                      this.resolved_conditions);
    }

    codegen() {
        return Codegen.codegenAction(this.manager.schemas, this);
    }

    prefix() {
        return this._("Execute");
    }
}
