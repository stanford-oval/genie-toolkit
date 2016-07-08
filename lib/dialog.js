// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');
const adt = require('adt');
const util = require('util');

const ThingTalk = require('thingtalk');

const ValueCategory = require('./semantic').ValueCategory;

function arrayEquals(a, b) {
    if (a.length !== b.length)
        return false;

    return a.every(function(e, i) {
        return categoryEquals(e, b[i]);
    });
}

function categoryEquals(a, b) {
    if ((a === null) != (b === null))
        return false;
    if (Array.isArray(a) && Array.isArray(b))
        return arrayEquals(a, b);
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    return a.equals(b);
}

module.exports = class Dialog {
    constructor() {
        this.expecting = null;
        this.question = null;
        this.subdialog = null;
    }

    notify(app, messages) {
        return false;
    }

    start() {
    }

    stop() {
    }

    ask(expected, question) {
        this.question = question;
        this.expect(expected);
        return this.reply(question);
    }

    expect(category) {
        this.expecting = category;
        this.manager.setRaw(category === ValueCategory.RawString);
    }

    switchTo(dlg, command) {
        this.manager.setRaw(false);
        this.manager.setDialog(dlg);
        if (command)
            return dlg.handle(command);
        else
            return true;
    }

    switchToDefault() {
        return this.manager.switchToDefault();
    }

    push(dlg, command) {
        this.manager.setRaw(false);
        this.subdialog = dlg;
        dlg.manager = this.manager;
        if (command)
            return dlg.handle(command);
        else
            return true;
    }

    pop() {
        this.manager.setRaw(false);
        this.expecting = null;
        this.subdialog = null;
        return false;
    }

    reply(msg) {
        this.manager.sendReply(msg);
        return true;
    }

    replyRDL(rdl) {
        this.manager.sendRDL(rdl);
        return true;
    }

    replyChoice(idx, what, title, text) {
        this.manager.sendChoice(idx, what, title, text);
        return true;
    }

    replyButton(text, json) {
        this.manager.sendButton(text, json);
        return true;
    }

    replyPicture(url) {
        this.manager.sendPicture(url);
        return true;
    }

    replyLink(title, url) {
        this.manager.sendLink(title, url);
    }

    handleGeneric(analyzer) {
        if (this.subdialog !== null) {
            if (this.subdialog.handle(analyzer))
                return true;
        }

        if (analyzer.isSpecial) {
            switch(analyzer.special) {
            case 'tt:root.special.failed':
                return false;
            case 'tt:root.special.hello':
                var prefs = this.manager.platform.getSharedPreferences();
                this.reply("Hi, " + prefs.get('sabrina-name') + ".");
                break;
            case 'tt:root.special.debug':
                this.reply("This is a " + this.constructor.name);
                if (this.expecting === null)
                    this.reply("I'm not expecting anything");
                else
                    this.reply("I'm expecting a " + this.expecting);
                break;
            case 'tt:root.special.help':
                this.reply("Sure! How can I help you?");
                this.reply("If you're unsure what to say, I understand most actions and objects. " +
                           "You can ask me a question and I'll try to answer it. " +
                           "You can tell me to do something at a later time if you give me the condition or the time.");
                if (this.expecting !== null) {
                    if (this.expecting === ValueCategory.YesNo) {
                        this.reply("At this time, just a yes or no will be fine though.");
                    } else if (this.question !== null) {
                        this.reply("At this time, though, just please answer my question: " + this.question);
                    }
                }
                break;
            case 'tt:root.special.thankyou':
                this.reply("At your service.");
                break;
            case 'tt:root.special.sorry':
                this.reply("No need to be sorry.");
                this.reply("Unless you're Canadian. Then I won't stop you.");
                break;
            case 'tt:root.special.cool':
                this.reply("I know, right?");
                break;
            case 'tt:root.special.nevermind':
                this.reset();
                break;
            }
            return true;
        }

        if (this.expecting === ValueCategory.YesNo) {
            if (analyzer.isYes || analyzer.isNo)
                return false;

            return this.reply("Just answer yes or no.");
        } else if (this.expecting !== null &&
                   (!analyzer.isAnswer || !categoryEquals(analyzer.category, this.expecting))) {
            if (analyzer.isYes)
                return this.reply("Yes what?");
            else if (analyzer.isNo)
                return this.reset();

            return this.unexpected();
        }

        return false;
    }

    handlePicture(url) {
        if (this.subdialog !== null)
            return this.subdialog.handlePicture(url);

        // let all pictures through by default
        return false;
    }

    handleRaw(raw) {
        if (this.subdialog !== null)
            return this.subdialog.handleRaw(raw);

        this.reply("I'm a little confused, sorry. What where we talking about?");
        this.switchToDefault();
        return true;
    }

    handleFailed(raw) {
        return false;
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        this.reply("I'm a little confused, sorry. What where we talking about?");
        this.switchToDefault();
        return true;
    }

    reset() {
        this.reply("Ok forget it.");
        this.switchToDefault();
        return true;
    }

    done() {
        this.reply("Consider it done.");
        this.switchToDefault();
        return true;
    }

    unexpected() {
        return this.reply("That's not what I asked.");
    }

    fail(msg) {
        if (msg)
            this.reply("Sorry, I did not understand that: " + msg + ". Can you rephrase it?");
        else
            this.reply("Sorry, I did not understand that. Can you rephrase it?");
        return true;
    }

    // faild and lose context
    failReset() {
        this.fail();
        this.switchToDefault();
        return true;
    }
}
