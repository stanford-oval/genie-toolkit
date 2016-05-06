// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

require('./polyfill');

const Q = require('q');
const readline = require('readline');

const Sabrina = require('../lib/sabrina');
const Sempre = require('../lib/semprewrapper');

const Mock = require('./mock');

class TestDelegate {
    constructor(rl) {
        this._rl = rl;
        this._sempre = new Sempre(true);
    }

    start() {
        this._sempre.start();
    }

    stop() {
        this._sempre.stop();
    }

    analyze(what) {
        return this._sempre.sendUtterance('test-session', what);
    }

    send(what) {
        console.log('>> ' + what);
    }

    sendPicture(url) {
        console.log('>> picture: ' + url);
    }
}

class MockUser {
    constructor() {
        this.id = 1;
        this.account = 'FOO';
        this.name = 'Alice Tester';
    }
}

function main() {
    var rl = readline.createInterface({ input: process.stdin, output: process.stdout });

    rl.setPrompt('$ ');

    var engine = Mock.createMockEngine();
    var delegate = new TestDelegate(rl);
    var sabrina = new Sabrina(engine, new MockUser(), delegate);

    delegate.start();
    sabrina.start();

    function quit() {
        console.log('Bye\n');
        rl.close();
        process.exit();
    }

    rl.on('line', function(line) {
        if (line.trim().length === 0) {
            rl.prompt();
            return;
        }
        if (line[0] === '\\') {
            if (line[1] === 'q')
                quit();
            else
                console.log('Unknown command ' + line[1]);
        } else {
            delegate.analyze(line).then(function(analyzed) {
                return sabrina.handleCommand(line, analyzed);
            }).then(function() {
                rl.prompt();
            });
        }
    });
    rl.on('SIGINT', quit);

    rl.prompt();
}

main();
