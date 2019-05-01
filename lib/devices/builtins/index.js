// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

exports['org.thingpedia.builtin.bluetooth.generic'] = {
    class: require('./bluetooth.generic.tt.json'),
    module: require('./bluetooth.generic'),
};
exports['org.thingpedia.builtin.matrix'] = {
    class: require('./matrix.tt.json'),
    module: require('./matrix')
};
exports['org.thingpedia.builtin.test'] = {
    class: require('./test.tt.json'),
    module: require('./test')
};
exports['org.thingpedia.builtin.thingengine'] = {
    class: require('./thingengine.tt.json'),
    module: require('./thingengine')
};
exports['org.thingpedia.builtin.thingengine.builtin'] = {
    class: require('./thingengine.builtin.tt.json'),
    module: require('./thingengine.builtin')
};
exports['org.thingpedia.builtin.thingengine.phone'] = {
    class: require('./thingengine.phone.tt.json'),
    module: require('./thingengine.phone')
};
exports['org.thingpedia.builtin.thingengine.remote'] = {
    class: require('./thingengine.remote.tt.json'),
    module: require('./thingengine.remote')
};
exports['org.thingpedia.builtin.thingengine.gnome'] = {
    class: require('./thingengine.gnome.tt'),
    module: require('./thingengine.gnome')
};
