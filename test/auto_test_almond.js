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
Q.longStackSupport = true;
const readline = require('readline');

const Almond = require('../lib/almond');
const ThingTalk = require('thingtalk');
const Type = ThingTalk.Type;

const Mock = require('./mock');

var buffer = '';
function writeLine(line) {
    console.log(line);
    buffer += line + '\n';
}
function flushBuffer() {
    buffer = '';
}

var app = null;
function loadOneApp(code) {
    app = code;
}

class TestDelegate {
    constructor() {
    }

    send(what) {
        writeLine('>> ' + what);
        // die horribly if something does not work
        if (what.indexOf('that did not work') >= 0)
            setImmediate(() => process.exit(1));
    }

    sendPicture(url) {
        writeLine('>> picture: ' + url);
    }

    sendRDL(rdl) {
        writeLine('>> rdl: ' + rdl.displayTitle + ' ' + rdl.callback);
    }

    sendChoice(idx, what, title, text) {
        writeLine('>> choice ' + idx + ': ' + title);
    }

    sendLink(title, url) {
        writeLine('>> link: ' + title + ' ' + url);
    }

    sendButton(title, json) {
        writeLine('>> button: ' + title + ' ' + json);
    }

    sendAskSpecial(what) {
        writeLine('>> ask special ' + what);
    }
}

class MockUser {
    constructor() {
        this.id = 1;
        this.account = 'FOO';
        this.name = 'Alice Tester';
    }
}

// TEST_CASES is a list of scripts
// each script is a sequence of inputs and ouputs
// inputs are JSON objects in sempre syntax, outputs are buffered responses
// the last element of each script is the ThingTalk code that should be
// generated as a result of the script (or null if the script should not
// generate ThingTalk)

const TEST_CASES = [
    [{ special: "help" },
`>> Click on one of the following buttons to start adding command.
>> ask special generic
>> choice 0: When
>> choice 1: Get
>> choice 2: Do
`,
    null],

    [{ action: { name: { id: 'tt:twitter.sink' }, args: [] } },
`>> You have multiple devices of type twitter. Which one do you want to use?
>> ask special generic
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
`,
     { answer: { type: 'Choice', value: 0 } },
`>> What do you want to tweet?
>> ask special generic
`,
     { answer: { type: 'String', value: { value: 'lol' } } },
`>> Ok, so you want me to tweet "lol". Is that right?
>> ask special yesno
`,
     { special: "yes" },
`>> Consider it done.
>> ask special null
`,
`AlmondGenerated() {
    now => @(type="twitter",id="twitter-foo").sink(status="lol") ;
}`],

    [{ rule: {
        trigger: { name: { id: 'tt:twitter.source' }, args: [] },
        action: { name: { id: 'tt:facebook.post' }, args: [
            { name: { id: 'tt:param.status'}, operator: 'is',
              type: 'VarRef', value: { id: 'tt:param.text' } }
        ]}
    } },
`>> You have multiple devices of type twitter. Which one do you want to use?
>> ask special generic
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
`,
    { answer: { type: 'Choice', value: 0 } },
`>> Ok, so you want me to post text on Facebook if anyone you follow tweets. Is that right?
>> ask special yesno
`,
    { special: "yes" },
`>> Consider it done.
>> ask special null
`,
`AlmondGenerated() {
    @(type="twitter",id="twitter-foo").source() , v_text := text => @(type="facebook",id="facebook-6").post(status=v_text) ;
}`],

    [{ query: { name: { id: 'tt:xkcd.get_comic' }, args: [] } },
`>> ask special null
`,
`AlmondGenerated() {
    now => @(type="xkcd",id="xkcd-7").get_comic()  => notify;
}`],

    [{ query: { name: { id: 'tt:xkcd.get_comic' }, person: 'mom', args: [] } },
`>> Ok, so you want me to get an Xkcd comic using Almond of Mom Corp Inc.. Is that right?
>> ask special yesno
`,
    { special: "yes" },
`>> Sending rule to Mom Corp Inc.: get an Xkcd comic then send it to me
>> Consider it done.
>> ask special null
`,
`AlmondGenerated() {
    @(type="remote",id="remote-5").receive(__principal="mock-account:MOCK1234-phone:+1800666"^^tt:contact, __token="122ceb51a2dd904f227e5e220ba8e0ea"^^tt:flow_token, __kindChannel="query:xkcd:get_comic"^^tt:function, number=v_number, title=v_title, picture_url=v_picture_url, link=v_link)  => notify;
}`]
];

function roundtrip(input, output) {
    flushBuffer();
    var json = JSON.stringify(input);
    console.log('$ \\r ' + json);
    return almond.handleParsedCommand(json).then(() => {
        if (output !== null && buffer !== output)
            throw new Error('Invalid reply from Almond: ' + buffer);
    });
}

function test(i) {
    console.log('Test Case #' + (i+1));

    flushBuffer();
    app = null;
    var script = TEST_CASES[i];

    function step(j) {
        if (j === script.length-1)
            return Q();

        return roundtrip(script[j], script[j+1]).then(() => step(j+2));
    }
    return roundtrip({"special":"nevermind"}, null).then(() => step(0)).then(() => {
        var expected = script[script.length-1];
        if (app !== expected) {
            console.error('Test Case #' + (i+1) + ': does not match what expected');
            console.error('Expected: ' + expected);
            console.error('Generated: ' + app);
        } else {
            console.log('Test Case #' + (i+1) + ' passed');
        }
    }).catch((e) => {
        console.error('Test Case #' + (i+1) + ': failed with exception');
        console.error('Error: ' + e.message);
    });
}

function loop(i) {
    if (i === TEST_CASES.length)
        return Q();

    return Q(test(i)).then(() => loop(i+1));
}

var almond;

function main() {
    var engine = Mock.createMockEngine();
    // mock out getDeviceSetup
    engine.thingpedia.getDeviceSetup = (kinds) => {
        var ret = {};
        for (var k of kinds) {
            ret[k] = {type:'none',kind:k};
        }
        return Q(ret);
    }
    // intercept loadOneApp
    engine.apps.loadOneApp = loadOneApp;

    var delegate = new TestDelegate();

    var sempreUrl;
    if (process.argv[2] !== undefined && process.argv[2].startsWith('--with-sempre='))
        sempreUrl = process.argv[2].substr('--with-sempre='.length);
    almond = new Almond(engine, 'test', new MockUser(), delegate,
        { debug: false, sempreUrl: sempreUrl, showWelcome: true });

    almond.start();
    flushBuffer();

    loop(0).done();
}
main();
