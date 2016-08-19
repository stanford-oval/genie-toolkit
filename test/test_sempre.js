// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

require('./polyfill');

const http = require('http');
const https = require('https');
//http.globalAgent.maxSockets = 5;
//https.globalAgent.maxSockets = 5;

const Q = require('q');
const SempreClient = require('../lib/sempreclient');

const UTTERANCES = ['yes', 'no', 'post on twitter', 'post on facebook "foo"', 'help nest', 'monitor if temperature greater than 70 f', 'turn off the light', 'monitor xkcd'];

function makeNoise() {
    var noise = '';
    for (var i = 0; i < 5; i++)
        noise += String.fromCharCode(Math.floor(97 + 26 * Math.random()));
    return noise;
}

function main() {
    var sempreUrl;
    if (process.argv[2] !== undefined && process.argv[2].startsWith('--with-sempre='))
        sempreUrl = process.argv[2].substr('--with-sempre='.length);

    // open 50 different clients
    var clients = [];
    for (var i = 0; i < 50; i++)
        clients.push(new SempreClient(sempreUrl, 'en-US'));

    var promises = [];
    var latencysum = 0;
    for (var i = 0; i < 100; i++) {
        var client = clients[i % (clients.length)];
        promises.push(Q.delay(i*600 + 200*Math.random()).then(function() {
            var utterance = UTTERANCES[Math.floor(Math.random() * UTTERANCES.length)];
            utterance = makeNoise() + ' ' + utterance + ' ' + makeNoise();
            var start = Date.now();
            return client.sendUtterance(utterance).then(function() {
                var end = Date.now();
                console.log(end-start);
                latencysum += end - start;
            })
        }).catch((e) => {
            console.log('sempre reported an error: ' + e.message);
        }));
    }

    Q.all(promises).then(() => {
        console.log('Avg latency: ' + (latencysum/100));
    }).done();
}

main();
