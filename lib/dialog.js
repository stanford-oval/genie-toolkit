// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
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
        this.icon = null;
    }

    notify(app, icon, messages) {
        return false;
    }

    notifyError(app, icon, error) {
        return false;
    }

    askForPermission(principal, invocation) {
        return null;
    }

    start() {
    }

    stop() {
    }

    ask(expected, question) {
        this.question = question;
        this.reply(question);
        this.expect(expected);
        return true;
    }

    expect(expected) {
        this.expecting = expected;
        this.manager.expect(expected);
        if (expected === ValueCategory.YesNo)
            this.manager.sendAskSpecial('yesno');
        else if (expected === ValueCategory.Location)
            this.manager.sendAskSpecial('location');
        else if (expected === ValueCategory.Picture)
            this.manager.sendAskSpecial('picture');
        else if (expected === ValueCategory.PhoneNumber)
            this.manager.sendAskSpecial('phone_number');
        else if (expected === ValueCategory.EmailAddress)
            this.manager.sendAskSpecial('email_address');
        else if (expected === ValueCategory.Number)
            this.manager.sendAskSpecial('number');
        else if (expected === ValueCategory.Date)
            this.manager.sendAskSpecial('date');
        else if (expected === ValueCategory.Time)
            this.manager.sendAskSpecial('time');
        else if (expected === ValueCategory.Command)
            this.manager.sendAskSpecial('command');
        else if (expected !== null)
            this.manager.sendAskSpecial('generic');
        else
            this.manager.sendAskSpecial(null);
    }

    switchTo(dlg, command) {
        this.manager.setDialog(dlg);
        if (command)
            return dlg.handle(command);
        else
            return true;
    }

    switchToDefault(command) {
        return this.manager.switchToDefault(command);
    }

    push(dlg, command) {
        this.manager.prepare(dlg);
        this.subdialog = dlg;
        if (command)
            return dlg.handle(command);
        else
            return true;
    }

    pop() {
        this.subdialog = null;
        return false;
    }

    reply(msg, icon) {
        this.manager.sendReply(msg, icon || this.icon);
        return true;
    }

    replyRDL(rdl, icon) {
        this.manager.sendRDL(rdl, icon || this.icon);
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

    replyPicture(url, icon) {
        this.manager.sendPicture(url, icon || this.icon);
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

    handleContextualHelp(command) {
        if (this.expecting !== null) {
            return this.lookingFor();
        } else {
            this.reply(this._("Sure! How can I help you?"));
            this.reply(this._("If you're unsure what to say, try 'list commands', or just give me a word and I'll try to find commands related to it."));
        }
    }

    _continueHandleGeneric(command) {
        if (command.isSpecial) {
            if (command.special !== 'tt:root.special.failed' &&
                command.special !== 'tt:root.special.fallback')
                this.manager.stats.hit('sabrina-command-special');

            switch(command.special) {
            case 'tt:root.special.failed':
            case 'tt:root.special.fallback':
                if (this.expecting !== null)
                    return this.fail();
                // don't handle this if we're not expecting anything
                // (it will fall through to whatever dialog.handle()
                // is doing, which is calling FallbackDialog for DefaultDialog,
                // actually showing the fallback for FallbackDialog,
                // and doing nothing for all other dialogs)
                return false;
            case 'tt:root.special.train':
                // switch to default dialog, then redo the command
                return this.switchToDefault(command);

            case 'tt:root.special.debug':
                this.reply("This is a " + this.constructor.name);
                if (this.expecting === null)
                    this.reply("I'm not expecting anything");
                else
                    this.reply("I'm expecting a " + this.expecting);
                for (var key of this.manager.stats.keys())
                    this.reply(key + ": " + this.manager.stats.get(key));
                break;
            case 'tt:root.special.help':
                return this.handleContextualHelp(command);
            case 'tt:root.special.nevermind':
                this.reset();
                break;
            }
            return true;
        }

        if (this.expecting !== null &&
            (!command.isAnswer || !categoryEquals(command.category, this.expecting))) {
            if (command.isYes)
                return this.reply(this._("Yes what?"));
            else if (command.isNo)
                return this.reset();

            if (this.expecting === ValueCategory.Command &&
                (command.isAction || command.isTrigger || command.isQuery ||
                 command.isHelp || command.isBack))
                return false;

            // if given an answer of the wrong type, or something weird, have Almond complain
            if (command.isAnswer || command.isSpecial || command.isEasterEgg)
                return this.unexpected();

            // anything else, just switch the subject
            return this.switchToDefault(command);
        }

        return false;
    }

    handleRaw(raw) {
        if (this.subdialog !== null)
            return this.subdialog.handleRaw(raw);

        this.reply(this._("I'm a little confused, sorry. What where we talking about?"));
        this.switchToDefault();
        return true;
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;

            this.reply(this._("I'm a little confused, sorry. What where we talking about?"));
            this.switchToDefault();
            return true;
        });
    }

    reset() {
        this.manager.stats.hit('sabrina-abort');
        this.reply(this._("Sorry I couldn't help on that."));
        this.switchToDefault();
        return true;
    }

    done() {
        this.reply(this._("Consider it done."));
        this.switchToDefault();
        return true;
    }

    unexpected() {
        this.manager.stats.hit('sabrina-unexpected');
        this.reply(this._("Sorry, but that's not what I asked."));
        return this.lookingFor();
    }

    lookingFor() {
        // FIXME move to ThingTalk
        const ALLOWED_MEASURES = {
            'ms': this._("a time interval"),
            'm': this._("a length"),
            'mps': this._("a speed"),
            'kg': this._("a weight"),
            'Pa': this._("a pressure"),
            'C': this._("a temperature"),
            'kcal': this._("an energy"),
            'byte': this._("a size")
        };
        const ALLOWED_UNITS = {
            'ms': ['ms', 's', 'min', 'h', 'day', 'week', 'mon', 'year'],
            'm': ['m', 'km', 'mm', 'cm', 'mi', 'in'],
            'mps': ['mps', 'kmph', 'mph'],
            'kg': ['kg', 'g', 'lb', 'oz'],
            'Pa': ['Pa', 'bar', 'psi', 'mmHg', 'inHg', 'atm'],
            'C': ['C', 'F', 'K'],
            'kcal': ['kcal', 'kJ'],
            'byte': ['byte', 'KB', 'KiB', 'MB', 'MiB', 'GB', 'GiB', 'TB', 'TiB']
        };

        if (this.expecting === null) {
            return this.reply(this._("In fact, I did not ask for anything at all!"));
        } else if (this.expecting === ValueCategory.YesNo) {
            this.reply(this._("Sorry, I need you to confirm the last question first."));
            this.manager.sendAskSpecial('yesno');
            return true;
        } else if (this.expecting === ValueCategory.MultipleChoice) {
            this.reply(this._("Could you choose one of the following?"));
            this.manager.resendChoices();
            return true;
        } else if (this.expecting.isMeasure) {
            return this.reply(this._("I'm looking for %s in any of the supported units (%s).")
                .format(ALLOWED_MEASURES[this.expecting.unit], ALLOWED_UNITS[this.expecting.unit].join(', ')));
        } else if (this.expecting === ValueCategory.Number) {
            this.reply(this._("Could you give me a number?"));
            this.manager.sendAskSpecial('number');
            return true;
        } else if (this.expecting === ValueCategory.Date) {
            this.reply(this._("Could you give me a date?"));
            this.manager.sendAskSpecial('date');
            return true;
        } else if (this.expecting === ValueCategory.Time) {
            this.reply(this._("Could you give me a time of day?"));
            this.manager.sendAskSpecial('time');
            return true;
        } else if (this.expecting === ValueCategory.Picture) {
            this.reply(this._("Could you upload a picture?"));
            this.manager.sendAskSpecial('picture');
            return true;
        } else if (this.expecting === ValueCategory.Location) {
            this.reply(this._("Could you give me a place?"));
            this.manager.sendAskSpecial('location');
            return true;
        } else if (this.expecting === ValueCategory.PhoneNumber) {
            this.reply(this._("Could you give me a phone number?"));
            this.manager.sendAskSpecial('phone_number');
            return true;
        } else if (this.expecting === ValueCategory.EmailAddress) {
            this.reply(this._("Could you give me an email address?"));
            this.manager.sendAskSpecial('email_address');
            return true;
        } else if (this.expecting === ValueCategory.RawString) {
            // ValueCategory.RawString puts Almond in raw mode,
            // so we accept almost everything
            // but this will happen if the user clicks a button
            // or upload a picture
            return this.reply(this._("Which is interesting, because I'll take anything at all. Just type your mind!"));
        } else if (this.expecting === ValueCategory.Command) {
            this.reply(this._("I'm looking for a trigger, an action, or a query."));
            // TODO: send a help list without rules by sendAskSpecial
            // this.manager.sendAskSpecial('command');
            return true;
        } else {
            return this.reply(this._("In fact, I'm not even sure what I asked. Sorry!"));
        }
    }

    fail(msg) {
        if (this.expecting === null) {
            if (msg)
                this.reply(this._("Sorry, I did not understand that: %s. Can you rephrase it?").format(msg));
            else
                this.reply(this._("Sorry, I did not understand that. Can you rephrase it?"));
        } else {
            if (msg)
                this.reply(this._("Sorry, I did not understand that: %s.").format(msg));
            else
                this.reply(this._("Sorry, I did not understand that."));
            this.lookingFor();
        }
        return true;
    }

    // faild and lose context
    failReset() {
        this.fail();
        this.switchToDefault();
        return true;
    }
}
