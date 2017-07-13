// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const adt = require('adt');
const ThingTalk = require('thingtalk');

const AsyncQueue = require('./async_queue');

const Semantic = require('./semantic');
const Intent = Semantic.Intent;
const ValueCategory = Semantic.ValueCategory;

const loop = require('./dialogs/default');

const QueueItem = adt.data({
    UserInput: { intent: adt.only(Intent) },
    Notification: {
        appId: adt.only(String, null),
        icon: adt.only(String, null),
        messages: adt.any
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
        program: adt.only(ThingTalk.Ast.Program)
    }
});

function _generatorToAsync(fn) {
    return function () {
        var gen = fn.apply(this, arguments);
        return new Promise(function (resolve, reject) {
            function step(key, arg) {
                try {
                    var info = gen[key](arg);
                    var value = info.value;
                } catch (error) {
                    reject(error);
                    return;
                }
                if (info.done) {
                    resolve(value);
                } else {
                    return Promise.resolve(value).then(function (value) { step("next", value); }, function (err) { step("throw", err); });
                }
            }
            return step("next");
        });
    };
}

function arrayEquals(a, b) {
    if (a.length !== b.length)
        return false;

    return a.every(function(e, i) {
        return categoryEquals(e, b[i]);
    });
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
    constructor(manager) {
        this._userInputQueue = new AsyncQueue();
        this._notifyQueue = new AsyncQueue();

        this.manager = manager;
        this.icon = null;
        this.expecting = null;
        this._choices = null;

        this._mgrResolve = null;
        this._mgrPromise = null;
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

    nextIntent() {
        this._mgrResolve();
        return this._userInputQueue.pop();
    }
    nextQueueItem() {
        this.expecting = null;
        this.manager.expect(null);
        this.manager.sendAskSpecial();
        this._mgrResolve();
        return this._notifyQueue.pop();
    }

    unexpected() {
        this.manager.stats.hit('sabrina-unexpected');
        this.reply(this._("Sorry, but that's not what I asked."));
        this.lookingFor();
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
            this.reply(this._("In fact, I did not ask for anything at all!"));
        } else if (this.expecting === ValueCategory.YesNo) {
            this.reply(this._("Sorry, I need you to confirm the last question first."));
        } else if (this.expecting === ValueCategory.MultipleChoice) {
            this.reply(this._("Could you choose one of the following?"));
            this.manager.resendChoices();
        } else if (this.expecting.isMeasure) {
            this.reply(this._("I'm looking for %s in any of the supported units (%s).")
                .format(ALLOWED_MEASURES[this.expecting.unit], ALLOWED_UNITS[this.expecting.unit].join(', ')));
        } else if (this.expecting === ValueCategory.Number) {
            this.reply(this._("Could you give me a number?"));
        } else if (this.expecting === ValueCategory.Date) {
            this.reply(this._("Could you give me a date?"));
        } else if (this.expecting === ValueCategory.Time) {
            this.reply(this._("Could you give me a time of day?"));
        } else if (this.expecting === ValueCategory.Picture) {
            this.reply(this._("Could you upload a picture?"));
        } else if (this.expecting === ValueCategory.Location) {
            this.reply(this._("Could you give me a place?"));
        } else if (this.expecting === ValueCategory.PhoneNumber) {
            this.reply(this._("Could you give me a phone number?"));
        } else if (this.expecting === ValueCategory.EmailAddress) {
            this.reply(this._("Could you give me an email address?"));
        } else if (this.expecting === ValueCategory.RawString) {
            // ValueCategory.RawString puts Almond in raw mode,
            // so we accept almost everything
            // but this will happen if the user clicks a button
            // or upload a picture
            this.reply(this._("Which is interesting, because I'll take anything at all. Just type your mind!"));
        } else if (this.expecting === ValueCategory.Command) {
            this.reply(this._("I'm looking for a trigger, an action, or a query."));
        } else {
            this.reply(this._("In fact, I'm not even sure what I asked. Sorry!"));
        }
        this.manager.sendAskSpecial();
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

    done() {
        this.reply(this._("Consider it done."));
    }
    expect(expected) {
        this.expecting = expected;
        this.manager.expect(expected);
        this.manager.sendAskSpecial();
        return this.nextIntent();
    }

    ask(expected, question) {
        this.reply(question);
        return this.expect(expected).then((intent) => {
            if (expected === ValueCategory.YesNo)
                return intent.value.value;
            else
                return intent.value;
        });
    }
    askChoices(question, choices) {
        this.reply(question);
        this.expecting = ValueCategory.MultipleChoice;
        this.manager.expect(ValueCategory.MultipleChoice);
        this._choices = choices;
        for (let i = 0; i < choices.length; i++)
            this.replyChoice(i, 'choice', choices[i]);
        this.manager.sendAskSpecial();
        return this.nextIntent().then((intent) => intent.value);
    }
    reset() {
        this.manager.stats.hit('sabrina-abort');
        this.reply(this._("Sorry I couldn't help on that."));
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

    _cancel() {
        var e = new Error(this._("User cancelled"));
        e.code = 'ECANCELLED';
        this._cancelled = true;
        this._userInputQueue.cancelWait(e);
    }

    _handleGeneric(command) {
        if (command.isFailed || command.isFallback) {
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
                this.reply("I'm in the default state");
            else
                this.reply("I'm not in the default state");
            if (this.expecting === null)
                this.reply("I'm not expecting anything");
            else
                this.reply("I'm expecting a " + this.expecting);
            //for (var key of this.manager.stats.keys())
            //    this.reply(key + ": " + this.manager.stats.get(key));
            return true;
        }
        if (command.isHelp && command.name === null)
            return this._handleContextualHelp(command);
        if (command.isNeverMind) {
            this.reset();
            this._cancel();
            return true;
        }

        if (this.expecting !== null &&
            (!command.isAnswer || !categoryEquals(command.category, this.expecting))) {
            if (command.isYes) {
                this.reply(this._("Yes what?"));
                return true;
            } else if (command.isNo) {
                this.reset();
                this._cancel();
                return true;
            }

            if (this.expecting === ValueCategory.Command &&
                (command.isPrimitive || command.isHelp || command.isBack || command.isEmpty))
                return false;
            if (this.expecting === ValueCategory.Filter &&
                (command.isFilter || command.isBack))
                return false;

            // if given an answer of the wrong type have Almond complain
            if (command.isAnswer) {
                this.unexpected();
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
                this.reply(this._("Please click on one of the provided choices."));
                this.manager.resendChoices();
                return true;
            }
        }

        return false;
    }

    _isInDefaultState() {
        return this._notifyQueue.hasWaiter();
    }

    _handleContextualHelp(command) {
        if (this._isInDefaultState())
            // prevent replaying the command when we leave
            // this handle() promise by returning true
            return this._doInject(new Intent.Make(null)).then(() => true);
        if (this.expecting !== null) {
            return this.lookingFor();
        } else {
            this.reply(this._("Sure! How can I help you?"));
            this.reply(this._("Try 'help' followed by a device name to get example commands of that device, e.g., 'help twitter', or just give me a word and I'll try to find commands related to it."));
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
    dispatchNotify(appId, icon, messages) {
        let item = new QueueItem.Notification(appId, icon, messages);
        return this._pushQueueItem(item);
    }
    dispatchNotifyError(appId, icon, error) {
        let item = new QueueItem.Error(appId, icon, error);
        return this._pushQueueItem(item);
    }
    dispatchRunProgram(program) {
        let item = new QueueItem.RunProgram(program);
        return this._pushQueueItem(item);
    }

    start(showWelcome) {
        let promise = new Promise((callback, errback) => {
            this._mgrResolve = callback;
        });
        this._mgrPromise = promise;
        _generatorToAsync(loop)(this, showWelcome);
        return promise;
    }

    _pushQueueItem(item) {
        let resolve, reject;
        let promise = new Promise((callback, errback) => {
            resolve = callback;
            reject = errback;
        });
        this._notifyQueue.push({ item, resolve, reject });
        return promise;
    }

    _doInject(intent) {
        return this._mgrPromise.then(() => {
            let promise = new Promise((callback, errback) => {
                this._mgrResolve = callback;
            });
            this._mgrPromise = promise;
            if (this._isInDefaultState())
                // ignore errors from the queue item (we handle them elsewhere)
                this._pushQueueItem(QueueItem.UserInput(intent)).catch(() => {});
            else
                this._userInputQueue.push(intent);
            return promise;
        });
    }

    handleRaw(raw) {
        let intent = new Intent.Answer(null, ValueCategory.RawString, ThingTalk.Ast.Value.String(raw));
        return this.handle(intent);
    }
    handle(intent) {
        return Promise.resolve(this._handleGeneric(intent)).then((handled) => {
            if (handled)
                return;

            return this._doInject(intent);
        });
    }
}
