// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Tp = require('thingpedia');

module.exports = new Tp.DeviceClass({
    Name: 'SabrinaDevice',

    _init: function(engine, state) {
        this.parent(engine, state);

        if (state.own) {
            this.own = true;
            this.globalName = 'sabrina';
            this.uniqueId = 'thingengine-own-sabrina';
        } else {
            throw new TypeError('Remote Sabrinas are not yet supported');
        }
    },

    hasKind: function(kind) {
        switch (kind) {
        case 'thingengine-system':
            return this.own;
        case 'cloud-only':
            return true;
        default:
            return this.parent(kind);
        }
    }
});
