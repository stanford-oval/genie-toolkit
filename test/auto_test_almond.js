// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

require('./polyfill');

const assert = require('assert');
const ThingTalk = require('thingtalk');
const AsyncQueue = require('consumer-queue');

const Almond = require('../lib/almond');
const Intent = require('../lib/semantic').Intent;

const Mock = require('./mock');

var buffer = '';
function writeLine(line) {
    //console.log(line);
    buffer += line + '\n';
}
function flushBuffer() {
    buffer = '';
}

var permission = null;
var app = null;
var appid = 0;

async function queueResults(queue, results) {
    let _resolve, _reject;
    for (let item of results) {
        const promise = new Promise((resolve, reject) => {
            _resolve = resolve;
            _reject = reject;
        });
        queue.push({ item, resolve: _resolve, reject: _reject });

        // await the promise before queueing the next result
        // this matches the behavior of thingengine-core,
        // and tests a hang that otherwise occurs if the dialog
        // waits on the output queue before releasing the queue
        // item
        await promise;
    }

    const promise = new Promise((resolve, reject) => {
        _resolve = resolve;
        _reject = reject;
    });
    queue.push({ item: { isDone: true }, resolve: _resolve, reject: _reject });
    await promise;
}

class MockApp {
    constructor(uniqueId, results) {
        this.uniqueId = uniqueId;

        const queue = new AsyncQueue();
        // if any error occurs asynchronously in queueResults,
        // it won't be caught and it will crash the program
        // in unhandledRejection (failing the test)
        queueResults(queue, results);

        this.mainOutput = queue;
    }
}

function genFakeData(size, fill) {
    return String(Buffer.alloc(size, fill));
}
function getTestData(count, size) {
    let ret = [];
    for (let i = 0; i < count; i++)
        ret.push({ data: genFakeData(size, '!'.charCodeAt(0) + i) });
    return ret;
}

function createApp(program) {
    const code = program.prettyprint(false);
    app = code;

    if (program.principal !== null) {
        if (program.rules[0].actions.length < 0 || !program.rules[0].actions[0].isInvocation
            || !program.rules[0].actions[0].invocation.selector.isBuiltin)
            return null;
    }
    let results = [];
    if (code === `{
  now => @com.xkcd(id="com.xkcd-8").get_comic() => notify;
}`) {
        results = [{ isNotification: true, icon: 'com.xkcd', outputType: 'com.xkcd:get_comic', outputValue: {
                number: 1986,
                title: 'River Border',
                picture_url: 'http://imgs.xkcd.com/comics/river_border.png',
                link: 'https://xkcd.com/1986',
                alt_text: `I'm not a lawyer, but I believe zones like this are technically considered the high seas, so if you cut a pizza into a spiral there you could be charged with pieracy under marinaritime law.` //'
            } }];
    } else if (code === `{
  now => @org.thingpedia.weather(id="org.thingpedia.weather-14").current(location=makeLocation(90, 0, "North pole")) => notify;
}`) {
        results = [{ isError: true, icon: 'org.thingpedia.weather',  error: new Error('I do not like that location') }];
    } else if (code === `{
  now => @org.thingpedia.weather(id="org.thingpedia.weather-46").current(location=makeLocation(-90, 0, "South pole")) => notify;
}`) {
        results = [{ isNotification: true, icon: 'org.thingpedia.weather', outputType: 'org.thingpedia.weather:current', outputValue: {
            location: { y: -90, x: 0, display: "South pole" },
            temperature: 22, // Measure(C),
            wind_speed: 0, // Measure(mps),
            humidity: 75, // Number,
            cloudiness: 0, // Number,
            fog: 0, // Number,
            status: 'sunny', // Enum(raining,cloudy,sunny,snowy,sleety,drizzling,windy),
            icon: 'sunny.png', // Entity(tt:picture)
         } }];
    } else if (code.indexOf('@org.thingpedia.builtin.test') >= 0) {
        results = getTestData(25, 10).map((r) => ({ isNotification: true, icon: 'org.thingpedia.builtin.test',
            outputType: 'org.thingpedia.builtin.test:get_data', outputValue: r }));
    }

    return Promise.resolve(new MockApp('uuid-' + appid++, results));
}
function addPermission(perm) {
    permission = perm;
}

function checkIcon(icon) {
    assert((typeof icon === 'string' && icon) || icon === null);
}

function makeContext() {
    return {
        command: null,
        previousCommand: null,
        previousCandidates: [],
        platformData: {}
    };
}

class TestDelegate {
    constructor() {
    }

    send(what, icon) {
        checkIcon(icon);
        writeLine('>> ' + what);
        // die horribly if something does not work (and it's not a test error
        if (what.indexOf('that did not work') >= 0 && what.indexOf('I do not like that location') < 0)
            setImmediate(() => process.exit(1));
    }

    sendPicture(url, icon) {
        checkIcon(icon);
        writeLine('>> picture: ' + url);
    }

    sendRDL(rdl, icon) {
        checkIcon(icon);
        writeLine('>> rdl: ' + rdl.displayTitle + ' ' + rdl.webCallback);
    }

    sendChoice(idx, what, title, text) {
        writeLine('>> choice ' + idx + ': ' + title);
    }

    sendLink(title, url) {
        writeLine('>> link: ' + title + ' ' + url);
    }

    sendButton(title, json) {
        if (typeof json !== 'object')
            console.error(json);
        assert(typeof json === 'object');
        assert(Array.isArray(json.code) ||
               typeof json.program === 'string' ||
               typeof json.permissionRule === 'string');
        Promise.resolve(Intent.parse(json, almond.schemas, makeContext()));
        if (json.slots) {
            json.slots.forEach((slot) => {
                assert(title.indexOf('$' + slot) >= 0, `button ${title} is missing slot ${slot}`);
            });
        }
        writeLine('>> button: ' + title + ' ' + JSON.stringify(json));
    }

    sendAskSpecial(what, code, entities, timeout) {
        writeLine('>> context = ' + code + ' // ' + JSON.stringify(entities));
        writeLine('>> ask special ' + what);
    }

    sendResult(msg, icon) {
        writeLine(`>> ${msg.constructor.name} ${msg.toLocaleString()}`);
    }
}

class MockUser {
    constructor() {
        this.name = 'Alice Tester';
        this.isOwner = true;
        this.anonymous = false;
    }
}

// TEST_CASES is a list of scripts
// each script is a sequence of inputs and ouputs
// inputs are JSON objects in sempre syntax, outputs are buffered responses
// the last element of each script is the ThingTalk code that should be
// generated as a result of the script (or null if the script should not
// generate ThingTalk)

const TEST_CASES = [
    [
    (almond) => almond.start(),
`>> Hello! I'm Almond, your virtual assistant.
>> I am part of a research project of Stanford University. Would you like to participate?
>> With your consent, I will record the commands you give me for training. Recording the commands will allow me to improve my understanding of natural language. I will collect what you type, not your data, or what I reply.
>> If you would like to participate, please review our consent form, and keep it for your records:
>> rdl: Consent Form https://oval.cs.stanford.edu/almond-consent-form.html
>> Do you consent to recording your commands?
>> context = null // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Thank you! If you change your mind, you can change the option from Settings.
>> Okay, on to what I can do: I am capable of understanding actions and events over web services and smart devices. I do not chat, and I do not understand questions very well. Please check out the Cheatsheet (from the menu) to find out what I understand, or type ‘help’.
>> To start, how about you try one of these examples:
>> button: Get a #cat gif {"code":["now","=>","@com.giphy.get","param:tag:Entity(tt:hashtag)","=","HASHTAG_0","=>","notify"],"entities":{"HASHTAG_0":"cat"}}
>> button: Show me the New York Times {"code":["now","=>","@com.nytimes.get_front_page","=>","notify"],"entities":{}}
>> button: Show me the weather for San Francisco {"code":["now","=>","@org.thingpedia.weather.current","param:location:Location","=","location:","\\"","san","francisco","\\"","=>","notify"],"entities":{}}
>> button: What's the stock price of Google? {"code":["now","=>","@co.alphavantage.get_price","param:company:Entity(tt:stock_id)","=","\\"","google","\\"","^^tt:stock_id","=>","notify"],"entities":{}}
>> context = null // {}
>> ask special null
`,
    null],

    [['bookkeeping', 'special', 'special:help'],
/*`>> Do you want to use your own account or others?
>> choice 0: Use my own account
>> choice 1: Use others' account
>> ask special choice
`,*/
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    null],

    [
    ['now', '=>', '@com.xkcd.get_comic', '=>', '@com.twitter.post_picture'],
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => @com.xkcd.get_comic => @com.twitter.post_picture // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> What caption do you want?
>> choice 0: Use the title from Xkcd
>> choice 1: Use the alt text from Xkcd
>> choice 2: A description of the result
>> choice 3: None of above
>> context = now => @com.xkcd.get_comic => @com.twitter.post_picture // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> Upload the picture now.
>> choice 0: Use the picture url from Xkcd
>> choice 1: None of above
>> context = now => @com.xkcd.get_comic => @com.twitter.post_picture on param:caption:String = param:title:String // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> Okay, so you want me to get an Xkcd comic and then tweet the title with an attached picture with picture url equal to the picture url. Is that right?
>> context = now => @com.xkcd.get_comic => @com.twitter.post_picture on param:caption:String = param:title:String on param:picture_url:Entity(tt:picture) = param:picture_url:Entity(tt:picture) // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> context = now => @com.xkcd.get_comic => @com.twitter.post_picture on param:caption:String = param:title:String on param:picture_url:Entity(tt:picture) = param:picture_url:Entity(tt:picture) // {}
>> ask special null
`,
`{
  now => @com.xkcd(id="com.xkcd-6").get_comic() => @com.twitter(id="twitter-foo").post_picture(caption=title, picture_url=picture_url);
}`],

    [
    ['now', '=>', '@com.twitter.post'],
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => @com.twitter.post // {}
>> ask special choice
`,
     ['bookkeeping', 'choice', 1],
`>> What do you want to tweet?
>> context = now => @com.twitter.post // {}
>> ask special raw_string
`,
     { code: ['bookkeeping', 'answer', 'QUOTED_STRING_0'], entities: { QUOTED_STRING_0: 'lol' } },
`>> Okay, so you want me to tweet “lol”. Is that right?
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"lol"}
>> ask special yesno
`,
     ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"lol"}
>> ask special null
`,
`{
  now => @com.twitter(id="twitter-bar").post(status="lol");
}`],

    [
    ['monitor', '(', '@com.twitter.home_timeline', ')', '=>', '@com.facebook.post', 'on', 'param:status:String', '=', 'param:text:String'],
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = monitor ( @com.twitter.home_timeline ) => @com.facebook.post on param:status:String = param:text:String // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 1],
`>> Okay, I'm going to post the text on Facebook when tweets from anyone you follow change.
>> context = monitor ( @com.twitter.home_timeline ) => @com.facebook.post on param:status:String = param:text:String // {}
>> ask special null
`,
`{
  monitor (@com.twitter(id="twitter-bar").home_timeline()) => @com.facebook(id="com.facebook-7").post(status=text);
}`],

    [
    ['now', '=>', '@com.xkcd.get_comic', '=>', 'notify'],
`>> rdl: River Border https://xkcd.com/1986
>> picture: http://imgs.xkcd.com/comics/river_border.png
>> I'm not a lawyer, but I believe zones like this are technically considered the high seas, so if you cut a pizza into a spiral there you could be charged with pieracy under marinaritime law.
>> context = now => @com.xkcd.get_comic => notify // {}
>> ask special null
`,
`{
  now => @com.xkcd(id="com.xkcd-8").get_comic() => notify;
}`],

    [
    ['monitor', '(', '@security-camera.current_event', ')', '=>', '@com.twitter.post_picture'],
`>> You have multiple Security Camera devices. Which one do you want to use?
>> choice 0: Some Device 1
>> choice 1: Some Device 2
>> context = monitor ( @security-camera.current_event ) => @com.twitter.post_picture // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = monitor ( @security-camera.current_event ) => @com.twitter.post_picture // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> What caption do you want?
>> choice 0: A description of the result
>> choice 1: None of above
>> context = monitor ( @security-camera.current_event ) => @com.twitter.post_picture // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 1],
`>> What caption do you want?
>> context = monitor ( @security-camera.current_event ) => @com.twitter.post_picture // {}
>> ask special raw_string
`,
    { code: ['bookkeeping', 'answer', 'QUOTED_STRING_0'], entities: { QUOTED_STRING_0: 'lol' } },
`>> Upload the picture now.
>> choice 0: Use the picture url from Security Camera
>> choice 1: None of above
>> context = monitor ( @security-camera.current_event ) => @com.twitter.post_picture param:caption:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"lol"}
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> Okay, so you want me to tweet “lol” with an attached picture with picture url equal to the picture url when the current event detected on your security camera changes. Is that right?
>> context = monitor ( @security-camera.current_event ) => @com.twitter.post_picture param:caption:String = QUOTED_STRING_0 on param:picture_url:Entity(tt:picture) = param:picture_url:Entity(tt:picture) // {"QUOTED_STRING_0":"lol"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> context = monitor ( @security-camera.current_event ) => @com.twitter.post_picture param:caption:String = QUOTED_STRING_0 on param:picture_url:Entity(tt:picture) = param:picture_url:Entity(tt:picture) // {"QUOTED_STRING_0":"lol"}
>> ask special null
`,
`{
  monitor (@security-camera(id="security-camera-1").current_event()) => @com.twitter(id="twitter-foo").post_picture(caption="lol", picture_url=picture_url);
}`],

    [
    ['monitor', '(', '@security-camera.current_event', ')', '=>', 'notify'],
`>> You have multiple Security Camera devices. Which one do you want to use?
>> choice 0: Some Device 1
>> choice 1: Some Device 2
>> context = monitor ( @security-camera.current_event ) => notify // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
    `>> Okay, I'm going to notify you when the current event detected on your security camera changes.
>> context = monitor ( @security-camera.current_event ) => notify // {}
>> ask special null
`,
`{
  monitor (@security-camera(id="security-camera-1").current_event()) => notify;
}`],

    [
    ['bookkeeping', 'special', 'special:makerule'],
/*`>> Do you want to use your own account or others?
>> choice 0: Use my own account
>> choice 1: Use others' account
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],*/
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    ['monitor', '(', '@security-camera.current_event', ')', '=>', 'notify'],
`>> Your command is: when the current event detected on your security camera changes notify me. You can add more filters or run your command if you are ready.
>> choice 0: Choose a different command
>> choice 1: Add a filter
>> choice 2: Run it
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    ['now', '=>', '@com.xkcd.get_comic', '=>', 'notify'],
`>> Your command is: get an Xkcd comic. You can add more filters or run your command if you are ready.
>> choice 0: Choose a different command
>> choice 1: Add a filter
>> choice 2: Run it
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 1],
`>> Choose the filter you want to add:
>> button: the title is equal to $title {"code":["bookkeeping","filter","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title is not equal to $title {"code":["bookkeeping","filter","not","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title contains $title {"code":["bookkeeping","filter","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title does not contain $title {"code":["bookkeeping","filter","not","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the alt text is equal to $alt_text {"code":["bookkeeping","filter","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text is not equal to $alt_text {"code":["bookkeeping","filter","not","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text contains $alt_text {"code":["bookkeeping","filter","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text does not contain $alt_text {"code":["bookkeeping","filter","not","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special generic
`,
    { code: ['bookkeeping', 'filter', 'param:title:String', '=~', 'SLOT_0'],
      slots: ['title'],
      slotTypes: { title: 'String' },
      entities: {} },
`>> What should the title contain?
>> context = null // {}
>> ask special raw_string
`,
    "lol",
`>> Your command is: get an Xkcd comic, the title contains “lol”. You can add more filters or run your command if you are ready.
>> choice 0: Choose a different command
>> choice 1: Add a filter
>> choice 2: Run it
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 2],
`>> Sorry, I did not find any result for that.
>> context = now => ( @com.xkcd.get_comic ) filter param:title:String =~ QUOTED_STRING_0 => notify // {"QUOTED_STRING_0":"lol"}
>> ask special null
`,
    `{
  now => (@com.xkcd(id="com.xkcd-9").get_comic()), title =~ "lol" => notify;
}`],

    [
    ['bookkeeping', 'special', 'special:makerule'],
/*`>> Do you want to use your own account or others?
>> choice 0: Use my own account
>> choice 1: Use others' account
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],*/
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    ['now', '=>', '@com.xkcd.get_comic', '=>', 'notify'],
`>> Your command is: get an Xkcd comic. You can add more filters or run your command if you are ready.
>> choice 0: Choose a different command
>> choice 1: Add a filter
>> choice 2: Run it
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 1],
`>> Choose the filter you want to add:
>> button: the title is equal to $title {"code":["bookkeeping","filter","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title is not equal to $title {"code":["bookkeeping","filter","not","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title contains $title {"code":["bookkeeping","filter","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title does not contain $title {"code":["bookkeeping","filter","not","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the alt text is equal to $alt_text {"code":["bookkeeping","filter","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text is not equal to $alt_text {"code":["bookkeeping","filter","not","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text contains $alt_text {"code":["bookkeeping","filter","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text does not contain $alt_text {"code":["bookkeeping","filter","not","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special generic
`,
    { code: ['bookkeeping', 'filter', 'param:title:String', '=~', 'SLOT_0'],
      slots: ['title'],
      slotTypes: { title: 'String' },
      entities: {} },
`>> What should the title contain?
>> context = null // {}
>> ask special raw_string
`,
    "lol",
`>> Your command is: get an Xkcd comic, the title contains “lol”. You can add more filters or run your command if you are ready.
>> choice 0: Choose a different command
>> choice 1: Add a filter
>> choice 2: Run it
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 1],
`>> Choose the filter you want to add:
>> button: the title is equal to $title {"code":["bookkeeping","filter","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title is not equal to $title {"code":["bookkeeping","filter","not","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title contains $title {"code":["bookkeeping","filter","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title does not contain $title {"code":["bookkeeping","filter","not","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the alt text is equal to $alt_text {"code":["bookkeeping","filter","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text is not equal to $alt_text {"code":["bookkeeping","filter","not","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text contains $alt_text {"code":["bookkeeping","filter","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text does not contain $alt_text {"code":["bookkeeping","filter","not","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special generic
`,
    {"code":["bookkeeping","filter","not","param:title:String","=~","SLOT_0"],
     "entities":{"SLOT_0": "foo"},
     "slots":["title"],
     "slotTypes":{"title":"String"}},
`>> Your command is: get an Xkcd comic, the title contains “lol”, the title does not contain “foo”. You can add more filters or run your command if you are ready.
>> choice 0: Choose a different command
>> choice 1: Add a filter
>> choice 2: Run it
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 2],
`>> Sorry, I did not find any result for that.
>> context = now => ( @com.xkcd.get_comic ) filter not param:title:String =~ QUOTED_STRING_1 and param:title:String =~ QUOTED_STRING_0 => notify // {"QUOTED_STRING_0":"lol","QUOTED_STRING_1":"foo"}
>> ask special null
`,
    `{
  now => (@com.xkcd(id="com.xkcd-10").get_comic()), (title =~ "lol" && !(title =~ "foo")) => notify;
}`],

    [
    ['bookkeeping', 'special', 'special:makerule'],
/*`>> Do you want to use your own account or others?
>> choice 0: Use my own account
>> choice 1: Use others' account
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],*/
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,

    {"code":["bookkeeping","category","media"],"entities":{}},
`>> Pick a command from the following devices
>> button: Fox News Articles {"code":["bookkeeping","commands","media","device:com.foxnews"],"entities":{}}
>> button: Giphy {"code":["bookkeeping","commands","media","device:com.giphy"],"entities":{}}
>> button: Imgflip Meme Generator {"code":["bookkeeping","commands","media","device:com.imgflip"],"entities":{}}
>> button: NASA Daily {"code":["bookkeeping","commands","media","device:gov.nasa"],"entities":{}}
>> button: New York Times {"code":["bookkeeping","commands","media","device:com.nytimes"],"entities":{}}
>> button: Piled Higher and Deeper {"code":["bookkeeping","commands","media","device:com.phdcomics"],"entities":{}}
>> button: Reddit Frontpage {"code":["bookkeeping","commands","media","device:com.reddit.frontpage"],"entities":{}}
>> button: RSS Feed {"code":["bookkeeping","commands","media","device:org.thingpedia.rss"],"entities":{}}
>> button: The Cat API {"code":["bookkeeping","commands","media","device:com.thecatapi"],"entities":{}}
>> button: The Dog API {"code":["bookkeeping","commands","media","device:uk.co.thedogapi"],"entities":{}}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,

    {"code":["bookkeeping","special","special:more"],"entities":{}},
`>> Pick a command from the following devices
>> button: The Wall Street Journal {"code":["bookkeeping","commands","media","device:com.wsj"],"entities":{}}
>> button: The Washington Post {"code":["bookkeeping","commands","media","device:com.washingtonpost"],"entities":{}}
>> button: XKCD {"code":["bookkeeping","commands","media","device:com.xkcd"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,

    {"code":["bookkeeping","special","special:back"],"entities":{}},
`>> Pick a command from the following devices
>> button: Fox News Articles {"code":["bookkeeping","commands","media","device:com.foxnews"],"entities":{}}
>> button: Giphy {"code":["bookkeeping","commands","media","device:com.giphy"],"entities":{}}
>> button: Imgflip Meme Generator {"code":["bookkeeping","commands","media","device:com.imgflip"],"entities":{}}
>> button: NASA Daily {"code":["bookkeeping","commands","media","device:gov.nasa"],"entities":{}}
>> button: New York Times {"code":["bookkeeping","commands","media","device:com.nytimes"],"entities":{}}
>> button: Piled Higher and Deeper {"code":["bookkeeping","commands","media","device:com.phdcomics"],"entities":{}}
>> button: Reddit Frontpage {"code":["bookkeeping","commands","media","device:com.reddit.frontpage"],"entities":{}}
>> button: RSS Feed {"code":["bookkeeping","commands","media","device:org.thingpedia.rss"],"entities":{}}
>> button: The Cat API {"code":["bookkeeping","commands","media","device:com.thecatapi"],"entities":{}}
>> button: The Dog API {"code":["bookkeeping","commands","media","device:uk.co.thedogapi"],"entities":{}}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["bookkeeping","special","special:more"],"entities":{}},
`>> Pick a command from the following devices
>> button: The Wall Street Journal {"code":["bookkeeping","commands","media","device:com.wsj"],"entities":{}}
>> button: The Washington Post {"code":["bookkeeping","commands","media","device:com.washingtonpost"],"entities":{}}
>> button: XKCD {"code":["bookkeeping","commands","media","device:com.xkcd"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,

    {"code":["bookkeeping","commands","media","device:com.xkcd"],"entities":{}},
`>> Pick a command below.
>> button: when a new xkcd is out notify me {"example_id":1648624,"code":["monitor","(","@com.xkcd.get_comic",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: when a new xkcd is out in the what-if section notify me {"example_id":1648625,"code":["monitor","(","@com.xkcd.what_if",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: get the latest xkcd {"example_id":1648626,"code":["now","=>","@com.xkcd.get_comic","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: get the xkcd number $p_number {"example_id":1648627,"code":["now","=>","@com.xkcd.get_comic","param:number:Number","=","SLOT_0","=>","notify"],"entities":{},"slotTypes":{"p_number":"Number"},"slots":["p_number"]}
>> button: get a random xkcd {"example_id":1648628,"code":["now","=>","@com.xkcd.random_comic","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,

    {"example_id":1648624,"code":["monitor","(","@com.xkcd.get_comic",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]},
`Clicked example 1648624
>> Your command is: when an Xkcd comic changes notify me. You can add more filters or run your command if you are ready.
>> choice 0: Choose a different command
>> choice 1: Add a filter
>> choice 2: Run it
>> context = null // {}
>> ask special choice
`,

    ['bookkeeping', 'choice', 2],
`>> Okay, I'm going to notify you when an Xkcd comic changes.
>> context = monitor ( @com.xkcd.get_comic ) => notify // {}
>> ask special null
`,

    `{
  monitor (@com.xkcd(id="com.xkcd-11").get_comic()) => notify;
}`],

    [
    { code: ['executor', '=', 'USERNAME_0', ':', 'now', '=>', '@com.twitter.post'],
      entities: { USERNAME_0: 'mom' } },
`>> You need a Matrix account: I talk to other Almonds via the secure Matrix messaging service.
>> link: Register a new Matrix account now https://riot.im/app/#/register
>> Insert your Matrix username:
>> context = null // {}
>> ask special raw_string
`,
    `bob`,
`>> Insert your Matrix password:
>> context = null // {}
>> ask special password
`,
    `pa55word`,
`>> Yes or no?
>> context = null // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> The account has been set up.
>> What do you want to tweet?
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.twitter.post // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-phone:+5556664357","display":"Alice Smith (mom)"}}
>> ask special raw_string
`,
    `some tweet`,
`>> Okay, so you want me to tell Alice Smith (mom): tweet “some tweet”. Is that right?
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-phone:+5556664357","display":"Alice Smith (mom)"},"QUOTED_STRING_0":"some tweet"}
>> ask special yesno
`,

    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-phone:+5556664357","display":"Alice Smith (mom)"},"QUOTED_STRING_0":"some tweet"}
>> ask special null
`,
    `executor = "mock-account:MOCK1234-phone:+5556664357"^^tt:contact("Alice Smith (mom)") : {
  now => @com.twitter.post(status="some tweet");
}`],

    [
    { code: ['executor', '=', 'USERNAME_0', ':', 'now', '=>', '@com.twitter.post'],
      entities: { USERNAME_0: 'invalid_user' } },
`>> Cannot find a messaging account for Invalid User.
>> context = executor = USERNAME_0 : now => @com.twitter.post // {"USERNAME_0":"invalid_user"}
>> ask special null
`,
    null],

    [
    { code: ['executor', '=', 'USERNAME_0', ':', 'now', '=>', '@com.twitter.post', 'param:status:String', '=', 'QUOTED_STRING_0'],
      entities: { USERNAME_0: 'mom', QUOTED_STRING_0: "lol" } },
`>> Okay, I'm going to tell Alice Smith (mom): tweet “lol”.
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-phone:+5556664357","display":"Alice Smith (mom)"},"QUOTED_STRING_0":"lol"}
>> ask special null
`,
    `executor = "mock-account:MOCK1234-phone:+5556664357"^^tt:contact("Alice Smith (mom)") : {
  now => @com.twitter.post(status="lol");
}`],

    [
    { code: ['executor', '=', 'USERNAME_0', ':', 'now', '=>', '@com.xkcd.get_comic', '=>', 'notify'],
      entities: { USERNAME_0: 'mom' } },
`>> Okay, I'm going to tell Alice Smith (mom): get an Xkcd comic and then notify you.
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-phone:+5556664357","display":"Alice Smith (mom)"}}
>> ask special null
`,
    `executor = "mock-account:MOCK1234-phone:+5556664357"^^tt:contact("Alice Smith (mom)") : {
  now => @com.xkcd.get_comic() => notify;
}`],
    [
    { code: ['executor', '=', 'USERNAME_0', ':', 'now', '=>', '@com.xkcd.get_comic', '=>', 'return'],
      entities: { USERNAME_0: 'mom' } },
`>> Okay, I'm going to tell Alice Smith (mom): get an Xkcd comic and then send it to me.
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.xkcd.get_comic => return // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-phone:+5556664357","display":"Alice Smith (mom)"}}
>> ask special null
`,
    `executor = "mock-account:MOCK1234-phone:+5556664357"^^tt:contact("Alice Smith (mom)") : {
  now => @com.xkcd.get_comic() => return;
}`],

    [
    { code: ['policy', 'param:source:Entity(tt:contact)', '==', 'USERNAME_0', ':', 'now', '=>', '@com.twitter.post'],
      entities: { USERNAME_0: 'mom' } },
`>> Okay, I'm going to set: Alice Smith (mom) is allowed to tweet any status.
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : now => @com.twitter.post // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-phone:+5556664357","display":"Alice Smith (mom)"}}
>> ask special null
`,
    `source == "mock-account:MOCK1234-phone:+5556664357"^^tt:contact("Alice Smith (mom)") : now => @com.twitter.post;`],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @com.xkcd.get_comic() => notify;`, almond.schemas, true).then((prog) => {
            almond.runProgram(prog, 'uuid-12345', 'phone:+555654321');

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> I'm going to get an Xkcd comic and then notify you (as asked by Carol Johnson).
>> Sorry, I did not find any result for that.
>> context = now => @com.xkcd.get_comic => notify // {}
>> ask special null
`,
    `{
  now => @com.xkcd(id="com.xkcd-12").get_comic() => notify;
}`],

    [(almond) => {
        return ThingTalk.Grammar.parseAndTypecheck(`now => @com.bing.web_search() => notify;`, almond.schemas, true).then((prog) => {
            almond.runProgram(prog, 'uuid-12345', 'phone:+555654321');

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        });
    },
`>> What do you want to search?
>> context = now => @com.bing.web_search => notify // {}
>> ask special raw_string
`,
    `pizza`,
`>> Okay, so you want me to get websites matching “pizza” on Bing and then notify you (as asked by Carol Johnson). Is that right?
>> context = now => @com.bing.web_search param:query:String = QUOTED_STRING_0 => notify // {"QUOTED_STRING_0":"pizza"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Sorry, I did not find any result for that.
>> context = now => @com.bing.web_search param:query:String = QUOTED_STRING_0 => notify // {"QUOTED_STRING_0":"pizza"}
>> ask special null
`,
    `{
  now => @com.bing(id="com.bing").web_search(query="pizza") => notify;
}`],

    [(almond) => {
        return Promise.resolve().then(() => {
            return almond.notify('uuid-test-notify1', 'com.xkcd', 'com.xkcd:get_comic', {
                number: 1986,
                title: 'River Border',
                picture_url: 'http://imgs.xkcd.com/comics/river_border.png',
                link: 'https://xkcd.com/1986',
                alt_text: `I'm not a lawyer, but I believe zones like this are technically considered the high seas, so if you cut a pizza into a spiral there you could be charged with pieracy under marinaritime law.` //'
            });
        }).then(() => {
            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        });
    },
`>> rdl: River Border https://xkcd.com/1986
>> picture: http://imgs.xkcd.com/comics/river_border.png
>> I'm not a lawyer, but I believe zones like this are technically considered the high seas, so if you cut a pizza into a spiral there you could be charged with pieracy under marinaritime law.
>> context = null // {}
>> ask special null
`,
    null],

    [(almond) => {
        return Promise.resolve().then(() => {
            almond.notify('uuid-test-notify2', 'com.xkcd', 'com.xkcd:get_comic', {
                number: 1986,
                title: 'River Border',
                picture_url: 'http://imgs.xkcd.com/comics/river_border.png',
                link: 'https://xkcd.com/1986',
                alt_text: `I'm not a lawyer, but I believe zones like this are technically considered the high seas, so if you cut a pizza into a spiral there you could be charged with pieracy under marinaritime law.` //'
            });
        }).then(() => {
            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        });
    },
`>> Notification from Xkcd ⇒ Notification
>> rdl: River Border https://xkcd.com/1986
>> picture: http://imgs.xkcd.com/comics/river_border.png
>> I'm not a lawyer, but I believe zones like this are technically considered the high seas, so if you cut a pizza into a spiral there you could be charged with pieracy under marinaritime law.
>> context = null // {}
>> ask special null
`,
    null],

    [(almond) => {
        return Promise.resolve().then(() => {
            return almond.notifyError('uuid-test-notify2', 'com.xkcd', new Error('Something went wrong'));
        }).then(() => {
            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        });
    },
`>> Xkcd ⇒ Notification had an error: Something went wrong.
>> context = null // {}
>> ask special null
`,
    null],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @org.thingpedia.builtin.test.eat_data(data="foo");`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bob@smith.com', prog).then((res) => {
                assert.strictEqual(res, null);
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> Bob Smith (dad) would like to consume “foo”.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody (no restrictions) {"program":"true : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from Bob Smith (dad) (no restrictions) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from Bob Smith (dad) (this exact request) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : now => @org.thingpedia.builtin.test.eat_data, data == \\"foo\\";"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : now => @org.thingpedia.builtin.test.eat_data filter param:data:String == QUOTED_STRING_0 // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"},"QUOTED_STRING_0":"foo"}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:no'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
    null],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @org.thingpedia.builtin.test.eat_data(data="foo");`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bogus@example.com', prog).then((res) => {
                assert.strictEqual(res, null);
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> bogus@example.com would like to consume “foo”.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody (no restrictions) {"program":"true : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from bogus@example.com (no restrictions) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"bogus@example.com\\") : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from bogus@example.com (this exact request) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"bogus@example.com\\") : now => @org.thingpedia.builtin.test.eat_data, data == \\"foo\\";"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : now => @org.thingpedia.builtin.test.eat_data filter param:data:String == QUOTED_STRING_0 // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"bogus@example.com"},"QUOTED_STRING_0":"foo"}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:no'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
    null],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @org.thingpedia.builtin.test.eat_data(data="foo");`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'phone:X1234567', prog).then((res) => {
                assert.strictEqual(res, null);
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> X1234567 would like to consume “foo”.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody (no restrictions) {"program":"true : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from X1234567 (no restrictions) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"X1234567\\") : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from X1234567 (this exact request) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"X1234567\\") : now => @org.thingpedia.builtin.test.eat_data, data == \\"foo\\";"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : now => @org.thingpedia.builtin.test.eat_data filter param:data:String == QUOTED_STRING_0 // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"X1234567"},"QUOTED_STRING_0":"foo"}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:no'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
    null],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @org.thingpedia.builtin.test.eat_data(data="foo");`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bob@smith.com', prog).then((res) => {
                assert.strictEqual(res, prog);
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> Bob Smith (dad) would like to consume “foo”.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody (no restrictions) {"program":"true : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from Bob Smith (dad) (no restrictions) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from Bob Smith (dad) (this exact request) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : now => @org.thingpedia.builtin.test.eat_data, data == \\"foo\\";"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : now => @org.thingpedia.builtin.test.eat_data filter param:data:String == QUOTED_STRING_0 // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"},"QUOTED_STRING_0":"foo"}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:maybe'],
`>> Choose the filter you want to add:
>> button: the data is equal to $data {"code":["bookkeeping","filter","param:data:String","==","SLOT_0"],"entities":{},"slots":["data"],"slotTypes":{"data":"String"}}
>> button: the data is not equal to $data {"code":["bookkeeping","filter","not","param:data:String","==","SLOT_0"],"entities":{},"slots":["data"],"slotTypes":{"data":"String"}}
>> button: the data contains $data {"code":["bookkeeping","filter","param:data:String","=~","SLOT_0"],"entities":{},"slots":["data"],"slotTypes":{"data":"String"}}
>> button: the data does not contain $data {"code":["bookkeeping","filter","not","param:data:String","=~","SLOT_0"],"entities":{},"slots":["data"],"slotTypes":{"data":"String"}}
>> button: the time is before $time {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_time","{","param:time:Time","<=","SLOT_0","}"],"entities":{},"slots":["time"],"slotTypes":{"time":"Time"}}
>> button: the time is after $time {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_time","{","param:time:Time",">=","SLOT_0","}"],"entities":{},"slots":["time"],"slotTypes":{"time":"Time"}}
>> button: my location is $location {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_gps","{","param:location:Location","==","SLOT_0","}"],"entities":{},"slots":["location"],"slotTypes":{"location":"Location"}}
>> button: my location is not $location {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_gps","{","not","param:location:Location","==","SLOT_0","}"],"entities":{},"slots":["location"],"slotTypes":{"location":"Location"}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : now => @org.thingpedia.builtin.test.eat_data // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    {"code":["bookkeeping","filter","param:data:String","=~","SLOT_0"],"entities":{SLOT_0: 'oo'},"slots":["data"],"slotTypes":{"data":"String"}},
`>> Okay, so Bob Smith (dad) is allowed to consume any data if the data contains “oo”. Is that correct?
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : now => @org.thingpedia.builtin.test.eat_data filter param:data:String =~ QUOTED_STRING_0 // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"},"QUOTED_STRING_0":"oo"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:no'],
`>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody (no restrictions) {"program":"true : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from Bob Smith (dad) (no restrictions) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from Bob Smith (dad) (this exact request) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : now => @org.thingpedia.builtin.test.eat_data, data == \\"foo\\";"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : now => @org.thingpedia.builtin.test.eat_data filter param:data:String == QUOTED_STRING_0 // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"},"QUOTED_STRING_0":"foo"}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:maybe'],
`>> Choose the filter you want to add:
>> button: the data is equal to $data {"code":["bookkeeping","filter","param:data:String","==","SLOT_0"],"entities":{},"slots":["data"],"slotTypes":{"data":"String"}}
>> button: the data is not equal to $data {"code":["bookkeeping","filter","not","param:data:String","==","SLOT_0"],"entities":{},"slots":["data"],"slotTypes":{"data":"String"}}
>> button: the data contains $data {"code":["bookkeeping","filter","param:data:String","=~","SLOT_0"],"entities":{},"slots":["data"],"slotTypes":{"data":"String"}}
>> button: the data does not contain $data {"code":["bookkeeping","filter","not","param:data:String","=~","SLOT_0"],"entities":{},"slots":["data"],"slotTypes":{"data":"String"}}
>> button: the time is before $time {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_time","{","param:time:Time","<=","SLOT_0","}"],"entities":{},"slots":["time"],"slotTypes":{"time":"Time"}}
>> button: the time is after $time {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_time","{","param:time:Time",">=","SLOT_0","}"],"entities":{},"slots":["time"],"slotTypes":{"time":"Time"}}
>> button: my location is $location {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_gps","{","param:location:Location","==","SLOT_0","}"],"entities":{},"slots":["location"],"slotTypes":{"location":"Location"}}
>> button: my location is not $location {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_gps","{","not","param:location:Location","==","SLOT_0","}"],"entities":{},"slots":["location"],"slotTypes":{"location":"Location"}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : now => @org.thingpedia.builtin.test.eat_data // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    {"code":["bookkeeping","filter","param:data:String","=~","SLOT_0"],"entities":{SLOT_0: 'oo'},"slots":["data"],"slotTypes":{"data":"String"}},
`>> Okay, so Bob Smith (dad) is allowed to consume any data if the data contains “oo”. Is that correct?
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : now => @org.thingpedia.builtin.test.eat_data filter param:data:String =~ QUOTED_STRING_0 // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"},"QUOTED_STRING_0":"oo"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Okay, I'll remember that.
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : now => @org.thingpedia.builtin.test.eat_data filter param:data:String =~ QUOTED_STRING_0 // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"},"QUOTED_STRING_0":"oo"}
>> ask special null
`,
    `source == "mock-account:..."^^tt:contact("Bob Smith (dad)") : now => @org.thingpedia.builtin.test.eat_data, data =~ "oo";`],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @com.xkcd.get_comic() => notify;`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bob@smith.com', prog).then((res) => {
                assert.strictEqual(res, null);
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> Bob Smith (dad) would like to get an Xkcd comic and then notify you.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"program":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:no'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
    null],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @com.xkcd.get_comic() => notify;`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bob@smith.com', prog).then((res) => {
                assert.strictEqual(res, prog);
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> Bob Smith (dad) would like to get an Xkcd comic and then notify you.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"program":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special null
`,
    null],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @com.xkcd.get_comic() => notify;`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bob@smith.com', prog).then((res) => {
                assert.strictEqual(res, prog);
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> Bob Smith (dad) would like to get an Xkcd comic and then notify you.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"program":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    {"code":["policy","true",":","@com.xkcd.get_comic","=>","notify"],"entities":{}},
`>> Okay, so anyone is allowed to read an Xkcd comic. Is that correct?
>> context = policy true : @com.xkcd.get_comic => notify // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Okay, I'll remember that.
>> context = policy true : @com.xkcd.get_comic => notify // {}
>> ask special null
`,
    'true : @com.xkcd.get_comic => notify;'],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @com.xkcd.get_comic() => notify;`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bob@smith.com', prog).then((res) => {
                assert.strictEqual(res, prog);
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> Bob Smith (dad) would like to get an Xkcd comic and then notify you.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"program":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    {"code":["policy","param:source:Entity(tt:contact)", "==", "USERNAME_0",":","@com.xkcd.get_comic","=>","notify"],"entities":{ "USERNAME_0": "bob" }},
`>> Okay, so Bob Smith (dad) is allowed to read an Xkcd comic. Is that correct?
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-phone:+555123456","display":"Bob Smith (dad)"}}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Okay, I'll remember that.
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-phone:+555123456","display":"Bob Smith (dad)"}}
>> ask special null
`,
    'source == "mock-account:MOCK1234-phone:+555123456"^^tt:contact("Bob Smith (dad)") : @com.xkcd.get_comic => notify;'],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @com.xkcd.get_comic() => notify;`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bob@smith.com', prog).then((res) => {
                assert.strictEqual(res, prog);
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> Bob Smith (dad) would like to get an Xkcd comic and then notify you.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"program":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    {"program": `true : @com.xkcd.get_comic, title =~ $undefined => notify`},
`>> What should the title contain?
>> context = policy true : @com.xkcd.get_comic filter param:title:String =~ undefined => notify // {}
>> ask special raw_string
`,
    "foo",
`>> Okay, so anyone is allowed to read an Xkcd comic if the title contains “foo”. Is that correct?
>> context = policy true : @com.xkcd.get_comic filter param:title:String =~ QUOTED_STRING_0 => notify // {"QUOTED_STRING_0":"foo"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Okay, I'll remember that.
>> context = policy true : @com.xkcd.get_comic filter param:title:String =~ QUOTED_STRING_0 => notify // {"QUOTED_STRING_0":"foo"}
>> ask special null
`,
    'true : @com.xkcd.get_comic, title =~ "foo" => notify;'],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @com.xkcd.get_comic() => notify;`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bob@smith.com', prog).then((res) => {
                assert.strictEqual(res, prog);
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> Bob Smith (dad) would like to get an Xkcd comic and then notify you.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"program":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    {"program":"true : @com.xkcd.get_comic => notify;"},
`>> Okay, so anyone is allowed to read an Xkcd comic. Is that correct?
>> context = policy true : @com.xkcd.get_comic => notify // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Okay, I'll remember that.
>> context = policy true : @com.xkcd.get_comic => notify // {}
>> ask special null
`,
    'true : @com.xkcd.get_comic => notify;'],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @com.xkcd.get_comic() => notify;`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bob@smith.com', prog).then((res) => {
                assert.strictEqual(res, prog);
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> Bob Smith (dad) would like to get an Xkcd comic and then notify you.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"program":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    {"program":"true : @com.xkcd.get_comic => notify;"},
`>> Okay, so anyone is allowed to read an Xkcd comic. Is that correct?
>> context = policy true : @com.xkcd.get_comic => notify // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:no'],
`>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"program":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    {"program":"source == \"mock-account:...\"^^tt:contact(\"Bob Smith (dad)\") : @com.xkcd.get_comic => notify;"},
`>> Okay, so Bob Smith (dad) is allowed to read an Xkcd comic. Is that correct?
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Okay, I'll remember that.
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special null
`,
    `source == "mock-account:..."^^tt:contact("Bob Smith (dad)") : @com.xkcd.get_comic => notify;`],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @com.xkcd.get_comic() => notify;`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bob@smith.com', prog).then((res) => {
                assert.strictEqual(res, prog);
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> Bob Smith (dad) would like to get an Xkcd comic and then notify you.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"program":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:maybe'],
`>> Choose the filter you want to add:
>> button: the number is equal to $number {"code":["bookkeeping","filter","param:number:Number","==","SLOT_0"],"entities":{},"slots":["number"],"slotTypes":{"number":"Number"}}
>> button: the number is greater than or equal to $number {"code":["bookkeeping","filter","param:number:Number",">=","SLOT_0"],"entities":{},"slots":["number"],"slotTypes":{"number":"Number"}}
>> button: the number is less than or equal to $number {"code":["bookkeeping","filter","param:number:Number","<=","SLOT_0"],"entities":{},"slots":["number"],"slotTypes":{"number":"Number"}}
>> button: the title is equal to $title {"code":["bookkeeping","filter","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title is not equal to $title {"code":["bookkeeping","filter","not","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title contains $title {"code":["bookkeeping","filter","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title does not contain $title {"code":["bookkeeping","filter","not","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the alt text is equal to $alt_text {"code":["bookkeeping","filter","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text is not equal to $alt_text {"code":["bookkeeping","filter","not","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text contains $alt_text {"code":["bookkeeping","filter","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text does not contain $alt_text {"code":["bookkeeping","filter","not","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the time is before $time {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_time","{","param:time:Time","<=","SLOT_0","}"],"entities":{},"slots":["time"],"slotTypes":{"time":"Time"}}
>> button: the time is after $time {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_time","{","param:time:Time",">=","SLOT_0","}"],"entities":{},"slots":["time"],"slotTypes":{"time":"Time"}}
>> button: my location is $location {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_gps","{","param:location:Location","==","SLOT_0","}"],"entities":{},"slots":["location"],"slotTypes":{"location":"Location"}}
>> button: my location is not $location {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_gps","{","not","param:location:Location","==","SLOT_0","}"],"entities":{},"slots":["location"],"slotTypes":{"location":"Location"}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    {"code":["bookkeeping","filter","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}},
`>> What should the title contain?
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic filter param:title:String =~ undefined => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special raw_string
`,
    `pierates`,
`>> Okay, so Bob Smith (dad) is allowed to read an Xkcd comic if the title contains “pierates”. Is that correct?
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic filter param:title:String =~ QUOTED_STRING_0 => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"},"QUOTED_STRING_0":"pierates"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Okay, I'll remember that.
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic filter param:title:String =~ QUOTED_STRING_0 => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"},"QUOTED_STRING_0":"pierates"}
>> ask special null
`,

    `source == "mock-account:..."^^tt:contact("Bob Smith (dad)") : @com.xkcd.get_comic, title =~ "pierates" => notify;`],

    [['now', '=>', '@org.thingpedia.weather.current', '=>', 'notify'],
`>> What location do you want the current weather for?
>> context = now => @org.thingpedia.weather.current => notify // {}
>> ask special location
`,
    ['bookkeeping', 'answer', 'location:current_location'],
`>> Sorry, I did not find any result for that.
>> context = now => @org.thingpedia.weather.current param:location:Location = LOCATION_0 => notify // {"LOCATION_0":{"latitude":37.4275,"longitude":-122.1697,"display":null}}
>> ask special null
`,

    `{
  now => @org.thingpedia.weather(id="org.thingpedia.weather-13").current(location=makeLocation(37.4275, -122.1697)) => notify;
}`],

    [['now', '=>', '@org.thingpedia.weather.current', '=>', 'notify'],
`>> What location do you want the current weather for?
>> context = now => @org.thingpedia.weather.current => notify // {}
>> ask special location
`,
    ['bookkeeping', 'answer', 'location:home'],
`>> What is your home address?
>> context = now => @org.thingpedia.weather.current => notify // {}
>> ask special location
`,

    { code: ['bookkeeping', 'answer', 'LOCATION_0'], entities: {"LOCATION_0": {longitude:0, latitude:90, display:"North pole"}}},
`>> Sorry, that did not work: I do not like that location.
>> context = now => @org.thingpedia.weather.current param:location:Location = LOCATION_0 => notify // {"LOCATION_0":{"latitude":90,"longitude":0,"display":"North pole"}}
>> ask special null
`,

    `{
  now => @org.thingpedia.weather(id="org.thingpedia.weather-14").current(location=makeLocation(90, 0, "North pole")) => notify;
}`],

    [['now', '=>', '@org.thingpedia.weather.current', '=>', 'notify'],
`>> What location do you want the current weather for?
>> context = now => @org.thingpedia.weather.current => notify // {}
>> ask special location
`,
    ['bookkeeping', 'answer', 'location:home'],
`>> Sorry, I did not find any result for that.
>> context = now => @org.thingpedia.weather.current param:location:Location = LOCATION_0 => notify // {"LOCATION_0":{"latitude":90,"longitude":0,"display":"North pole"}}
>> ask special null
`,

    `{
  now => @org.thingpedia.weather(id="org.thingpedia.weather-15").current(location=makeLocation(90, 0, "North pole")) => notify;
}`],


    [
    ['bookkeeping', 'special', 'special:makerule'],
/*`>> Do you want to use your own account or others?
>> choice 0: Use my own account
>> choice 1: Use others' account
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],*/
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["bookkeeping","category","media"],"entities":{}},
`>> Pick a command from the following devices
>> button: Fox News Articles {"code":["bookkeeping","commands","media","device:com.foxnews"],"entities":{}}
>> button: Giphy {"code":["bookkeeping","commands","media","device:com.giphy"],"entities":{}}
>> button: Imgflip Meme Generator {"code":["bookkeeping","commands","media","device:com.imgflip"],"entities":{}}
>> button: NASA Daily {"code":["bookkeeping","commands","media","device:gov.nasa"],"entities":{}}
>> button: New York Times {"code":["bookkeeping","commands","media","device:com.nytimes"],"entities":{}}
>> button: Piled Higher and Deeper {"code":["bookkeeping","commands","media","device:com.phdcomics"],"entities":{}}
>> button: Reddit Frontpage {"code":["bookkeeping","commands","media","device:com.reddit.frontpage"],"entities":{}}
>> button: RSS Feed {"code":["bookkeeping","commands","media","device:org.thingpedia.rss"],"entities":{}}
>> button: The Cat API {"code":["bookkeeping","commands","media","device:com.thecatapi"],"entities":{}}
>> button: The Dog API {"code":["bookkeeping","commands","media","device:uk.co.thedogapi"],"entities":{}}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["bookkeeping","commands","media","device:com.phdcomics"],"entities":{}},
`>> Pick a command below.
>> button: when there is a new post on phd comics notify me {"example_id":1645320,"code":["monitor","(","@com.phdcomics.get_post",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: get posts on phd comics {"example_id":1645321,"code":["now","=>","@com.phdcomics.get_post","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["bookkeeping","special","special:back"],"entities":{}},
`>> Pick a command from the following devices
>> button: Fox News Articles {"code":["bookkeeping","commands","media","device:com.foxnews"],"entities":{}}
>> button: Giphy {"code":["bookkeeping","commands","media","device:com.giphy"],"entities":{}}
>> button: Imgflip Meme Generator {"code":["bookkeeping","commands","media","device:com.imgflip"],"entities":{}}
>> button: NASA Daily {"code":["bookkeeping","commands","media","device:gov.nasa"],"entities":{}}
>> button: New York Times {"code":["bookkeeping","commands","media","device:com.nytimes"],"entities":{}}
>> button: Piled Higher and Deeper {"code":["bookkeeping","commands","media","device:com.phdcomics"],"entities":{}}
>> button: Reddit Frontpage {"code":["bookkeeping","commands","media","device:com.reddit.frontpage"],"entities":{}}
>> button: RSS Feed {"code":["bookkeeping","commands","media","device:org.thingpedia.rss"],"entities":{}}
>> button: The Cat API {"code":["bookkeeping","commands","media","device:com.thecatapi"],"entities":{}}
>> button: The Dog API {"code":["bookkeeping","commands","media","device:uk.co.thedogapi"],"entities":{}}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["bookkeeping","commands","media","device:com.yahoo.finance"],"entities":{}},
`>> Pick a command below.
>> button: when the stock price of $p_stock_id changes notify me {"example_id":1645420,"code":["monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)"},"slots":["p_stock_id"]}
>> button: when stock dividends for $p_stock_id changes notify me {"example_id":1645421,"code":["monitor","(","@com.yahoo.finance.get_stock_div","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)"},"slots":["p_stock_id"]}
>> button: get stock price of $p_stock_id {"example_id":1645422,"code":["now","=>","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)"},"slots":["p_stock_id"]}
>> button: when the ask stock price of $p_stock_id goes above $p_ask_price notify me {"example_id":1645423,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:ask_price:Currency",">=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_ask_price":"Currency"},"slots":["p_stock_id","p_ask_price"]}
>> button: when the ask stock price of $p_stock_id goes below $p_ask_price notify me {"example_id":1645424,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:ask_price:Currency","<=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_ask_price":"Currency"},"slots":["p_stock_id","p_ask_price"]}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["bookkeeping","special","special:more"],"entities":{}},
`>> Pick a command below.
>> button: when the bid stock price of $p_stock_id goes above $p_bid_price notify me {"example_id":1645425,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:bid_price:Currency",">=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_bid_price":"Currency"},"slots":["p_stock_id","p_bid_price"]}
>> button: when the bid stock price of $p_stock_id goes below $p_bid_price notify me {"example_id":1645426,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:bid_price:Currency","<=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_bid_price":"Currency"},"slots":["p_stock_id","p_bid_price"]}
>> button: get dividend per share of $p_stock_id {"example_id":1645429,"code":["now","=>","@com.yahoo.finance.get_stock_div","param:stock_id:Entity(tt:stock_id)","=","SLOT_0","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)"},"slots":["p_stock_id"]}
>> button: when the dividend of $p_stock_id goes above $p_value notify me {"example_id":1645431,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_div","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:value:Currency",">=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_value":"Currency"},"slots":["p_stock_id","p_value"]}
>> button: when the dividend of $p_stock_id goes below $p_value notify me {"example_id":1645432,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_div","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:value:Currency","<=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_value":"Currency"},"slots":["p_stock_id","p_value"]}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["bookkeeping","special","special:back"],"entities":{}},
`>> Pick a command below.
>> button: when the stock price of $p_stock_id changes notify me {"example_id":1645420,"code":["monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)"},"slots":["p_stock_id"]}
>> button: when stock dividends for $p_stock_id changes notify me {"example_id":1645421,"code":["monitor","(","@com.yahoo.finance.get_stock_div","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)"},"slots":["p_stock_id"]}
>> button: get stock price of $p_stock_id {"example_id":1645422,"code":["now","=>","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)"},"slots":["p_stock_id"]}
>> button: when the ask stock price of $p_stock_id goes above $p_ask_price notify me {"example_id":1645423,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:ask_price:Currency",">=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_ask_price":"Currency"},"slots":["p_stock_id","p_ask_price"]}
>> button: when the ask stock price of $p_stock_id goes below $p_ask_price notify me {"example_id":1645424,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:ask_price:Currency","<=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_ask_price":"Currency"},"slots":["p_stock_id","p_ask_price"]}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["bookkeeping","special","special:back"],"entities":{}},
`>> Pick a command from the following devices
>> button: Fox News Articles {"code":["bookkeeping","commands","media","device:com.foxnews"],"entities":{}}
>> button: Giphy {"code":["bookkeeping","commands","media","device:com.giphy"],"entities":{}}
>> button: Imgflip Meme Generator {"code":["bookkeeping","commands","media","device:com.imgflip"],"entities":{}}
>> button: NASA Daily {"code":["bookkeeping","commands","media","device:gov.nasa"],"entities":{}}
>> button: New York Times {"code":["bookkeeping","commands","media","device:com.nytimes"],"entities":{}}
>> button: Piled Higher and Deeper {"code":["bookkeeping","commands","media","device:com.phdcomics"],"entities":{}}
>> button: Reddit Frontpage {"code":["bookkeeping","commands","media","device:com.reddit.frontpage"],"entities":{}}
>> button: RSS Feed {"code":["bookkeeping","commands","media","device:org.thingpedia.rss"],"entities":{}}
>> button: The Cat API {"code":["bookkeeping","commands","media","device:com.thecatapi"],"entities":{}}
>> button: The Dog API {"code":["bookkeeping","commands","media","device:uk.co.thedogapi"],"entities":{}}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["bookkeeping","commands","media","device:gov.nasa"],"entities":{}},
`>> Pick a command below.
>> button: when an asteroid passes close to earth notify me {"example_id":1641548,"code":["monitor","(","@gov.nasa.asteroid",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: get today 's asteroid info {"example_id":1641549,"code":["now","=>","@gov.nasa.asteroid","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: get nasa 's astronomy picture of the day {"example_id":1641550,"code":["now","=>","@gov.nasa.apod","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: get a picture from curiosity rover {"example_id":1641553,"code":["now","=>","@gov.nasa.rover","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: get $p_count pictures from curiosity rover {"example_id":1641555,"code":["now","=>","@gov.nasa.rover","param:count:Number","=","SLOT_0","=>","notify"],"entities":{},"slotTypes":{"p_count":"Number"},"slots":["p_count"]}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["now","=>","@gov.nasa.asteroid","=>","notify"],"entities":{},"slotTypes":{},"slots":[]},
`>> Your command is: get the asteroid passing close to Earth today. You can add more filters or run your command if you are ready.
>> choice 0: Choose a different command
>> choice 1: Add a filter
>> choice 2: Run it
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', '2'],
`>> Sorry, I did not find any result for that.
>> context = now => @gov.nasa.asteroid => notify // {}
>> ask special null
`,

    `{
  now => @gov.nasa(id="gov.nasa-16").asteroid() => notify;
}`],

    [
    ['bookkeeping', 'special', 'special:makerule'],
/*`>> Do you want to use your own account or others?
>> choice 0: Use my own account
>> choice 1: Use others' account
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],*/
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["bookkeeping","category","communication"],"entities":{}},
`>> Pick a command from the following devices
>> button: Gmail Account {"code":["bookkeeping","commands","communication","device:com.gmail"],"entities":{}}
>> button: Phone {"code":["bookkeeping","commands","communication","device:org.thingpedia.builtin.thingengine.phone"],"entities":{}}
>> button: Slack {"code":["bookkeeping","commands","communication","device:com.slack"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["bookkeeping","commands","communication","device:org.thingpedia.builtin.thingengine.phone"],"entities":{}},
`>> Pick a command below.
>> button: when i receive a sms notify me {"example_id":1647498,"code":["monitor","(","@org.thingpedia.builtin.thingengine.phone.sms",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: when i receive a sms from $p_sender  notify me {"example_id":1647499,"code":["monitor","(","(","@org.thingpedia.builtin.thingengine.phone.sms",")","filter","param:sender:Entity(tt:phone_number)","==","SLOT_0",")","=>","notify"],"entities":{},"slotTypes":{"p_sender":"Entity(tt:phone_number)"},"slots":["p_sender"]}
>> button: send an sms to $p_to saying $p_message {"example_id":1647501,"code":["now","=>","@org.thingpedia.builtin.thingengine.phone.send_sms","param:message:String","=","SLOT_1","param:to:Entity(tt:phone_number)","=","SLOT_0"],"entities":{},"slotTypes":{"p_to":"Entity(tt:phone_number)","p_message":"String"},"slots":["p_to","p_message"]}
>> button: set my phone to $p_mode {"example_id":1647504,"code":["now","=>","@org.thingpedia.builtin.thingengine.phone.set_ringer","param:mode:Enum(normal,vibrate,silent)","=","SLOT_0"],"entities":{},"slotTypes":{"p_mode":"Enum(normal,vibrate,silent)"},"slots":["p_mode"]}
>> button: call $p_number {"example_id":1647505,"code":["now","=>","@org.thingpedia.builtin.thingengine.phone.call","param:number:Entity(tt:phone_number)","=","SLOT_0"],"entities":{},"slotTypes":{"p_number":"Entity(tt:phone_number)"},"slots":["p_number"]}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,

    null],

    [
    ['bookkeeping', 'special', 'special:makerule'],
/*`>> Do you want to use your own account or others?
>> choice 0: Use my own account
>> choice 1: Use others' account
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],*/
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    {"code":["bookkeeping","category","service"],"entities":{}},
`>> Pick a command from the following devices
>> button: Almond Coffee {"code":["bookkeeping","commands","service","device:org.thingpedia.demo.coffee"],"entities":{}}
>> button: Bing Search {"code":["bookkeeping","commands","service","device:com.bing"],"entities":{}}
>> button: Dad Jokes {"code":["bookkeeping","commands","service","device:com.icanhazdadjoke"],"entities":{}}
>> button: Google Account {"code":["bookkeeping","commands","service","device:com.google"],"entities":{}}
>> button: Holidays Calendar {"code":["bookkeeping","commands","service","device:org.thingpedia.holidays"],"entities":{}}
>> button: iCalendar Events {"code":["bookkeeping","commands","service","device:org.thingpedia.icalendar"],"entities":{}}
>> button: Microsoft Computer Vision {"code":["bookkeeping","commands","service","device:com.microsoft.cognitive.vision"],"entities":{}}
>> button: Miscellaneous Interfaces {"code":["bookkeeping","commands","service","device:org.thingpedia.builtin.thingengine.builtin"],"entities":{}}
>> button: Partner Finder {"code":["bookkeeping","commands","service","device:org.thingpedia.friendhub.partnerfinder"],"entities":{}}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    ['bookkeeping', 'special', 'special:more'],
`>> Pick a command from the following devices
>> button: Quotes {"code":["bookkeeping","commands","service","device:com.forismatic.quotes"],"entities":{}}
>> button: Sticky Notes {"code":["bookkeeping","commands","service","device:org.thingpedia.friendhub.stickynotes"],"entities":{}}
>> button: Test Device {"code":["bookkeeping","commands","service","device:org.thingpedia.builtin.test"],"entities":{}}
>> button: Uber {"code":["bookkeeping","commands","service","device:com.uber"],"entities":{}}
>> button: Weather API {"code":["bookkeeping","commands","service","device:org.thingpedia.weather"],"entities":{}}
>> button: WolframAlpha {"code":["bookkeeping","commands","service","device:com.wolframalpha"],"entities":{}}
>> button: Wunderlist {"code":["bookkeeping","commands","service","device:com.wunderlist"],"entities":{}}
>> button: Yandex Translate {"code":["bookkeeping","commands","service","device:com.yandex.translate"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    ['bookkeeping', 'special', 'special:more'],
`>> Pick a command from the following devices
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    ['bookkeeping', 'special', 'special:nevermind'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,

    null],

    /*[
    ['bookkeeping', 'special', 'special:makerule'],
`>> Do you want to use your own account or others?
>> choice 0: Use my own account
>> choice 1: Use others' account
>> ask special choice
`,
    ['bookkeeping', 'choice', '1'],
`>> Whose account do you want to use?
>> ask special phone_number
`,
    {code:['bookkeeping', 'answer', 'PHONE_NUMBER_0'],entities:{'PHONE_NUMBER_0':'+1234567890'}},
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","commands","communication","device:org.thingpedia.builtin.thingengine.phone"],"entities":{}},
`>> Pick a command below.
>> button: when their location changes notify me {"example_id":1647495,"code":["monitor","(","@org.thingpedia.builtin.thingengine.builtin.get_gps",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: when their location changes to $p_location notify me {"example_id":1647497,"code":["edge","(","monitor","(","@org.thingpedia.builtin.thingengine.builtin.get_gps",")",")","on","param:location:Location","==","SLOT_0","=>","notify"],"entities":{},"slotTypes":{"p_location":"Location"},"slots":["p_location"]}
>> button: when they receive a sms notify me {"example_id":1647498,"code":["monitor","(","@org.thingpedia.builtin.thingengine.phone.sms",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: when they receive a sms from $p_sender  notify me {"example_id":1647499,"code":["monitor","(","(","@org.thingpedia.builtin.thingengine.phone.sms",")","filter","param:sender:Entity(tt:phone_number)","==","SLOT_0",")","=>","notify"],"entities":{},"slotTypes":{"p_sender":"Entity(tt:phone_number)"},"slots":["p_sender"]}
>> button: get their current location {"example_id":1647500,"code":["now","=>","@org.thingpedia.builtin.thingengine.builtin.get_gps","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"example_id":1647495,"code":["monitor","(","@org.thingpedia.builtin.thingengine.builtin.get_gps",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]},
`Clicked example 1647495
>> Your command is: when their location changes notify me. You can add more filters or run your command if you are ready.
>> choice 0: Choose a different command
>> choice 1: Add a filter
>> choice 2: Run it
>> ask special choice
`,
    ['bookkeeping', 'choice', '2'],
`>> Okay, so you want me to tell mock-account:MOCK1234-phone:+1234567890: send it to me when your location changes. Is that right?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> ask special null
`,
    `{
    class @__dyn_0 extends @org.thingpedia.builtin.thingengine.remote {
        query receive (in req __principal : Entity(tt:contact), in req __program_id : Entity(tt:program_id), in req __flow : Number, out __kindChannel : Entity(tt:function), out location : Location, out altitude : Measure(m), out bearing : Number, out speed : Measure(mps));
    }
    monitor (@__dyn_0.receive(__principal="mock-account:MOCK1234-phone:+1234567890"^^tt:contact, __program_id=$event.program_id, __flow=0)) => notify;
}
remote mock-account:MOCK1234-phone:+1234567890/phone:+15555555555 : uuid-XXXXXX : {
    class @__dyn_0 extends @org.thingpedia.builtin.thingengine.remote {
        action send (in req __principal : Entity(tt:contact), in req __program_id : Entity(tt:program_id), in req __flow : Number, in req __kindChannel : Entity(tt:function), in req location : Location, in req altitude : Measure(m), in req bearing : Number, in req speed : Measure(mps));
    }
    monitor (@org.thingpedia.builtin.thingengine.builtin.get_gps()) => @__dyn_0.send(__principal="mock-account:123456-SELF"^^tt:contact("me"), __program_id=$event.program_id, __flow=0, __kindChannel=$event.type, location=location, altitude=altitude, bearing=bearing, speed=speed);
}`],*/

    /*[
    ['bookkeeping', 'special', 'special:makerule'],
`>> Do you want to use your own account or others?
>> choice 0: Use my own account
>> choice 1: Use others' account
>> ask special choice
`,
    ['bookkeeping', 'choice', '1'],
`>> Whose account do you want to use?
>> ask special phone_number
`,
    {code:['bookkeeping', 'answer', 'PHONE_NUMBER_0'],entities:{'PHONE_NUMBER_0':'+1234567890'}},
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","category","social-network"],"entities":{}},
`>> Pick a command from the following devices
>> button: Facebook Account {"code":["bookkeeping","commands","social-network","device:com.facebook"],"entities":{}}
>> button: Google Contacts {"code":["bookkeeping","commands","social-network","device:com.google.contacts"],"entities":{}}
>> button: Instagram {"code":["bookkeeping","commands","social-network","device:com.instagram"],"entities":{}}
>> button: LinkedIn Account {"code":["bookkeeping","commands","social-network","device:com.linkedin"],"entities":{}}
>> button: Matrix {"code":["bookkeeping","commands","social-network","device:org.thingpedia.builtin.matrix"],"entities":{}}
>> button: Twitter Account {"code":["bookkeeping","commands","social-network","device:com.twitter"],"entities":{}}
>> button: Youtube Account {"code":["bookkeeping","commands","social-network","device:com.youtube"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","commands","social-network","device:com.facebook"],"entities":{}},
`>> Pick a command below.
>> button: post $p_status on facebook {"example_id":1640495,"code":["now","=>","@com.facebook.post","param:status:String","=","SLOT_0"],"entities":{},"slotTypes":{"p_status":"String"},"slots":["p_status"]}
>> button: post a picture on facebook {"example_id":1640497,"code":["now","=>","@com.facebook.post_picture"],"entities":{},"slotTypes":{},"slots":[]}
>> button: post a picture with caption $p_caption on facebook {"example_id":1640498,"code":["now","=>","@com.facebook.post_picture","param:caption:String","=","SLOT_0"],"entities":{},"slotTypes":{"p_caption":"String"},"slots":["p_caption"]}
>> button: post something on facebook {"example_id":1640502,"code":["now","=>","@com.facebook.post"],"entities":{},"slotTypes":{},"slots":[]}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"example_id":1640495,"code":["now","=>","@com.facebook.post","param:status:String","=","SLOT_0"],"entities":{'SLOT_0':"a test"},"slotTypes":{"p_status":"String"},"slots":["p_status"]},

`Clicked example 1640495
>> Your command is: post "a test" on Facebook. You can add more filters or run your command if you are ready.
>> choice 0: Choose a different command
>> choice 1: Add a filter
>> choice 2: Run it
>> ask special choice
`,
    ['bookkeeping', 'choice', '2'],
`>> Okay, so you want me to tell mock-account:MOCK1234-phone:+1234567890: post "a test" on Facebook. Is that right?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> ask special null
`,
    `null
remote mock-account:MOCK1234-phone:+1234567890/phone:+15555555555 : uuid-XXXXXX : {
    now => @com.facebook.post(status="a test");
}`],*/

    /*[
    ['bookkeeping', 'special', 'special:makerule'],
`>> Do you want to use your own account or others?
>> choice 0: Use my own account
>> choice 1: Use others' account
>> ask special choice
`,
    ['bookkeeping', 'choice', '1'],
`>> Whose account do you want to use?
>> ask special phone_number
`,
    {code:['bookkeeping', 'answer', 'PHONE_NUMBER_0'],entities:{'PHONE_NUMBER_0':'+1234567890'}},
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","category","social-network"],"entities":{}},
`>> Pick a command from the following devices
>> button: Facebook Account {"code":["bookkeeping","commands","social-network","device:com.facebook"],"entities":{}}
>> button: Google Contacts {"code":["bookkeeping","commands","social-network","device:com.google.contacts"],"entities":{}}
>> button: Instagram {"code":["bookkeeping","commands","social-network","device:com.instagram"],"entities":{}}
>> button: LinkedIn Account {"code":["bookkeeping","commands","social-network","device:com.linkedin"],"entities":{}}
>> button: Matrix {"code":["bookkeeping","commands","social-network","device:org.thingpedia.builtin.matrix"],"entities":{}}
>> button: Twitter Account {"code":["bookkeeping","commands","social-network","device:com.twitter"],"entities":{}}
>> button: Youtube Account {"code":["bookkeeping","commands","social-network","device:com.youtube"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","commands","social-network","device:com.facebook"],"entities":{}},
`>> Pick a command below.
>> button: post $p_status on facebook {"example_id":1640495,"code":["now","=>","@com.facebook.post","param:status:String","=","SLOT_0"],"entities":{},"slotTypes":{"p_status":"String"},"slots":["p_status"]}
>> button: post a picture on facebook {"example_id":1640497,"code":["now","=>","@com.facebook.post_picture"],"entities":{},"slotTypes":{},"slots":[]}
>> button: post a picture with caption $p_caption on facebook {"example_id":1640498,"code":["now","=>","@com.facebook.post_picture","param:caption:String","=","SLOT_0"],"entities":{},"slotTypes":{"p_caption":"String"},"slots":["p_caption"]}
>> button: post something on facebook {"example_id":1640502,"code":["now","=>","@com.facebook.post"],"entities":{},"slotTypes":{},"slots":[]}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"example_id":1640495,"code":["now","=>","@com.facebook.post","param:status:String","=","SLOT_0"],"entities":{},"slotTypes":{"p_status":"String"},"slots":["p_status"]},

`Clicked example 1640495
>> Your command is: post ____ on Facebook. You can add more filters or run your command if you are ready.
>> choice 0: Choose a different command
>> choice 1: Add a filter
>> choice 2: Run it
>> ask special choice
`,
    ['bookkeeping', 'choice', '2'],
`>> What do you want to post?
>> ask special raw_string
`,
    'another test',
`>> Okay, so you want me to tell mock-account:MOCK1234-phone:+1234567890: post "another test" on Facebook. Is that right?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> ask special null
`,
    `null
remote mock-account:MOCK1234-phone:+1234567890/phone:+15555555555 : uuid-XXXXXX : {
    now => @com.facebook.post(status="another test");
}`],*/

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @com.xkcd.get_comic() => notify;`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bob@smith.com', prog).then((res) => {
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> Bob Smith (dad) would like to get an Xkcd comic and then notify you.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"program":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:maybe'],
`>> Choose the filter you want to add:
>> button: the number is equal to $number {"code":["bookkeeping","filter","param:number:Number","==","SLOT_0"],"entities":{},"slots":["number"],"slotTypes":{"number":"Number"}}
>> button: the number is greater than or equal to $number {"code":["bookkeeping","filter","param:number:Number",">=","SLOT_0"],"entities":{},"slots":["number"],"slotTypes":{"number":"Number"}}
>> button: the number is less than or equal to $number {"code":["bookkeeping","filter","param:number:Number","<=","SLOT_0"],"entities":{},"slots":["number"],"slotTypes":{"number":"Number"}}
>> button: the title is equal to $title {"code":["bookkeeping","filter","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title is not equal to $title {"code":["bookkeeping","filter","not","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title contains $title {"code":["bookkeeping","filter","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title does not contain $title {"code":["bookkeeping","filter","not","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the alt text is equal to $alt_text {"code":["bookkeeping","filter","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text is not equal to $alt_text {"code":["bookkeeping","filter","not","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text contains $alt_text {"code":["bookkeeping","filter","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text does not contain $alt_text {"code":["bookkeeping","filter","not","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the time is before $time {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_time","{","param:time:Time","<=","SLOT_0","}"],"entities":{},"slots":["time"],"slotTypes":{"time":"Time"}}
>> button: the time is after $time {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_time","{","param:time:Time",">=","SLOT_0","}"],"entities":{},"slots":["time"],"slotTypes":{"time":"Time"}}
>> button: my location is $location {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_gps","{","param:location:Location","==","SLOT_0","}"],"entities":{},"slots":["location"],"slotTypes":{"location":"Location"}}
>> button: my location is not $location {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_gps","{","not","param:location:Location","==","SLOT_0","}"],"entities":{},"slots":["location"],"slotTypes":{"location":"Location"}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_gps","{","not","param:location:Location","==","SLOT_0","}"],"entities":{},"slots":["location"],"slotTypes":{"location":"Location"}},
`>> What location are you interested in?
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic filter @org.thingpedia.builtin.thingengine.builtin.get_gps { not param:location:Location == undefined } => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special location
`,
    { code: ['bookkeeping', 'answer', 'LOCATION_0'], entities: {"LOCATION_0": {longitude:0, latitude:90, display:"North pole"}}},
`>> Okay, so Bob Smith (dad) is allowed to read an Xkcd comic if the my location is not equal to North pole. Is that correct?
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic filter @org.thingpedia.builtin.thingengine.builtin.get_gps { not param:location:Location == LOCATION_0 } => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"},"LOCATION_0":{"latitude":90,"longitude":0,"display":"North pole"}}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Okay, I'll remember that.
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic filter @org.thingpedia.builtin.thingengine.builtin.get_gps { not param:location:Location == LOCATION_0 } => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"},"LOCATION_0":{"latitude":90,"longitude":0,"display":"North pole"}}
>> ask special null
`,

    `source == "mock-account:..."^^tt:contact("Bob Smith (dad)") : @com.xkcd.get_comic, @org.thingpedia.builtin.thingengine.builtin.get_gps() { !(location == makeLocation(90, 0, "North pole")) } => notify;`],

    [(almond) => {
        return Promise.resolve(ThingTalk.Grammar.parseAndTypecheck(`now => @com.xkcd.get_comic() => notify;`, almond.schemas, true).then((prog) => {
            Promise.resolve(almond.askForPermission('mock-account:...', 'email:bob@smith.com', prog).then((res) => {
            }));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        }));
    },
`>> Bob Smith (dad) would like to get an Xkcd comic and then notify you.
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"program":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"program":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Only if… {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:maybe'],
`>> Choose the filter you want to add:
>> button: the number is equal to $number {"code":["bookkeeping","filter","param:number:Number","==","SLOT_0"],"entities":{},"slots":["number"],"slotTypes":{"number":"Number"}}
>> button: the number is greater than or equal to $number {"code":["bookkeeping","filter","param:number:Number",">=","SLOT_0"],"entities":{},"slots":["number"],"slotTypes":{"number":"Number"}}
>> button: the number is less than or equal to $number {"code":["bookkeeping","filter","param:number:Number","<=","SLOT_0"],"entities":{},"slots":["number"],"slotTypes":{"number":"Number"}}
>> button: the title is equal to $title {"code":["bookkeeping","filter","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title is not equal to $title {"code":["bookkeeping","filter","not","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title contains $title {"code":["bookkeeping","filter","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the title does not contain $title {"code":["bookkeeping","filter","not","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: the alt text is equal to $alt_text {"code":["bookkeeping","filter","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text is not equal to $alt_text {"code":["bookkeeping","filter","not","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text contains $alt_text {"code":["bookkeeping","filter","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the alt text does not contain $alt_text {"code":["bookkeeping","filter","not","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the time is before $time {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_time","{","param:time:Time","<=","SLOT_0","}"],"entities":{},"slots":["time"],"slotTypes":{"time":"Time"}}
>> button: the time is after $time {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_time","{","param:time:Time",">=","SLOT_0","}"],"entities":{},"slots":["time"],"slotTypes":{"time":"Time"}}
>> button: my location is $location {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_gps","{","param:location:Location","==","SLOT_0","}"],"entities":{},"slots":["location"],"slotTypes":{"location":"Location"}}
>> button: my location is not $location {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_gps","{","not","param:location:Location","==","SLOT_0","}"],"entities":{},"slots":["location"],"slotTypes":{"location":"Location"}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special generic
`,
    {"code":["bookkeeping","filter","@org.thingpedia.builtin.thingengine.builtin.get_gps","{","param:location:Location","==","SLOT_0","}"],"entities":{},"slots":["location"],"slotTypes":{"location":"Location"}},
`>> What location are you interested in?
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic filter @org.thingpedia.builtin.thingengine.builtin.get_gps { param:location:Location == undefined } => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"}}
>> ask special location
`,
    { code: ['bookkeeping', 'answer', 'LOCATION_0'], entities: {"LOCATION_0": {longitude:0, latitude:90, display:"North pole"}}},
`>> Okay, so Bob Smith (dad) is allowed to read an Xkcd comic if the my location is equal to North pole. Is that correct?
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic filter @org.thingpedia.builtin.thingengine.builtin.get_gps { param:location:Location == LOCATION_0 } => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"},"LOCATION_0":{"latitude":90,"longitude":0,"display":"North pole"}}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Okay, I'll remember that.
>> context = policy param:source:Entity(tt:contact) == GENERIC_ENTITY_tt:contact_0 : @com.xkcd.get_comic filter @org.thingpedia.builtin.thingengine.builtin.get_gps { param:location:Location == LOCATION_0 } => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:...","display":"Bob Smith (dad)"},"LOCATION_0":{"latitude":90,"longitude":0,"display":"North pole"}}
>> ask special null
`,

    `source == "mock-account:..."^^tt:contact("Bob Smith (dad)") : @com.xkcd.get_comic, @org.thingpedia.builtin.thingengine.builtin.get_gps() { location == makeLocation(90, 0, "North pole") } => notify;`],

    [(almond) => {
        almond.askQuestion(null, 'org.thingpedia.builtin.test', ThingTalk.Type.Number, 'What is the answer to life the universe and everything?').then((v) => {
            assert.strictEqual(v, 42);
        });

        // inject a meaningless intent so we synchronize the two concurrent tasks
        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> What is the answer to life the universe and everything?
>> context = null // {}
>> ask special number
`,
    { entities: {NUMBER_0: 42}, code: ['bookkeeping', 'answer', 'NUMBER_0'] },
`>> context = null // {}
>> ask special null
`,
    null],

    [(almond) => {
        almond.askQuestion(null, 'org.thingpedia.builtin.test', ThingTalk.Type.Number, 'What is the answer to life the universe and everything?').then((v) => {
            assert.fail('expected an error');
        }, (err) => {
            assert.strictEqual(err.code, 'ECANCELLED');
        });

        // inject a meaningless intent so we synchronize the two concurrent tasks
        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> What is the answer to life the universe and everything?
>> context = null // {}
>> ask special number
`,
    ['bookkeeping', 'special', 'special:nevermind'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
    null],

    [(almond) => {
        almond.askQuestion(null, 'org.thingpedia.builtin.test', ThingTalk.Type.Number, 'What is the answer to life the universe and everything?').then((v) => {
            assert.fail('expected an error');
        }, (err) => {
            assert.strictEqual(err.code, 'ECANCELLED');
        });

        // inject a meaningless intent so we synchronize the two concurrent tasks
        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> What is the answer to life the universe and everything?
>> context = null // {}
>> ask special number
`,
    ['bookkeeping', 'special', 'special:stop'],
`>> context = null // {}
>> ask special null
`,
    null],

    [
    ['now', '=>', '@com.instagram.get_pictures', '=>', 'notify'],
`>> Sorry, I did not understand that. You might need to enable a new skill before I understand that command.
>> link: Configure a new skill /devices/create
>> context = now => @com.instagram.get_pictures => notify // {}
>> ask special null
`,
    null],

    [
    ['now', '=>', '@com.tumblr.blog.post_text'],
`>> Sorry, I did not understand that. You might need to enable a new skill before I understand that command.
>> link: Configure a new skill /devices/create
>> context = now => @com.tumblr.blog.post_text // {}
>> ask special null
`,
    null],

    [
    ['now', '=>', '@org.thingpedia.rss.get_post', '=>', 'notify'],
`>> Sorry, I did not understand that. You might need to enable a new skill before I understand that command.
>> link: Configure a new skill /devices/create
>> context = now => @org.thingpedia.rss.get_post => notify // {}
>> ask special null
`,
    null],

    [
    ['now', '=>', '@com.lg.tv.webos2.set_power'],
`>> Sorry, I did not understand that. You might need to enable a new skill before I understand that command.
>> link: Configure a new skill /devices/create
>> context = now => @com.lg.tv.webos2.set_power // {}
>> ask special null
`,
    null],

    [
    (almond) => {
        almond.interactiveConfigure('com.xkcd');

        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> com.xkcd has been enabled successfully.
>> context = null // {}
>> ask special null
`,
    null],

    [
    (almond) => {
        almond.interactiveConfigure('com.instagram');

        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> OK, here's the link to configure Instagram.
>> link: Configure Instagram /devices/oauth2/com.instagram?name=Instagram
>> context = null // {}
>> ask special null
`,
    null],

    [
    (almond) => {
        almond.interactiveConfigure('org.thingpedia.rss');

        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> Please enter the Feed URL.
>> context = null // {}
>> ask special raw_string
`,
    'https://example.com/rss.xml',
`>> The account has been set up.
>> context = null // {}
>> ask special null
`,
    null],

    [
    (almond) => {
        almond.interactiveConfigure('com.tumblr.blog');

        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> Choose one of the following to configure Tumblr Blog.
>> link: Configure Tumblr Account /devices/oauth2/com.tumblr?name=Tumblr Account
>> button: Configure Some other Tumblr Thing {"entities":{},"code":["now","=>","@org.thingpedia.builtin.thingengine.builtin.configure","param:device:Entity(tt:device)","=","device:com.tumblr2"]}
>> context = null // {}
>> ask special null
`,
    null],

    [
    (almond) => {
        almond.interactiveConfigure('org.thingpedia.builtin.matrix');

        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> Insert your Matrix username:
>> context = null // {}
>> ask special raw_string
`,
    `bob`,
`>> Insert your Matrix password:
>> context = null // {}
>> ask special password
`,
    {entities: { QUOTED_STRING_0: `pa55word` }, code: ['bookkeeping', 'answer', 'QUOTED_STRING_0'] },
`>> Yes or no?
>> context = null // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> The account has been set up.
>> context = null // {}
>> ask special null
`,
    null],

    [
    (almond) => {
        almond.interactiveConfigure('com.lg.tv.webos2');

        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> Searching for LG WebOS TV…
>> Can't find any LG WebOS TV around.
>> context = null // {}
>> ask special null
`,
    null],

    [
    (almond) => {
        almond.interactiveConfigure('org.thingpedia.builtin.bluetooth.generic');

        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> Searching for Generic Bluetooth Device…
>> I found the following devices. Which one do you want to set up?
>> choice 0: Bluetooth Device foo
>> choice 1: Bluetooth Device bar
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],
`>> The device has been set up.
>> context = null // {}
>> ask special null
`,
    null],

    [
    (almond) => {
        almond.interactiveConfigure(null).then(() => {
            assert.fail('expected an error');
        }, (err) => {
            assert.strictEqual(err.code, 'ECANCELLED');
        });

        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> Searching for devices nearby…
>> I found the following devices. Which one do you want to set up?
>> choice 0: Bluetooth Device foo
>> choice 1: Bluetooth Device bar
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'special', 'special:nevermind'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
    null],

    [
    ['bookkeeping', 'special', 'special:help'],
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    ['bookkeeping', 'special', 'special:back'],
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    ['bookkeeping', 'special', 'special:empty'],
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    ['bookkeeping', 'special', 'special:more'],
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Yes what?
`,
    ['bookkeeping', 'answer', '0'],
`>> Sorry, but that's not what I asked.
>> I'm looking for a command.
>> context = null // {}
>> ask special command
`,
    ['bookkeeping', 'special', 'special:nevermind'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,

    null],

    [
    ['now', '=>', '@org.thingpedia.builtin.thingengine.home.start_playing'],
`>> Sorry, I did not understand that. You might need to enable a new skill before I understand that command.
>> link: Configure a new skill /devices/create
>> context = now => @org.thingpedia.builtin.thingengine.home.start_playing // {}
>> ask special null
`,
    null],

    [
    ['now', '=>', '@car.honk_horn'],
`>> Sorry, I did not understand that. You might need to enable a new skill before I understand that command.
>> link: Configure a new skill /devices/create
>> context = now => @car.honk_horn // {}
>> ask special null
`,
    null],

    [
    (almond) => {
        almond.interactiveConfigure('org.thingpedia.builtin.thingengine.home');

        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> Sorry, I don't know how to configure Home.
>> context = null // {}
>> ask special null
`,
    null],

    [
    ['bookkeeping', 'special', 'special:wakeup'],
``,
    null],

    [
    {"program": `now => @com.twitter.follow(user_name="bob"^^tt:username);` },
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => @com.twitter.follow param:user_name:Entity(tt:username) = USERNAME_0 // {"USERNAME_0":"bob"}
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],
`>> Okay, I'm going to follow @bob on Twitter.
>> context = now => @com.twitter.follow param:user_name:Entity(tt:username) = USERNAME_0 // {"USERNAME_0":"bob"}
>> ask special null
`,
    `{
  now => @com.twitter(id="twitter-foo").follow(user_name="bob"^^tt:username);
}`],

    [
    {"program": `now => @com.gmail.send_email(to="bob"^^tt:username, message="foo", subject="bar");` },
`>> Okay, I'm going to send an email to Bob Smith (dad) with subject “bar” on GMail with message equal to “foo”.
>> context = now => @com.gmail.send_email param:message:String = QUOTED_STRING_0 param:subject:String = QUOTED_STRING_1 param:to:Entity(tt:email_address) = EMAIL_ADDRESS_0 // {"QUOTED_STRING_0":"foo","QUOTED_STRING_1":"bar","EMAIL_ADDRESS_0":"bob@smith.com"}
>> ask special null
`,
    `{
  now => @com.gmail(id="com.gmail-19").send_email(message="foo", subject="bar", to="bob@smith.com"^^tt:email_address("Bob Smith (dad)"));
}`],

    [
    {"program": `now => @com.gmail.send_email(to="dad"^^tt:username, message="foo", subject="bar");` },
`>> Okay, I'm going to send an email to Bob Smith (dad) with subject “bar” on GMail with message equal to “foo”.
>> context = now => @com.gmail.send_email param:message:String = QUOTED_STRING_0 param:subject:String = QUOTED_STRING_1 param:to:Entity(tt:email_address) = EMAIL_ADDRESS_0 // {"QUOTED_STRING_0":"foo","QUOTED_STRING_1":"bar","EMAIL_ADDRESS_0":"bob@smith.com"}
>> ask special null
`,
    `{
  now => @com.gmail(id="com.gmail-20").send_email(message="foo", subject="bar", to="bob@smith.com"^^tt:email_address("Bob Smith (dad)"));
}`],

    [
    {"program": `now => @com.gmail.send_email(to="missing_user"^^tt:username, message="foo", subject="bar");` },
`>> No contact matches your search.
>> Who do you want to contact?
>> context = now => @com.gmail.send_email param:message:String = QUOTED_STRING_0 param:subject:String = QUOTED_STRING_1 param:to:Entity(tt:email_address) = USERNAME_0 // {"QUOTED_STRING_0":"foo","QUOTED_STRING_1":"bar","USERNAME_0":"missing_user"}
>> ask special email_address
`,
    {code:['bookkeeping', 'answer', 'EMAIL_ADDRESS_0'], entities:{'EMAIL_ADDRESS_0': 'bob@smith.com'}},
`>> Okay, I'm going to send an email to bob@smith.com with subject “bar” on GMail with message equal to “foo”.
>> context = now => @com.gmail.send_email param:message:String = QUOTED_STRING_0 param:subject:String = QUOTED_STRING_1 param:to:Entity(tt:email_address) = EMAIL_ADDRESS_0 // {"QUOTED_STRING_0":"foo","QUOTED_STRING_1":"bar","EMAIL_ADDRESS_0":"bob@smith.com"}
>> ask special null
`,
    `{
  now => @com.gmail(id="com.gmail-21").send_email(message="foo", subject="bar", to="bob@smith.com"^^tt:email_address);
}`],

    [
    {"program": `now => @com.gmail.send_email(to="equal_prob"^^tt:username, message="foo", subject="bar");` },
`>> Multiple contacts match “equal_prob”. Who do you mean?
>> choice 0: Alice Smith (mom)
>> choice 1: Bob Smith (dad)
>> context = now => @com.gmail.send_email param:message:String = QUOTED_STRING_0 param:subject:String = QUOTED_STRING_1 param:to:Entity(tt:email_address) = USERNAME_0 // {"QUOTED_STRING_0":"foo","QUOTED_STRING_1":"bar","USERNAME_0":"equal_prob"}
>> ask special choice
`,
    {code:['bookkeeping', 'answer', 'EMAIL_ADDRESS_0'], entities:{'EMAIL_ADDRESS_0': 'bob@smith.com'}},
`>> Sorry, but that's not what I asked.
>> Could you choose one of the following?
>> choice 0: Alice Smith (mom)
>> choice 1: Bob Smith (dad)
>> context = now => @com.gmail.send_email param:message:String = QUOTED_STRING_0 param:subject:String = QUOTED_STRING_1 param:to:Entity(tt:email_address) = USERNAME_0 // {"QUOTED_STRING_0":"foo","QUOTED_STRING_1":"bar","USERNAME_0":"equal_prob"}
>> ask special choice
`,
    ['bookkeeping', 'choice', '1'],
`>> Okay, I'm going to send an email to Bob Smith (dad) with subject “bar” on GMail with message equal to “foo”.
>> context = now => @com.gmail.send_email param:message:String = QUOTED_STRING_0 param:subject:String = QUOTED_STRING_1 param:to:Entity(tt:email_address) = EMAIL_ADDRESS_0 // {"QUOTED_STRING_0":"foo","QUOTED_STRING_1":"bar","EMAIL_ADDRESS_0":"bob@smith.com"}
>> ask special null
`,
    `{
  now => @com.gmail(id="com.gmail-22").send_email(message="foo", subject="bar", to="bob@smith.com"^^tt:email_address("Bob Smith (dad)"));
}`],

    [
    {code: ['now', '=>', '@com.gmail.send_email', 'param:to:Entity(tt:email_address)', '=', 'USERNAME_0', 'param:message:String', '=', 'QUOTED_STRING_0', 'param:subject:String', '=', 'QUOTED_STRING_1'],
     entities: { USERNAME_0: 'dad', QUOTED_STRING_0: 'foo', QUOTED_STRING_1: 'bar' } },
`>> Okay, I'm going to send an email to Bob Smith (dad) with subject “bar” on GMail with message equal to “foo”.
>> context = now => @com.gmail.send_email param:message:String = QUOTED_STRING_0 param:subject:String = QUOTED_STRING_1 param:to:Entity(tt:email_address) = EMAIL_ADDRESS_0 // {"QUOTED_STRING_0":"foo","QUOTED_STRING_1":"bar","EMAIL_ADDRESS_0":"bob@smith.com"}
>> ask special null
`,
    `{
  now => @com.gmail(id="com.gmail-23").send_email(message="foo", subject="bar", to="bob@smith.com"^^tt:email_address("Bob Smith (dad)"));
}`],

    [
    {code: ['now', '=>', '@org.thingpedia.builtin.thingengine.phone.send_sms', 'param:to:Entity(tt:phone_number)', '=', 'USERNAME_0', 'param:message:String', '=', 'QUOTED_STRING_0'],
     entities: { USERNAME_0: 'dad', QUOTED_STRING_0: 'foo', QUOTED_STRING_1: 'bar' } },
`>> Okay, I'm going to send a message to Bob Smith (dad) containing “foo”.
>> context = now => @org.thingpedia.builtin.thingengine.phone.send_sms param:message:String = QUOTED_STRING_0 param:to:Entity(tt:phone_number) = PHONE_NUMBER_0 // {"QUOTED_STRING_0":"foo","PHONE_NUMBER_0":"+555123456"}
>> ask special null
`,
    `{
  now => @org.thingpedia.builtin.thingengine.phone(id="org.thingpedia.builtin.thingengine.phone").send_sms(message="foo", to="+555123456"^^tt:phone_number("Bob Smith (dad)"));
}`],

    [
    {program: `now => @com.twitter.search(), hashtags == $undefined => notify;`},
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => ( @com.twitter.search ) filter param:hashtags:Array(Entity(tt:hashtag)) == undefined => notify // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],
`>> What should the hashtags be equal to?
>> context = now => ( @com.twitter.search ) filter param:hashtags:Array(Entity(tt:hashtag)) == undefined => notify // {}
>> ask special raw_string
`,
    {code: ['bookkeeping', 'answer', 'QUOTED_STRING_0'], entities: { QUOTED_STRING_0: 'lol' }},
`>> You chose #lol.
>> Would you like to add more elements to the list?
>> context = now => ( @com.twitter.search ) filter param:hashtags:Array(Entity(tt:hashtag)) == undefined => notify // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> What should the hashtags be equal to?
>> context = now => ( @com.twitter.search ) filter param:hashtags:Array(Entity(tt:hashtag)) == undefined => notify // {}
>> ask special raw_string
`,
    {code: ['bookkeeping', 'answer', 'QUOTED_STRING_0'], entities: { QUOTED_STRING_0: 'funny' }},
`>> You chose #lol, #funny.
>> Would you like to add more elements to the list?
>> context = now => ( @com.twitter.search ) filter param:hashtags:Array(Entity(tt:hashtag)) == undefined => notify // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:no'],
`>> Sorry, I did not find any result for that.
>> context = now => ( @com.twitter.search ) filter param:hashtags:Array(Entity(tt:hashtag)) == [ HASHTAG_0 , HASHTAG_1 ] => notify // {"HASHTAG_0":"lol","HASHTAG_1":"funny"}
>> ask special null
`,
    `{
  now => (@com.twitter(id="twitter-foo").search()), hashtags == ["lol"^^tt:hashtag, "funny"^^tt:hashtag] => notify;
}`],

    [
    ['now', '=>', '@com.cryptonator.get_price', 'param:currency:Entity(tt:cryptocurrency_code)', '=', '"', 'bitcoin', '"', '^^tt:cryptocurrency_code', '=>', 'notify'],
`>> Sorry, I did not find any result for that.
>> context = now => @com.cryptonator.get_price param:currency:Entity(tt:cryptocurrency_code) = GENERIC_ENTITY_tt:cryptocurrency_code_0 => notify // {"GENERIC_ENTITY_tt:cryptocurrency_code_0":{"value":"btc","display":"Bitcoin"}}
>> ask special null
`,
    `{
  now => @com.cryptonator(id="com.cryptonator-24").get_price(currency="btc"^^tt:cryptocurrency_code("Bitcoin")) => notify;
}`],

    [
    ['now', '=>', '@com.cryptonator.get_price', 'param:currency:Entity(tt:cryptocurrency_code)', '=', '"', 'bitcoin', '"', '^^tt:cryptocurrency_code', '=>', 'notify'],
`>> Sorry, I did not find any result for that.
>> context = now => @com.cryptonator.get_price param:currency:Entity(tt:cryptocurrency_code) = GENERIC_ENTITY_tt:cryptocurrency_code_0 => notify // {"GENERIC_ENTITY_tt:cryptocurrency_code_0":{"value":"btc","display":"Bitcoin"}}
>> ask special null
`,
    `{
  now => @com.cryptonator(id="com.cryptonator-25").get_price(currency="btc"^^tt:cryptocurrency_code("Bitcoin")) => notify;
}`],

    [
    ['now', '=>', '@com.cryptonator.get_price', 'param:currency:Entity(tt:cryptocurrency_code)', '=', '"', 'invalid', '"', '^^tt:cryptocurrency_code', '=>', 'notify'],
`>> Sorry, I cannot find any Cryptocurrency Code matching “invalid”.
>> context = now => @com.cryptonator.get_price param:currency:Entity(tt:cryptocurrency_code) = GENERIC_ENTITY_tt:cryptocurrency_code_0 => notify // {"GENERIC_ENTITY_tt:cryptocurrency_code_0":{"value":null,"display":"invalid"}}
>> ask special null
`,
    null],

    [
    {code: ['now', '=>', '@org.thingpedia.builtin.test.get_data', 'param:size:Measure(byte)', '=', 'NUMBER_0',
     'unit:byte', 'param:count:Number', '=', 'NUMBER_1', '=>', 'notify'],
     entities: { NUMBER_1: 25, NUMBER_0: 10 } },
`>> !!!!!!!!!!
>> """"""""""
>> ##########
>> $$$$$$$$$$
>> %%%%%%%%%%
>> button: Show more result… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> context = now => @org.thingpedia.builtin.test.get_data param:count:Number = NUMBER_0 param:size:Measure(byte) = MEASURE_byte_0 => notify // {"NUMBER_0":25,"MEASURE_byte_0":{"unit":"byte","value":10}}
>> ask special generic
`,
    {"code":["bookkeeping","special","special:more"],"entities":{}},
`>> &&&&&&&&&&
>> ''''''''''
>> ((((((((((
>> ))))))))))
>> **********
>> button: Show more result… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> context = now => @org.thingpedia.builtin.test.get_data param:count:Number = NUMBER_0 param:size:Measure(byte) = MEASURE_byte_0 => notify // {"NUMBER_0":25,"MEASURE_byte_0":{"unit":"byte","value":10}}
>> ask special generic
`,
    {"code":["bookkeeping","special","special:more"],"entities":{}},
`>> ++++++++++
>> ,,,,,,,,,,
>> ----------
>> ..........
>> //////////
>> button: Show more result… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> context = now => @org.thingpedia.builtin.test.get_data param:count:Number = NUMBER_0 param:size:Measure(byte) = MEASURE_byte_0 => notify // {"NUMBER_0":25,"MEASURE_byte_0":{"unit":"byte","value":10}}
>> ask special generic
`,
    {"code":["bookkeeping","special","special:more"],"entities":{}},
`>> 0000000000
>> 1111111111
>> 2222222222
>> 3333333333
>> 4444444444
>> button: Show more result… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> context = now => @org.thingpedia.builtin.test.get_data param:count:Number = NUMBER_0 param:size:Measure(byte) = MEASURE_byte_0 => notify // {"NUMBER_0":25,"MEASURE_byte_0":{"unit":"byte","value":10}}
>> ask special generic
`,
    {"code":["bookkeeping","special","special:more"],"entities":{}},
`>> 5555555555
>> 6666666666
>> 7777777777
>> 8888888888
>> 9999999999
>> context = now => @org.thingpedia.builtin.test.get_data param:count:Number = NUMBER_0 param:size:Measure(byte) = MEASURE_byte_0 => notify // {"NUMBER_0":25,"MEASURE_byte_0":{"unit":"byte","value":10}}
>> ask special null
`,
    `{
  now => @org.thingpedia.builtin.test(id="org.thingpedia.builtin.test-27").get_data(count=25, size=10byte) => notify;
}`],

    [
    {code: ['now', '=>', '@org.thingpedia.builtin.test.get_data', 'param:size:Measure(byte)', '=', 'NUMBER_0',
     'unit:byte', 'param:count:Number', '=', 'NUMBER_1', '=>', 'notify'],
     entities: { NUMBER_1: 25, NUMBER_0: 10 } },
`>> !!!!!!!!!!
>> """"""""""
>> ##########
>> $$$$$$$$$$
>> %%%%%%%%%%
>> button: Show more result… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> context = now => @org.thingpedia.builtin.test.get_data param:count:Number = NUMBER_0 param:size:Measure(byte) = MEASURE_byte_0 => notify // {"NUMBER_0":25,"MEASURE_byte_0":{"unit":"byte","value":10}}
>> ask special generic
`,
    {"code":["bookkeeping","special","special:nevermind"],"entities":{}},
`>> context = null // {}
>> ask special null
`,
    `{
  now => @org.thingpedia.builtin.test(id="org.thingpedia.builtin.test-28").get_data(count=25, size=10byte) => notify;
}`],

    [
    {code: ['now', '=>', '@org.thingpedia.builtin.test.get_data', 'param:size:Measure(byte)', '=', 'NUMBER_0',
     'unit:byte', 'param:count:Number', '=', 'NUMBER_1', '=>', 'notify'],
     entities: { NUMBER_1: 25, NUMBER_0: 10 } },
`>> !!!!!!!!!!
>> """"""""""
>> ##########
>> $$$$$$$$$$
>> %%%%%%%%%%
>> button: Show more result… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> context = now => @org.thingpedia.builtin.test.get_data param:count:Number = NUMBER_0 param:size:Measure(byte) = MEASURE_byte_0 => notify // {"NUMBER_0":25,"MEASURE_byte_0":{"unit":"byte","value":10}}
>> ask special generic
`,
    ['now', '=>', '@com.xkcd.get_comic', '=>', 'notify'],
`>> context = null // {}
>> ask special null
>> Sorry, I did not find any result for that.
>> context = now => @com.xkcd.get_comic => notify // {}
>> ask special null
`,
    `{
  now => @com.xkcd(id="com.xkcd-30").get_comic() => notify;
}`],

    [
    {code: ['now', '=>', '@org.thingpedia.builtin.test.get_data', 'param:size:Measure(byte)', '=', 'NUMBER_0',
     'unit:byte', 'param:count:Number', '=', 'NUMBER_1', '=>', 'notify'],
     entities: { NUMBER_1: 25, NUMBER_0: 10 } },
`>> !!!!!!!!!!
>> """"""""""
>> ##########
>> $$$$$$$$$$
>> %%%%%%%%%%
>> button: Show more result… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> context = now => @org.thingpedia.builtin.test.get_data param:count:Number = NUMBER_0 param:size:Measure(byte) = MEASURE_byte_0 => notify // {"NUMBER_0":25,"MEASURE_byte_0":{"unit":"byte","value":10}}
>> ask special generic
`,
    ['now', '=>', '@com.twitter.post'],
`>> context = null // {}
>> ask special null
>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => @com.twitter.post // {}
>> ask special choice
`,
    ['bookkeeping', 'special', 'special:nevermind'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
    `{
  now => @org.thingpedia.builtin.test(id="org.thingpedia.builtin.test-31").get_data(count=25, size=10byte) => notify;
}`],

    [
    ['now', '=>', '@com.twitter.post'],
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => @com.twitter.post // {}
>> ask special choice
`,
    ['now', '=>', '@com.xkcd.get_comic', '=>', 'notify'],
`>> context = null // {}
>> ask special null
>> Sorry, I did not find any result for that.
>> context = now => @com.xkcd.get_comic => notify // {}
>> ask special null
`,
    `{
  now => @com.xkcd(id="com.xkcd-32").get_comic() => notify;
}`],

    [(almond) => {
    almond.user.isOwner = false;
    return almond.handleParsedCommand({ code: ['now', '=>', '@com.twitter.post'], entities: {} });
},
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => @com.twitter.post // {}
>> ask special choice
`,
    ['bookkeeping', 'special', 'special:nevermind'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
null],

    [(almond) => {
    almond.user.isOwner = false;
    return almond.handleParsedCommand({ program: `now => @com.facebook.post(status="MOCK DISALLOWED PROGRAM");` });
},
`>> I'm sorry, you don't have permission to do that.
>> context = null // {}
>> ask special null
`,
null],

    [(almond) => {
    almond.user.isOwner = false;
    return almond.handleParsedCommand({ program: `now => @com.facebook.post(status=$undefined);` });
},
`>> What do you want to post?
>> context = now => @com.facebook.post // {}
>> ask special raw_string
`,
    `MOCK DISALLOWED PROGRAM`,
`>> I'm sorry, you don't have permission to do that.
>> context = null // {}
>> ask special null
`,
null],

    [(almond) => {
    almond.user.isOwner = false;
    return almond.handleParsedCommand({ program: `true : * => *;` });
},
`>> I'm sorry, you don't have permission to do that.
>> context = null // {}
>> ask special null
`,
null],

    [(almond) => {
    almond.user.isOwner = false;
    return almond.handleParsedCommand({ program: `executor = "bob"^^tt:username : now => @com.facebook.post(status=$undefined);` });
},
`>> I'm sorry, you don't have permission to do that.
>> context = null // {}
>> ask special null
`,
null],

    [(almond) => {
    almond._options.anonymous = true;
    return almond.handleParsedCommand({ program: `now => @com.facebook.post(status=$undefined);` });
},
`>> Sorry, to execute this command you must log in to your personal account.
>> link: Register for Almond /user/register
>> context = null // {}
>> ask special null
`,
null],

    [(almond) => {
    almond._options.anonymous = true;
    return almond.handleParsedCommand({ program: `monitor @com.xkcd.get_comic() => notify;` });
},
`>> Sorry, to execute this command you must log in to your personal account.
>> link: Register for Almond /user/register
>> context = null // {}
>> ask special null
`,
null],

    [(almond) => {
    almond._options.anonymous = true;
    return almond.handleParsedCommand({ program: `true : * => *;` });
},
`>> Sorry, to allow access to your devices you must log in to your personal account.
>> link: Register for Almond /user/register
>> context = null // {}
>> ask special null
`,
null],

    [(almond) => {
    almond._options.anonymous = true;
    return almond.handleParsedCommand({ program: `executor = "bob"^^tt:username : now => @com.facebook.post(status=$undefined);` });
},
`>> Sorry, to execute this command you must log in to your personal account.
>> link: Register for Almond /user/register
>> context = null // {}
>> ask special null
`,
null],


    [
    (almond) => {
        return almond.handleThingTalk(`executor = "ABCDEFG"^^tt:username : now => @com.gmail.inbox() => return;`, {
            contacts: [
            { value: 'ABCDEFG', principal: 'mock-account:123456789', display: "@slack_user_name" }
            ]
        });
    },
    `>> Okay, I'm going to tell @slack_user_name: get the emails in your GMail inbox and then send it to me.
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.gmail.inbox => return // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:123456789","display":"@slack_user_name"}}
>> ask special null
`,
    `executor = "mock-account:123456789"^^tt:contact("@slack_user_name") : {
  now => @com.gmail.inbox() => return;
}`],

    [
    (almond) => {
        return almond.handleThingTalk(`executor = "ABCDEFG"^^tt:username : now => @com.gmail.inbox() => return;`, {
            contacts: [
            { value: 'ABCDEFG', principal: 'email:dummy@example.com', display: "@slack_user_name" }
            ]
        });
    },
    `>> Okay, I'm going to tell @slack_user_name: get the emails in your GMail inbox and then send it to me.
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.gmail.inbox => return // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-email:dummy@example.com","display":"@slack_user_name"}}
>> ask special null
`,
    `executor = "mock-account:MOCK1234-email:dummy@example.com"^^tt:contact("@slack_user_name") : {
  now => @com.gmail.inbox() => return;
}`],

    [
    (almond) => {
        return almond.handleThingTalk(`executor = "ABCDEFG"^^tt:username : now => @com.gmail.inbox() => return;`, {
            contacts: [
            { value: 'GFEDCBA', principal: 'mock-account:123456789', display: "@slack_user_name" }
            ]
        });
    },
    `>> Multiple contacts match “ABCDEFG”. Who do you mean?
>> choice 0: Alice Smith (mom)
>> choice 1: Bob Smith (dad)
>> context = executor = USERNAME_0 : now => @com.gmail.inbox => return // {"USERNAME_0":"ABCDEFG"}
>> ask special choice
`,
    ['bookkeeping', 'special', 'special:nevermind'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
    null],

    [
    (almond) => {
        return almond.handleThingTalk(`executor = "mock-account:123456789"^^tt:contact : now => @com.gmail.inbox() => return;`, {
            contacts: [
            { value: 'ABCDEFG', principal: 'mock-account:123456789', display: "@slack_user_name" }
            ]
        });
    },
    `>> Okay, I'm going to tell @slack_user_name: get the emails in your GMail inbox and then send it to me.
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.gmail.inbox => return // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:123456789","display":"@slack_user_name"}}
>> ask special null
`,
    `executor = "mock-account:123456789"^^tt:contact("@slack_user_name") : {
  now => @com.gmail.inbox() => return;
}`],

    [
    (almond) => {
        return almond.handleThingTalk(`executor = "mock-account:123456789"^^tt:contact : now => @com.gmail.inbox() => return;`, {
            contacts: [
            { value: 'ABCDEFG', principal: 'mock-account:987654321', display: "@slack_user_name" }
            ]
        });
    },
    `>> Okay, I'm going to tell Some Guy: get the emails in your GMail inbox and then send it to me.
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.gmail.inbox => return // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:123456789","display":"Some Guy"}}
>> ask special null
`,
    `executor = "mock-account:123456789"^^tt:contact("Some Guy") : {
  now => @com.gmail.inbox() => return;
}`],

    [
    { code: ['executor', '=', 'USERNAME_0', ':', 'now', '=>', '@com.bing.web_search', '=>', 'notify'],
      entities: { USERNAME_0: 'mom' } },
`>> What do you want to search?
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.bing.web_search => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-phone:+5556664357","display":"Alice Smith (mom)"}}
>> ask special raw_string
`,
    `some tweet`,
`>> Okay, so you want me to tell Alice Smith (mom): get websites matching “some tweet” on Bing and then notify you. Is that right?
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.bing.web_search param:query:String = QUOTED_STRING_0 => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-phone:+5556664357","display":"Alice Smith (mom)"},"QUOTED_STRING_0":"some tweet"}
>> ask special yesno
`,

    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> context = executor = GENERIC_ENTITY_tt:contact_0 : now => @com.bing.web_search param:query:String = QUOTED_STRING_0 => notify // {"GENERIC_ENTITY_tt:contact_0":{"value":"mock-account:MOCK1234-phone:+5556664357","display":"Alice Smith (mom)"},"QUOTED_STRING_0":"some tweet"}
>> ask special null
`,
    `executor = "mock-account:MOCK1234-phone:+5556664357"^^tt:contact("Alice Smith (mom)") : {
  now => @com.bing.web_search(query="some tweet") => notify;
}`],

    [(almond) => {
    almond._engine.permissions = null;
    almond._engine.remote = null;
    return almond.handleParsedCommand({ program: `true : @com.xkcd.get_comic => notify;` });
},
`>> Sorry, this version of Almond does not support adding permissions.
>> context = null // {}
>> ask special null
`,
    null
    ],

    [{program: `executor = "bob"^^tt:username : now => @com.xkcd.get_comic() => notify;` },
`>> Sorry, this version of Almond does not support asking other users for permission.
>> context = null // {}
>> ask special null
`,
    null
    ],

    [{program: `now => @com.xkcd.get_comic() => notify;` },
`>> Sorry, I did not find any result for that.
>> context = now => @com.xkcd.get_comic => notify // {}
>> ask special null
`,
`{
  now => @com.xkcd(id="com.xkcd-34").get_comic() => notify;
}`
    ],

    ['\\t now => @com.xkcd.get_comic() => notify;',
`>> Sorry, I did not find any result for that.
>> context = now => @com.xkcd.get_comic => notify // {}
>> ask special null
`,
`{
  now => @com.xkcd(id="com.xkcd-35").get_comic() => notify;
}`],

    [(almond) => {
    // avoid polluting the logs
    almond.platform.getSharedPreferences().set('sabrina-store-log', 'no');
    return almond.handleCommand('get an xkcd comic');
    },
`>> Sorry, I did not find any result for that.
>> context = now => @com.xkcd.get_comic => notify // {}
>> ask special null
`,
`{
  now => @com.xkcd(id="com.xkcd-36").get_comic() => notify;
}`],

    [`tweet my instagram pictures`,
`>> Sorry, I did not understand that. You might need to enable a new skill before I understand that command.
>> link: Configure a new skill /devices/create
>> context = monitor ( @com.instagram.get_pictures ) => @com.twitter.post_picture on param:picture_url:Entity(tt:picture) = param:picture_url:Entity(tt:picture) // {}
>> ask special null
`,
    null],

    [`get an xkcd comic`,
`>> Sorry, I did not find any result for that.
>> context = now => @com.xkcd.get_comic => notify // {}
>> ask special null
`,
    ['bookkeeping', 'special', 'special:train'],
`>> context = null // {}
>> ask special null
>> Did you mean get an Xkcd comic and then notify you?
>> context = null // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Thanks, I made a note of that.
>> You have trained me with 1 sentence.
>> context = null // {}
>> ask special null
`,
    `{
  now => @com.xkcd(id="com.xkcd-37").get_comic() => notify;
}`],

    [`get an xkcd comic`,
`>> Sorry, I did not find any result for that.
>> context = now => @com.xkcd.get_comic => notify // {}
>> ask special null
`,
    ['bookkeeping', 'special', 'special:train'],
`>> context = null // {}
>> ask special null
>> Did you mean get an Xkcd comic and then notify you?
>> context = null // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:no'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
    `{
  now => @com.xkcd(id="com.xkcd-38").get_comic() => notify;
}`],

    // this is a special command that always fails to parse
    // we use it to test the fallback paths
    /*[`!! test command always failed !!`,
`>> Sorry, I did not understand that. Try the following instead:
>> button: eat test data {"example_id":1,"code":["now","=>","@org.thingpedia.builtin.test.eat_data"],"entities":{},"slotTypes":{},"slots":[]}
>> button: get test data {"example_id":2,"code":["now","=>","@org.thingpedia.builtin.test.get_data","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: get $p_size test data {"example_id":3,"code":["now","=>","@org.thingpedia.builtin.test.get_data","param:size:Measure(byte)","=","SLOT_0","=>","notify"],"entities":{},"slotTypes":{"p_size":"Measure(byte)"},"slots":["p_size"]}
>> context = null // {}
>> ask special null
`,
    null],*/

    [`!! test command always nothing !!`,
`>> Sorry, I did not understand that. Use ‘help’ to learn what I can do for you.
>> context = null // {}
>> ask special null
`,
    null],

    [`!! test command multiple results !!`,
`>> Okay, so you want me to tweet ____. Is that right?
>> context = now => @com.twitter.post // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:train'],
`>> context = null // {}
>> ask special null
>> Did you mean any of the following?
>> choice 0: tweet ____
>> choice 1: tweet “multiple results”
>> choice 2: post ____ on Facebook
>> choice 3: none of the above
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'special', 'special:no'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
    null],

    [`!! test command multiple results !!`,
`>> Okay, so you want me to tweet ____. Is that right?
>> context = now => @com.twitter.post // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:train'],
`>> context = null // {}
>> ask special null
>> Did you mean any of the following?
>> choice 0: tweet ____
>> choice 1: tweet “multiple results”
>> choice 2: post ____ on Facebook
>> choice 3: none of the above
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', '1'],
`>> Thanks, I made a note of that.
>> You have trained me with 2 sentences.
>> context = null // {}
>> ask special null
`,
    null],

    [`!! test command multiple results !!`,
`>> Okay, so you want me to tweet ____. Is that right?
>> context = now => @com.twitter.post // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:train'],
`>> context = null // {}
>> ask special null
>> Did you mean any of the following?
>> choice 0: tweet ____
>> choice 1: tweet “multiple results”
>> choice 2: post ____ on Facebook
>> choice 3: none of the above
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', '3'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
    null],

    [`!! test command host unreach !!`,
`>> Sorry, I cannot contact the Almond service. Please check your Internet connection and try again later.
`,
    null],

    [`\\t now => @org.thingpedia.test.timedout.action();`,
`>> Sorry, I cannot contact the Almond service. Please check your Internet connection and try again later.
`,
    null],

    [`\\t now => @org.thingpedia.builtin.thingengine.builtin.configure(device="com.instagram"^^tt:device);`,
`>> Okay, I'm going to configure a new Instagram.
>> context = now => @org.thingpedia.builtin.thingengine.builtin.configure param:device:Entity(tt:device) = device:com.instagram // {}
>> ask special null
`,
    `{
  now => @org.thingpedia.builtin.thingengine.builtin(id="thingengine-own-global").configure(device="com.instagram"^^tt:device("Instagram"));
}`],

    [`\\t now => @org.thingpedia.builtin.thingengine.builtin.configure(device="com.tumblr.blog"^^tt:device);`,
`>> Okay, I'm going to configure a new Tumblr Blog.
>> context = now => @org.thingpedia.builtin.thingengine.builtin.configure param:device:Entity(tt:device) = device:com.tumblr.blog // {}
>> ask special null
`,
    `{
  now => @org.thingpedia.builtin.thingengine.builtin(id="thingengine-own-global").configure(device="com.tumblr.blog"^^tt:device("Tumblr Blog"));
}`],

    [
    ['now', '=>', '@com.bodytrace.scale.get', '=>', 'notify'],
`>> Sorry, I don't know how to do that yet.
>> context = null // {}
>> ask special null
`,
    null],

    // the first result is bodytrace, the second is fitbit
    // both come from the parse (score !== Infinity) and so we only
    // consider the first, and report unsupported
    [
    `get the weight from my scale`,
`>> Sorry, I don't know how to do that yet.
>> context = null // {}
>> ask special null
`,
    null],

    // the first result is test.newyorktimes, the second is com.nytimes
    // the first result comes from the exact matcher and is skipped
    // so we run the second result
    [
    `get new york times`,
`>> Okay, so you want me to get New York Times articles and then notify you. Is that right?
>> context = now => @com.nytimes.get_front_page => notify // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Sorry, I did not find any result for that.
>> context = now => @com.nytimes.get_front_page => notify // {}
>> ask special null
`,
    `{
  now => @com.nytimes(id="com.nytimes-39").get_front_page() => notify;
}`],

    [
    `!! test command all unsupported !!`,
`>> Sorry, I don't know how to do that yet.
>> context = null // {}
>> ask special null
`,
    null],

    [
    `!! test command all unsupported 2 !!`,
`>> Sorry, I don't know how to do that yet.
>> context = null // {}
>> ask special null
`,
    null],

    [
    ['bookkeeping', 'special', 'special:help'],
`>> Pick one from the following categories or simply type in.
>> button: Media (news, comics, meme, etc) {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks (facebook, twitter, etc) {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home (camera, tv, etc) {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication (phone, email, messenger, etc) {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services (weather, calendar, todo list, etc) {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management (cloud drives) {"code":["bookkeeping","category","data-management"],"entities":{}}
>> context = null // {}
>> ask special command
`,
    ['now', '=>', '@com.twitter.post'],
`>> Your command is: tweet ____. You can add more filters or run your command if you are ready.
>> choice 0: Choose a different command
>> choice 1: Run it
>> context = null // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 1],
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => @com.twitter.post // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 1],
`>> What do you want to tweet?
>> context = now => @com.twitter.post // {}
>> ask special raw_string
`,
    '!! test command always nothing !!',
`>> Okay, so you want me to tweet “!! test command always nothing !!”. Is that right?
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"!! test command always nothing !!"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"!! test command always nothing !!"}
>> ask special null
`,
    `{
  now => @com.twitter(id="twitter-bar").post(status="!! test command always nothing !!");
}`],

    // confirmation: confident, no slot, query
    [
    `\\t now => @com.bing.web_search(query="hello") => notify;`,
    `>> Sorry, I did not find any result for that.
>> context = now => @com.bing.web_search param:query:String = QUOTED_STRING_0 => notify // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
    `{\n  now => @com.bing(id="com.bing").web_search(query="hello") => notify;\n}`
    ],

    // confirmation: confident, has slot, query
    [
    `\\t now => @com.bing.web_search() => notify;`,
    `>> What do you want to search?
>> context = now => @com.bing.web_search => notify // {}
>> ask special raw_string
`,
    `hello`,
    `>> Sorry, I did not find any result for that.
>> context = now => @com.bing.web_search param:query:String = QUOTED_STRING_0 => notify // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
    `{\n  now => @com.bing(id="com.bing").web_search(query="hello") => notify;\n}`
    ],

    // confirmation: confident, no slot, safe action
    [
    `\\t now => @com.spotify.play_song(toPlay = "hello");`,
    `>> Okay, I'm going to play a song with to play equal to “hello”.
>> context = now => @com.spotify.play_song param:toPlay:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
    `{\n  now => @com.spotify(id="com.spotify-40").play_song(toPlay="hello");\n}`
    ],


    // confirmation: confident, has slot, safe action
    [
    `\\t now => @com.spotify.play_song();`,
    `>> What song would you like to play?
>> context = now => @com.spotify.play_song // {}
>> ask special raw_string
`,
    `hello`,
    `>> Okay, I'm going to play a song with to play equal to “hello”.
>> context = now => @com.spotify.play_song param:toPlay:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
    `{\n  now => @com.spotify(id="com.spotify-41").play_song(toPlay="hello");\n}`
    ],

    // confirmation: confident, no slot, general
    [
        `\\t now => @com.twitter.post(status="hello");`,
        `>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
    `>> Okay, I'm going to tweet “hello”.
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
        `{\n  now => @com.twitter(id="twitter-foo").post(status="hello");\n}`
    ],


    // confirmation: confident, has slot, general
    [
        `\\t now => @com.twitter.post();`,
        `>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => @com.twitter.post // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
    `>> What do you want to tweet?
>> context = now => @com.twitter.post // {}
>> ask special raw_string
`,
    `hello`,
    `>> Okay, so you want me to tweet “hello”. Is that right?
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
    `>> Consider it done.
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
    `{\n  now => @com.twitter(id="twitter-foo").post(status="hello");\n}`
    ],

    // confirmation: not confident, no slot, query
    [
    `search hello on bing`,
    `>> Okay, so you want me to get websites matching “hello” on Bing and then notify you. Is that right?
>> context = now => @com.bing.web_search param:query:String = QUOTED_STRING_0 => notify // {"QUOTED_STRING_0":"hello"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
    `>> Sorry, I did not find any result for that.
>> context = now => @com.bing.web_search param:query:String = QUOTED_STRING_0 => notify // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
        `{\n  now => @com.bing(id="com.bing").web_search(query="hello") => notify;\n}`
    ],

    // confirmation: not confident, has slot, query
    [
    `search on bing`,
    `>> Okay, so you want me to get websites matching ____ on Bing and then notify you. Is that right?
>> context = now => @com.bing.web_search => notify // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
    `>> What do you want to search?
>> context = now => @com.bing.web_search => notify // {}
>> ask special raw_string
`,
    `hello`,
    `>> Sorry, I did not find any result for that.
>> context = now => @com.bing.web_search param:query:String = QUOTED_STRING_0 => notify // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
        `{\n  now => @com.bing(id="com.bing").web_search(query="hello") => notify;\n}`
    ],

    // confirmation: not confident, has slot in filter, query
    [
    `search hello on bing with title filter`,
    `>> Okay, so you want me to get websites matching “hello” on Bing if the title contains ____ and then notify you. Is that right?
>> context = now => ( @com.bing.web_search param:query:String = QUOTED_STRING_0 ) filter param:title:String =~ undefined => notify // {"QUOTED_STRING_0":"hello"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
    `>> What should the title contain?
>> choice 0: Use the description from Bing
>> choice 1: None of above
>> context = now => ( @com.bing.web_search param:query:String = QUOTED_STRING_0 ) filter param:title:String =~ undefined => notify // {"QUOTED_STRING_0":"hello"}
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],
    `>> Sorry, I did not find any result for that.
>> context = now => ( @com.bing.web_search param:query:String = QUOTED_STRING_0 ) filter param:title:String =~ param:description:String => notify // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
    `{\n  now => (@com.bing(id="com.bing").web_search(query="hello")), title =~ description => notify;\n}`
    ],

    // confirmation: not confident, no slot, safe action
    [
    `play hello`,
    `>> Okay, so you want me to play a song with to play equal to “hello”. Is that right?
>> context = now => @com.spotify.play_song param:toPlay:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
    `>> Okay, I'm going to play a song with to play equal to “hello”.
>> context = now => @com.spotify.play_song param:toPlay:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
    `{\n  now => @com.spotify(id="com.spotify-42").play_song(toPlay="hello");\n}`
    ],


    // confirmation: not confident, has slot, safe action
    [
    `play a song`,
    `>> Okay, so you want me to play a song. Is that right?
>> context = now => @com.spotify.play_song // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
    `>> What song would you like to play?
>> context = now => @com.spotify.play_song // {}
>> ask special raw_string
`,
    `hello`,
    `>> Okay, I'm going to play a song with to play equal to “hello”.
>> context = now => @com.spotify.play_song param:toPlay:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
    `{\n  now => @com.spotify(id="com.spotify-43").play_song(toPlay="hello");\n}`
    ],

    // confirmation: not confident, no slot, general
    [
    `tweet hello`,
    `>> Okay, so you want me to tweet “hello”. Is that right?
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
    `>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
    `>> Consider it done.
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
    `{\n  now => @com.twitter(id="twitter-foo").post(status="hello");\n}`
    ],


    // confirmation: not confident, has slot, general
    [
    `tweet`,
    `>> Okay, so you want me to tweet ____. Is that right?
>> context = now => @com.twitter.post // {}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
    `>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => @com.twitter.post // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
    `>> What do you want to tweet?
>> context = now => @com.twitter.post // {}
>> ask special raw_string
`,
    `hello`,
    `>> Okay, so you want me to tweet “hello”. Is that right?
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
    `>> Consider it done.
>> context = now => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"QUOTED_STRING_0":"hello"}
>> ask special null
`,
        `{\n  now => @com.twitter(id="twitter-foo").post(status="hello");\n}`
    ],

    // contextual help
    [
        '\\t now => @org.thingpedia.builtin.thingengine.builtin.get_random_between(high=6) => notify;',
`>> What should be the lower bound?
>> context = now => @org.thingpedia.builtin.thingengine.builtin.get_random_between param:high:Number = NUMBER_0 => notify // {"NUMBER_0":6}
>> ask special number
`,
['bookkeeping', 'special', 'special:help'],
`>> Could you give me a number?
>> context = now => @org.thingpedia.builtin.thingengine.builtin.get_random_between param:high:Number = NUMBER_0 => notify // {"NUMBER_0":6}
>> ask special number
`,
        ['bookkeeping', 'answer', '0'],
`>> Sorry, I did not find any result for that.
>> context = now => @org.thingpedia.builtin.thingengine.builtin.get_random_between param:high:Number = NUMBER_0 param:low:Number = 0 => notify // {"NUMBER_0":6}
>> ask special null
`,
        `{
  now => @org.thingpedia.builtin.thingengine.builtin(id="thingengine-own-global").get_random_between(high=6, low=0) => notify;
}`
    ],

    // stop / nevermind
    [
    `\\t now => @com.facebook.post();`,
`>> What do you want to post?
>> context = now => @com.facebook.post // {}
>> ask special raw_string
`,
    ['bookkeeping', 'special', 'special:nevermind'],
`>> Sorry I couldn't help on that.
>> context = null // {}
>> ask special null
`,
    null
    ],

    [
    `\\t now => @com.facebook.post();`,
`>> What do you want to post?
>> context = now => @com.facebook.post // {}
>> ask special raw_string
`,
    ['bookkeeping', 'special', 'special:stop'],
`>> context = null // {}
>> ask special null
`,
    null
    ],

    [['now', '=>', '@org.thingpedia.weather.current', '=>', 'notify'],
`>> What location do you want the current weather for?
>> context = now => @org.thingpedia.weather.current => notify // {}
>> ask special location
`,

    { code: ['bookkeeping', 'answer', 'LOCATION_0'], entities: {"LOCATION_0": {longitude:0, latitude:-90, display:"South pole"}}},
`>> Current weather for South pole: sunny, temperature 22.0 C, wind speed 0.0 m/s, humidity 75%, cloudiness 0%, fog 0%.
>> MapFO Location: [Latitude: -90.000 deg, Longitude: 0.000 deg]
>> context = now => @org.thingpedia.weather.current param:location:Location = LOCATION_0 => notify // {"LOCATION_0":{"latitude":-90,"longitude":0,"display":"South pole"}}
>> ask special null
`,

    `{
  now => @org.thingpedia.weather(id="org.thingpedia.weather-46").current(location=makeLocation(-90, 0, "South pole")) => notify;
}`],

    [['now', '=>', '@org.thingpedia.weather.current', 'param:location:Location', '=', 'location:', '"', 'seattle', '"', '=>', 'notify'],
`>> Sorry, I did not find any result for that.
>> context = now => @org.thingpedia.weather.current param:location:Location = LOCATION_0 => notify // {"LOCATION_0":{"latitude":47.6038321,"longitude":-122.3300624,"display":"Seattle, King County, Washington, USA"}}
>> ask special null
`,

    `{
  now => @org.thingpedia.weather(id="org.thingpedia.weather-47").current(location=makeLocation(47.6038321, -122.3300624, "Seattle, King County, Washington, USA")) => notify;
}`],

    [['now', '=>', '@org.thingpedia.weather.current', '=>', 'notify'],
`>> What location do you want the current weather for?
>> context = now => @org.thingpedia.weather.current => notify // {}
>> ask special location
`,

    { code: ['bookkeeping', 'answer', 'location:', '"', 'seattle', '"',], entities: {}},
`>> Sorry, I did not find any result for that.
>> context = now => @org.thingpedia.weather.current param:location:Location = LOCATION_0 => notify // {"LOCATION_0":{"latitude":47.6038321,"longitude":-122.3300624,"display":"Seattle, King County, Washington, USA"}}
>> ask special null
`,

    `{
  now => @org.thingpedia.weather(id="org.thingpedia.weather-48").current(location=makeLocation(47.6038321, -122.3300624, "Seattle, King County, Washington, USA")) => notify;
}`],

    [['now', '=>', '@org.thingpedia.weather.current', 'param:location:Location', '=', 'location:', '"', 'invalid', '"', '=>', 'notify'],
`>> Sorry, I cannot find any location matching “invalid”.
>> context = now => @org.thingpedia.weather.current param:location:Location = LOCATION_0 => notify // {"LOCATION_0":{"latitude":null,"longitude":null,"display":"invalid"}}
>> ask special null
`,

    null],

    ['\\t attimer(time=$?) => @com.twitter.post();',
`>> When do you want your command to run?
>> context = attimer time = undefined => @com.twitter.post // {}
>> ask special time
`,
    { code: ['bookkeeping', 'answer', 'TIME_0',], entities: { TIME_0: { hour: 7, minute: 30 }}},
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = attimer time = TIME_0 => @com.twitter.post // {"TIME_0":{"hour":7,"minute":30,"second":0}}
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],
`>> What do you want to tweet?
>> context = attimer time = TIME_0 => @com.twitter.post // {"TIME_0":{"hour":7,"minute":30,"second":0}}
>> ask special raw_string
`,
    `good morning`,
`>> Okay, so you want me to tweet “good morning” every day at 7:30 AM. Is that right?
>> context = attimer time = TIME_0 => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"TIME_0":{"hour":7,"minute":30,"second":0},"QUOTED_STRING_0":"good morning"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> context = attimer time = TIME_0 => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"TIME_0":{"hour":7,"minute":30,"second":0},"QUOTED_STRING_0":"good morning"}
>> ask special null
`,

    `{
  attimer(time=makeTime(7, 30)) => @com.twitter(id="twitter-foo").post(status="good morning");
}`],

    ['\\t attimer(time=[$?, $?]) => @com.twitter.post();',
`>> What is the first time you would like your command to run?
>> context = attimer time = [ undefined , undefined ] => @com.twitter.post // {}
>> ask special time
`,
    { code: ['bookkeeping', 'answer', 'TIME_0',], entities: { TIME_0: { hour: 7, minute: 30 }}},
`>> What is the second time you would like your command to run?
>> context = attimer time = [ TIME_0 , undefined ] => @com.twitter.post // {"TIME_0":{"hour":7,"minute":30,"second":0}}
>> ask special time
`,
    { code: ['bookkeeping', 'answer', 'TIME_1',], entities: { TIME_0:{ hour: 7, minute: 30, second: 0 }, TIME_1: { hour: 8, minute: 30 } }},
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = attimer time = [ TIME_0 , TIME_1 ] => @com.twitter.post // {"TIME_0":{"hour":7,"minute":30,"second":0},"TIME_1":{"hour":8,"minute":30,"second":0}}
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],
`>> What do you want to tweet?
>> context = attimer time = [ TIME_0 , TIME_1 ] => @com.twitter.post // {"TIME_0":{"hour":7,"minute":30,"second":0},"TIME_1":{"hour":8,"minute":30,"second":0}}
>> ask special raw_string
`,
    `good morning`,
`>> Okay, so you want me to tweet “good morning” every day at 7:30 AM and 8:30 AM. Is that right?
>> context = attimer time = [ TIME_0 , TIME_1 ] => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"TIME_0":{"hour":7,"minute":30,"second":0},"TIME_1":{"hour":8,"minute":30,"second":0},"QUOTED_STRING_0":"good morning"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> context = attimer time = [ TIME_0 , TIME_1 ] => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"TIME_0":{"hour":7,"minute":30,"second":0},"TIME_1":{"hour":8,"minute":30,"second":0},"QUOTED_STRING_0":"good morning"}
>> ask special null
`,

    `{
  attimer(time=[makeTime(7, 30), makeTime(8, 30)]) => @com.twitter(id="twitter-foo").post(status="good morning");
}`],

    ['\\t attimer(time=[$?, $?], expiration_date=$?) => @com.twitter.post();',
`>> What is the first time you would like your command to run?
>> context = attimer time = [ undefined , undefined ] expiration_date = undefined => @com.twitter.post // {}
>> ask special time
`,
    { code: ['bookkeeping', 'answer', 'TIME_0',], entities: { TIME_0: { hour: 7, minute: 30 }}},
`>> What is the second time you would like your command to run?
>> context = attimer time = [ TIME_0 , undefined ] expiration_date = undefined => @com.twitter.post // {"TIME_0":{"hour":7,"minute":30,"second":0}}
>> ask special time
`,
    { code: ['bookkeeping', 'answer', 'TIME_1',], entities: { TIME_0:{ hour: 7, minute: 30, second: 0 }, TIME_1: { hour: 8, minute: 30 } }},
`>> When should your command stop?
>> context = attimer time = [ TIME_0 , TIME_1 ] expiration_date = undefined => @com.twitter.post // {"TIME_0":{"hour":7,"minute":30,"second":0},"TIME_1":{"hour":8,"minute":30,"second":0}}
>> ask special date
`,
    { code: ['bookkeeping', 'answer', 'end_of', 'unit:week'], entities: {}},
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = attimer time = [ TIME_0 , TIME_1 ] expiration_date = end_of unit:week => @com.twitter.post // {"TIME_0":{"hour":7,"minute":30,"second":0},"TIME_1":{"hour":8,"minute":30,"second":0}}
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],
`>> What do you want to tweet?
>> context = attimer time = [ TIME_0 , TIME_1 ] expiration_date = end_of unit:week => @com.twitter.post // {"TIME_0":{"hour":7,"minute":30,"second":0},"TIME_1":{"hour":8,"minute":30,"second":0}}
>> ask special raw_string
`,
    `good morning`,
`>> Okay, so you want me to tweet “good morning” every day at 7:30 AM and 8:30 AM until the end of this week. Is that right?
>> context = attimer time = [ TIME_0 , TIME_1 ] expiration_date = end_of unit:week => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"TIME_0":{"hour":7,"minute":30,"second":0},"TIME_1":{"hour":8,"minute":30,"second":0},"QUOTED_STRING_0":"good morning"}
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> context = attimer time = [ TIME_0 , TIME_1 ] expiration_date = end_of unit:week => @com.twitter.post param:status:String = QUOTED_STRING_0 // {"TIME_0":{"hour":7,"minute":30,"second":0},"TIME_1":{"hour":8,"minute":30,"second":0},"QUOTED_STRING_0":"good morning"}
>> ask special null
`,

    `{
  attimer(time=[makeTime(7, 30), makeTime(8, 30)], expiration_date=end_of(week)) => @com.twitter(id="twitter-foo").post(status="good morning");
}`],

    ['\\t now => @com.twitter.search(), hashtags == [$?,$?] => notify;',
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> context = now => ( @com.twitter.search ) filter param:hashtags:Array(Entity(tt:hashtag)) == [ undefined , undefined ] => notify // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],
`>> What would you like the first hashtags to be?
>> context = now => ( @com.twitter.search ) filter param:hashtags:Array(Entity(tt:hashtag)) == [ undefined , undefined ] => notify // {}
>> ask special raw_string
`,
    ['bookkeeping', 'answer', '"', 'foo', '"', '^^tt:hashtag'],
`>> What would you like the second hashtags to be?
>> context = now => ( @com.twitter.search ) filter param:hashtags:Array(Entity(tt:hashtag)) == [ HASHTAG_0 , undefined ] => notify // {"HASHTAG_0":"foo"}
>> ask special raw_string
`,
    ['bookkeeping', 'answer', '"', 'bar', '"', '^^tt:hashtag'],
`>> Sorry, I did not find any result for that.
>> context = now => ( @com.twitter.search ) filter param:hashtags:Array(Entity(tt:hashtag)) == [ HASHTAG_0 , HASHTAG_1 ] => notify // {"HASHTAG_0":"foo","HASHTAG_1":"bar"}
>> ask special null
`,
    `{
  now => (@com.twitter(id="twitter-foo").search()), hashtags == ["foo"^^tt:hashtag, "bar"^^tt:hashtag] => notify;
}`],

    [
    ['now', '=>', '@com.cryptonator.get_price', '=>', 'notify'],
`>> What crypto currency do you want to check?
>> context = now => @com.cryptonator.get_price => notify // {}
>> ask special raw_string
`,
    `bitcoin`,
`>> Sorry, I did not find any result for that.
>> context = now => @com.cryptonator.get_price param:currency:Entity(tt:cryptocurrency_code) = GENERIC_ENTITY_tt:cryptocurrency_code_0 => notify // {"GENERIC_ENTITY_tt:cryptocurrency_code_0":{"value":"btc","display":"Bitcoin"}}
>> ask special null
`,
    `{
  now => @com.cryptonator(id="com.cryptonator-50").get_price(currency="btc"^^tt:cryptocurrency_code("Bitcoin")) => notify;
}`],

    [
    ['now', '=>', '@com.cryptonator.get_price', '=>', 'notify'],
`>> What crypto currency do you want to check?
>> context = now => @com.cryptonator.get_price => notify // {}
>> ask special raw_string
`,
    `invalid`,
`>> Sorry, I cannot find any Cryptocurrency Code matching “invalid”.
>> context = now => @com.cryptonator.get_price => notify // {}
>> ask special null
`,
    null],

    [
    {program: `now => @light-bulb.set_power(power=enum(on));`},
    `>> You have multiple Light Bulb devices. Which one do you want to use?
>> choice 0: Bed Light 1
>> choice 1: Bed Light 2
>> choice 2: Kitchen Lights
>> choice 3: Ceiling Lights
>> context = now => @light-bulb.set_power param:power:Enum(on,off) = enum:on // {}
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],
`>> Okay, I'm going to turn on your Bed Light 1.
>> context = now => @light-bulb.set_power param:power:Enum(on,off) = enum:on // {}
>> ask special null
`,
    `{
  now => @light-bulb(id="light-bulb-bed1").set_power(power=enum(on));
}`,
    ],

    [
    {program: `now => @light-bulb(all=true).set_power(power=enum(on));`},
    `>> Okay, I'm going to turn on all your light bulb.
>> context = now => @light-bulb.set_power attribute:all:Boolean = true param:power:Enum(on,off) = enum:on // {}
>> ask special null
`,
    `{
  now => @light-bulb(all=true).set_power(power=enum(on));
}`,
    ],

    [
    {program: `now => @light-bulb(name="kitchen").set_power(power=enum(on));`},
    `>> Okay, I'm going to turn on your Kitchen Lights.
>> context = now => @light-bulb.set_power attribute:name:String = QUOTED_STRING_0 param:power:Enum(on,off) = enum:on // {"QUOTED_STRING_0":"kitchen"}
>> ask special null
`,
    `{
  now => @light-bulb(id="light-bulb-kitchen", name="kitchen").set_power(power=enum(on));
}`,
    ],

    [
    {program: `now => @light-bulb(name="bed").set_power(power=enum(on));`},
    `>> You have multiple “bed” Light Bulb devices. Which one do you want to use?
>> choice 0: Bed Light 1
>> choice 1: Bed Light 2
>> context = now => @light-bulb.set_power attribute:name:String = QUOTED_STRING_0 param:power:Enum(on,off) = enum:on // {"QUOTED_STRING_0":"bed"}
>> ask special choice
`,
    ['bookkeeping', 'choice', '1'],
`>> Okay, I'm going to turn on your Bed Light 2.
>> context = now => @light-bulb.set_power attribute:name:String = QUOTED_STRING_0 param:power:Enum(on,off) = enum:on // {"QUOTED_STRING_0":"bed"}
>> ask special null
`,
    `{
  now => @light-bulb(id="light-bulb-bed2", name="bed").set_power(power=enum(on));
}`,
    ],

    [
    {program: `now => @light-bulb(name="bed", all=true).set_power(power=enum(on));`},
    `>> Okay, I'm going to turn on all your “bed” light bulb.
>> context = now => @light-bulb.set_power attribute:all:Boolean = true attribute:name:String = QUOTED_STRING_0 param:power:Enum(on,off) = enum:on // {"QUOTED_STRING_0":"bed"}
>> ask special null
`,
    `{
  now => @light-bulb(all=true, name="bed").set_power(power=enum(on));
}`,
    ],

    [
    {program: `now => @light-bulb(name="invalid").set_power(power=enum(on));`},
    `>> I cannot find any “invalid” device. Which Light Bulb do you want to use?
>> choice 0: Bed Light 1
>> choice 1: Bed Light 2
>> choice 2: Kitchen Lights
>> choice 3: Ceiling Lights
>> context = now => @light-bulb.set_power attribute:name:String = QUOTED_STRING_0 param:power:Enum(on,off) = enum:on // {"QUOTED_STRING_0":"invalid"}
>> ask special choice
`,
    ['bookkeeping', 'choice', '1'],
`>> Okay, I'm going to turn on your Bed Light 2.
>> context = now => @light-bulb.set_power param:power:Enum(on,off) = enum:on // {}
>> ask special null
`,
    `{
  now => @light-bulb(id="light-bulb-bed2").set_power(power=enum(on));
}`,
    ],
];

function handleCommand(almond, input) {
    if (input.startsWith('\\t'))
        return almond.handleThingTalk(input.substring(2));
    else
        return almond.handleCommand(input);
}

function roundtrip(input, output) {
    flushBuffer();
    return Promise.resolve().then(() => {
        //console.log('roundtrip begin', input);
        if (typeof input === 'string') {
            //console.log('$ ' + input);
            return handleCommand(almond, input);
        } else if (Array.isArray(input)) {
            return almond.handleParsedCommand({ code: input, entities: {} });
        } else if (typeof input === 'function') {
            return input(almond);
        } else {
            //console.log('$ \\r ' + json);
            return almond.handleParsedCommand(input);
        }
    }).then(() => {
        //console.log('roundtrip end');
        if (output !== null && buffer !== output)
            throw new Error('Invalid reply from Almond: ' + buffer + '\n\nExpected: ' + output);
    });
}

function cleanToken(code) {
    if (code === null)
        return null;
    return code.replace(/__token="[a-f0-9]+"/g, '__token="XXX"').replace(/uuid-[A-Za-z0-9-]+/g, 'uuid-XXXXXX');
}
function resetOptions(almond) {
    almond.user.isOwner = true;
    almond._options.anonymous = false;
}

let anyFailed = false;

async function test(script, i) {
    console.error('Test Case #' + (i+1));

    flushBuffer();
    app = null;
    permission = null;

    function step(j) {
        if (j === script.length-1)
            return Promise.resolve();

        return roundtrip(script[j], script[j+1]).then(() => step(j+2));
    }
    resetOptions(almond);

    return (i > 0 ? roundtrip(['bookkeeping', 'special', 'special:nevermind'], null) : Promise.resolve())
    .then(() => step(0)).then(() => {
        var expected = script[script.length-1];
        if (permission)
            app = cleanToken(permission.prettyprint());
        else
            app = cleanToken(app);
        expected = cleanToken(expected);
        if (app !== expected) {
            console.error('Test Case #' + (i+1) + ': does not match what expected');
            console.error('Expected: ' + expected);
            console.error('Generated: ' + app);
            anyFailed = true;
        } else {
            console.error('Test Case #' + (i+1) + ' passed');
        }
    }).catch((e) => {
        console.error('Test Case #' + (i+1) + ': failed with exception');
        console.error('Error: ' + e.message);
        console.error(e.stack);
        anyFailed = true;
    });
}

var almond;

const mockMatrix = {
    loadInteractively(engine, configDelegate) {
        return configDelegate.requestCode("Insert your Matrix username:").then((username) => {
            assert.strictEqual(username, 'bob');
            return configDelegate.requestCode("Insert your Matrix password:", true);
        }).then((password) => {
            assert.strictEqual(password, 'pa55word');
            return configDelegate.confirm("Yes or no?");
        }).then((v) => {
            assert.strictEqual(v, true);
            configDelegate.configDone();
            engine.messaging.isAvailable = true;
        });
    }
};

const mockDeviceFactory = {
    _engine: null,

    getDeviceClass(f) {
        if (f === 'org.thingpedia.builtin.matrix')
            return Promise.resolve(mockMatrix);
        else
            return Promise.reject(new Error('no such device'));
    },
    loadInteractively(kind, delegate) {
        return this.getDeviceClass(kind).then((factory) => factory.loadInteractively(this._engine, delegate));
    },

    getManifest(what) {
        if (what === 'com.xkcd') {
            return Promise.resolve({
                queries: {
                    get_comic: {
                        formatted: [
                            { type: "rdl",
                              webCallback: "${link}",
                              displayTitle: "${title}" },
                            { type: "picture",
                              url: "${picture_url}" },
                            { type: "text",
                              text: "${alt_text}" }
                        ]
                    }
                },
                actions: {}
            });
        } else {
            return Promise.reject(new Error('no such device'));
        }
    }
};

const _rssFactory = {
    "type":"form",
    "category":"online",
    "kind":"org.thingpedia.rss",
    "text":"RSS Feed",
    "fields":[{"name":"url","label":"Feed URL","type":"text"}]
};

async function main(limit = Infinity) {
    var engine = Mock.createMockEngine('mock');
    engine.platform.getSharedPreferences().set('sabrina-initialized', false);

    // mock out getDeviceSetup
    engine.thingpedia.clickExample = (ex) => {
        writeLine('Clicked example ' + ex);
        return Promise.resolve();
    };
    engine.thingpedia.getDeviceSetup = (kinds) => {
        var ret = {};
        for (var k of kinds) {
            if (k === 'messaging' || k === 'org.thingpedia.builtin.matrix')
                ret[k] = {type:'interactive',category:'online', kind:'org.thingpedia.builtin.matrix', name:"Matrix Account"};
            else if (k === 'com.lg.tv.webos2')
                ret[k] = {type: 'discovery', discoveryType: 'upnp', text: 'LG WebOS TV'};
            else if (k === 'org.thingpedia.builtin.bluetooth.generic')
                ret[k] = {type: 'discovery', discoveryType: 'bluetooth', text: 'Generic Bluetooth Device'};
            else if (k === 'com.tumblr.blog')
                ret[k] = {type: 'multiple', choices: [{ type: 'oauth2', kind: 'com.tumblr', text: "Tumblr Account" }, { type: 'form', kind: 'com.tumblr2', text: 'Some other Tumblr Thing' }]};
            else if (k === 'com.instagram')
                ret[k] = {type: 'oauth2', kind: 'com.instagram', text: 'Instagram'};
            else if (k === 'org.thingpedia.rss')
                ret[k] = _rssFactory;
            else if (k === 'org.thingpedia.builtin.thingengine.home' || k === 'car')
                ret[k] = {type: 'multiple', choices: [] };
            else
                ret[k] = {type:'none',kind:k,text: k};
        }
        return Promise.resolve(ret);
    };
    // intercept createApp
    engine.apps.createApp = createApp;
    engine.permissions.addPermission = addPermission;
    engine.messaging.isAvailable = false;
    engine.devices.addInteractively = async (kind, delegate) => {
        return mockDeviceFactory.loadInteractively(kind, delegate);
    };
    mockDeviceFactory._engine = engine;

    var delegate = new TestDelegate();

    const sempreUrl = 'https://nlp-staging.almond.stanford.edu';
    almond = new Almond(engine, 'test', new MockUser(), delegate,
        { debug: false, sempreUrl: sempreUrl, showWelcome: true, anonymous: false,
          testMode: true });

    // inject some mocking in the parser:
    almond.parser.onlineLearn = function(utterance, targetCode) {
        if (utterance === 'get an xkcd comic')
            assert.strictEqual(targetCode.join(' '), 'now => @com.xkcd.get_comic => notify');
        else if (utterance === '!! test command multiple results !!')
            assert.strictEqual(targetCode.join(' '), 'now => @com.twitter.post param:status:String = " multiple results "');
        else
            assert.fail(`Unexpected learned utterance ${utterance}`);
    };

    const realSendUtterance = almond.parser.sendUtterance;
    almond.parser.sendUtterance = async function(utterance) {
        if (utterance === '!! test command all unsupported 2 !!') {
            const candidates = [
                { code: ['now', '=>', '@invalid1.get', '=>', 'notify'], score: 'Infinity', },
                { code: ['now', '=>', '@invalid1.get', '=>', 'notify'], score: 1, },
            ];
            const tokens = '!! test command all unsupported 2 !!'.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else if (utterance === '!! test command all unsupported !!') {
            const candidates = [
                { code: ['now', '=>', '@invalid1.get', '=>', 'notify'], score: 'Infinity', },
                { code: ['now', '=>', '@invalid2.get', '=>', 'notify'], score: 'Infinity', },
            ];
            const tokens = '!! test command all unsupported !!'.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else if (utterance === 'get new york times') {
            const candidates = [
                { code: ['now', '=>', '@test.nytimes.get', '=>', 'notify'], score: 'Infinity', },
                { code: ['now', '=>', '@com.nytimes.get_front_page', '=>', 'notify'], score: 1, },
            ];
            const tokens = 'get new york times'.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else if (utterance === 'get the weight from my scale') {
            const candidates = [
                { code: ['now', '=>', '@com.bodytrace.scale.get', '=>', 'notify'], score: 1, },
                { code: ['now', '=>', '@edu.stanford.rakeshr1.fitbit.getbody', '=>', 'notify'], score: 0.5, },
            ];
            const tokens = 'get the weight from my scale'.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else if (utterance === 'get an xkcd comic') {
            const candidates = [
                { code: ['now', '=>', '@com.xkcd.get_comic', '=>', 'notify'], score: 'Infinity' },
            ];
            const tokens = 'get an xkcd comic'.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else if (utterance === 'search hello on bing') {
            const candidates = [
                { code: ['now', '=>', '@com.bing.web_search', 'param:query:String', '=', '"', 'hello', '"', '=>', 'notify'], score: 0.5 },
            ];
            const tokens = utterance.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else if (utterance === 'search on bing') {
            const candidates = [
                { code: ['now', '=>', '@com.bing.web_search', '=>', 'notify'], score: 0.5 },
            ];
            const tokens = utterance.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else if (utterance === 'search hello on bing with title filter') {
            const candidates = [
                { code: ['now', '=>', '(', '@com.bing.web_search', 'param:query:String', '=', '"', 'hello', '"', ')', 'filter', 'param:title:String', '=~', 'undefined' , '=>', 'notify'], score: 0.5 },
            ];
            const tokens = utterance.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else if (utterance === 'play hello') {
            const candidates = [
                { code: ['now', '=>', '@com.spotify.play_song', 'param:toPlay:String', '=', '"', 'hello', '"'], score: 0.5 },
            ];
            const tokens = utterance.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else if (utterance === 'play a song') {
            const candidates = [
                { code: ['now', '=>', '@com.spotify.play_song'], score: 0.5 },
            ];
            const tokens = utterance.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else if (utterance === 'tweet hello') {
            const candidates = [
                { code: ['now', '=>', '@com.twitter.post', 'param:status:String', '=', '"', 'hello', '"'], score: 0.5 },
            ];
            const tokens = utterance.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else if (utterance === 'tweet') {
            const candidates = [
                { code: ['now', '=>', '@com.twitter.post'], score: 0.5 },
            ];
            const tokens = utterance.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else if (utterance === '!! test command always nothing !!') {
            return Promise.resolve({ tokens: ('!! test command always nothing !!').split(' '), entities: {}, candidates: [] });
        } else if (utterance === '!! test command host unreach !!') {
            const e = new Error('Host is unreachable');
            e.code = 'EHOSTUNREACH';
            throw e;
        } else if (utterance === '!! test command multiple results !!') {
            const candidates = [
                { code: ['now', '=>', '@com.twitter.post'], score: 1 },
                { code: ['now', '=>', '@com.twitter.post', 'param:status:String', '=', 'QUOTED_STRING_0'],
                  score: 0.9 },
                { code: ['now', '=>', '@com.twitter.post', 'param:status:String', '=', '"', 'multiple', 'results', '"'],
                  score: 0.8 },
                { code: ['now', '=>', '@com.facebook.post'],
                  score: 0.7 },
            ];
            const tokens = '!! test command multiple results !!'.split(' ');
            const entities = {};

            return Promise.resolve({ tokens, entities, candidates });
        } else {
            return realSendUtterance.apply(this, arguments);
        }
    };

    for (let i = 0; i < Math.min(limit, TEST_CASES.length); i++)
        await test(TEST_CASES[i], i);

    if (anyFailed)
        throw new Error('Test failed');
}
if (module.parent)
    module.exports = main;
else
    main(parseInt(process.argv[2]) || Infinity);
