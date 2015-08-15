// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

const BaseApp = require('../base_app');

// 'config-server' is an app whose sole purpose is to deploy ThingEngine
// on a private server, given th
const DeployApp = new lang.Class({
    Name: 'TestApp',
    Extends: BaseApp,

    // no cached state, this app manipulates the engine settings
    _init: function() {
        this.parent();
    }
});
