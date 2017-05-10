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
    constructor(principal, identity, command, defer) {
        super();
        this._principal = principal;
        this._identity = identity;
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

    _lookupContactByAccount(account) {
        return this.manager.messaging.getUserByAccount(account).then((user) => {
            return this._("%s (unverified)").format(user.name);
        }).catch((e) => {
            console.log('Failed to lookup account ' + account + ': ' + e.message);
            return null;
        });
    }

    _getIdentityName() {
        var split = this._identity.split(':');

        if (split[0] === 'omlet')
            return this._("Omlet User @%s").format(split[1]);

        var contactApi = this.manager.platform.getCapability('contacts');
        if (contactApi !== null) {
            return contactApi.lookupPrincipal(this._identity).then((contact) => {
                if (contact)
                    return contact.displayName;
                else
                    return split[1];
            });
        } else {
            return split[1];
        }
    }

    _getPrincipalName() {
        var split = this._identity.split(':');

        if (split[0] !== this.manager.messaging.type + '-account')
            throw new Error('Unsupported principal type ' + split[0]);

        return this._lookupContactByAccount(split[1]);
    }

    _getName() {
        if (this._identity)
            return this._getIdentityName();
        else
            return this._getPrincipalName();
    }

    start() {
        return Q.try(() => {
            return Q.all([reconstructCanonical(this, this._command),
                          this._getIdentityName()]);
        }).then(([reconstructed, identity]) => {
            if (!identity)
                throw new Error('Unknown identity ' + this._identity);
            return this.ask(ValueCategory.YesNo, this._("%s wants to %s").format(identity, reconstructed));
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
