// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Silei Xu <silei@stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const ValueCategory = require('./semantic').ValueCategory;
const Dialog = require('./dialog');
const DiscoveryDialog = require('./discovery_dialog');
const ConfigDialog = require('./config_dialog');

// command to trigger
//\r {"command": {"type":"discover", "value":"fitbit"}}

module.exports = class commandDialog extends Dialog {
    handle(analyzer) {
        if (this.handleGeneric(analyzer))
            return true;

        var type = analyzer.root.command.type;
        switch (type) {
            case 'discover':
                return(this.switchTo(new DiscoveryDialog(), analyzer));
                break;
        }
    }
}
