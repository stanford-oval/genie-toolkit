// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const SEMPRESyntax = ThingTalk.SEMPRESyntax;

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');
const ContactSearchDialog = require('./contact_search_dialog');

const Describe = require('./describe');

module.exports = class SetupDialog extends Dialog {
    constructor() {
        super();

        this.person = null;
        this.principal = null;
        this.program = null;
        this.reconstructed = null;
        this.contactSearch = null;
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (this.program === null) {
                this.program = command.program;
                this.person = command.person;
                this.reconstructed = Describe.describeProgram(this, this.program);
                return this._continue(command);
            } else {
                return this._continue(command);
            }
        });
    }

    _resolvePerson() {
        if (this.principal !== null)
            return Q(false);
        if (this.contactSearch !== null && this.contactSearch.value.type !== 'tt:contact_name') {
            this.principal = this.contactSearch.value;
            return Q(false);
        }

        this.contactSearch = Ast.InputParam('__principal', this.person);
        return ContactSearchDialog.resolve(this, Type.Entity('tt:contact'), this.contactSearch).then((waiting) => {
            if (waiting)
                return waiting;
            else
                return this._resolvePerson();
        });
    }

    execute() {
        var json = SEMPRESyntax.toSEMPRE(this.program);
        this.manager.remote.installRuleRemote(this.principal, json).catch((e) => {
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
                    .format(Describe.describeArg(this, this.principal), this.reconstructed));
            }
        });
    }
}
