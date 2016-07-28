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
const ValueCategory = require('./semantic').ValueCategory;
const Helpers = require('./helpers');

// A dialog to resolve information about the user (such as
// current location, home or work address)
//
// This dialog is pushed as a subdialog of SlotFillingDialog
// when a slot is filled with a reference to the user context
// (eg, the user says "get uber times to home", and has
// never told us where home is)
module.exports = class UserContextDialog extends Dialog {
    constructor(variable, values, index) {
        super();

        this.variable = variable;
        this.values = null;
        this.index = null;
        this.resolved = null;

        this._saveToContext = false;
    }

    static resolve(parent, values, index) {
        if (!values[index].isVarRef)
            return Q(false);

        // if we get here, either we never pushed the UserContextDialog,
        // or the UserContextDialog returned false from .handle(), which
        // implies it is done
        if (parent.subdialog === null) {
            parent.push(new UserContextDialog(values[index].name, values, index));
            return parent.subdialog.continue().then((waiting) => {
                if (waiting) {
                    return waiting;
                } else {
                    values[index] = parent.subdialog.resolved;
                    parent.pop();
                    return false;
                }
            });
        } else {
            values[index] = parent.subdialog.resolved;
            parent.pop();
            return Q(false);
        }
    }

    _tryGetCurrentLocation() {
        var phone = this.manager.devices.getDevice('thingengine-own-phone');
        if (phone === null) {
            console.log('Phone is not setup, cannot find current location');
            return null;
        }

        return phone.invokeTrigger('gps').then((event) => {
            if (event === null) {
                console.log('GPS location not available');
                return null;
            } else {
                return Ast.Value.Location(event[0].x, event[0].y);
            }
        });
    }

    _valueToJs(category, value) {
        if (category.isLocation)
            return Ast.Value.Location(value.x, value.y);
        else
            return null; // FIXME handle other types when we have more context values
    }

    _tryGetStored(category, variable) {
        var platform = this.manager.platform;
        var sharedPrefs = platform.getSharedPreferences();

        var value = sharedPrefs.get('context-' + variable);
        if (value !== undefined)
            return this._valueToJs(category, value);
        else
            return null;
    }

    _doSaveToContext(variable, value) {
        var platform = this.manager.platform;
        var sharedPrefs = platform.getSharedPreferences();

        sharedPrefs.set('context-' + variable, Ast.valueToJS(value));
    }

    _tryFromContext() {
        switch (this.variable) {
        case '$location.current_location':
            return this._tryGetCurrentLocation();
        case '$location.home':
        case '$location.work':
            return Q(this._tryGetStored(ValueCategory.Location, this.variable));
        default:
            throw new TypeError('Invalid variable ' + this.variable);
        }
    }

    continue() {
        if (this.resolved !== null && !this.resolved.isVarRef) {
            if (this._saveToContext)
                this._doSaveToContext(this.variable, this.resolved);
            return false;
        } else if (this.resolved !== null) {
            this.variable = this.resolved.name;
            this._saveToContext = false;
        }

        return this._tryFromContext().then((value) => {
            if (value !== null) {
                this.resolved = value;

                if (this._saveToContext)
                    this._doSaveToContext(this.variable, value);

                return false;
            }

            var question, type;
            switch (this.variable) {
            case '$location.current_location':
                question = this._("Where are you now?");
                type = ValueCategory.Location;
                break;
            case '$location.home':
                question = this._("What is your home address?");
                type = ValueCategory.Location;
                this._saveToContext = true;
                break;
            case '$location.work':
                question = this._("What is your work address?");
                type = ValueCategory.Location;
                this._saveToContext = true;
                break;
            default:
                throw new TypeError('Unknown user context variable');
            }

            return this.ask(type, question);
        });
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.expecting !== null) {
                this.resolved = command.value;
                return this.continue();
            }

            return false;
        });
    }
}
