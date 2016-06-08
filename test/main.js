// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of DataShare
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
const SempreClient = require('sabrina').Sempre;

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

function runOneQuery(engine, query) {
    return Q.try(function() {
        var stream = engine.sparql.runQuery(query);

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
    });
}

function runOneUtterance(engine, delegate, assistant, line) {
    return delegate.analyze(line).then(function(analyzed) {
        return assistant.handleCommand(line, analyzed);
    });
}

class TestDelegate {
    constructor(rl) {
        this._rl = rl;

        this._sempre = new SempreClient();
    }

    start() {
        this._sempre.start();
        this._session = this._sempre.openSession();
    }

    stop() {
        this._sempre.stop();
    }

    analyze(what) {
        return this._session.sendUtterance(what);
    }

    send(what) {
        console.log('>> ' + what);
    }

    sendPicture(url) {
        console.log('>> picture: ' + url);
    }

    sendRDL(rdl) {
        console.log('>> rdl: ' + rdl.displayTitle + ' ' + rdl.callback);
    }

    sendChoice(idx, what, title, text) {
        console.log('>> choice ' + idx + ': ' + title);
    }

    sendLink(title, url) {
        console.log('>> link: ' + title + ' ' + url);
    }
}

function interact(engine, platform, delegate, rl) {
    function quit() {
        console.log('Bye\n');
        rl.close();
        engine.close().finally(function() {
            platform.exit();
        });
    }
    function help() {
        console.log('Available commands:');
        console.log('\\q : quit');
        console.log('\\r <json> : handle an utterance in SEMPRE format');
        console.log('\\s <sparql> : run a graphdb query');
        console.log('\\c <number> : make a choice');
        console.log('\\? or \\h : show this help');
        console.log('Any other command is interpreted as an English sentence and sent to Sabrina');
    }

    var assistant = platform.getCapability('assistant');
    assistant.start();

    rl.on('line', function(line) {
        Q.try(function() {
            if (line[0] === '\\') {
                if (line[1] === 'q')
                    return quit();
                else if (line[1] === '?' || line === 'h')
                    return help();
                else if (line[1] === 'r')
                    return assistant.handleCommand(null, line.substr(2));
                else if (line[1] === 'c')
                    return assistant.handleCommand(null, JSON.stringify({ answer: { type: "Choice", value: parseInt(line.substr(2)) }}));
                else if (line[1] === 's')
                    return runOneQuery(engine, line.substr(2));
                else
                    console.log('Unknown command ' + line[1]);
            } else if (line.trim()) {
                return runOneUtterance(engine, delegate, assistant, line);
            }
        }).then(function() {
            rl.prompt();
        }).done();
    });
    rl.on('SIGINT', quit);

    rl.prompt();
}

function batch(engine, platform) {
    var queries = fs.readFileSync(path.resolve(path.dirname(module.filename), './tests.sparql'), { encoding: 'utf8' }).split('====');

    function loop(i) {
        if (i === queries.length)
            return Q();

        return runOneQuery(engine, queries[i]).then(function() { return loop(i+1); });
    }

    loop(0).delay(5000).finally(function() {
        return engine.close();
    }).finally(function() {
        return platform.exit();
    });
}

class MockUser {
    constructor() {
        this.id = 1;
        this.account = 'FOO';
        this.name = 'Alice Tester';
    }
}

function main() {
    var interactive = process.argv[2] === '-i';
    if (interactive) {
        var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.setPrompt('$ ');
    }

    var platform = require('./test_platform');
    platform.init();

    var engine = new Engine(platform);
    if (interactive) {
        var delegate = new TestDelegate(rl);
        delegate.start();
        platform.createAssistant(engine, new MockUser(), delegate);
    }

    Q.try(function() {
        return engine.open();
    }).delay(5000).then(function() {
        if (interactive)
            interact(engine, platform, delegate, rl);
        else
            batch(engine, platform);
    }).done();
}

main();
