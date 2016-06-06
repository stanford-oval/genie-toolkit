// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const Dialog = require('./dialog');
const SlotFillingDialog = require('./slot_filling_dialog');
const ValueCategory = require('./semantic').ValueCategory;
const codegen = require('./codegen');

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}
function regexify(str) {
    return str.toLowerCase().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
}

module.exports = class RuleDialog extends Dialog {
    constructor() {
        super();

        this.trigger = null;
        this.action = null;
    }

    describeSelector(kind, channel) {
        if (kind === '$builtin')
            return channel
        else
            return channel + " on " + kind;
    }

    capitalizeSelector(kind, channel) {
        if (kind === '$builtin')
            return capitalize(channel);
        else
            return capitalize(kind);
    }

    describe() {
        return this.describeSelector(this.action.kind, this.action.schema.doc) + " " +
            this.action.resolved_args.join(", ") + " if " +
            this.describeSelector(this.trigger.kind, this.trigger.schema.doc) + " " +
            this.trigger.resolved_args.join(", ");
    }

    execute() {
        Q.try(() => {
            return Codegen.codegen(this.manager.schemas, this.trigger, this.action);
        }).then((code) => {
            var name = 'Sabrina Generated ' + this.capitalizeSelector(this.trigger.kind, this.trigger.channel) + ' to ' +
                this.capitalizeSelector(this.action.kind, this.action.channel);
            this.manager.apps.loadOneApp(code, {}, undefined, undefined,
                                         name, this.describe());
        }).then(() => {
            return this.done();
        }).catch((e) => {
            this.reply("Sorry, that did not work: " + e.message);
            console.error(e.stack);
            this.switchToDefault();
        }).done();

        return true;
    }

    _getSchema(obj, what) {
        return this.manager.schemas.getMeta(obj.kind, what, obj.channel).then((schema) => {
            obj.schema = schema;
            return true;
        });
    }

    handleRaw(raw) {
        if (this.subdialog !== null) {
            if (this.subdialog.handleRaw(raw))
                return true;

            return this._continue();
        } else {
            return super.handleRaw(raw);
        }
    }

    handle(command) {
        if (this.trigger === null || this.action === null) {
            this.trigger = command.trigger;
            this.trigger.resolved_args = null;
            this.trigger.resolved_conditions = null;
            this.action = command.action;
            this.action.resolved_args = null;
            this.action.resolved_conditions = null;

            this._getSchema(command.trigger, 'triggers').then((ok) => {
                if (!ok)
                    return false;

                return this._getSchema(command.action, 'actions');
            }).then((ok) => {
                if (ok)
                    this._continue();
            }).catch((e) => {
                this.fail(e.message);
                this.switchToDefault();
            }).done();

            return true;
        } else if (this.trigger.schema === null || this.trigger.action === null) {
            // still in process of loading the schema, ignore...
            return true;
        } else {
            return this._continue(command);
        }
    }

    _continue(command) {
        if (SlotFillingDialog.slotFill(this, this.trigger, false))
            return true;

        if (SlotFillingDialog.slotFill(this, this.action, true))
            return true;

        if (this.expecting === ValueCategory.YesNo) {
            if (command.isYes)
                return this.execute();
            else if (command.isNo)
                return this.reset();
            else
                return this.fail();
        } else {
            return this.ask(ValueCategory.YesNo, "Ok, so you want me to " +
                            this.describe() +
                            ". Is that right?");
        }
    }
}
