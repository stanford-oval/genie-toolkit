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

const reconstructCanonical = require('./reconstruct_canonical');

module.exports = class PermissionGrantDialog extends Dialog {
    constructor(principal, command, defer) {
        super();
        this._principal = principal;
        this._command = command;
        this._defer = defer;
    }

    // if the user switches away, then reject the permission
    // (this will have no effect if we already resolved the promise
    // with yes or no)
    switchToDefault() {
        this._defer.resolve(false);
        return super.switchToDefault.apply(this, arguments);
    }
    switchTo() {
        this._defer.resolve(false);
        return super.switchTo.apply(this, arguments);
    }

    _getPrincipalName() {
        var contactApi = this.manager.platform.getCapability('contacts');
        if (contactApi !== null)
            return contactApi.lookupPrincipal(this._principal);

        var split = this._principal.split(':');
        if (split[0] !== 'omlet')
            throw new Error('Unsupported principal type ' + split[0]);

        return this.manager.messaging.getUserByAccount(split[1]).then((user) => {
            if (!user)
                throw new Error('Unknown principal ' + this._principal);
            return user.name;
        });
    }

    start() {
        return Q.try(() => {
            return Q.all([reconstructCanonical(this, this._command),
                          this._getPrincipalName()]);
        }).then(([reconstructed, principal]) => {
            return this.ask(ValueCategory.YesNo, this._("%s wants to %s").format(principal, reconstructed));
        }).catch((e) => {
            console.error('Failed to prepare permission grant question: ' + e.message);
            this._defer.reject(e);
        });
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            if (command.isYes) {
                this._defer.resolve(true);
                return this.switchToDefault();
            } else if (command.isNo) {
                this._defer.resolve(false);
                return this.switchToDefault();
            }

            return false;
        });
    }
};
