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

const ThingTalk = require('thingtalk');
const Semantic = require('./semantic');
const Intent = Semantic.Intent;
const ValueCategory = Semantic.ValueCategory;
const ParserClient = require('./parserclient');
const Helpers = require('./helpers');
const Dispatcher = require('./dispatcher');

const DEFAULT_GETTEXT = {
    dgettext: (domain, msg) => msg,
    dngettext: (domain, msg, msgp, n) => (n === 1 ? msg : msgp),
    dpgettext: (domain, ctx, msg) => msg,
};

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
        };
        this._pgettext = function(msgctx, msg) {
            return gettext.dpgettext('almond', msgctx, msg);
        };
        this._ = function(string) {
            return gettext.dgettext('almond', string);
        };

        this._raw = false;
        this._options = options || {};
        this._debug = !!this._options.debug;

        this._delegate = delegate;
        this.parser = new ParserClient(this._options.sempreUrl, engine.platform.locale);

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

    get permissions() {
        return this._engine.permissions;
    }

    notify() {
        return this._dispatcher.dispatchNotify.apply(this._dispatcher, arguments);
    }

    notifyError() {
        return this._dispatcher.dispatchNotifyError.apply(this._dispatcher, arguments);
    }

    askForPermission() {
        return this._dispatcher.dispatchAskForPermission.apply(this._dispatcher, arguments);
    }

    askQuestion() {
        return this._dispatcher.dispatchAskQuestion.apply(this._dispatcher, arguments);
    }

    interactiveConfigure() {
        return this._dispatcher.dispatchInteractiveConfigure.apply(this._dispatcher, arguments);
    }

    runProgram() {
        return this._dispatcher.dispatchRunProgram.apply(this._dispatcher, arguments);
    }

    expect(expecting) {
        this._expecting = expecting;
        this._choices = [];
        this._raw = (expecting === ValueCategory.RawString);
    }

    start() {
        return this._dispatcher.start(this._options.showWelcome);
    }

    handleParsedCommand(root) {
        this.stats.hit('sabrina-parsed-command');
        this.emit('active');
        if (this._debug)
            console.log('Received pre-parsed assistant command');
        if (root.example_id) {
            this.thingpedia.clickExample(root.example_id).catch((e) => {
                console.error('Failed to record example click: ' + e.message);
            });
        }

        return Intent.parse(root.code, root.entities, this.schemas, null, this._lastUtterance, this._lastCandidates)
            .then((intent) => this._doHandleCommand(intent, null, [])).catch((e) => {
                this.sendReply(this._("Sorry, I had an error processing your command: %s").format(e.message));
                console.error(e.stack);
            });
    }

    handleThingTalk(thingtalk) {
        this.stats.hit('sabrina-thingtalk-command');
        this.emit('active');
        if (this._debug)
            console.log('Received ThingTalk program');

        return Intent.parseProgram(thingtalk, this.schemas)
            .then((intent) => this._doHandleCommand(intent, null, [])).catch((e) => {
                this.sendReply(this._("Sorry, I had an error processing your command: %s").format(e.message));
                console.error(e.stack);
            });
    }

    _doHandleCommand(intent, command, candidates) {
        if (!intent.isTrain) {
            this._lastUtterance = command;
            this._lastCandidates = candidates;
        }

        return this._dispatcher.handle(intent);
    }

    _continueHandleCommand(command, analyzed) {
        // parse all code sequences into an Intent
        // this will correctly filter out anything that does not parse
        if (analyzed.candidates.length > 0)
            console.log('Analyzed message into ' + analyzed.candidates[0].join(' '));
        else
            console.log('Failed to analyze message');
        return analyzed.candidates.map((candidate, beamposition) => {
            return Intent.parse(candidate.code, this.schemas, command, this._lastUtterance, this._lastCandidates).catch((e) => {
                // Likely, a type error in the ThingTalk code; not a big deal, but we still log it
                console.log(`Failed to parse beam ${beamposition}: ${e.message}`);
                return null;
            });
        }).filter((c) => c !== null).then((candidates) => {
            // here we used to do a complex heuristic dance of probabilities and confidence scores
            // we do none of that, because Almond-NNParser does not give us useful scores

            if (candidates.length > 0) {
                let choice = candidates[0];

                this.stats.hit('sabrina-command-good');
                return this._doHandleCommand(choice, command, analyzed.candidates);
            } else {
                this._lastUtterance = command;
                this._lastCandidates = candidates;

                this.stats.hit('sabrina-failure');
                return this._dispatcher.handle(Intent.Failed(command));
            }
        });
    }

    handleCommand(command, postprocess) {
        this.stats.hit('sabrina-command');
        this.emit('active');
        if (this._debug)
            console.log('Received assistant command ' + command);

        return Promise.resolve().then(() => {
            if (this._raw && command !== null) {
                let intent = new Intent.Answer(null, ValueCategory.RawString, ThingTalk.Ast.Value.String(command));
                return this._doHandleCommand(intent, command, []);
            }

            return this.parser.sendUtterance(command, this._expecting, this._choices).then((analyzed) => {
                if (postprocess)
                    postprocess(analyzed);
                return this._continueHandleCommand(command, analyzed);
            });
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
        return Helpers.presentSingleExample(this._dispatcher, utterance, targetJson);
    }
}
module.exports.Intent = Intent;
