// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of DataShare
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const readline = require('readline');

const Engine = require('../lib/engine');

function readOneLine(rl) {
    return Q.Promise(function(callback, errback) {
        rl.once('line', function(line) {
            if (line.trim().length === 0) {
                errback(new Error('User cancelled'));
                return;
            }

            callback(line);
        })
    });
}

function main() {
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    rl.setPrompt('$ ');

    var platform = require('./platform');
    platform.init();

    var engine = new Engine(platform);

    Q.try(function() {
        return engine.open();
    }).then(function() {
        function quit() {
            console.log('Bye\n');
            rl.close();
            engine.close().finally(function() {
                process.exit();
            });
        }

        rl.on('line', function(line) {
            if (line[0] === '\\') {
                if (line[1] === 'q')
                    quit();
                else
                    console.log('Unknown command ' + line[1]);
            } else if (line.trim()) {
                Q.try(function() {
                    var stream = engine.sparql.runQuery(line);

                    return Q.Promise(function(callback, errback) {
                        stream.on('error', errback);
                        stream.on('data', (data) => {
                            console.log(data);
                        });
                        stream.on('end', callback);
                    });
                }).catch(function(e) {
                    console.error('Failed to execute query: ' + e.message);
                    console.error(e.stack);
                }).then(function() {
                    rl.prompt();
                }).done();
            } else {
                rl.prompt();
            }
        });
        rl.on('SIGINT', quit);

        rl.prompt();
    }).done();
}

main();
