// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');
const adt = require('adt');
const ThingTalk = require('thingtalk');
const interpolate = require('string-interp');
const AsyncQueue = require('consumer-queue');

const Semantic = require('./semantic');
const Intent = Semantic.Intent;
const ValueCategory = Semantic.ValueCategory;

const loop = require('./dialogs/default');

const QueueItem = adt.data({
    UserInput: {
        intent: adt.only(Intent),
        confident: adt.only(Boolean)
    },
    Notification: {
        appId: adt.only(String, null),
        icon: adt.only(String, null),
        outputType: adt.only(String, null),
        outputValue: adt.any,
    },
    Error: {
        appId: adt.only(String, null),
        icon: adt.only(String, null),
        error: adt.any
    },
    Question: {
        appId: adt.only(String, null),
        icon: adt.only(String, null),
        type: adt.only(ThingTalk.Type),
        question: adt.only(String),
    },
    PermissionRequest: {
        principal: adt.only(String),
        identity: adt.only(String),
        program: adt.only(ThingTalk.Ast.Program),
    },
    InteractiveConfigure: {
        kind: adt.only(String, null),
    },
    RunProgram: {
        program: adt.only(ThingTalk.Ast.Program),
        uniqueId: adt.only(String),
        identity: adt.only(String)
    }
});

function arrayEquals(a, b) {
    if (a.length !== b.length)
        return false;

    return a.every((e, i) => categoryEquals(e, b[i]));
}

function categoryEquals(a, b) {
    if ((a === null) !== (b === null))
        return false;
    if (Array.isArray(a) && Array.isArray(b))
        return arrayEquals(a, b);
    if (Array.isArray(a) !== Array.isArray(b))
        return false;
    return a.equals(b);
}

module.exports = class Dispatcher {
    constructor(manager, debug) {
        this._userInputQueue = new AsyncQueue();
        this._notifyQueue = new AsyncQueue();

        this._debug = debug;
        this.manager = manager;
        this.formatter = new ThingTalk.Formatter(manager.platform.locale, manager.platform.timezone, manager.schemas, manager.gettext);
        this.icon = null;
        this.expecting = null;
        this.platformData = null;
        this._choices = null;

        this._mgrResolve = null;
        this._mgrPromise = null;
    }

    get locale() {
        return this.manager.platform.locale;
    }
    get timezone() {
        return this.manager.platform.timezone;
    }
    get _() {
        return this.manager._;
    }
    get ngettext() {
        return this.manager._ngettext;
    }
    get gettext() {
        return this.manager._;
    }

    debug() {
        if (!this._debug)
            return;
        console.log.apply(console, arguments);
    }

    async nextIntent() {
        this._mgrPromise = null;
        this._mgrResolve();
        const intent = await this._userInputQueue.pop();
        this.platformData = intent.platformData;
        return intent;
    }
    async nextQueueItem() {
        this.expecting = null;
        this.manager.expect(null);
        await this.manager.sendAskSpecial();
        this._mgrPromise = null;
        this._mgrResolve();
        const queueItem = await this._notifyQueue.pop();
        if (queueItem.item.isUserInput)
            this.platformData = queueItem.item.intent.platformData;
        else
            this.platformData = {};
        return queueItem;
    }

    async unexpected() {
        this.manager.stats.hit('sabrina-unexpected');
        await this.reply(this._("Sorry, but that's not what I asked."));
        await this.lookingFor();
    }

    async lookingFor() {
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
            await this.reply(this._("In fact, I did not ask for anything at all!"));
        } else if (this.expecting === ValueCategory.YesNo) {
            await this.reply(this._("Sorry, I need you to confirm the last question first."));
        } else if (this.expecting === ValueCategory.MultipleChoice) {
            await this.reply(this._("Could you choose one of the following?"));
            this.manager.resendChoices();
        } else if (this.expecting.isMeasure) {
            await this.replyInterp(this._("I'm looking for ${expecting:select:\
                ms {a time interval}\
                m {a length}\
                mps {a speed}\
                kg {a weight}\
                Pa {a pressure}\
                C {a temperature}\
                kcal {an energy}\
                byte {a size}\
                other {a value}\
            } in any of the supported units (${units})."), {
                expecting: this.expecting.unit,
                units: ALLOWED_UNITS[this.expecting.unit]
            });
        } else if (this.expecting === ValueCategory.Number) {
            await this.reply(this._("Could you give me a number?"));
        } else if (this.expecting === ValueCategory.Date) {
            await this.reply(this._("Could you give me a date?"));
        } else if (this.expecting === ValueCategory.Time) {
            await this.reply(this._("Could you give me a time of day?"));
        } else if (this.expecting === ValueCategory.Picture) {
            await this.reply(this._("Could you upload a picture?"));
        } else if (this.expecting === ValueCategory.Location) {
            await this.reply(this._("Could you give me a place?"));
        } else if (this.expecting === ValueCategory.PhoneNumber) {
            await this.reply(this._("Could you give me a phone number?"));
        } else if (this.expecting === ValueCategory.EmailAddress) {
            await this.reply(this._("Could you give me an email address?"));
        } else if (this.expecting === ValueCategory.RawString || this.expecting === ValueCategory.Password) {
            // ValueCategory.RawString puts Almond in raw mode,
            // so we accept almost everything
            // but this will happen if the user clicks a button
            // or upload a picture
            await this.reply(this._("Which is interesting, because I'll take anything at all. Just type your mind!"));
        } else if (this.expecting === ValueCategory.Command) {
            await this.reply(this._("I'm looking for a command."));
        } else if (this.expecting === ValueCategory.Predicate) {
            await this.reply(this._("I'm looking for a filter"));
        } else {
            await this.reply(this._("In fact, I'm not even sure what I asked. Sorry!"));
        }
        this.manager.sendAskSpecial();
    }

    async fail(msg) {
        if (this.expecting === null) {
            if (msg) {
                await this.replyInterp(this._("Sorry, I did not understand that: ${error}. Can you rephrase it?"), {
                    error: msg
                });
            } else {
                await this.reply(this._("Sorry, I did not understand that. Can you rephrase it?"));
            }
        } else {
            if (msg)
                await this.replyInterp(this._("Sorry, I did not understand that: ${error}."), { error: msg });
            else
                await this.reply(this._("Sorry, I did not understand that."));
            await this.lookingFor();
        }
        return true;
    }

    async forbid() {
        await this.reply(this._("I'm sorry, you don't have permission to do that."));
        await this.setContext(null);
    }
    async done() {
        await this.reply(this._("Consider it done."));
    }
    async expect(expected) {
        if (expected === undefined)
            throw new TypeError();
        this.expecting = expected;
        this.manager.expect(expected);
        await this.manager.sendAskSpecial();
        return this.nextIntent();
    }
    setContext(context) {
        this.manager.setContext(context);
    }

    async ask(expected, question, args) {
        await this.replyInterp(question, args);
        const intent = await this.expect(expected);
        if (expected === ValueCategory.YesNo)
            return intent.value.value;
        else
            return intent.value;
    }
    askMoreResults() {
        return this.expect(ValueCategory.More);
    }
    async askChoices(question, choices) {
        await this.reply(question);
        this.expecting = ValueCategory.MultipleChoice;
        this.manager.expect(ValueCategory.MultipleChoice);
        this._choices = choices;
        for (let i = 0; i < choices.length; i++)
            await this.replyChoice(i, 'choice', choices[i]);
        await this.manager.sendAskSpecial();
        return this.nextIntent().then((intent) => intent.value);
    }
    async reset() {
        this.manager.stats.hit('sabrina-abort');
        await this.reply(this._("Sorry I couldn't help on that."));
        await this.setContext(null);
    }

    interpolate(msg, args) {
        return interpolate(msg, args, {
            locale: this.locale,
            timezone: this.timezone
        });
    }

    async replyInterp(msg, args, icon) {
        if (args === undefined)
            return this.reply(msg, icon);
        else
            return this.reply(this.interpolate(msg, args), icon);
    }

    async reply(msg, icon) {
        await this.manager.sendReply(msg, icon || this.icon);
        return true;
    }

    async replyRDL(rdl, icon) {
        await this.manager.sendRDL(rdl, icon || this.icon);
        return true;
    }

    async replyChoice(idx, what, title, text) {
        await this.manager.sendChoice(idx, what, title, text);
        return true;
    }

    async replyButton(text, json) {
        await this.manager.sendButton(text, json);
        return true;
    }

    async replySpecial(text, special) {
        let json = { code: ['bookkeeping', 'special', 'special:' + special], entities: {} };
        return this.replyButton(text, json);
    }

    async replyPicture(url, icon) {
        await this.manager.sendPicture(url, icon || this.icon);
        return true;
    }

    async replyLink(title, url) {
        await this.manager.sendLink(title, url);
        return true;
    }

    async replyResult(message, icon) {
        await this.manager.sendResult(message, icon || this.icon);
        return true;
    }

    _cancel() {
        var e = new Error(this._("User cancelled"));
        e.code = 'ECANCELLED';
        this._waitNextIntent();

        if (this._isInDefaultState())
            this._notifyQueue.cancelWait(e);
        else
            this._userInputQueue.cancelWait(e);
        this.manager.setContext(null);
    }

    async _handleGeneric(command) {
        if (command.isFailed) {
            if (this.expecting !== null)
                return this.fail();
            // don't handle this if we're not expecting anything
            // (it will fall through to whatever dialog.handle()
            // is doing, which is calling FallbackDialog for DefaultDialog,
            // actually showing the fallback for FallbackDialog,
            // and doing nothing for all other dialogs)
            return false;
        }
        if (command.isTrain) {
            this._cancel();
            // (returning false will cause this command to be injected later)
            return false;
        }
        if (command.isDebug) {
            if (this._isInDefaultState())
                await this.reply("I'm in the default state");
            else
                await this.reply("I'm not in the default state");
            if (this.expecting === null)
                await this.reply("I'm not expecting anything");
            else
                await this.reply("I'm expecting a " + this.expecting);
            //for (var key of this.manager.stats.keys())
            //    await this.reply(key + ": " + this.manager.stats.get(key));
            return true;
        }
        if (command.isHelp && await this._handleContextualHelp(command))
            return true;
        if (command.isWakeUp) // nothing to do
            return true;

        // if we're expecting the user to click on More... or press cancel,
        // three things can happen
        if (this.expecting === ValueCategory.More) {
            // if the user clicks more, more we let the intent through to rule.js
            if (command.isMore)
                return false;
            // if the user says no, cancel or stop, we inject the cancellation error but we don't show
            // a failure message to the user
            if (command.isNeverMind || command.isNo || command.isStop) {
                this._cancel();
                return true;
            }
            // if the user says anything else, we cancel the current dialog, and then let
            // the command be injected again
            this._cancel();
            return false;
        }

        // stop means cancel, but without a failure message
        if (command.isStop) {
            this._cancel();
            return true;
        }

        if (command.isNeverMind) {
            this.reset();
            this._cancel();
            return true;
        }

        if (this.expecting !== null &&
            (!command.isAnswer || !categoryEquals(command.category, this.expecting))) {
            if (command.isNo) {
                await this.reset();
                this._cancel();
                return true;
            }
            if (this.expecting === ValueCategory.Password &&
                command.isAnswer && command.category === ValueCategory.RawString)
                return false;

            if (this.expecting === ValueCategory.Command &&
                (command.isProgram || command.isCommandList || command.isBack || command.isMore || command.isEmpty))
                return false;
            if (this.expecting === ValueCategory.Predicate &&
                (command.isPredicate || command.isBack || command.isMore))
                return false;
            if (this.expecting === ValueCategory.PermissionResponse &&
                (command.isPredicate || command.isPermissionRule || command.isMore || command.isYes || command.isMaybe || command.isBack))
                return false;

            // if given an answer of the wrong type have Almond complain
            if (command.isYes) {
                await this.reply(this._("Yes what?"));
                return true;
            }
            if (command.isAnswer) {
                await this.unexpected();
                return true;
            }

            // anything else, just switch the subject
            // (returning false will cause this command to be injected later)
            this._cancel();
            return false;
        }
        if (this.expecting === ValueCategory.MultipleChoice) {
            let index = command.value;
            if (index !== Math.floor(index) ||
                index < 0 ||
                index > this._choices.length) {
                await this.reply(this._("Please click on one of the provided choices."));
                await this.manager.resendChoices();
                return true;
            }
        }

        return false;
    }

    _isInDefaultState() {
        return this._notifyQueue.hasWaiter();
    }

    async _handleContextualHelp(command) {
        if (this.expecting !== null) {
            await this.lookingFor();
            return true;
        } else {
            return false;
        }
    }

    dispatchAskForPermission(principal, identity, program) {
        let item = new QueueItem.PermissionRequest(principal, identity, program);
        return this._pushQueueItem(item);
    }
    dispatchAskQuestion(appId, icon, type, question) {
        let item = new QueueItem.Question(appId, icon, type, question);
        return this._pushQueueItem(item);
    }
    dispatchInteractiveConfigure(kind) {
        let item = new QueueItem.InteractiveConfigure(kind);
        return this._pushQueueItem(item);
    }
    dispatchNotify(appId, icon, outputType, outputValue) {
        let item = new QueueItem.Notification(appId, icon, outputType, outputValue);
        return this._pushQueueItem(item);
    }
    dispatchNotifyError(appId, icon, error) {
        let item = new QueueItem.Error(appId, icon, error);
        return this._pushQueueItem(item);
    }
    dispatchRunProgram(program, uniqueId, identity) {
        let item = new QueueItem.RunProgram(program, uniqueId, identity);
        return this._pushQueueItem(item);
    }

    start(showWelcome) {
        let promise = this._waitNextIntent();
        loop(this, showWelcome).then(() => {
            throw new Error('Unexpected end of dialog loop');
        }, (err) => {
            console.error('Uncaught error in dialog loop', err);
            throw err;
        });
        return promise;
    }

    _pushQueueItem(item) {
        // ensure that we have something to wait on before the next
        // command is handled
        if (!this._mgrPromise)
            this._waitNextIntent();

        let resolve, reject;
        let promise = new Promise((callback, errback) => {
            resolve = callback;
            reject = errback;
        });
        this._notifyQueue.push({ item, resolve, reject });
        return promise;
    }

    _waitNextIntent() {
        let promise = new Promise((callback, errback) => {
            this._mgrResolve = callback;
        });
        this._mgrPromise = promise;
        return promise;
    }

    async handle(intent, confident=false) {
        // wait until the dialog is ready to accept commands
        await this._mgrPromise;
        assert(this._mgrPromise === null);

        // check if this command can be handled generically
        let handled = await this._handleGeneric(intent);
        if (handled)
            return this._mgrPromise;

        // this if statement can occur only if the user "changes the subject",
        // in which case _handleGeneric returns false but injects a cancellation
        // error
        // we await this promise to make sure the stack is unwound, the cleanup
        // code is run and we're back in the default state business
        if (this._mgrPromise !== null) {
            await this._mgrPromise;
            assert(this._mgrPromise === null);
        }
        const promise = this._waitNextIntent();

        if (this._isInDefaultState())
            // ignore errors from the queue item (we handle them elsewhere)
            this._pushQueueItem(QueueItem.UserInput(intent, confident)).catch(() => {});
        else
            this._userInputQueue.push(intent);

        return promise;
    }
};
