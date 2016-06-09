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
const LocalSempre = require('./localsempre');
const SempreClient = require('../lib/sempreclient');

const Mock = require('./mock');

class FakeSempre {
    constructor() {
        console.log('Using fake sempre');
    }

    start() {}
    stop() {}

    openSession() {
        return {
            sendUtterance(utt) {
                if (/yes/i.test(utt))
                    return Q(JSON.stringify({"special":"tt:root.special.yes"}));
                else if (/no/i.test(utt))
                    return Q(JSON.stringify({"special":"tt:root.special.no"}));
                else
                    return Q(JSON.stringify({"special":"tt:root.special.failed"}));
            }
        }
    }
}

class TestDelegate {
    constructor(rl) {
        this._rl = rl;

        if (process.argv[2] === '--with-sempre=fake')
            this._sempre = new FakeSempre();
        else if (process.argv[2] === '--with-sempre=local')
            this._sempre = new LocalSempre(true);
        else if (process.argv[2] !== undefined && process.argv[2].startsWith('--with-sempre='))
            this._sempre = new SempreClient(process.argv[2].substr('--with-sempre='.length));
        else
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
    var sabrina = new Sabrina(engine, new MockUser(), delegate, false);

    delegate.start();
    sabrina.start();

    function quit() {
        console.log('Bye\n');
        rl.close();
        process.exit();
    }

    function _process(command, analysis) {
        Q(analysis).then(function(analyzed) {
            return sabrina.handleCommand(command, analyzed);
        }).then(function() {
            rl.prompt();
        }).catch(function(e) {
            console.error('Failed to analyze utterance: ' + e.message);
            console.error(e.stack);
        }).done();
    }

    rl.on('line', function(line) {
        if (line.trim().length === 0) {
            rl.prompt();
            return;
        }
        if (line[0] === '\\') {
            if (line[1] === 'q')
                quit();
            else if (line[1] === 'r')
                _process(null, line.substr(2));
            else if (line[1] === 'c')
                _process(null, JSON.stringify({ answer: { type: "Choice", value: parseInt(line.substr(2)) }}));
            else
                console.log('Unknown command ' + line[1]);
        } else {
            _process(line, delegate.analyze(line));
        }
    });
    rl.on('SIGINT', quit);

    rl.prompt();
}

main();
