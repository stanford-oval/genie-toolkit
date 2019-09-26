// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

require('./polyfill');

const readline = require('readline');

const Almond = require('../lib/almond');
const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;

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
        console.log('>> button: ' + title + ' ' + JSON.stringify(json));
    }

    sendAskSpecial(what, code, entities, timeout) {
        console.log('>> context = ' + code + ' // ' + JSON.stringify(entities));
        console.log('>> ask special ' + what);
    }

    sendResult(obj) {
        console.log('>> result: ' + JSON.stringify(obj));
    }
}

class MockUser {
    constructor() {
        this.id = 1;
        this.account = 'FOO';
        this.name = 'Alice Tester';
        this.anonymous = false;
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
    else
        sempreUrl = 'https://nlp-staging.almond.stanford.edu';
    var almond = new Almond(engine, 'test', new MockUser(), delegate,
        { debug: false, sempreUrl: sempreUrl, showWelcome: true });

    almond.start().then(() => {
        rl.prompt();
    });

    function quit() {
        console.log('Bye\n');
        rl.close();
        process.exit();
    }

    function forceSuggestions(result) {
      // remove everything from the array, to force looking up in the examples
      result.candidates.length = 0;
    }

    function _process(command, analysis, postprocess) {
        Promise.resolve().then(() => {
            if (command === null)
                return almond.handleParsedCommand(analysis);
            else
                return almond.handleCommand(command, undefined, postprocess);
        }).then(() => {
            rl.prompt();
        });
    }
    function _processprogram(prog) {
        Promise.resolve(almond.handleThingTalk(prog)).then(() => {
            rl.prompt();
        });
    }

    function help() {
      console.log('Available console commands:');
      console.log('\\q: quit');
      console.log('\\r NN-TT: send parsed intent to Almond');
      console.log('\\c NUMBER: make a choice');
      console.log('\\f COMMAND: force example search fallback');
      console.log('\\a TYPE QUESTION: ask a question');
      console.log('\\t PROGRAM: execute a ThingTalk program');
      console.log('\\d KIND: run interactive configuration');
      console.log('\\p IDENTITY PROGRAM: run a permission request');
      console.log('\\n MESSAGE: show a notification');
      console.log('\\e ERROR: show an error');
      console.log('\\? or \\h: this help');
      rl.prompt();
    }

    function askQuestion(type, question) {
        Promise.resolve(almond.askQuestion(null, null, Type.fromString(type), question)
            .then((v) => console.log('You Answered: ' + v)).catch((e) => {
            if (e.code === 'ECANCELLED')
                console.log('You Cancelled');
            else
                throw e;
        }));
    }
    function interactiveConfigure(kind) {
        Promise.resolve(almond.interactiveConfigure(kind).then(() => {
            console.log('Interactive configuration complete');
        }).catch((e) => {
            if (e.code === 'ECANCELLED')
                console.log('You Cancelled');
            else
                throw e;
        }));
    }
    function permissionGrant(identity, program) {
        Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(program, engine.schemas, true).then((program) => {
            return almond.askForPermission(identity, identity, program);
        }).then((permission) => {
            console.log('Permission result: ' + permission);
        }).catch((e) => {
            if (e.code === 'ECANCELLED')
                console.log('You Cancelled');
            else
                throw e;
        }));
    }
    function notify(message) {
        Promise.resolve(almond.notify('app-foo', null, message));
    }
    function notifyError(message) {
        Promise.resolve(almond.notifyError('app-foo', null, new Error(message)));
    }
    function handleSlashR(line) {
        line = line.trim();
        if (line.startsWith('{'))
            _process(null, JSON.parse(line));
        else
            _process(null, { code: line.split(' '), entities: {} });
    }

    rl.on('line', (line) => {
        if (line.trim().length === 0) {
            rl.prompt();
            return;
        }
        if (line[0] === '\\') {
            if (line[1] === 'q') {
                quit();
            } else if (line[1] === 'h' || line[1] === '?') {
                help();
            } else if (line[1] === 't') {
                _processprogram(line.substr(3));
            } else if (line[1] === 'r') {
                handleSlashR(line.substr(3));
            } else if (line[1] === 'c') {
                _process(null, { code: ['bookkeeping', 'choice', line.substr(3)], entities: {} });
            } else if (line[1] === 'f') {
                _process(line.substr(3), null, forceSuggestions);
            } else if (line[1] === 'a') {
                askQuestion(line.substring(3, line.indexOf(' ', 3)), line.substr(line.indexOf(' ', 3)));
            } else if (line[1] === 'd') {
                interactiveConfigure(line.substring(3) || null);
            } else if (line[1] === 'p') {
                permissionGrant(line.substring(3, line.indexOf(' ', 3)), line.substr(line.indexOf(' ', 3)));
            } else if (line[1] === 'n') {
                notify(line.substring(3));
            } else if (line[1] === 'e') {
                notifyError(line.substring(3));
            } else {
                console.log('Unknown command ' + line[1]);
                rl.prompt();
            }
        } else {
            _process(line);
        }
    });
    rl.on('SIGINT', quit);
}

main();
