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
const path = require('path');
const fs = require('fs');

const ThingTalk = require('thingtalk');

const SemanticAnalyzer = require('./semantic');
const ValueCategory = SemanticAnalyzer.ValueCategory;
const DefaultDialog = require('./default_dialog');
const InitializationDialog = require('./init_dialog');
const SempreClient = require('./sempreclient');
const Helpers = require('./helpers');

function formatError(e) {
    if (e.name === 'SyntaxError') {
        return "Syntax error at line " + e.lineNumber + ": " + e.message;
    } else if (typeof e === 'string') {
        return e;
    } else if (e.message) {
        return e.message;
    } else {
        return e;
    }
}

module.exports = class Almond extends events.EventEmitter {
    constructor(engine, conversationId, user, delegate, options) {
        super();
        this._engine = engine;
        this._user = user;
        this._conversationId = conversationId;

        this._raw = false;
        this._options = options || {};
        this._debug = !!this._options.debug;

        this._delegate = delegate;
        this._initialized = false;
        this._dialog = null;

        this.sempre = new SempreClient(this._options.sempreUrl, engine.platform.locale);

        this._notifyQueue = [];
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

    notify(data) {
        if (!this._dialog || !this._dialog.notify(data[0], data[1], data[2]))
            this._notifyQueue.push(['notify', data]);
    }

    notifyError(data) {
        if (!this._dialog || !this._dialog.notifyError(data[0], data[1], data[2]))
            this._notifyQueue.push(['notifyError', data]);
    }

    _flushNotify() {
        var queue = this._notifyQueue;
        this._notifyQueue = [];
        queue.forEach(function(data) {
            this[data[0]](data[1]);
        }, this);
    }

    setDialog(dlg) {
        if (this._dialog)
            this._dialog.stop();
        this.prepare(dlg);
        this._dialog = dlg;

        dlg.start();
        this._flushNotify();
    }

    prepare(dlg) {
        dlg.manager = this;
        dlg.gettext = this.gettext;
        dlg.ngettext = this.ngettext;
        dlg.pgettext = this.pgettext;
        dlg._ = dlg.gettext;
        dlg.C_ = dlg.pgettext;
        dlg.N_ = this.N_;
    }

    switchToDefault(command) {
        this.expect(null);
        this.sendAskSpecial(null);
        this._dialog.switchTo(new DefaultDialog());
        if (command)
            return this._dialog.handle(command);
        else
            return true;
    }

    expect(expecting) {
        this._expecting = expecting;
        this._choices = [];
        this._raw = (expecting === ValueCategory.RawString);
    }

    start() {
        this._initialize();
    }

    _initialize() {
        if (this._initialized)
            return;

        if (this.platform.hasCapability('gettext') && this.platform.locale !== 'en-US') {
            var gettext = this.platform.getCapability('gettext');
            var modir = path.resolve(path.dirname(module.filename), '../po');
            try {
                gettext.loadTextdomainDirectory('sabrina', modir);
            } catch(e) {
                console.error('Failed to load translation file: ' + e.message);
            }
            this.gettext = function(string) {
                return gettext.dgettext('sabrina', string);
            };
            this.ngettext = function(msg, msgplural, count) {
                return gettext.dngettext('sabrina', msg, msgplural, count);
            }
            this.pgettext = function(msgctx, msg) {
                return gettext.dpgettext('sabrina', msgctx, msg);
            }
            this._ = this.gettext;
        } else {
            this.gettext = (msg) => msg;
            this.ngettext = (msg, msgp, n) => (n === 1 ? msg : msgp);
            this.pgettext = (ctx, msg) => msg;
            this._ = this.gettext;
        }

        this._initialized = true;
        this.setDialog(new InitializationDialog(this._options.showWelcome));
    }

    handleParsedCommand(analyzed) {
        this.stats.hit('sabrina-parsed-command');
        console.log('Received pre-parsed assistant command');

        return Q.try(() => {
            // we know with absolute certainty this is what the user wants
            // because he clicked on a button to do it
            return this._continueHandleCommand(null, [{ prob: 1, score: 'Infinity', answer: analyzed }]);
        }).then(function(handled) {
            if (!handled)
                this._dialog.fail();
        }.bind(this)).catch(function(e) {
            this.sendReply(this._("Sorry, I had an error processing your command: %s").format(formatError(e)));
            console.error(e.stack);
            this._dialog.failReset();
        }.bind(this));
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

            if (analyzed[0].score !== 'Infinity') {
                var max = 3;
                for (var candidate of analyzed) {
                    if (max == 0)
                        break;
                    max --;
                    var json = JSON.parse(top);
                    if (json.rule || json.trigger || json.action || json.query)
                        candidate.prob = 0.33;
                }
            }
            for (var candidate of analyzed) {
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
                for (var candidate of analyzed) {
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

            var analyzer = new SemanticAnalyzer(choice, command, this._lastUtterance, this._lastCandidates);
            if (!analyzer.isTrain) {
                this._lastUtterance = command;
                this._lastCandidates = candidates;
            }
            if (analyzer.exampleId !== null) {
                this.thingpedia.clickExample(analyzer.exampleId).catch((e) => {
                    console.error('Failed to record example click: ' + e.message);
                }).done();
            }

            return this._dialog.handle(analyzer);
        } else if (fallbacks.length > 0) {
            this._lastUtterance = command;
            this._lastCandidates = candidates;

            this.stats.hit('sabrina-command-ambiguous');
            console.log('Ambiguously analyzed message into', fallbacks);

            return this._dialog.handle(SemanticAnalyzer.makeFallbacks(command, fallbacks));
        } else {
            this._lastUtterance = command;
            this._lastCandidates = candidates;

            this.stats.hit('sabrina-failure');
            console.log('Failed to analyzed message');
            return this._dialog.handle(SemanticAnalyzer.makeFailed(command));
        }
    }

    handleCommand(command, postprocess) {
        this.stats.hit('sabrina-command');
        console.log('Received assistant command ' + command);

        return Q.try(() => {
            if (this._raw && command !== null)
                return this._dialog.handleRaw(command);

            return this.sempre.sendUtterance(command, this._expecting, this._choices).then((analyzed) => {
                if (postprocess)
                  postprocess(analyzed);
                return this._continueHandleCommand(command, analyzed);
            });
        }).then((handled) => {
            if (!handled) {
                this.stats.hit('sabrina-unhandled');
                this._dialog.fail();
            }
        }).catch(function(e) {
            this.sendReply(this._("Sorry, I had an error processing your command: %s").format(formatError(e)));
            console.error(e.stack);
            this._dialog.failReset();
        }.bind(this));
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

    sendAskSpecial(what) {
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
        return Helpers.presentSingleExample(this._dialog, utterance, targetJson);
    }
}
