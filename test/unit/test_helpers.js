// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2016-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');
const ThingTalk = require('thingtalk');

const { MockPlatform } = require('./mock_utils');
const Helpers = require('../../lib/dialogue-agent/helpers');

const CATEGORIES = ['media', 'social-network', 'home', 'communication', 'health', 'service', 'data-management'];


async function test(tpClient) {
    const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);

    for (const category of CATEGORIES) {
        console.log('category', category);

        for (let page = 0; ; page++) {
            const devices = await tpClient.getDeviceList(category, page, 10);
            let hasMore = false;
            if (devices.length > 10) {
                hasMore = true;
                devices.length = 10;
            }
            for (let device of devices) {
                console.log('device', '@' + device.primary_kind);
                const examples = await tpClient.getExamplesByKinds([device.primary_kind], true);
                await Helpers.loadExamples(examples, schemas);
            }
            if (!hasMore)
                break;
        }
    }
}

async function main() {
    const platform = new MockPlatform();
    const tpClient = new Tp.HttpClient(platform, 'https://almond-dev.stanford.edu/thingpedia');
    await test(tpClient);
}
if (module.parent)
    module.exports = main;
else
    main();
