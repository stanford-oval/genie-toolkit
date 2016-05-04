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

const OmletFactory = require('./omlet');

const Database = require('../lib/index');
const Messaging = require('./deps/messaging');

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

    var client = OmletFactory(platform, true);
    var messaging = new Messaging(client);
    var database = new Database(platform, messaging);

    Q.try(function() {
        if (!client.auth.isAuthenticated()) {
            console.log('Omlet login required');
            console.log('Insert phone number:');
            rl.prompt();

            var phone;
            return readOneLine(rl).then(function(line) {
                phone = line.trim();
                client._ldClient.auth.connectPhone(phone);
                console.log('Insert confirm code:');
                return readOneLine(rl);
            }).then(function(code) {
                var identity = new LDProto.LDIdentity();
                identity.Type = LDProto.LDIdentityType.Phone;
                identity.Principal = phone;

                return Q.Promise(function(callback) {
                    client._ldClient.onSignedUp = callback;
                    client._ldClient.auth.confirmPinForIdentity(identity, code.trim(),
                                                                client._ldClient.auth._onAuthenticationComplete.bind(client._ldClient.auth));
                });
            });
        }
    }).delay(1000).then(function() {
        return messaging.start();
    }).then(function() {
        return database.start();
    }).then(function() {
        // insert some fake data
        var prefs = platform.getSharedPreferences();
        if (prefs.get('initialized'))
            return;

        prefs.set('initialized', true);
        var rdfstore = platform.getCapability('triple-store');
        return rdfstore.put([{
            subject: 'omlet://me',
            predicate: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',
            object: 'http://xmlns.com/foaf/0.1/Person'
        }, {
            subject: 'omlet://me',
            predicate: 'http://xmlns.com/foaf/0.1/firstName',
            object: '"John"'
        }, {
            subject: 'omlet://me',
            predicate: 'http://xmlns.com/foaf/0.1/lastName',
            object: '"Doe"'
        }]);
    }).then(function() {
        function quit() {
            console.log('Bye\n');
            rl.close();
            process.exit();
        }

        rl.on('line', function(line) {
            if (line[0] === '\\') {
                if (line[1] === 'q')
                    quit();
                else
                    console.log('Unknown command ' + line[1]);
            } else if (line.trim()) {
                Q.try(function() {
                    var stream = database.runQuery(line);

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
