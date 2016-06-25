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
const ListDialog = require('./list_dialog');

// test commands
// \r {"command": {"type":"discover", "value":{"id":"fitbit"}}}
// \r {"command": {"type":"list", "value":"devices"}}

module.exports = class commandDialog extends Dialog {
    handle(analyzer) {
        if (this.handleGeneric(analyzer))
            return true;

        var type = analyzer.root.command.type;
        switch (type) {
            case 'discover':
                return(this.switchTo(new DiscoveryDialog(), analyzer));
                break;
            case 'configure':
                return(this.switchTo(new ConfigDialog(), analyzer));
                break;
            case 'help':
                break;
            case 'action':
                break;
            case 'list':
                return(this.switchTo(new ListDialog(), analyzer));
            default: 
                return false;
        }
    }
}
