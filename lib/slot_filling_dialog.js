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
const Type = ThingTalk.Type;

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');
const Codegen = require('./codegen');

module.exports = class SlotFillingDialog extends Dialog {
    constructor(slots, prefilled, fillAll, mustFill) {
        super();

        this.slots = slots;
        this.values = new Array(slots.length);
        this.comparisons = [];
        this.toFill = [];

        this._resolving = null;

        Codegen.assignSlots(slots, prefilled, this.values, this.comparisons, fillAll, mustFill, this.toFill);
    }

    static slotFill(parent, obj, fillAll, mustFill) {
        if (obj.resolved_args !== null)
            return false;

        // if we get here, either we never pushed the SlotFillingDialog,
        // or the SlotFillingDialog returned false from .handle(), which
        // implies it is done
        if (parent.subdialog === null) {
            // make up slots
            var slots = obj.schema.schema.map(function(type, i) {
                return { name: obj.schema.args[i], type: type,
                         question: obj.schema.questions[i],
                         required: (obj.schema.required[i] || false) };
            });

            parent.push(new SlotFillingDialog(slots, obj.args, fillAll, mustFill));
            if (parent.subdialog.continue())
                return true;

            // fallthrough
        }

        obj.resolved_args = parent.subdialog.values;
        obj.resolved_conditions = parent.subdialog.comparisons;
        parent.pop();
        return false;
    }

    continue() {
        if (this.toFill.length > 0) {
            var idx = this.toFill.shift();
            this._resolving = idx;

            var param = this.slots[idx];
            var question = param.question || "What is the value of argument " + param.name + "?";

            if (param.type.isString)
                this.ask(ValueCategory.RawString, question);
            else if (param.type.isMeasure)
                this.ask(ValueCategory.Measure(param.type.unit), question);
            else if (param.type.isNumber)
                this.ask(ValueCategory.Number, question);
            else if (param.type.isBoolean)
                this.ask(ValueCategory.YesNo, question);
            else if (param.type.isDate)
                this.ask(ValueCategory.Date, question);
            else if (param.type.isPicture)
                this.ask(ValueCategory.Picture, question);
            else
                throw new TypeError(); // can't handle it

            return true;
        } else {
            return false;
        }
    }

    handlePicture(url) {
        if (this._resolving !== null &&
            this.expecting === ValueCategory.RawString) {
            this.values[this._resolving] = Ast.Value.Picture(raw);
            this._resolving = null;
            return this.continue();
        } else {
            return super.handleRaw(raw);
        }
    }

    handleRaw(raw) {
        if (this._resolving !== null &&
            this.expecting === ValueCategory.RawString) {
            this.values[this._resolving] = Ast.Value.String(raw);
            this._resolving = null;
            return this.continue();
        } else {
            return super.handleRaw(raw);
        }
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        if (this._resolving !== null) {
            if (this.expecting === ValueCategory.YesNo) {
                if (command.isYes)
                    this.values[this._resolving] = Ast.Value.Boolean(true);
                else
                    this.values[this._resolving] = Ast.Value.Boolean(false);
            } else {
                var givenType = ThingTalk.Ast.typeForValue(command.value);
                ThingTalk.Type.typeUnify(this.slots[this._resolving].type, givenType);
                this.values[this._resolving] = command.value;
            }
            this._resolving = null;
            return this.continue();
        } else {
            return this.unexpected();
        }
    }
}
