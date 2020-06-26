// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const Semantic = require('./semantic');
const Intent = Semantic.Intent;

class QueueItem {
}

class UserInput extends QueueItem {
    constructor(intent, confident) {
        super();
        assert(intent instanceof Intent);
        this.intent = intent;
        this.confident = confident;
    }

    toString() {
        return `UserInput(${this.intent})`;
    }
}
UserInput.prototype.isUserInput = true;
QueueItem.UserInput = UserInput;

class Notification extends QueueItem {
    constructor(appId, icon, outputType, outputValue) {
        super();
        this.appId = appId;
        this.icon = icon;
        this.outputType = outputType;
        this.outputValue = outputValue;
    }

    toString() {
        return `Notification(${this.appId}, ${this.outputType})`;
    }
}
Notification.prototype.isNotification = true;
QueueItem.Notification = Notification;

class Error extends QueueItem {
    constructor(appId, icon, error) {
        super();
        this.appId = appId;
        this.icon = icon;
        this.error = error;
    }

    toString() {
        return `Error(${this.appId}, ${this.error})`;
    }
}
Error.prototype.isError = true;
QueueItem.Error = Error;

module.exports = QueueItem;
