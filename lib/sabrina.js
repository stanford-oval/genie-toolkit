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
const path = require('path');
const fs = require('fs');

const ThingTalk = require('thingtalk');

const SemanticAnalyzer = require('./semantic');
const DefaultDialog = require('./default_dialog');
const InitializationDialog = require('./init_dialog');
const SempreClient = require('./sempreclient');

module.exports = class Sabrina extends events.EventEmitter {
    constructor(engine, user, delegate, debug, sempreUrl) {
        super();
        this._engine = engine;
        this._user = user;

        this._raw = false;
        this._debug = debug;

        this._delegate = delegate;
        this._initialized = false;
        this._dialog = null;

        this.sempre = new SempreClient(sempreUrl, engine.platform.locale);

        this._notifyQueue = [];
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

    notify(data) {
        if (!this._dialog || !this._dialog.notify(data[0], data[1]))
            this._notifyQueue.push(data);
    }

    _flushNotify() {
        var queue = this._notifyQueue;
        this._notifyQueue = [];
        queue.forEach(function(data) {
            this.notify(data);
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

    switchToDefault() {
        this._dialog.switchTo(new DefaultDialog());
        return true;
    }

    setRaw(raw) {
        this._raw = raw;
    }

    start() {
        this._initialize();
    }

    _initialize() {
        if (this._initialized)
            return;

        if (this.platform.hasCapability('gettext') && this.platform.locale !== 'en_US' && this.platform.locale !== 'en_US.utf8') {
            var locale = this.platform.locale.split(/[-_\.@]/);
            var gettext = this.platform.getCapability('gettext');
            var modir = path.resolve(path.dirname(module.filename), '../po');
            var mo = modir + '/' + locale.join('_') + '.mo';
            console.log('mo', mo);
            while (!fs.existsSync(mo) && locale.length) {
                locale.pop();
                mo = modir + '/' + locale.join('_') + '.mo';
            }
            try {
                gettext.addTextdomain("sabrina", fs.readFileSync(mo));
            } catch(e) {
                console.error('Failed to load translation file: ' + e.message);
            }
            this.gettext = function(string) {
                return gettext.dgettext("sabrina", string);
            };
            this.ngettext = function(msg, msgplural, count) {
                return gettext.dngettext('sabrina', msg, msgplural, count);
            }
            this.pgettext = function(msgctx, msg) {
                return gettext.dpgettext('sabrina', msgctx, msg);
            }
            this._ = this.gettext;
            this.C_ = this.pgettext;
        } else {
            this.gettext = (msg) => msg;
            this.ngettext = (msg, msgp, count) => msg;
            this.pgettext = (ctx, msg) => msg;
            this._ = this.gettext;
            this.C_ = this.gettext;
        }
        this.N_ = (msg) => msg;

        this._initialized = true;
        this.setDialog(new InitializationDialog());
    }

    handleParsedCommand(analyzed) {
        this.stats.hit('sabrina-parsed-command');
        console.log('Received pre-parsed assistant command');

        return Q.try(() => {
            // we know with absolute certainty this is what the user wants
            // because he clicked on a button to do it
            return this._continueHandleCommand(null, [{ prob: 1, score: Infinity, answer: analyzed }]);
        }).then(function(handled) {
            if (!handled)
                this._dialog.fail();
        }.bind(this)).catch(function(e) {
            this.sendReply(this._("Sorry, I had an error processing your command: %s").format(e.message));
            console.error(e.stack);
            this._dialog.failReset();
        }.bind(this));
    }

    _continueHandleCommand(command, analyzed) {
        var choice = null;
        var fallbacks = [];
        var learnFromFallback = undefined;

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

            for (var candidate of analyzed) {
                if (candidate.answer === top)
                    effectiveProb += candidate.prob;
                else
                    break;
            }
            if (effectiveProb > 0.9) {
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
                // we want to run a fallback to the user from which we can learn
                // we don't want to show all possible choices to the user, so we
                // trim it down to 5
                // (incidentally, 5 is also how many candidates we get from sempre
                // in the first place, but that might change)
                // we can't threshold on score, because chance is all scores
                // are terrible (this is true even of good parses), so we threshold
                // on probability
                fallbacks = [];
                for (var candidate of analyzed) {
                    if (fallbacks.length >= 5)
                        break;
                    if (candidate.prob < 0.15)
                        break;
                    fallbacks.push(candidate.answer);
                }
                // there are two possibilities here:
                // 1) all parses are kind of equally bad, including those we don't
                // show the user
                // this case just means there is learning to do
                // 2) a few parses are good but we can't pick the best one among them
                // this means the sentence is ambiguous (eg, just the word "post",
                // could be post on twitter, on facebook, on instagram...)
                // in this case we don't want to learn!
                // finally, note that an untrained model will give all parses a
                // probability of about 0.038; this does not pass the threshold above
                // so we have no fallback and we go through the "search the database"
                // fallback instead
                learnFromFallback = fallbacks.length === 5;
            }
        }

        if (choice !== null) {
            this.stats.hit('sabrina-command-good');
            console.log('Confidently analyzed message into ' + choice);

            var parsed = JSON.parse(choice);
            var analyzer = new SemanticAnalyzer(parsed);
            return this._dialog.handle(analyzer);
        } else if (fallbacks.length > 0) {
            this.stats.hit('sabrina-command-ambiguous');
            console.log('Ambiguously analyzed message into', fallbacks);

            return this._dialog.handle(SemanticAnalyzer.makeFallbacks(command, fallbacks, learnFromFallback));
        } else {
            this.stats.hit('sabrina-failure');
            console.log('Failed to analyzed message');
            return this._dialog.handle(SemanticAnalyzer.makeFailed(command));
        }
    }

    handleCommand(command) {
        this.stats.hit('sabrina-command');
        console.log('Received assistant command ' + command);

        return Q.try(() => {
            if (this._raw && command !== null)
                return this._dialog.handleRaw(command);

            return this.sempre.sendUtterance(command).then((analyzed) => {
                return this._continueHandleCommand(command, analyzed);
            });
        }).then((handled) => {
            if (!handled) {
                this.stats.hit('sabrina-unhandled');
                this._dialog.fail();
            }
        }).catch(function(e) {
            this.sendReply(this._("Sorry, I had an error processing your command: %s").format(e.message));
            console.error(e.stack);
            this._dialog.failReset();
        }.bind(this));
    }

    sendReply(message) {
        if (this._debug)
            console.log('Sabrina Says: ' + message);
        if (this._delegate)
            return this._delegate.send(message);
        else
            return Q();
    }

    sendPicture(url) {
        if (this._debug)
            console.log('Sabrina sends picture: '+ url);
        if (this._delegate)
            return this._delegate.sendPicture(url);
        else
            return Q();
    }

    sendRDL(rdl) {
        if (this._debug)
            console.log('Sabrina sends RDL: '+ rdl.callback);
        if (this._delegate)
            return this._delegate.sendRDL(rdl);
        else
            return Q();
    }

    sendChoice(idx, what, title, text) {
        if (this._debug)
            console.log('Sabrina sends multiple choice button: '+ title);
        if (this._delegate)
            return this._delegate.sendChoice(idx, what, title, text);
        else
            return Q();
    }

    sendButton(title, json) {
        if (this._debug)
            console.log('Sabrina sends generic button: '+ title);
        if (this._delegate)
            return this._delegate.sendButton(title, json);
        else
            return Q();
    }

    sendLink(title, url) {
        if (this._debug)
            console.log('Sabrina sends link: '+ url);
        if (this._delegate)
            return this._delegate.sendLink(title, url);
        else
            return Q();
    }

    sendAskSpecial(what) {
        if (this._debug)
            console.log('Sabrina sends a special request');
        if (this._delegate)
            return this._delegate.sendAskSpecial(what);
        else
            return Q();
    }
}
