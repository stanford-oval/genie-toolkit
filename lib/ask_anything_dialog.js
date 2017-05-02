// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');
const SlotFillingDialog = require('./slot_filling_dialog');

module.exports = class AskAnythingDialog extends Dialog {
    constructor(appId, icon, type, question, defer) {
        super();

        this.icon = icon;
        this._type = type;
        this._question = question;
        this._defer = defer;

        // make up a schema that SlotFillingDialog would like
        this.args = [];
        this.schema = {
            schema: [type],
            args: ['arg'],
            argcanonicals: ['arg'],
            questions: [question],
            required: [true]
        };
        this.resolved_args = null;
        this.resolved_conditions = null;
    }

    // if the user switches away, then return null
    // (this will have no effect if we already resolved the promise
    // with some value)
    switchToDefault() {
        this._defer.resolve(null);
        return super.switchToDefault.apply(this, arguments);
    }
    switchTo() {
        this._defer.resolve(null);
        return super.switchTo.apply(this, arguments);
    }

    start() {
        return this._continue().catch((e) => {
            console.error('Failed to prepare question: ' + e.message);
            this._defer.reject(e);
        });

    }

    _continue() {
        return Q.try(() => {
            return SlotFillingDialog.slotFill(this, this, true, [], {});
        }).then((handled) => {
            if (handled)
                return handled;
            this._defer.resolve(Ast.valueToJS(this.resolved_args[0]));
            return this.switchToDefault();
        });
    }

    handleRaw(raw) {
        if (this.subdialog !== null) {
            return Q(this.subdialog.handleRaw(raw)).then((handled) => {
                if (handled)
                    return true;
                return this._continue();
            });
        } else {
            return super.handleRaw(raw);
        }
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;
            return this._continue();
        });
    }
};
