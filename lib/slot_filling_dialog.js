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

module.exports = class SlotFillingDialog extends Dialog {
    constructor(slots, prefilled, fillAll) {
        super();

        this.slots = slots;
        this.values = new Array(slots.length);
        this.toFill = [];

        this._resolving = null;

        this.slots.forEach((slot, i) => {
            if (slot.name in prefilled) {
                Type.typeUnify(slot.type, Ast.typeForValue(prefilled[slot.name]));

                this.values[i] = prefilled[slot.name];
                delete prefilled[slot.name];
            } else if (fillAll) {
                this.toFill.push(i);
            }
        });

        for (var name in prefilled)
            throw new Error("I don't know what to do with " + name + " " + prefilled[name]);
    }

    continue() {
        if (this.toFill.length > 0) {
            var idx = this.toFill.shift();
            this._resolving = idx;

            var param = this.slots[idx];
            var question = param.question || "What is the value of argument " + param.name + "?";

            if (param.type.isString)
                this.ask(ValueCategory.RawString, question);
            else if (param.type.isMeasure || param.type.isNumber)
                this.ask(ValueCategory.Number, question);
            else if (param.type.isBoolean)
                this.ask(ValueCategory.YesNo, question);
            else if (param.type.isDate)
                this.ask(ValueCategory.Date, question);
            else
                throw new TypeError(); // can't handle it

            return true;
        } else {
            return false;
        }
    }

    handleRaw(command) {
        if (this._resolving !== null &&
            this.expecting === ValueCategory.RawString) {
            this.values[this._resolving] = Ast.Value.String(command);
            this._resolving = null;
            return this.continue();
        } else {
            return this.parent(command);
        }
    }

    handle(analyzer) {
        if (this._resolving !== null) {
            if (this.expecting === ValueCategory.YesNo) {
                if (command.isYes)
                    this.values[this._resolving] = Ast.Value.Boolean(true);
                else
                    this.values[this._resolving] = Ast.Value.Boolean(false);
            } else {
                this.values[this._resolving] = command.value;
            }
            this._resolving = null;
            return this.continue();
        } else {
            return this.unexpected();
        }
    }
}
