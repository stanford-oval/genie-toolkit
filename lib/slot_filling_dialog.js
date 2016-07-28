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
const UserContextDialog = require('./user_context_dialog');
const Helpers = require('./helpers');

module.exports = class SlotFillingDialog extends Dialog {
    constructor(slots, prefilled, fillAll, mustFill) {
        super();

        this.slots = slots;
        this.values = new Array(slots.length);
        this.comparisons = [];
        this.toFill = [];

        this._resolving = null;
        this._aux = null;

        Codegen.assignSlots(slots, prefilled, this.values, this.comparisons, fillAll, mustFill, this.toFill);
    }

    static slotFill(parent, obj, fillAll, mustFill) {
        if (obj.resolved_args !== null)
            return Q(false);

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
            return parent.subdialog.concretizeInitialSlots().then((waiting) => {
                if (waiting)
                    return true;
                else
                    return parent.subdialog.continue();
            }).then((waiting) => {
                if (waiting) {
                    return waiting;
                } else {
                    obj.resolved_args = parent.subdialog.values;
                    obj.resolved_conditions = parent.subdialog.comparisons;
                    parent.pop();
                    return false;
                }
            });
        } else {
            obj.resolved_args = parent.subdialog.values;
            obj.resolved_conditions = parent.subdialog.comparisons;
            parent.pop();
            return Q(false);
        }
    }

    concretizeInitialSlots() {
        var values = this.values;

        function loop(i) {
            if (i === values.length)
                return Q(false);

            var value = values[i];
            if (value === undefined || !value.isVarRef)
                return loop.call(this, i+1);

            return UserContextDialog.resolve(this, this.values, i).then((waiting) => {
                if (waiting)
                    return waiting;
                else
                    return loop.call(this, i+1);
            });
        }

        return loop.call(this, 0);
    }

    concretizeOneSlot(index) {
        return UserContextDialog.resolve(this, this.values, index);
    }

    _askFeed(question) {
        var messaging = this.manager.messaging;
        if (!messaging.isAvailable) {
            this.reply(this._("Messaging is not available, cannot choose a feed."));
            return this.switchToDefault();
        }

        return Helpers.getFeedList(this, this.manager.messaging).then((feeds) => {
            this._aux = [];
            this.ask(ValueCategory.MultipleChoice, question);
            feeds.forEach((f, i) => {
                this._aux[i] = Ast.Value.Feed(this.manager.messaging.getFeed(f[1]));
                this.replyChoice(i, "feed", f[0]);
            });
            return true;
        });
    }

    _askEnum(entries, question) {
        this._aux = entries.map((e) => Ast.Value.Enum(e));
        this.ask(ValueCategory.MultipleChoice, question);
        entries.forEach((e, i) => {
            this.replyChoice(i, "choice", e);
        });
        return true;
    }

    continue() {
        if (this.toFill.length > 0) {
            var idx = this.toFill.shift();
            this._resolving = idx;

            var param = this.slots[idx];
            var question = param.question || this._("What is the value of argument %s?");

            if (param.type.isString)
                return this.ask(ValueCategory.RawString, question);
            else if (param.type.isMeasure)
                return this.ask(ValueCategory.Measure(param.type.unit), question);
            else if (param.type.isNumber)
                return this.ask(ValueCategory.Number, question);
            else if (param.type.isBoolean)
                return this.ask(ValueCategory.YesNo, question);
            else if (param.type.isDate)
                return this.ask(ValueCategory.Date, question);
            else if (param.type.isPicture)
                return this.ask(ValueCategory.Picture, question);
            else if (param.type.isLocation)
                return this.ask(ValueCategory.Location, question);
            else if (param.type.isFeed)
                return this._askFeed(question);
            else if (param.type.isEnum)
                return this._askEnum(param.type.entries, question);
            else
                throw new TypeError(); // can't handle it
        } else {
            return false;
        }
    }

    handleRaw(raw) {
        if (this._resolving !== null &&
            this.expecting === ValueCategory.RawString) {
            this.values[this._resolving] = Ast.Value.String(raw);
            this._resolving = null;
            return this.continue();
        } else if (this._aux !== null &&
            this.expecting === ValueCategory.MultipleChoice) {
            for (var e of this._aux) {
                if (e.value === raw.toLowerCase().trim()) {
                    var givenType = Ast.typeForValue(e);
                    Type.typeUnify(this.slots[this._resolving].type, givenType);
                    this.values[this._resolving] = e;
                    this.expecting = null;
                    this._aux = null;

                    // this is not going to be a varref slot, so we
                    // don't need to concretize it
                    this._resolving = null;
                    return this.continue();
                }
            }
            return this.unexpected();
        } else {
            return super.handleRaw(raw);
        }
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this._resolving !== null) {
                if (this.expecting === ValueCategory.YesNo) {
                    if (command.isYes)
                        this.values[this._resolving] = Ast.Value.Boolean(true);
                    else
                        this.values[this._resolving] = Ast.Value.Boolean(false);
                    this._resolving = null;
                    return this.continue();
                } else {
                    if (this.expecting !== null) {
                        var value;
                        if (this.expecting === ValueCategory.MultipleChoice) {
                            var index = command.value;
                            if (index !== Math.floor(index) ||
                                index < 0 ||
                                index >= this._aux.length) {
                                this.reply(this._("Please click on one of the provided choices."));
                                return true;
                            } else {
                                value = this._aux[index];
                            }
                        } else {
                            value = command.value;
                        }
                        var givenType = Ast.typeForValue(value);
                        Type.typeUnify(this.slots[this._resolving].type, givenType);
                        this.values[this._resolving] = value;
                        this.expecting = null;
                        this._aux = null;
                    }

                    if (!this.values[this._resolving].isVarRef) {
                        this._resolving = null;
                        return this.continue();
                    }

                    return this.concretizeOneSlot(this._resolving).then((waiting) => {
                        if (waiting) {
                            return waiting;
                        } else {
                            this._resolving = null;
                            return this.continue();
                        }
                    });
                }
            } else {
                return this.continue();
            }
        });
    }
}
