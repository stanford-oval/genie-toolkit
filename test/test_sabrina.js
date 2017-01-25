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

const Mock = require('./mock');

class TestDelegate {
    constructor(rl) {
        this._rl = rl;
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

    sendButton(title, json) {
        console.log('>> button: ' + title + ' ' + json);
    }

    sendAskSpecial(what) {
        console.log('>> ask special ' + what);
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

    var sempreUrl;
    if (process.argv[2] !== undefined && process.argv[2].startsWith('--with-sempre='))
        sempreUrl = process.argv[2].substr('--with-sempre='.length);
    var sabrina = new Sabrina(engine, new MockUser(), delegate, false, sempreUrl);

    sabrina.start();

    function quit() {
        console.log('Bye\n');
        rl.close();
        process.exit();
    }

    function forceFallback(choices) {
      // remove everything from the array, to force looking up in the examples
      choices.length = 0;
    }
    function forceSuggestions(choices) {
      // bring everything to 0.15 probability and 0 score, to trigger the heuristic
      // for ambiguous analysis
      choices.forEach((c) => {
        c.prob = 0.20;
        c.score = 0;
      });
    }

    function _process(command, analysis, postprocess) {
        Q.try(function() {
            if (command === null)
                return sabrina.handleParsedCommand(analysis);
            else
                return sabrina.handleCommand(command, postprocess);
        }).then(function() {
            rl.prompt();
        }).done();
    }

    function help() {
      console.log('Available console commands:');
      console.log('\\q: quit');
      console.log('\\h: this help');
      console.log('\\r JSON: send json to Sabrina');
      console.log('\\f COMMAND: force example search fallback');
      console.log('\\s COMMAND: force ambiguous command fallback');
      rl.prompt();
    }

    rl.on('line', function(line) {
        if (line.trim().length === 0) {
            rl.prompt();
            return;
        }
        if (line[0] === '\\') {
            if (line[1] === 'q')
                quit();
            else if (line[1] === 'h')
                help();
            else if (line[1] === 'r')
                _process(null, line.substr(2));
            else if (line[1] === 'c')
                _process(null, JSON.stringify({ answer: { type: "Choice", value: parseInt(line.substr(2)) }}));
            else if (line[1] === 'f')
                _process(line.substr(2), null, forceFallback)
            else if (line[1] === 's')
                _process(line.substr(2), null, forceSuggestions)
            else
                console.log('Unknown command ' + line[1]);
        } else {
            _process(line);
        }
    });
    rl.on('SIGINT', quit);

    rl.prompt();
}

main();
