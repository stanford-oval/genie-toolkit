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

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');
const ContactSearchDialog = require('./contact_search_dialog');

const Describe = require('./describe');
const reconstructCanonical = require('./reconstruct_canonical');

module.exports = class SetupDialog extends Dialog {
    constructor() {
        super();

        this.person = null;
        this.principal = null;
        this.rule = null;
        this.reconstructed = null;
        this.contactSearch = [null];
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.rule === null) {
                this.rule = command.rule;
                this.person = command.person;
                return reconstructCanonical(this, this.rule).then((reconstructed) => {
                    this.reconstructed = reconstructed;
                    return this._continue(command);
                });
            } else {
                return this._continue(command);
            }
        });
    }

    _resolvePerson() {
        if (this.principal !== null)
            return Q(false);
        if (this.contactSearch[0] !== null && !this.contactSearch[0].isVarRef) {
            this.person = this.contactSearch[0];
            this.principal = this.person.value;
            return Q(false);
        }

        this.contactSearch[0] = this.person;
        return ContactSearchDialog.resolve(this, null, this.contactSearch, 0).then((waiting) => {
            if (waiting)
                return waiting;
            else
                return this._resolvePerson();
        });
    }

    execute() {
        this.manager.remote.installRuleRemote(this.principal, this.rule).catch((e) => {
            console.log('Ignored error from permission control request: ' + e.code + ': ' + e.message);
        });
        return this.done();
    }

    _continue(command) {
        return this._resolvePerson().then((waiting) => {
            if (waiting)
                return waiting;

            if (this.expecting === ValueCategory.YesNo) {
                if (command.isYes)
                    return this.execute();
                else if (command.isNo)
                    return this.reset();
                else
                    return this.fail();
            } else {
                return this.ask(ValueCategory.YesNo, this._("Ok, so you want me to tell %s: %s. Is that right?")
                    .format(Describe.describeArg(this, this.person), this.reconstructed));
            }
        });
    }
}
