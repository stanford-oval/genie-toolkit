// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');

const Dialog = require('./dialog');
const Semantic = require('./semantic');
const Intent = Semantic.Intent;
const ValueCategory = Semantic.ValueCategory;

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

module.exports = class StateMachineDialog extends Dialog {
    constructor(fn) {
        super();

        this._fn = fn;
        this._choices = null;
        // for compatibility, until async/await becomes a standard
        if (Object.getPrototypeOf(fn) === Object.getPrototypeOf(function*(){}))
            this._fn = _generatorToAsync(fn);

        let self = this;
        this._dlg = {
            nextIntent: this._nextIntent.bind(this),
            reply(msg, icon) {
                this.manager.sendReply(msg, icon || this.icon);
            },
            replyRDL(rdl, icon) {
                this.manager.sendRDL(rdl, icon || this.icon);
            },
            replyChoice(idx, what, title, text) {
                this.manager.sendChoice(idx, what, title, text);
            },
            replyButton(text, json) {
                this.manager.sendButton(text, json);
            },
            replyPicture(url, icon) {
                this.manager.sendPicture(url, icon || this.icon);
            },
            replyLink(title, url) {
                this.manager.sendLink(title, url);
            },
            done: () => {
                this.done();
            },
            ask: (expected, question) => {
                this.ask(expected, question);
                return this._nextIntent().then((intent) => intent.value);
            },
            askChoices: (question, choices) => {
                this.ask(ValueCategory.MultipleChoice, question);
                this._choices = choices;
                for (let i = 0; i < choices.length; i++)
                    this.replyChoice(i, 'choice', choices[i]);
                return this._nextIntent().then((intent) => intent.value);
            },
            reset: () => {
                this.reset();
            },

            get icon() {
                return self.icon;
            },
            set icon(v) {
                self.icon = v;
            }
        }

        this._fnResolve = null;
        this._fnReject = null;
        this._mgrResolve = null;
        this._mgrReject = null;
        this._cancelled = false;
    }

    _nextIntent() {
        if (this._mgrResolve)
            this._mgrResolve(true);

        return new Promise((callback, errback) => {
            this._fnResolve = callback;
            this._fnReject = errback;
        });
    }

    // if the user switches away, then fail the dialog
    // (this will have no effect if we already completed it)
    switchToDefault() {
        this._cancel();
        return super.switchToDefault.apply(this, arguments);
    }
    switchTo() {
        this._cancel();
        return super.switchTo.apply(this, arguments);
    }
    _cancel() {
        var e = new Error(this._("User cancelled"));
        e.code = 'ECANCELLED';
        this._cancelled = true;
        this._fnReject(e);
    }

    start() {
        this._dlg.manager = this.manager;
        this._dlg._ = this._;
        this._nextIntent().then((intent) => this._fn(this._dlg, intent)).then(() => {
            this._mgrResolve(true);
        }).catch((e) => {
            if (this._cancelled)
                return;
            if (this._mgrReject) {
                this._mgrReject(e);
            } else {
                console.error('Unexpected error in dialog: '+ e.message);
                console.error(e.stack);
                this.failReset();
            }
        });
    }

    _doInject(intent) {
        //this.expect(null);
        return new Promise((callback, errback) => {
            this._mgrResolve = callback;
            this._mgrReject = errback;

            this._fnResolve(intent);
        });
    }

    handleRaw(raw) {
        if (this.expecting === ValueCategory.RawString) {
            return this._doInject(Intent.Answer(ValueCategory.RawString, ThingTalk.Ast.Value.String(raw)));
        } else {
            return super.handleRaw(raw);
        }
    }

    handle(intent) {
        return this.handleGeneric(intent).then((handled) => {
            if (handled)
                return true;

            if (this.expecting === ValueCategory.MultipleChoice) {
                let index = intent.value;
                if (index !== Math.floor(index) ||
                    index < 0 ||
                    index > this._choices.length) {
                    this.reply(this._("Please click on one of the provided choices."));
                    this.manager.resendChoices();
                    return true;
                }
            }

            return this._doInject(intent);
        });
    }
};
