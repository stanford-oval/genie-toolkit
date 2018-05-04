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
process.on('unhandledRejection', (up) => { throw up; });

const assert = require('assert');
const ThingTalk = require('thingtalk');

const Almond = require('../lib/almond');

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

class MockApp {
    constructor(uniqueId) {
        this.uniqueId = uniqueId;
        this.mainOutput = {
            next() {
                let _resolve, _reject;
                new Promise((resolve, reject) => {
                    _resolve = resolve;
                    _reject = reject;
                });
                return { item: { isDone: true }, resolve: _resolve, reject: _reject };
            }
        };
    }
}
function loadOneApp(code) {
    app = code;
    return Promise.resolve(new MockApp('uuid-' + appid++));
}
function addPermission(perm) {
    permission = perm;
}

var remoteApps = '';
function installProgramRemote(principal, identity, uniqueId, program) {
    remoteApps += `\nremote ${principal}/${identity} : ${uniqueId} : ${ThingTalk.Ast.prettyprint(program)}`;
    return Promise.resolve();
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
        writeLine('>> button: ' + title + ' ' + JSON.stringify(json));
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
    [(almond) => {
        almond.start();
        // inject a meaningless intent so we synchronize the two concurrent tasks
        return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
    },
`>> Hello! I'm Almond, your virtual assistant.
>> I am part of a research project of Stanford University. Would you like to contribute?
>> With your consent, I will record the commands you give me for training. Recording the commands will allow me to improve my understanding of natural language.
>> The collection is completely anonymous, and I will strip personal data (such as search queries, messages or phone numbers). The data, once collected, will be shared with our developers and researchers, and potentially other researchers working on natural language understanding.
>> You must be 13 or older to partecipate. If you are not, please answer ‘No’ here. Your answer will not affect the functionality of Almond.
>> Regardless of your choice here, I will not collect or store your credentials or the results of your commands.
>> If you would like to know more, see our privacy policy at https://almond.stanford.edu/about/privacy or contact us at <mobisocial@lists.stanford.edu>.
>> Do you consent to recording your commands?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Thank you! If you change your mind, you can change the option from Settings.
>> Now, I will help you set up your devices and accounts.
>> To do so, try ‘configure‘ followed by the type of device or account (e.g., ‘configure twitter’ or ‘configure tv’), or try ‘discover’ and I'll take a look at what you have.
>> If you need help at any point, try ‘help’.
>> ask special null
`,
    null],

    [['bookkeeping', 'special', 'special:help'],
`>> Click on one of the following buttons to start adding commands.
>> choice 0: When
>> choice 1: Get
>> choice 2: Do
>> ask special choice
`,
    null],

    [
    ['now', '=>', '@com.xkcd.get_comic', '=>', '@com.twitter.post_picture'],
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> What do you want to tweet?
>> choice 0: Use the title from Xkcd
>> choice 1: Use the picture url from Xkcd
>> choice 2: Use the link from Xkcd
>> choice 3: Use the alt text from Xkcd
>> choice 4: A description of the result
>> choice 5: None of above
>> ask special choice
`,
    ['bookkeeping', 'choice', 2],
`>> Upload the picture now.
>> choice 0: Use the picture url from Xkcd
>> choice 1: None of above
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> Ok, so you want me to get get an Xkcd comic and then tweet the link with an attached picture with picture url equal to the picture url. Is that right?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> ask special null
`,
`{
    now => @com.xkcd(id="com.xkcd-6").get_comic() => @com.twitter(id="twitter-foo").post_picture(caption=link, picture_url=picture_url);
}`],

    [
    ['now', '=>', '@com.twitter.post'],
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> ask special choice
`,
     ['bookkeeping', 'choice', 1],
`>> What do you want to tweet?
>> ask special raw_string
`,
     { code: ['bookkeeping', 'answer', 'QUOTED_STRING_0'], entities: { QUOTED_STRING_0: 'lol' } },
`>> Ok, so you want me to tweet "lol". Is that right?
>> ask special yesno
`,
     ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
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
>> ask special choice
`,
    ['bookkeeping', 'choice', 1],
`>> Ok, so you want me to post the text on Facebook when tweets from anyone you follow changes. Is that right?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> ask special null
`,
`{
    monitor (@com.twitter(id="twitter-bar").home_timeline()) => @com.facebook(id="com.facebook-7").post(status=text);
}`],

    [
    ['now', '=>', '@com.xkcd.get_comic', '=>', 'notify'],
`>> ask special null
`,
`{
    now => @com.xkcd(id="com.xkcd-8").get_comic() => notify;
}`],

    /*[
    { code: ['now', '=>', '@com.xkcd.get_comic', '=>', 'notify'], entities: { USERNAME_0: "mom" } },
`>> Ok, so you want me to get an Xkcd comic using Almond of Mom Corp Inc.. Is that right?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Sending rule to Mom Corp Inc.: get an Xkcd comic then send it to me
>> Consider it done.
>> ask special null
`,
`AlmondGenerated() {
    class @__dyn_0 extends @remote {
        trigger receive (in req __principal : Entity(tt:contact), in req __token : Entity(tt:flow_token), in req __kindChannel : Entity(tt:function), out number : Number, out title : String, out picture_url : Entity(tt:picture), out link : Entity(tt:url), out alt_text : String);
    }
    @__dyn_0.receive(__principal="mock-account:MOCK1234-phone:+1800666"^^tt:contact("Mom Corp Inc."), __token="XXX"^^tt:flow_token, __kindChannel="query:xkcd:get_comic"^^tt:function) , v_title := title, v_picture_url := picture_url, v_link := link, v_alt_text := alt_text => notify;
}`],*/

    [
    ['monitor', '(', '@security-camera.current_event', ')', '=>', '@com.twitter.post_picture'],
`>> You have multiple Security Camera devices. Which one do you want to use?
>> choice 0: Some Device 1
>> choice 1: Some Device 2
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> You have multiple Twitter devices. Which one do you want to use?
>> choice 0: Twitter Account foo
>> choice 1: Twitter Account bar
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> What do you want to tweet?
>> choice 0: Use the picture url from Security Camera
>> choice 1: A description of the result
>> choice 2: None of above
>> ask special choice
`,
    ['bookkeeping', 'choice', 2],
`>> What do you want to tweet?
>> ask special raw_string
`,
    { code: ['bookkeeping', 'answer', 'QUOTED_STRING_0'], entities: { QUOTED_STRING_0: 'lol' } },
`>> Upload the picture now.
>> choice 0: Use the picture url from Security Camera
>> choice 1: None of above
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> Ok, so you want me to tweet "lol" with an attached picture with picture url equal to the picture url when the current event detected on your security camera changes. Is that right?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> ask special null
`,
`{
    monitor (@security-camera(id="security-camera-1").current_event()) => @com.twitter(id="twitter-foo").post_picture(caption="lol", picture_url=picture_url);
}`],

    [
    ['bookkeeping', 'special', 'special:makerule'],
`>> Click on one of the following buttons to start adding commands.
>> choice 0: When
>> choice 1: Get
>> choice 2: Do
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> Pick one from the following categories or simply type in.
>> button: Do it now {"code":["bookkeeping","special","special:empty"],"entities":{}}
>> button: Media {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management {"code":["bookkeeping","category","data-management"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    ['monitor', '(', '@security-camera.current_event', ')', '=>', 'notify'],
`>> Add more commands and filters or run your command if you are ready.
>> choice 0: When: when the current event detected on your security camera changes
>> choice 1: Get
>> choice 2: Do: notify me
>> choice 3: Add a filter
>> choice 4: Run it
>> ask special choice
`,
    ['bookkeeping', 'choice', 1],
`>> Pick one from the following categories or simply type in.
>> button: Media {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management {"code":["bookkeeping","category","data-management"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    ['now', '=>', '@com.xkcd.get_comic', '=>', 'notify'],
`>> Add more commands and filters or run your command if you are ready.
>> choice 0: When: when the current event detected on your security camera changes
>> choice 1: Get: get an Xkcd comic
>> choice 2: Do: notify me
>> choice 3: Add a filter
>> choice 4: Run it
>> ask special choice
`,
    ['bookkeeping', 'choice', 3],
`>> Pick the command you want to add filters to:
>> choice 0: When: when the current event detected on your security camera changes
>> choice 1: Get: get an Xkcd comic
>> choice 2: Back
>> ask special choice
`,
    ['bookkeeping', 'choice', 1],
`>> Pick the filter you want to add:
>> button: title is equal to $title {"code":["bookkeeping","filter","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: title is not equal to $title {"code":["bookkeeping","filter","param:title:String","!=","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: title contains $title {"code":["bookkeeping","filter","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: picture url is equal to $picture_url {"code":["bookkeeping","filter","param:picture_url:Entity(tt:picture)","==","SLOT_0"],"entities":{},"slots":["picture_url"],"slotTypes":{"picture_url":"Entity(tt:picture)"}}
>> button: picture url is not equal to $picture_url {"code":["bookkeeping","filter","param:picture_url:Entity(tt:picture)","!=","SLOT_0"],"entities":{},"slots":["picture_url"],"slotTypes":{"picture_url":"Entity(tt:picture)"}}
>> button: link is equal to $link {"code":["bookkeeping","filter","param:link:Entity(tt:url)","==","SLOT_0"],"entities":{},"slots":["link"],"slotTypes":{"link":"Entity(tt:url)"}}
>> button: link is not equal to $link {"code":["bookkeeping","filter","param:link:Entity(tt:url)","!=","SLOT_0"],"entities":{},"slots":["link"],"slotTypes":{"link":"Entity(tt:url)"}}
>> button: alt text is equal to $alt_text {"code":["bookkeeping","filter","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: alt text is not equal to $alt_text {"code":["bookkeeping","filter","param:alt_text:String","!=","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: alt text contains $alt_text {"code":["bookkeeping","filter","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special generic
`,
    { code: ['bookkeeping', 'filter', 'param:title:String', '=~', 'SLOT_0'],
      slots: ['title'],
      slotTypes: { title: 'String' },
      entities: {} },
`>> What's the value of this filter?
>> ask special raw_string
`,
    "lol",
`>> Add more commands and filters or run your command if you are ready.
>> choice 0: When: when the current event detected on your security camera changes
>> choice 1: Get: get an Xkcd comic, title contains "lol"
>> choice 2: Do: notify me
>> choice 3: Add a filter
>> choice 4: Run it
>> ask special choice
`,
    ['bookkeeping', 'choice', 4],
`>> You have multiple Security Camera devices. Which one do you want to use?
>> choice 0: Some Device 1
>> choice 1: Some Device 2
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> Ok, I'm going to notify you when the current event detected on your security camera changes and then get get an Xkcd comic if the title contains "lol".
>> ask special null
`,
    `{
    (monitor (@security-camera(id="security-camera-1").current_event()) join (@com.xkcd(id="com.xkcd-9").get_comic()), title =~ "lol") => notify;
}`],


    [
    ['bookkeeping', 'special', 'special:makerule'],
`>> Click on one of the following buttons to start adding commands.
>> choice 0: When
>> choice 1: Get
>> choice 2: Do
>> ask special choice
`,
    ['bookkeeping', 'choice', 0],
`>> Pick one from the following categories or simply type in.
>> button: Do it now {"code":["bookkeeping","special","special:empty"],"entities":{}}
>> button: Media {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management {"code":["bookkeeping","category","data-management"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,

    {"code":["bookkeeping","category","media"],"entities":{}},
`>> Pick a command from the following devices
>> button: Giphy {"code":["bookkeeping","commands","media","device:com.giphy"],"entities":{}}
>> button: Imgflip Meme Generator {"code":["bookkeeping","commands","media","device:com.imgflip"],"entities":{}}
>> button: NASA Daily {"code":["bookkeeping","commands","media","device:gov.nasa"],"entities":{}}
>> button: Piled Higher and Deeper {"code":["bookkeeping","commands","media","device:com.phdcomics"],"entities":{}}
>> button: Reddit Frontpage {"code":["bookkeeping","commands","media","device:com.reddit.frontpage"],"entities":{}}
>> button: RSS Feed {"code":["bookkeeping","commands","media","device:org.thingpedia.rss"],"entities":{}}
>> button: SportRadar {"code":["bookkeeping","commands","media","device:us.sportradar"],"entities":{}}
>> button: The Cat API {"code":["bookkeeping","commands","media","device:com.thecatapi"],"entities":{}}
>> button: The Dog API {"code":["bookkeeping","commands","media","device:uk.co.thedogapi"],"entities":{}}
>> button: The Wall Street Journal {"code":["bookkeeping","commands","media","device:com.wsj"],"entities":{}}
>> button: The Washington Post {"code":["bookkeeping","commands","media","device:com.washingtonpost"],"entities":{}}
>> button: XKCD {"code":["bookkeeping","commands","media","device:com.xkcd"],"entities":{}}
>> button: Yahoo Finance {"code":["bookkeeping","commands","media","device:com.yahoo.finance"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,

    {"code":["bookkeeping","commands","media","device:com.xkcd"],"entities":{}},
`>> Pick a command below.
>> button: when a new xkcd is out {"example_id":1549785,"code":["monitor","(","@com.xkcd.get_comic",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: when a new xkcd is out in the what-if section {"example_id":1549786,"code":["monitor","(","@com.xkcd.what_if",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,

    {"example_id":1549785,"code":["monitor","(","@com.xkcd.get_comic",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]},
`Clicked example 1549785
>> Add more commands and filters or run your command if you are ready.
>> choice 0: When: when get an Xkcd comic changes
>> choice 1: Get
>> choice 2: Do: notify me
>> choice 3: Add a filter
>> choice 4: Run it
>> ask special choice
`,

    ['bookkeeping', 'choice', 4],
`>> Ok, I'm going to notify you when get an Xkcd comic changes.
>> ask special null
`,

    `{
    monitor (@com.xkcd(id="com.xkcd-10").get_comic()) => notify;
}`],

    [
    { code: ['executor', '=', 'USERNAME_0', ':', 'now', '=>', '@com.twitter.post'],
      entities: { USERNAME_0: 'mom' } },
`>> You haven't configured a Matrix account yet. You need a Matrix account to let me talk to other Almonds.
>> Insert your Matrix username:
>> ask special raw_string
`,
    `bob`,
`>> Yes or no?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> The account has been set up.
>> What do you want to tweet?
>> ask special raw_string
`,
    `some tweet`,
`>> Ok, so you want me to tell Alice Smith (mom): tweet "some tweet". Is that right?
>> ask special yesno
`,

    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> ask special null
`,
    `null
remote mock-account:MOCK1234-phone:+5556664357/phone:+15555555555 : uuid-XXXXXX : {
    now => @com.twitter.post(status="some tweet");
}`],

    [
    { code: ['executor', '=', 'USERNAME_0', ':', 'now', '=>', '@com.twitter.post', 'param:status:String', '=', 'QUOTED_STRING_0'],
      entities: { USERNAME_0: 'mom', QUOTED_STRING_0: "lol" } },
`>> Ok, so you want me to tell Alice Smith (mom): tweet "lol". Is that right?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> ask special null
`,
    `null
remote mock-account:MOCK1234-phone:+5556664357/phone:+15555555555 : uuid-XXXXXX : {
    now => @com.twitter.post(status="lol");
}`],

    [
    { code: ['executor', '=', 'USERNAME_0', ':', 'now', '=>', '@com.xkcd.get_comic', '=>', 'notify'],
      entities: { USERNAME_0: 'mom' } },
`>> Ok, so you want me to tell Alice Smith (mom): get get an Xkcd comic and then notify you. Is that right?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> ask special null
`,
    `null
remote mock-account:MOCK1234-phone:+5556664357/phone:+15555555555 : uuid-XXXXXX : {
    now => @com.xkcd.get_comic() => notify;
}`],
    [
    { code: ['executor', '=', 'USERNAME_0', ':', 'now', '=>', '@com.xkcd.get_comic', '=>', 'return'],
      entities: { USERNAME_0: 'mom' } },
`>> Ok, so you want me to tell Alice Smith (mom): get get an Xkcd comic and then send it to me. Is that right?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
>> ask special null
`,
    `{
    class @__dyn_0 extends @org.thingpedia.builtin.thingengine.remote {
        query receive (in req __principal : Entity(tt:contact), in req __program_id : Entity(tt:program_id), in req __flow : Number, out __kindChannel : Entity(tt:function), out title : String, out picture_url : Entity(tt:picture), out link : Entity(tt:url), out alt_text : String);
    }
    monitor (@__dyn_0.receive(__principal="mock-account:MOCK1234-phone:+5556664357"^^tt:contact("Alice Smith (mom)"), __program_id=$event.program_id, __flow=0)) => notify;
}
remote mock-account:MOCK1234-phone:+5556664357/phone:+15555555555 : uuid-XXXXXX : {
    class @__dyn_0 extends @org.thingpedia.builtin.thingengine.remote {
        action send (in req __principal : Entity(tt:contact), in req __program_id : Entity(tt:program_id), in req __flow : Number, in req __kindChannel : Entity(tt:function), in req title : String, in req picture_url : Entity(tt:picture), in req link : Entity(tt:url), in req alt_text : String);
    }
    now => @com.xkcd.get_comic() => @__dyn_0.send(__principal="mock-account:123456-SELF"^^tt:contact("me"), __program_id=$event.program_id, __flow=0, __kindChannel=$event.type, title=title, picture_url=picture_url, link=link, alt_text=alt_text);
}`],

    [
    { code: ['policy', 'param:source:Entity(tt:contact)', '==', 'USERNAME_0', ':', 'now', '=>', '@com.twitter.post'],
      entities: { USERNAME_0: 'mom' } },
`>> Ok, so Alice Smith (mom) is allowed to tweet any status. Is that right?
>> ask special yesno
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> Consider it done.
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
`>> I'm going to get get an Xkcd comic and then notify you (as asked by Carol Johnson).
`,
    `{
    now => @com.xkcd(id="com.xkcd-11").get_comic() => notify;
}`],

    [(almond) => {
        return ThingTalk.Grammar.parseAndTypecheck(`now => @com.bing.web_search() => notify;`, almond.schemas, true).then((prog) => {
            almond.runProgram(prog, 'uuid-12345', 'phone:+555654321');

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        });
    },
`>> What do you want to search?
>> ask special raw_string
`,
    `pizza`,
`>> I'm going to get search for "pizza" on Bing and then notify you (as asked by Carol Johnson).
>> ask special null
`,
    `{
    now => @com.bing(id="com.bing").web_search(query="pizza") => notify;
}`],

    [(almond) => {
        return Promise.resolve().then(() => {
            almond.notify('uuid-test-notify1', 'com.xkcd', 'com.xkcd:get_comic', {
                number: 1986,
                title: 'River Border',
                picture_url: 'http://imgs.xkcd.com/comics/river_border.png',
                link: 'https://xkcd.com/1986',
                alt_text: `I'm not a lawyer, but I believe zones like this are technically considered the high seas, so if you cut a pizza into a spiral there you could be charged with pieracy under marinaritime law.` //'
            });

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        });
    },
`>> rdl: River Border https://xkcd.com/1986
>> picture: http://imgs.xkcd.com/comics/river_border.png
>> I'm not a lawyer, but I believe zones like this are technically considered the high seas, so if you cut a pizza into a spiral there you could be charged with pieracy under marinaritime law.
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

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        });
    },
`>> Notification from Xkcd ⇒ Notification
>> rdl: River Border https://xkcd.com/1986
>> picture: http://imgs.xkcd.com/comics/river_border.png
>> I'm not a lawyer, but I believe zones like this are technically considered the high seas, so if you cut a pizza into a spiral there you could be charged with pieracy under marinaritime law.
>> ask special null
`,
    null],

    [(almond) => {
        return Promise.resolve().then(() => {
            almond.notifyError('uuid-test-notify2', 'com.xkcd', new Error('Something went wrong'));

            // inject a meaningless intent so we synchronize the two concurrent tasks
            return almond.handleParsedCommand({ code: ['bookkeeping', 'special', 'special:wakeup'], entities: {} });
        });
    },
`>> Xkcd ⇒ Notification had an error: Something went wrong.
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
`>> Bob Smith (dad) wants to consume "foo"
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody (no restrictions) {"permissionRule":"true : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from Bob Smith (dad) (no restrictions) {"permissionRule":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from Bob Smith (dad) (this exact request) {"permissionRule":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : now => @org.thingpedia.builtin.test.eat_data, data == \\"foo\\";"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Add constraints {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:no'],
`>> Sorry I couldn't help on that.
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
`>> Bob Smith (dad) wants to consume "foo"
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody (no restrictions) {"permissionRule":"true : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from Bob Smith (dad) (no restrictions) {"permissionRule":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : now => @org.thingpedia.builtin.test.eat_data;"}
>> button: Always from Bob Smith (dad) (this exact request) {"permissionRule":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : now => @org.thingpedia.builtin.test.eat_data, data == \\"foo\\";"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Add constraints {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:maybe'],
`>> Pick the filter you want to add:
>> button: data is equal to $data {"code":["bookkeeping","filter","param:data:String","==","SLOT_0"],"entities":{},"slots":["data"],"slotTypes":{"data":"String"}}
>> button: data is not equal to $data {"code":["bookkeeping","filter","param:data:String","!=","SLOT_0"],"entities":{},"slots":["data"],"slotTypes":{"data":"String"}}
>> button: data contains $data {"code":["bookkeeping","filter","param:data:String","=~","SLOT_0"],"entities":{},"slots":["data"],"slotTypes":{"data":"String"}}
>> button: the time is before $__time {"code":["bookkeeping","filter","param:__time:Time","<=","SLOT_0"],"entities":{},"slots":["__time"],"slotTypes":{"__time":"Time"}}
>> button: the time is after $__time {"code":["bookkeeping","filter","param:__time:Time",">=","SLOT_0"],"entities":{},"slots":["__time"],"slotTypes":{"__time":"Time"}}
>> button: my location is $__location {"code":["bookkeeping","filter","param:__location:Location","==","SLOT_0"],"entities":{},"slots":["__location"],"slotTypes":{"__location":"Location"}}
>> button: my location is not ____ {"code":["bookkeeping","filter","not","param:__location:Location","==","SLOT_0"],"entities":{},"slots":["__location"],"slotTypes":{"__location":"Location"}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special generic
`,
    {"code":["bookkeeping","filter","param:data:String","=~","SLOT_0"],"entities":{SLOT_0: 'oo'},"slots":["data"],"slotTypes":{"data":"String"}},
`>> Ok, I'll remember that Bob Smith (dad) is allowed to consume any data if the data contains "oo"
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
`>> Bob Smith (dad) wants to get get an Xkcd comic and then notify you
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"permissionRule":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"permissionRule":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Add constraints {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:no'],
`>> Sorry I couldn't help on that.
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
`>> Bob Smith (dad) wants to get get an Xkcd comic and then notify you
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"permissionRule":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"permissionRule":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Add constraints {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:yes'],
`>> ask special null
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
`>> Bob Smith (dad) wants to get get an Xkcd comic and then notify you
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"permissionRule":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"permissionRule":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Add constraints {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> ask special generic
`,
    {"code":["policy","true",":","@com.xkcd.get_comic","=>","notify"],"entities":{}},
`>> Ok, I'll remember that anyone is allowed to read get an Xkcd comic
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
`>> Bob Smith (dad) wants to get get an Xkcd comic and then notify you
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"permissionRule":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"permissionRule":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Add constraints {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> ask special generic
`,
    {"permissionRule":"true : @com.xkcd.get_comic => notify;"},
`>> Ok, I'll remember that anyone is allowed to read get an Xkcd comic
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
`>> Bob Smith (dad) wants to get get an Xkcd comic and then notify you
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"permissionRule":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"permissionRule":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Add constraints {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> ask special generic
`,
    {"permissionRule":"source == \"mock-account:...\"^^tt:contact(\"Bob Smith (dad)\") : @com.xkcd.get_comic => notify;"},
`>> Ok, I'll remember that Bob Smith (dad) is allowed to read get an Xkcd comic
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
`>> Bob Smith (dad) wants to get get an Xkcd comic and then notify you
>> button: Yes this time {"code":["bookkeeping","special","special:yes"],"entities":{}}
>> button: Always from anybody {"permissionRule":"true : @com.xkcd.get_comic => notify;"}
>> button: Always from Bob Smith (dad) {"permissionRule":"source == \\"mock-account:...\\"^^tt:contact(\\"Bob Smith (dad)\\") : @com.xkcd.get_comic => notify;"}
>> button: No {"code":["bookkeeping","special","special:no"],"entities":{}}
>> button: Add constraints {"code":["bookkeeping","special","special:maybe"],"entities":{}}
>> ask special generic
`,
    ['bookkeeping', 'special', 'special:maybe'],
`>> Pick the filter you want to add:
>> button: number is equal to $number {"code":["bookkeeping","filter","param:number:Number","==","SLOT_0"],"entities":{},"slots":["number"],"slotTypes":{"number":"Number"}}
>> button: number is greater than or equal to $number {"code":["bookkeeping","filter","param:number:Number",">=","SLOT_0"],"entities":{},"slots":["number"],"slotTypes":{"number":"Number"}}
>> button: number is less than or equal to $number {"code":["bookkeeping","filter","param:number:Number","<=","SLOT_0"],"entities":{},"slots":["number"],"slotTypes":{"number":"Number"}}
>> button: title is equal to $title {"code":["bookkeeping","filter","param:title:String","==","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: title is not equal to $title {"code":["bookkeeping","filter","param:title:String","!=","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: title contains $title {"code":["bookkeeping","filter","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}}
>> button: picture url is equal to $picture_url {"code":["bookkeeping","filter","param:picture_url:Entity(tt:picture)","==","SLOT_0"],"entities":{},"slots":["picture_url"],"slotTypes":{"picture_url":"Entity(tt:picture)"}}
>> button: picture url is not equal to $picture_url {"code":["bookkeeping","filter","param:picture_url:Entity(tt:picture)","!=","SLOT_0"],"entities":{},"slots":["picture_url"],"slotTypes":{"picture_url":"Entity(tt:picture)"}}
>> button: link is equal to $link {"code":["bookkeeping","filter","param:link:Entity(tt:url)","==","SLOT_0"],"entities":{},"slots":["link"],"slotTypes":{"link":"Entity(tt:url)"}}
>> button: link is not equal to $link {"code":["bookkeeping","filter","param:link:Entity(tt:url)","!=","SLOT_0"],"entities":{},"slots":["link"],"slotTypes":{"link":"Entity(tt:url)"}}
>> button: alt text is equal to $alt_text {"code":["bookkeeping","filter","param:alt_text:String","==","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: alt text is not equal to $alt_text {"code":["bookkeeping","filter","param:alt_text:String","!=","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: alt text contains $alt_text {"code":["bookkeeping","filter","param:alt_text:String","=~","SLOT_0"],"entities":{},"slots":["alt_text"],"slotTypes":{"alt_text":"String"}}
>> button: the time is before $__time {"code":["bookkeeping","filter","param:__time:Time","<=","SLOT_0"],"entities":{},"slots":["__time"],"slotTypes":{"__time":"Time"}}
>> button: the time is after $__time {"code":["bookkeeping","filter","param:__time:Time",">=","SLOT_0"],"entities":{},"slots":["__time"],"slotTypes":{"__time":"Time"}}
>> button: my location is $__location {"code":["bookkeeping","filter","param:__location:Location","==","SLOT_0"],"entities":{},"slots":["__location"],"slotTypes":{"__location":"Location"}}
>> button: my location is not ____ {"code":["bookkeeping","filter","not","param:__location:Location","==","SLOT_0"],"entities":{},"slots":["__location"],"slotTypes":{"__location":"Location"}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special generic
`,
    {"code":["bookkeeping","filter","param:title:String","=~","SLOT_0"],"entities":{},"slots":["title"],"slotTypes":{"title":"String"}},
`>> What's the value of this filter?
>> ask special raw_string
`,
    `pierates`,
`>> Ok, I'll remember that Bob Smith (dad) is allowed to read get an Xkcd comic if the title contains "pierates"
>> ask special null
`,

    `source == "mock-account:..."^^tt:contact("Bob Smith (dad)") : @com.xkcd.get_comic, title =~ "pierates" => notify;`],

    [['now', '=>', '@org.thingpedia.weather.current', '=>', 'notify'],
`>> What location do you want the current weather for?
>> ask special location
`,
    ['bookkeeping', 'answer', 'location:current_location'],
`>> ask special null
`,

    `{
    now => @org.thingpedia.weather(id="org.thingpedia.weather-12").current(location=makeLocation(37.4275, -122.1697)) => notify;
}`],

    [['now', '=>', '@org.thingpedia.weather.current', '=>', 'notify'],
`>> What location do you want the current weather for?
>> ask special location
`,
    ['bookkeeping', 'answer', 'location:home'],
`>> What is your home address?
>> ask special location
`,

    { code: ['bookkeeping', 'answer', 'LOCATION_0'], entities: {"LOCATION_0": {longitude:0, latitude:90, display:"North pole"}}},
`>> ask special null
`,

    `{
    now => @org.thingpedia.weather(id="org.thingpedia.weather-13").current(location=makeLocation(90, 0, "North pole")) => notify;
}`],

    [['now', '=>', '@org.thingpedia.weather.current', '=>', 'notify'],
`>> What location do you want the current weather for?
>> ask special location
`,
    ['bookkeeping', 'answer', 'location:home'],
`>> ask special null
`,

    `{
    now => @org.thingpedia.weather(id="org.thingpedia.weather-14").current(location=makeLocation(90, 0, "North pole")) => notify;
}`],


    [
    ['bookkeeping', 'special', 'special:makerule'],
`>> Click on one of the following buttons to start adding commands.
>> choice 0: When
>> choice 1: Get
>> choice 2: Do
>> ask special choice
`,
    ['bookkeeping', 'choice', '0'],
`>> Pick one from the following categories or simply type in.
>> button: Do it now {"code":["bookkeeping","special","special:empty"],"entities":{}}
>> button: Media {"code":["bookkeeping","category","media"],"entities":{}}
>> button: Social Networks {"code":["bookkeeping","category","social-network"],"entities":{}}
>> button: Home {"code":["bookkeeping","category","home"],"entities":{}}
>> button: Communication {"code":["bookkeeping","category","communication"],"entities":{}}
>> button: Services {"code":["bookkeeping","category","service"],"entities":{}}
>> button: Data Management {"code":["bookkeeping","category","data-management"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","category","media"],"entities":{}},
`>> Pick a command from the following devices
>> button: Giphy {"code":["bookkeeping","commands","media","device:com.giphy"],"entities":{}}
>> button: Imgflip Meme Generator {"code":["bookkeeping","commands","media","device:com.imgflip"],"entities":{}}
>> button: NASA Daily {"code":["bookkeeping","commands","media","device:gov.nasa"],"entities":{}}
>> button: Piled Higher and Deeper {"code":["bookkeeping","commands","media","device:com.phdcomics"],"entities":{}}
>> button: Reddit Frontpage {"code":["bookkeeping","commands","media","device:com.reddit.frontpage"],"entities":{}}
>> button: RSS Feed {"code":["bookkeeping","commands","media","device:org.thingpedia.rss"],"entities":{}}
>> button: SportRadar {"code":["bookkeeping","commands","media","device:us.sportradar"],"entities":{}}
>> button: The Cat API {"code":["bookkeeping","commands","media","device:com.thecatapi"],"entities":{}}
>> button: The Dog API {"code":["bookkeeping","commands","media","device:uk.co.thedogapi"],"entities":{}}
>> button: The Wall Street Journal {"code":["bookkeeping","commands","media","device:com.wsj"],"entities":{}}
>> button: The Washington Post {"code":["bookkeeping","commands","media","device:com.washingtonpost"],"entities":{}}
>> button: XKCD {"code":["bookkeeping","commands","media","device:com.xkcd"],"entities":{}}
>> button: Yahoo Finance {"code":["bookkeeping","commands","media","device:com.yahoo.finance"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","commands","media","device:com.giphy"],"entities":{}},
`>> Can't find a compatible command from Giphy, choose another device
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","special","special:back"],"entities":{}},
`>> Pick a command from the following devices
>> button: Giphy {"code":["bookkeeping","commands","media","device:com.giphy"],"entities":{}}
>> button: Imgflip Meme Generator {"code":["bookkeeping","commands","media","device:com.imgflip"],"entities":{}}
>> button: NASA Daily {"code":["bookkeeping","commands","media","device:gov.nasa"],"entities":{}}
>> button: Piled Higher and Deeper {"code":["bookkeeping","commands","media","device:com.phdcomics"],"entities":{}}
>> button: Reddit Frontpage {"code":["bookkeeping","commands","media","device:com.reddit.frontpage"],"entities":{}}
>> button: RSS Feed {"code":["bookkeeping","commands","media","device:org.thingpedia.rss"],"entities":{}}
>> button: SportRadar {"code":["bookkeeping","commands","media","device:us.sportradar"],"entities":{}}
>> button: The Cat API {"code":["bookkeeping","commands","media","device:com.thecatapi"],"entities":{}}
>> button: The Dog API {"code":["bookkeeping","commands","media","device:uk.co.thedogapi"],"entities":{}}
>> button: The Wall Street Journal {"code":["bookkeeping","commands","media","device:com.wsj"],"entities":{}}
>> button: The Washington Post {"code":["bookkeeping","commands","media","device:com.washingtonpost"],"entities":{}}
>> button: XKCD {"code":["bookkeeping","commands","media","device:com.xkcd"],"entities":{}}
>> button: Yahoo Finance {"code":["bookkeeping","commands","media","device:com.yahoo.finance"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","commands","media","device:com.phdcomics"],"entities":{}},
`>> Pick a command below.
>> button: when there is a new post on phd comics {"example_id":1549797,"code":["monitor","(","@com.phdcomics.get_post",")","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","special","special:back"],"entities":{}},
`>> Pick a command from the following devices
>> button: Giphy {"code":["bookkeeping","commands","media","device:com.giphy"],"entities":{}}
>> button: Imgflip Meme Generator {"code":["bookkeeping","commands","media","device:com.imgflip"],"entities":{}}
>> button: NASA Daily {"code":["bookkeeping","commands","media","device:gov.nasa"],"entities":{}}
>> button: Piled Higher and Deeper {"code":["bookkeeping","commands","media","device:com.phdcomics"],"entities":{}}
>> button: Reddit Frontpage {"code":["bookkeeping","commands","media","device:com.reddit.frontpage"],"entities":{}}
>> button: RSS Feed {"code":["bookkeeping","commands","media","device:org.thingpedia.rss"],"entities":{}}
>> button: SportRadar {"code":["bookkeeping","commands","media","device:us.sportradar"],"entities":{}}
>> button: The Cat API {"code":["bookkeeping","commands","media","device:com.thecatapi"],"entities":{}}
>> button: The Dog API {"code":["bookkeeping","commands","media","device:uk.co.thedogapi"],"entities":{}}
>> button: The Wall Street Journal {"code":["bookkeeping","commands","media","device:com.wsj"],"entities":{}}
>> button: The Washington Post {"code":["bookkeeping","commands","media","device:com.washingtonpost"],"entities":{}}
>> button: XKCD {"code":["bookkeeping","commands","media","device:com.xkcd"],"entities":{}}
>> button: Yahoo Finance {"code":["bookkeeping","commands","media","device:com.yahoo.finance"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","commands","media","device:com.yahoo.finance"],"entities":{}},
`>> Pick a command below.
>> button: when the stock price of $p_stock_id changes {"example_id":1597849,"code":["monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)"},"slots":["p_stock_id"]}
>> button: when stock dividends for $p_stock_id changes {"example_id":1597850,"code":["monitor","(","@com.yahoo.finance.get_stock_div","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)"},"slots":["p_stock_id"]}
>> button: when the ask stock price of $p_stock_id goes above $p_ask_price {"example_id":1597852,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:ask_price:Currency",">=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_ask_price":"Currency"},"slots":["p_stock_id","p_ask_price"]}
>> button: when the ask stock price of $p_stock_id goes below $p_ask_price {"example_id":1597853,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:ask_price:Currency","<=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_ask_price":"Currency"},"slots":["p_stock_id","p_ask_price"]}
>> button: when the bid stock price of $p_stock_id goes above $p_bid_price {"example_id":1597854,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:bid_price:Currency",">=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_bid_price":"Currency"},"slots":["p_stock_id","p_bid_price"]}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","special","special:more"],"entities":{}},
`>> Pick a command below.
>> button: when the bid stock price of $p_stock_id goes below $p_bid_price {"example_id":1597855,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:bid_price:Currency","<=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_bid_price":"Currency"},"slots":["p_stock_id","p_bid_price"]}
>> button: when the dividend of $p_stock_id goes above $p_value {"example_id":1597860,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_div","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:value:Currency",">=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_value":"Currency"},"slots":["p_stock_id","p_value"]}
>> button: when the dividend of $p_stock_id goes below $p_value {"example_id":1597861,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_div","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:value:Currency","<=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_value":"Currency"},"slots":["p_stock_id","p_value"]}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","special","special:back"],"entities":{}},
`>> Pick a command below.
>> button: when the stock price of $p_stock_id changes {"example_id":1597849,"code":["monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)"},"slots":["p_stock_id"]}
>> button: when stock dividends for $p_stock_id changes {"example_id":1597850,"code":["monitor","(","@com.yahoo.finance.get_stock_div","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)"},"slots":["p_stock_id"]}
>> button: when the ask stock price of $p_stock_id goes above $p_ask_price {"example_id":1597852,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:ask_price:Currency",">=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_ask_price":"Currency"},"slots":["p_stock_id","p_ask_price"]}
>> button: when the ask stock price of $p_stock_id goes below $p_ask_price {"example_id":1597853,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:ask_price:Currency","<=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_ask_price":"Currency"},"slots":["p_stock_id","p_ask_price"]}
>> button: when the bid stock price of $p_stock_id goes above $p_bid_price {"example_id":1597854,"code":["edge","(","monitor","(","@com.yahoo.finance.get_stock_quote","param:stock_id:Entity(tt:stock_id)","=","SLOT_0",")",")","on","param:bid_price:Currency",">=","SLOT_1","=>","notify"],"entities":{},"slotTypes":{"p_stock_id":"Entity(tt:stock_id)","p_bid_price":"Currency"},"slots":["p_stock_id","p_bid_price"]}
>> button: More… {"code":["bookkeeping","special","special:more"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","special","special:back"],"entities":{}},
`>> Pick a command from the following devices
>> button: Giphy {"code":["bookkeeping","commands","media","device:com.giphy"],"entities":{}}
>> button: Imgflip Meme Generator {"code":["bookkeeping","commands","media","device:com.imgflip"],"entities":{}}
>> button: NASA Daily {"code":["bookkeeping","commands","media","device:gov.nasa"],"entities":{}}
>> button: Piled Higher and Deeper {"code":["bookkeeping","commands","media","device:com.phdcomics"],"entities":{}}
>> button: Reddit Frontpage {"code":["bookkeeping","commands","media","device:com.reddit.frontpage"],"entities":{}}
>> button: RSS Feed {"code":["bookkeeping","commands","media","device:org.thingpedia.rss"],"entities":{}}
>> button: SportRadar {"code":["bookkeeping","commands","media","device:us.sportradar"],"entities":{}}
>> button: The Cat API {"code":["bookkeeping","commands","media","device:com.thecatapi"],"entities":{}}
>> button: The Dog API {"code":["bookkeeping","commands","media","device:uk.co.thedogapi"],"entities":{}}
>> button: The Wall Street Journal {"code":["bookkeeping","commands","media","device:com.wsj"],"entities":{}}
>> button: The Washington Post {"code":["bookkeeping","commands","media","device:com.washingtonpost"],"entities":{}}
>> button: XKCD {"code":["bookkeeping","commands","media","device:com.xkcd"],"entities":{}}
>> button: Yahoo Finance {"code":["bookkeeping","commands","media","device:com.yahoo.finance"],"entities":{}}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["bookkeeping","commands","media","device:gov.nasa"],"entities":{}},
`>> Pick a command below.
>> button: when today 's asteroid info change {"example_id":1641078,"code":["now","=>","@gov.nasa.asteroid","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: when nasa 's astronomy picture of the day change {"example_id":1641079,"code":["now","=>","@gov.nasa.apod","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: when a picture from curiosity rover change {"example_id":1641082,"code":["now","=>","@gov.nasa.rover","=>","notify"],"entities":{},"slotTypes":{},"slots":[]}
>> button: when $p_count pictures from curiosity rover change {"example_id":1641084,"code":["now","=>","@gov.nasa.rover","param:count:Number","=","SLOT_0","=>","notify"],"entities":{},"slotTypes":{"p_count":"Number"},"slots":["p_count"]}
>> button: when a picture from curiosity rover taken on $p_date_taken change {"example_id":1641085,"code":["now","=>","@gov.nasa.rover","param:date_taken:Date","=","SLOT_0","=>","notify"],"entities":{},"slotTypes":{"p_date_taken":"Date"},"slots":["p_date_taken"]}
>> button: Back {"code":["bookkeeping","special","special:back"],"entities":{}}
>> ask special command
`,
    {"code":["now","=>","@gov.nasa.asteroid","=>","notify"],"entities":{},"slotTypes":{},"slots":[]},
`>> Add more commands and filters or run your command if you are ready.
>> choice 0: When: when the asteroid passing close to Earth today changes
>> choice 1: Get
>> choice 2: Do: notify me
>> choice 3: Add a filter
>> choice 4: Run it
>> ask special choice
`,
    ['bookkeeping', 'choice', '4'],
`>> Ok, I'm going to notify you when the asteroid passing close to Earth today changes.
>> ask special null
`,

    `{
    monitor (@gov.nasa(id="gov.nasa-15").asteroid()) => notify;
}`]
];

function roundtrip(input, output) {
    flushBuffer();
    return Promise.resolve().then(() => {
        if (typeof input === 'string') {
            //console.log('$ ' + input);
            return almond.handleCommand(input);
        } else if (Array.isArray(input)) {
            return almond.handleParsedCommand({ code: input, entities: {} });
        } else if (typeof input === 'function') {
            return input(almond);
        } else {
            //console.log('$ \\r ' + json);
            return almond.handleParsedCommand(input);
        }
    }).then(() => {
        if (output !== null && buffer !== output)
            throw new Error('Invalid reply from Almond: ' + buffer + '\n\nExpected: ' + output);
    });
}

function cleanToken(code) {
    if (code === null)
        return null;
    return code.replace(/__token="[a-f0-9]+"/g, '__token="XXX"').replace(/uuid-[A-Za-z0-9-]+/g, 'uuid-XXXXXX');
}

let anyFailed = false;

function test(script, i) {
    console.error('Test Case #' + (i+1));

    flushBuffer();
    app = null;
    permission = null;
    remoteApps = '';

    function step(j) {
        if (j === script.length-1)
            return Promise.resolve();

        return roundtrip(script[j], script[j+1]).then(() => step(j+2));
    }
    return (i > 0 ? roundtrip(['bookkeeping', 'special', 'special:nevermind'], null) : Promise.resolve())
    .then(() => step(0)).then(() => {
        var expected = script[script.length-1];
        if (permission)
            app = cleanToken(ThingTalk.Ast.prettyprintPermissionRule(permission));
        else
            app = cleanToken(app);
        if (remoteApps)
            app += cleanToken(remoteApps);
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

function promiseDoAll(array, fn) {
    function loop(i) {
        if (i === array.length)
            return Promise.resolve();

        return Promise.resolve(fn(array[i], i)).then(() => loop(i+1));
    }
    return loop(0);
}

var almond;

const mockMatrix = {
    configureFromAlmond(engine, configDelegate) {
        return configDelegate.requestCode("Insert your Matrix username:").then((username) => {
            assert.strictEqual(username, 'bob');
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

    getFactory(f) {
        if (f === 'org.thingpedia.builtin.matrix')
            return Promise.resolve(mockMatrix);
        else
            return Promise.reject(new Error('no such device'));
    },
    runInteractiveConfiguration(kind, delegate) {
        return this.getFactory(kind).then((factory) => factory.configureFromAlmond(this._engine, delegate));
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

function main() {
    var engine = Mock.createMockEngine();
    engine.platform.getSharedPreferences().set('sabrina-initialized', false);

    // mock out getDeviceSetup
    engine.thingpedia.clickExample = (ex) => {
        writeLine('Clicked example ' + ex);
        return Promise.resolve();
    };
    engine.thingpedia.getDeviceSetup = (kinds) => {
        var ret = {};
        for (var k of kinds) {
            if (k === 'messaging')
                ret[k] = {type:'interactive',category:'online', kind:'org.thingpedia.builtin.matrix', name:"Matrix Account"};
            else
                ret[k] = {type:'none',kind:k};
        }
        return Promise.resolve(ret);
    };
    // intercept loadOneApp
    engine.apps.loadOneApp = loadOneApp;
    engine.permissions.addPermission = addPermission;
    engine.remote.installProgramRemote = installProgramRemote;
    engine.messaging.isAvailable = false;
    engine.devices.factory = mockDeviceFactory;
    mockDeviceFactory._engine = engine;

    var delegate = new TestDelegate();

    var sempreUrl;
    if (process.argv[2] !== undefined && process.argv[2].startsWith('--with-sempre='))
        sempreUrl = process.argv[2].substr('--with-sempre='.length);
    almond = new Almond(engine, 'test', new MockUser(), delegate,
        { debug: false, sempreUrl: sempreUrl, showWelcome: true });

    promiseDoAll(TEST_CASES, test).then(() => {
        if (anyFailed)
            process.exit(1);
    });
}
main();
