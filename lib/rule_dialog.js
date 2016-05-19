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

function capitalize(str) {
    return str[0].toUpperCase() + str.substr(1);
}

module.exports = class RuleDialog extends Dialog {
    constructor() {
        super();

        this.originalCommand = null;

        this.trigger = null;
        this.action = null;
    }

    describe() {
        return this.action.schema.doc + " on " + this.action.kind + " " +
            this.action.resolved_args.join(", ") + "if " + this.trigger.schema.doc + " on " + this.trigger.kind + " " +
            this.trigger.resolved_args.join(", ");
    }

    execute() {
        var progName = 'SabrinaGenerated' + capitalize(this.trigger.kind) +
            'To' + capitalize(this.action.kind);

        var triggerParams = this.trigger.resolved_args.map(function(arg, i) {
            if (arg === undefined) {
                return Ast.Expression.VarRef(this.trigger.schema.schema.args[i]);
            } else {
                return Ast.Expression.Constant(arg);
            }
        });
        var triggerSel = Ast.Selector.GlobalName(this.trigger.kind);
        var trigger = Ast.RulePart.Invocation(triggerSel, this.trigger.channel,
                                              triggerParams);
        var actionParams = this.action.resolved_args.map(function(arg) {
            if (arg.isVarRef)
                return Ast.Expression.VarRef(arg.name);
            else
                return Ast.Expression.Constant(arg);
        });
        var actionSel = Ast.Selector.GlobalName(this.action.kind);
        var action = Ast.RulePart.Invocation(actionSel, this.action.channel,
                                             actionParams);
        var rule = Ast.Statement.Rule([trigger, action]);
        var program = Ast.Program(progName, [], [rule]);

        // check that this program compiles
        var compiler = new ThingTalk.Compiler();
        compiler.setSchemaRetriever(this.manager.schemas);
        compiler.compileProgram(program).then(() => {
            var code = ThingTalk.codegen(program);
            var name = 'Sabrina Generated ' + this.trigger.kind + ' to ' + this.action.kind;
            this.manager.apps.loadOneApp(code, {}, undefined, undefined,
                                         name, this.describe());
        }).then(() => {
            return this.done();
        }).catch((e) => {
            this.reply("Sorry, that did not work: " + e.message);
            this.switchToDefault();
        }).done();

        return true;
    }

    _getSchema(obj, what) {
        return this.manager.schemas.getMeta(obj.kind).then((schema) => {
            if (schema === null) {
                this.sendReply("I don't know what " + obj.kind + " is.");
                this.switchToDefault();
                return false;
            } else {
                if (!(obj.channel in schema[what])) {
                    this.sendReply("Things of kind " + obj.kind + " cannot " + obj.channel + ".");
                    this.switchToDefault();
                    return false;
                } else {
                    obj.schema = schema[what][obj.channel];
                    return true;
                }
            }
        });
    }

    handle(command) {
        if (this.originalCommand === null)
            this.originalCommand = command;

        if (this.trigger === null || this.action === null) {
            this.trigger = command.trigger;
            this.action = command.action;

            this._getSchema(command.trigger, 'triggers').then((ok) => {
                if (!ok)
                    return false;

                return this._getSchema(command.action, 'actions');
            }).then((ok) => {
                if (ok)
                    this._continue();
            }).catch((e) => {
                console.error("Failed to retrieve schema for " + this.kind + ": " + e.message);
                this.failReset();
            }).done();
        } else if (this.trigger.schema === null || this.trigger.action === null) {
            // still in process of loading the schema, ignore...
            return;
        } else {
            this._continue(command);
        }
    }

    _slotFill(obj) {
        if (obj.resolved_args === null) {
            // if we get here, either we never pushed the SlotFillingDialog,
            // or the SlotFillingDialog returned false from .handle(), which
            // implies it is done
            if (this.subdialog === null) {
                // make up slots
                var slots = obj.schema.schema.map(function(typeString, i) {
                    var type = ThingTalk.Type.fromString(type);
                    return { name: obj.schema.args[i], type: type,
                             question: obj.schema.questions[i] };
                });

                this.push(new SlotFillingDialog(slots, obj.args));
                if (this.subdialog.continue())
                    return true;
            } else {
                obj.resolved_args = this.subdialog.values;
                this.pop();
                return false;
            }
        } else {
            return false;
        }
    }

    _continue(command) {
        if (this._slotFill(this.trigger))
            return true;

        if (this._slotFill(this.action))
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
