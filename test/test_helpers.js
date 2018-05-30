// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

require('./polyfill');
process.on('unhandledRejection', (up) => { throw up; });

const Almond = require('../lib/almond');
const Helpers = require('../lib/helpers');

const Mock = require('./mock');

const CATEGORIES = ['media', 'social-network', 'home', 'communication', 'health', 'service', 'data-management'];

var engine, almond, dlg;

function test() {
    return promiseLoop(CATEGORIES, (category) => {
        console.log('category', category);

        return (function loop(page) {
            console.log('page', page);
            return engine.thingpedia.getDeviceList(category, page, 10).then(({ devices }) => {
                let hasMore = false;
                if (devices.length > 10) {
                    hasMore = true;
                    devices.length = 10;
                }
                return promiseLoop(devices, (device) => {
                    console.log('device', '@' + device.primary_kind);
                    return almond.thingpedia.getExamplesByKinds([device.primary_kind], true)
                        .then((examples) => Helpers.loadExamples(dlg, examples));
                }).then(() => {
                    if (hasMore)
                        return loop(page+1);
                    else
                        return Promise.resolve();
                });
            });
        })(0);
    });
}

function promiseLoop(array, fn) {
    return (function loop(i) {
        if (i === array.length)
            return Promise.resolve();
        return Promise.resolve(fn(array[i], i)).then(() => loop(i+1));
    })(0);
}

function main() {
    engine = Mock.createMockEngine('https://thingpedia.stanford.edu/thingpedia');
    almond = new Almond(engine, 'test', null, null,
        { debug: false, showWelcome: false });
    dlg = almond._dispatcher;

    return Promise.resolve(test());
}
if (module.parent)
    module.exports = main;
else
    main();