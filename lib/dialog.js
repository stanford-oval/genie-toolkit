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
        this.reply(question);
        if (expected === ValueCategory.YesNo)
            this.manager.sendAskSpecial('yesno');
        else if (expected === ValueCategory.Location)
            this.manager.sendAskSpecial('location');
        else if (expected === ValueCategory.Picture)
            this.manager.sendAskSpecial('picture');
        return true;
    }

    expect(category) {
        this.expecting = category;
        this.manager.setRaw(category === ValueCategory.RawString ||
                            category === ValueCategory.MultipleChoice);
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

    handleGeneric(command) {
        if (this.subdialog !== null) {
            return this.subdialog.handle(command).then((handled) => {
                if (handled)
                    return true;
                else
                    return this._continueHandleGeneric(command);
            })
        } else {
            return Q(this._continueHandleGeneric(command));
        }
    }

    _continueHandleGeneric(command) {
        if (command.isSpecial) {
            switch(command.special) {
            case 'tt:root.special.failed':
                if (this.expecting !== null)
                    return this.unexpected();
                // don't handle this if we're not expecting anything
                // (it will fall through to whatever dialog.handle()
                // is doing, which is calling FallbackDialog for DefaultDialog,
                // actually showing the fallback for FallbackDialog,
                // and doing nothing for all other dialogs)
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
                if (this.expecting !== null) {
                    return this.lookingFor();
                } else {
                    this.reply("Sure! How can I help you?");
                    this.reply("If you're unsure what to say, try 'list commands', or just give me a word and I'll try to find commands related to it.");
                }
                break;

            // easter eggs
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

        if (this.expecting !== null &&
            (!command.isAnswer || !categoryEquals(command.category, this.expecting))) {
            if (command.isYes)
                return this.reply("Yes what?");
            else if (command.isNo)
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

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            this.reply("I'm a little confused, sorry. What where we talking about?");
            this.switchToDefault();
            return true;
        });
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
        this.reply("That's not what I asked.");
        return this.lookingFor();
    }

    lookingFor() {
        // FIXME move to ThingTalk
        const ALLOWED_MEASURES = {
            'ms': 'time interval',
            'm': 'length',
            'mps': 'speed',
            'kg': 'weight',
            'Pa': 'pressure',
            'C': 'temperature',
            'kcal': 'energy'
        };
        const ALLOWED_UNITS = {
            'ms': ['ms', 's', 'min', 'h', 'day', 'week', 'mon', 'year'],
            'm': ['m', 'km', 'mm', 'cm', 'mi', 'in'],
            'mps': ['mps', 'kmph', 'mph'],
            'kg': ['kg', 'g', 'lb', 'oz'],
            'Pa': ['Pa', 'bar', 'psi', 'mmHg', 'inHg', 'atm'],
            'C': ['C', 'F', 'K'],
            'kcal': ['kcal', 'kJ']
        };

        if (this.expecting === null) {
            return this.reply("In fact, I did not ask for anything at all!");
        } else if (this.expecting === ValueCategory.YesNo) {
            return this.reply("Just answer yes or no.");
        } else if (this.expecting === ValueCategory.MultipleChoice) {
            return this.reply("Just click one of the buttons above.");
        } else if (this.expecting.isMeasure) {
            return this.reply("I'm looking for a " + ALLOWED_MEASURES[this.expecting.unit] +
                " in any of the supported units (" + ALLOWED_UNITS[this.expecting.unit].join(', ') + ").");
        } else if (this.expecting === ValueCategory.Number) {
            return this.reply("I'm looking for a number.");
        } else if (this.expecting === ValueCategory.Date) {
            return this.reply("I'm looking for a date and time.");
        } else if (this.expecting === ValueCategory.Picture) {
            return this.reply("You need to upload a picture!");
        } else if (this.expecting === ValueCategory.RawString) {
            // ValueCategory.RawString puts Sabrina in raw mode,
            // so we accept almost everything
            // but this will happen if the user clicks a button
            // or upload a picture
            return this.reply("Which is interesting, because I'll take anything at all. Just type your mind!");
        } else {
            return this.reply("In fact, I'm not even sure what I asked. Sorry!");
        }
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
