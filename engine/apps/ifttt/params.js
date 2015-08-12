// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

exports.parseParams = function(serializedParams) {
    var params = {};

    serializedParams.forEach(function(p) {
        if (p.value)
            params[p.name] = p.value;
        else
            params[p.name] = '{{' + p['trigger-value'] + '}}';
    });
}
