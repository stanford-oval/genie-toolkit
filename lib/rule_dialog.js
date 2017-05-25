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

const Dialog = require('./dialog');
const DeviceChoiceDialog = require('./device_choice_dialog');
const SlotFillingDialog = require('./slot_filling_dialog');
const ValueCategory = require('./semantic').ValueCategory;
const Helpers = require('./helpers');
const Describe = require('./describe');
const reconstruct = require('./reconstruct_canonical');

function makeProgram(rules) {
    var program = Ast.Program('AlmondGenerated', [], rules);
    return Ast.prettyprint(program);
}

module.exports = class RuleDialog extends Dialog {
    constructor() {
        super();

        this.once = false;
        this.trigger = null;
        this.query = null;
        this.action = null;
        this._loaded = false;
        this._isPrimitive = false;

        this.scope = {};
    }

    _computeIcon() {
        if (this.action && this.action.kind !== 'remote') {
            if (this.action.device)
                return this.action.device.kind;
        }
        if (this.query && this.query.kind !== 'remote') {
            if (this.query.device)
                return this.query.device.kind;
        }
        if (this.trigger && this.trigger.kind !== 'remote') {
            if (this.trigger.device)
                return this.trigger.device.kind;
        }
        return null;
    }

    get _autoConfirm() {
        if (this.trigger)
            return false;
        if (this.action && (this.action.kind !== 'builtin' || this.action.owner !== null))
            return false;
        if (this.query && this.query.owner !== null)
            return false;
        return true;
    }

    describe() {
        var actionDesc, queryDesc, triggerDesc;
        if (this.action) {
            actionDesc = Describe.describeAction(this, this.action);
        }
        if (this.query) {
            queryDesc = Describe.describeAction(this, this.query);
        }
        if (this.trigger) {
            triggerDesc = Describe.describeTrigger(this, this.trigger);
        }

        var ruleDesc;
        if (this.action && this.query && this.trigger)
            ruleDesc = this._("%s then %s if %s").format(queryDesc, actionDesc, triggerDesc);
        else if (this.action && this.trigger)
            ruleDesc = this._("%s if %s").format(actionDesc, triggerDesc);
        else if (this.query && this.trigger)
            ruleDesc = this._("%s if %s").format(queryDesc, triggerDesc);
        else if (this.action && this.query)
            ruleDesc = this._("%s then %s").format(queryDesc, actionDesc);
        else if (this.trigger)
            ruleDesc = this._("notify if %s").format(triggerDesc);
        else if (this.query)
            ruleDesc = queryDesc;
        else if (this.action)
            ruleDesc = actionDesc;
        if (this.once)
            ruleDesc += this._(" (only once)");
        return ruleDesc;
    }

    _getName() {
        var actionName, queryName, triggerName;
        if (this.action) {
            actionName = ThingTalk.Generate.capitalizeSelector(this.action.kind, this.action.channel);
        }
        if (this.query) {
            queryName = ThingTalk.Generate.capitalizeSelector(this.query.kind, this.query.channel);
        }
        if (this.trigger) {
            triggerName = ThingTalk.Generate.capitalizeSelector(this.trigger.kind, this.trigger.channel) ;
        }
        if (this.action && this.query && this.trigger)
            return this._("%s to %s to %s").format(triggerName, queryName, actionName);
        else if (this.action && this.trigger)
            return this._("%s to %s").format(triggerName, actionName);
        else if (this.query && this.trigger)
            return this._("%s to %s").format(triggerName, queryName);
        else if (this.query && this.action)
            return this._("%s to %s").format(queryName, actionName);
        else if (this.trigger)
            return this._("Monitor %s").format(triggerName);
        else if (this.action)
            return this._("Execute %s").format(actionName);
        else
            return this._("Query %s").format(queryName);
    }

    execute() {
        this.manager.stats.hit('sabrina-confirm');
        var newrules, sendrules;
        return Q.try(() => {
            // get the name, description and icon before we factor the remote rules out
            var name = this._getName();
            var description = this.describe();
            var appMeta = { $icon: this.icon };
            if (!this.trigger)
                appMeta.$conversation = this.manager.id;

            [newrules, sendrules] = ThingTalk.Generate.factorRule(this.manager.messaging, this);

            var newttrules = newrules.map((r) => {
                return ThingTalk.Generate.codegenRule(r.trigger, r.query, r.action, this.once || r.once);
            });
            if (newttrules.length > 0) {
                var code = makeProgram(newttrules);
                return this.manager.apps.loadOneApp(code, appMeta, undefined, undefined,
                                                    name, description, true);
            }
        }).then((app) => {
            return Helpers.sendRules(this, sendrules, app);
        }).then(() => {
            return this.done();
        }).catch((e) => {
            this.reply(this._("Sorry, that did not work: %s.").format(e.message));
            console.error(e.stack);
            return this.switchToDefault();
        });
    }

    _getSchema(obj, what) {
        if (obj === null)
            return Q();
        if (obj.schema)
            return Q();
        return this.manager.schemas.getMeta(obj.kind, what, obj.channel).then((schema) => {
            obj.schema = schema;
            obj.kind_type = schema.kind_type;
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

            if (this.trigger === null && this.query === null && this.action === null) {
                this.once = command.once;
                this.trigger = command.trigger;
                var fncount = 0;
                if (this.trigger !== null) {
                    this.trigger.resolved_args = null;
                    this.trigger.resolved_conditions = null;
                    this.trigger.resolved_scope = null;
                    fncount ++;
                }
                this.query = command.query;
                if (this.query !== null) {
                    this.query.resolved_args = null;
                    this.query.resolved_conditions = null;
                    this.query.resolved_scope = null;
                    fncount ++;
                }
                this.action = command.action;
                if (this.action !== null) {
                    this.action.resolved_args = null;
                    this.action.resolved_conditions = null;
                    fncount ++;
                }
                if (fncount === 1)
                    this._isPrimitive = true;

                var promises = [
                    this._getSchema(command.trigger, 'triggers'),
                    this._getSchema(command.query, 'queries'),
                    this._getSchema(command.action, 'actions')
                ];

                return Q.all(promises).then(() => {
                    this._loaded = true;
                    return this._continue();
                }).catch((e) => {
                    console.log(e.stack);
                    this.fail(e.message);
                    return this.switchToDefault();
                });
            } else if (!this._loaded) {
                // still in process of loading the schema, ignore...
                return true;
            } else {
                return this._continue(command);
            }
        });
    }

    _continue(command) {
        return Q.try(() => {
            if (this.trigger)
                return DeviceChoiceDialog.chooseDevice(this, this.trigger);
            else
                return false;
        }).then((waiting) => {
            if (waiting)
                return true;
            this.icon = this._computeIcon();

            if (this.query)
                return DeviceChoiceDialog.chooseDevice(this, this.query);
            else
                return false;
        }).then((waiting) => {
            if (waiting)
                return true;
            this.icon = this._computeIcon();

            if (this.action)
                return DeviceChoiceDialog.chooseDevice(this, this.action);
            else
                return false;
        }).then((waiting) => {
            if (waiting)
                return true;
            this.icon = this._computeIcon();

            if (this.trigger)
                return SlotFillingDialog.slotFill(this, this.trigger, false, this.trigger.slots, this.scope,
                    this.trigger.schema.options, this.trigger.remoteSlots);
            else
                return false;
        }).then((waiting) => {
            if (waiting)
                return true;

            if (this.query)
                return SlotFillingDialog.slotFill(this, this.query, false, this.query.slots, this.scope,
                    this.query.schema.options, this.query.remoteSlots);
            else
                return false;
        }).then((waiting) => {
            if (waiting)
                return true;

            if (this.action)
                return SlotFillingDialog.slotFill(this, this.action, true, this.action.slots, this.scope,
                    this.action.schema.options, this.action.remoteSlots);
            else
                return false;
        }).then((waiting) => {
            if (waiting)
                return true;

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
        });
    }
}
