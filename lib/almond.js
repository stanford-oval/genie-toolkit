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
const path = require('path');

const Semantic = require('./semantic');
const Intent = Semantic.Intent;
const ValueCategory = Semantic.ValueCategory;
const SempreClient = require('./sempreclient');
const Helpers = require('./helpers');
const Dispatcher = require('./dispatcher');


const DEFAULT_GETTEXT = {
    dgettext: (domain, msg) => msg,
    dngettext: (domain, msg, msgp, n) => (n === 1 ? msg : msgp),
    dpgettext: (domain, ctx, msg) => msg,
}
const N_ = (msg) => msg;

module.exports = class Almond extends events.EventEmitter {
    constructor(engine, conversationId, user, delegate, options) {
        super();
        this._engine = engine;
        this._user = user;
        this._conversationId = conversationId;
        this._gettext = this._engine.platform.getCapability('gettext');
        if (!this._gettext)
            this._gettext = DEFAULT_GETTEXT;
        let gettext = this._gettext;
        this._ngettext = function(msg, msgplural, count) {
            return gettext.dngettext('almond', msg, msgplural, count);
        }
        this._pgettext = function(msgctx, msg) {
            return gettext.dpgettext('almond', msgctx, msg);
        }
        this._ = function(string) {
            return gettext.dgettext('almond', string);
        };

        this._raw = false;
        this._options = options || {};
        this._debug = !!this._options.debug;

        this._delegate = delegate;
        this.sempre = new SempreClient(this._options.sempreUrl, engine.platform.locale);

        this._dispatcher = new Dispatcher(this);
        this._choices = [];

        this._lastUtterance = null;
        this._lastCandidates = null;
    }

    get id() {
        return this._conversationId;
    }

    get user() {
        return this._user;
    }

    get platform() {
        return this._engine.platform;
    }

    get gettext() {
        return this._gettext;
    }

    get stats() {
        return this._engine.stats;
    }

    get apps() {
        return this._engine.apps;
    }

    get devices() {
        return this._engine.devices;
    }

    get messaging() {
        return this._engine.messaging;
    }

    get sparql() {
        return this._engine.sparql;
    }

    get schemas() {
        return this._engine.schemas;
    }

    get thingpedia() {
        return this._engine.thingpedia;
    }

    get discovery() {
        return this._engine.discovery;
    }

    get ml() {
        return this._engine.ml;
    }

    get remote() {
        return this._engine.remote;
    }

    notify(data) {
        return this._dispatcher.dispatchNotify(...data);
    }

    notifyError(data) {
        return this._dispatcher.dispatchNotifyError(...data);
    }

    askForPermission(data) {
        return this._dispatcher.dispatchAskForPermission(...data);
    }

    askQuestion(data) {
        return this._dispatcher.dispatchAskQuestion(...data);
    }

    interactiveConfigure(data) {
        return this._dispatcher.dispatchInteractiveConfigure(...data);
    }

    expect(expecting) {
        this._expecting = expecting;
        this._choices = [];
        this._raw = (expecting === ValueCategory.RawString);
    }

    start() {
        return this._dispatcher.start(this._options.showWelcome);
    }

    handleParsedCommand(analyzed) {
        this.stats.hit('sabrina-parsed-command');
        this.emit('active');
        if (this._debug)
            console.log('Received pre-parsed assistant command');

        return Promise.resolve().then(() => this._doHandleCommand(analyzed, null, [])).catch((e) => {
            this.sendReply(this._("Sorry, I had an error processing your command: %s").format(e.message));
        });
    }

    handleThingTalk(thingtalk) {
        this.stats.hit('sabrina-thingtalk-command');
        this.emit('active');
        if (this._debug)
            console.log('Received ThingTalk program');

        return Promise.resolve().then(() => Intent.parseProgram(thingtalk, this.schemas)).then((intent) => {
            return this._dispatcher.handle(intent);
        }).catch((e) => {
            this.sendReply(this._("Sorry, I had an error processing your command: %s").format(e.message));
        });
    }

    _doHandleCommand(choice, command, candidates) {
        return Intent.parseString(choice, this.schemas, command, this._lastUtterance, this._lastCandidates).then((intent) => {
            if (!intent.isTrain) {
                this._lastUtterance = command;
                this._lastCandidates = candidates;
            }
            if (intent.exampleId) {
                this.thingpedia.clickExample(intent.exampleId).catch((e) => {
                    console.error('Failed to record example click: ' + e.message);
                }).done();
            }

            return this._dispatcher.handle(intent);
        });
    }

    _continueHandleCommand(command, analyzed) {
        var choice = null;
        var fallbacks = [];

        if (analyzed.length === 0) {
            // this is pretty much only possible with BeamParser, because
            // FloatingParser will rather respond garbage (with negative scores
            // and weird probabilities) than nothing
            console.log('Failed to analyze message (no candidate parses)');
        } else {
            // figure out the probability of the topmost choice
            // we sum the reported probabilities for all the first choices that
            // are equal because sometimes FloatingParser reaches the same conclusion
            // through different paths
            // in that case, it's even more likely we have the right answer
            var effectiveProb = 0;
            var top = analyzed[0].answer;

            if (analyzed[0].score !== 'Infinity' && this._expecting === null) {
                var max = 3;
                for (let candidate of analyzed) {
                    if (max === 0)
                        break;
                    max --;
                    var json = JSON.parse(top);
                    if (json.rule || json.trigger || json.action || json.query)
                        candidate.prob = 0.33;
                }
            }
            for (let candidate of analyzed) {
                if (candidate.answer === top)
                    effectiveProb += candidate.prob;
                else
                    break;
            }

            if (top === '{"special":{"id":"tt:root.special.failed"}}') {
                // if SEMPRE claims we have failed to parse, then we have definitely
                // failed to parse and we should hit the fallbacks
                choice = null;
            } else if (effectiveProb > 0.9) {
                // if we know with 90% confidence this is the right answer, just
                // run with it
                choice = top;
            } else if (effectiveProb > 0.5 && analyzed[0].score >= 0) {
                // if we're only somewhat confident in this answer, only run with it
                // if the score is positive, which is usually an indicator we didn't
                // collect too many negative features
                // effectively, the goal here is to find bad parses that get high
                // probability because everything is equally bad
                // in particular, we will find bad parses that leave too much of
                // the sentence uncovered (so are likely to miss a parameter)
                choice = top;
            } else {
                // ok, we didn't get a satisfactory parse
                //
                // there are many possibilities here:
                // 1) all parses are low score and the scores are almost homogeneous,
                // including those we don't show the user
                // this case just means there is learning to do
                // 2) a few parses are good but we can't pick the best one among them
                // this means the sentence is ambiguous (eg, just the word "post",
                // could be post on twitter, on facebook, on instagram...)
                // 3) all parses are terrible but the learning went sideways
                // and we get meaningless high-confidence results (eg. "dogs" gets
                // parsed to either "cool" or "hello" with high confidence)
                //
                // in case 1, we want to show the choices and learn from them, so
                // the next time we go straight to understanding
                // in case 2, we want to show the choices and don't learn - learning
                // would just confuse us
                // in case 3, we should just shut up, look away, and claim we did not
                // understand (or go with the fallback search)
                //
                // unfortunately we don't have a good way to separate these
                //
                // heuristically we separate 3 from 2+1 by removing parses with
                // low score in addition to parses with low confidence, on the hope
                // that if the learning gets lost in the woods it would at least
                // pick some really low score
                // we separate 2 from 1 by looking at the number of words (minus stop
                // words) that the user picked: one words means the user is "searching
                // by keyword" and just wants to see what's possible; two or more
                // means the user wants something to happen
                // this second heuristic is implemented in fallback_dialog.js, because
                // we run it for searches in the thingpedia database too, on the account
                // that some stuff might be there and not have been picked up by
                // FloatingParser
                //
                // in fact, in this stage of development we don't actually separate
                // 2 from 1 and learn everything with absolute confidence
                // the user can always override the training with the train button
                fallbacks = [];
                for (let candidate of analyzed) {
                    if (fallbacks.length >= 5)
                        break;
                    if (candidate.prob < 0.20 || candidate.score < -20)
                        break;
                    fallbacks.push(candidate.answer);
                }
            }
        }

        var candidates = analyzed.map((a) => a.answer);

        if (choice !== null) {
            this.stats.hit('sabrina-command-good');
            console.log('Confidently analyzed message into ' + choice);

            return this._doHandleCommand(choice, command, candidates);
        } else if (fallbacks.length > 0) {
            this._lastUtterance = command;
            this._lastCandidates = candidates;

            this.stats.hit('sabrina-command-ambiguous');
            console.log('Ambiguously analyzed message into', fallbacks);

            return this._dispatcher.handle(Intent.Fallback(command, fallbacks));
        } else {
            this._lastUtterance = command;
            this._lastCandidates = candidates;

            this.stats.hit('sabrina-failure');
            console.log('Failed to analyzed message');
            return this._dispatcher.handle(Intent.Failed(command));
        }
    }

    handleCommand(command, postprocess) {
        this.stats.hit('sabrina-command');
        this.emit('active');
        if (this._debug)
            console.log('Received assistant command ' + command);

        if (this._raw && command !== null)
            return this._dispatcher.handleRaw(command);

        return this.sempre.sendUtterance(command, this._expecting, this._choices).then((analyzed) => {
            if (postprocess)
                postprocess(analyzed);
            return this._continueHandleCommand(command, analyzed);
        }).catch((e) => {
            this.sendReply(this._("Sorry, I had an error processing your command: %s").format(e.message));
        });
    }

    sendReply(message, icon) {
        if (this._debug)
            console.log('Almond Says: ' + message);
        return this._delegate.send(message, icon);
    }

    sendPicture(url, icon) {
        if (this._debug)
            console.log('Almond sends picture: '+ url);
        return this._delegate.sendPicture(url, icon);
    }

    sendRDL(rdl, icon) {
        if (this._debug)
            console.log('Almond sends RDL: '+ rdl.callback);
        return this._delegate.sendRDL(rdl, icon);
    }

    sendChoice(idx, what, title, text) {
        if (this._expecting !== ValueCategory.MultipleChoice)
            console.log('UNEXPECTED: sendChoice while not expecting a MultipleChoice');

        this._choices[idx] = { what: what, title: title, text: text };
        if (this._debug)
            console.log('Almond sends multiple choice button: '+ title);
        return this._delegate.sendChoice(idx, what, title, text);
    }

    resendChoices() {
        if (this._expecting !== ValueCategory.MultipleChoice)
            console.log('UNEXPECTED: sendChoice while not expecting a MultipleChoice');

        return Q.all(this._choices.map((choice, idx) => {
            return this._delegate.sendChoice(idx, choice.what, choice.title, choice.text);
        }));
    }

    sendButton(title, json) {
        if (this._debug)
            console.log('Almond sends generic button: '+ title);
        return this._delegate.sendButton(title, json);
    }

    sendLink(title, url) {
        if (this._debug)
            console.log('Almond sends link: '+ url);
        return this._delegate.sendLink(title, url);
    }

    sendAskSpecial() {
        let what = ValueCategory.toAskSpecial(this._expecting);

        if (this._debug) {
            if (what !== null && what !== 'generic')
                console.log('Almond sends a special request');
            else if (what !== null)
                console.log('Almond expects an answer');
        }
        return this._delegate.sendAskSpecial(what);
    }

    // HACK HACK HACK! we want to get a template when we click the autocomplete
    // in the android app
    // this is how we gather the required data to build it on the app side
    // this method is called manually by app.js in android
    presentSingleExample(utterance, targetJson) {
        this.switchToDefault();
        return Helpers.presentSingleExample(this._dispatcher, utterance, targetJson);
    }
}
module.exports.Intent = Intent;
