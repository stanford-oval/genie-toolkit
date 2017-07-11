// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Generate = ThingTalk.Generate;
const Describe = ThingTalk.Describe;

const Dialog = require('./dialog');
const DeviceChoiceDialog = require('./device_choice_dialog');
const SlotFillingDialog = require('./slot_filling_dialog');
const ValueCategory = require('./semantic').ValueCategory;
const Helpers = require('./helpers');

module.exports = class RuleDialog extends Dialog {
    constructor() {
        super();

        this.program = null;
        this._hasTrigger = false;
        this._primitiveQuery = null;
        this._primitiveAction = null;
        this._primitiveList = null;
        this._deviceChoiceIdx = 0;
        this._slotFillIdx = 0;
        this.scope = {};
    }

    _computePrimList() {
        var list = [];
        this.program.rules.forEach((r) => {
            if (r.trigger) {
                this._hasTrigger = true;
                list.push(r.trigger);
            }
            list = list.concat(r.queries);
            list = list.concat(r.actions.filter((a) => !a.selector.isBuiltin));
        });
        this._primitiveList = list;

        if (this._primitiveList.length === 1 &&
            this.program.rules.length === 1 &&
            this.program.rules[0].queries.length === 1) {
            this._primitiveQuery = this.program.rules[0].queries[0];
        }
        if (this._primitiveList.length === 1 &&
            this.program.rules.length === 1 &&
            this.program.rules[0].queries.length === 0 &&
            !this.program.rules[0].trigger &&
            this.program.rules[0].actions.length === 1) {
            this._primitiveAction = this.program.rules[0].actions[0];
        }
    }

    _computeIcon() {
        for (let i = this._primitiveList.length-1; i >= 0; i--) {
            let prim = this._primitiveList[i];
            if (prim.selector.kind !== 'remote' &&
                !prim.selector.kind.startsWith('__dyn')
                && prim.selector.device)
                return prim.selector.device.kind;
        }
        return null;
    }

    get _autoConfirm() {
        if (this._hasTrigger)
            return false;
        if (this._primitiveAction && this._primitiveAction.selector.kind === 'builtin' && this._primitiveAction.selector.principal === null)
            return true;
        if (this._primitiveQuery && this._primitiveQuery.selector.principal === null)
            return true;
        return false;
    }

    describe() {
        return Describe.describeProgram(this.manager.gettext, this.program);
    }

    _getName() {
        return Describe.getProgramName(this.manager.gettext, this.program);
    }

    execute() {
        this.manager.stats.hit('sabrina-confirm');
        var newprogram, sendprograms;
        return Q.try(() => {
            // get the name, description and icon before we factor the remote rules out
            var name = this._getName();
            var description = this.describe();
            var appMeta = { $icon: this.icon };
            if (!this._hasTrigger)
                appMeta.$conversation = this.manager.id;

            [newprogram, sendprograms] = ThingTalk.Generate.factorProgram(this.manager.messaging, this.program);

            if (newprogram !== null) {
                var code = Ast.prettyprint(newprogram);
                return this.manager.apps.loadOneApp(code, appMeta, undefined, undefined,
                                                    name, description, true);
            }
        }).then((app) => {
            return Helpers.sendRules(this, sendprograms, app);
        }).then(() => {
            if (this._autoConfirm)
                return this.switchToDefault();
            else
                return this.done();
        }).catch((e) => {
            this.reply(this._("Sorry, that did not work: %s.").format(e.message));
            console.error(e.stack);
            return this.switchToDefault();
        });
    }

    handleRaw(raw) {
        if (this.subdialog !== null) {
            return Q(this.subdialog.handleRaw(raw)).then((handled) => {
                if (handled)
                    return true;
                else
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

            if (this.program === null) {
                if (command.isProgram) {
                    this.program = command.program;
                } else {
                    this.program = Generate.primitiveProgram(command.primitiveType, command.primitive);
                }
                assert(this.program.isProgram);
                //console.log(Ast.prettyprint(this.program));
                this._computePrimList();
            }
            return this._continue(command);
        });
    }

    _chooseNextDevice() {
        var prim = this._primitiveList[this._deviceChoiceIdx];
        return DeviceChoiceDialog.chooseDevice(this, prim.selector);
    }

    _slotFillNextPrimitive() {
        var prim = this._primitiveList[this._slotFillIdx];
        return SlotFillingDialog.slotFill(this, prim, this.scope);
    }

    _continue(command) {
        this.icon = this._computeIcon();
        if (this._deviceChoiceIdx < this._primitiveList.length) {
            return this._chooseNextDevice().then((waiting) => {
                if (waiting)
                    return waiting;

                this._deviceChoiceIdx++;
                return this._continue();
            });
        }
        if (this._slotFillIdx < this._primitiveList.length) {
            return this._slotFillNextPrimitive().then((waiting) => {
                if (waiting)
                    return waiting;

                this._slotFillIdx++;
                return this._continue();
            });
        }

        if (this.expecting === ValueCategory.YesNo) {
            if (command.isYes)
                return this.execute();
            else if (command.isNo)
                return this.reset();
            else
                return this.fail();
        } else if (this._autoConfirm) {
            return this.execute();
        } else {
            return this.ask(ValueCategory.YesNo, this._("Ok, so you want me to %s. Is that right?").format(this.describe()));
        }
    }
}
