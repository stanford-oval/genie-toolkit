// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const events = require('events');

const interpolate = require('string-interp');
const ThingTalk = require('thingtalk');

const ParserClient = require('../prediction/parserclient');

const UserInput = require('./user-input');
const ValueCategory = require('./value-category');
const Dispatcher = require('./dispatcher');

const DEFAULT_GETTEXT = {
    dgettext: (domain, msg) => msg,
    dngettext: (domain, msg, msgp, n) => (n === 1 ? msg : msgp),
    dpgettext: (domain, ctx, msg) => msg,
};

const DummyStatistics = {
    hit() {
    }
};

module.exports = class Conversation extends events.EventEmitter {
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

        this._stats = this._engine.platform.getCapability('statistics');
        if (this._stats === null)
            this._stats = DummyStatistics;

        this._raw = false;
        this._options = options || {};
        this._debug = !!this._options.debug;

        this._delegate = delegate;
        this._prefs = engine.platform.getSharedPreferences();
        this.parser = ParserClient.get(this._options.sempreUrl, engine.platform.locale, engine.platform);

        this._dispatcher = new Dispatcher(this, this._engine, this._debug);
        this._choices = [];
        this._context = {
            timeout: Infinity,
            code: 'null',
            entities: {}
        };

        this._lastCommand = null;
        this._lastCandidates = null;
    }

    get isAnonymous() {
        return this._options.anonymous;
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

    get locale() {
        return this._engine.platform.locale;
    }

    get timezone() {
        return this._engine.platform.timezone;
    }

    get gettext() {
        return this._gettext;
    }

    get stats() {
        return this._stats;
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

    notify() {
        return this._dispatcher.dispatchNotify.apply(this._dispatcher, arguments);
    }

    notifyError() {
        return this._dispatcher.dispatchNotifyError.apply(this._dispatcher, arguments);
    }

    expect(expecting) {
        this._expecting = expecting;
        this._choices = [];
        this._raw = (expecting === ValueCategory.RawString || expecting === ValueCategory.Password);
    }

    async start() {
        await this._parser.start();
        await this._dispatcher.init();
        return this._dispatcher.start(this._options.showWelcome, this._options.configureMessaging);
    }

    async stop() {
        await this._parser.stop();
    }

    _isUnsupportedError(e) {
        // FIXME there should be a better way to do this

        // 'xxx has no actions yyy' or 'xxx has no queries yyy'
        // quite likely means that the NN worked but it produced a device that
        // was not approved yet (otherwise the NN itself would catch the invalid function and
        // skip this result) and we don't have the necessary developer key
        // in that case, we reply to the user that the command is unsupported
        return /(invalid kind| has no (quer(ies|y)|actions?)) /i.test(e.message);
    }

    handleParsedCommand(root, platformData = {}) {
        this.stats.hit('sabrina-parsed-command');
        this.emit('active');
        if (this._debug)
            console.log('Received pre-parsed assistant command');
        if (typeof root === 'string')
            root = JSON.parse(root);
        if (root.example_id) {
            this.thingpedia.clickExample(root.example_id).catch((e) => {
                console.error('Failed to record example click: ' + e.message);
            });
        }

        return this._errorWrap(async () => {
            const intent = await UserInput.parse(root, this.schemas, this._getContext(null, platformData));
            return this._doHandleCommand(intent, null, [], true);
        }, platformData);
    }

    handleThingTalk(thingtalk, platformData = {}) {
        this.stats.hit('sabrina-thingtalk-command');
        this.emit('active');
        if (this._debug)
            console.log('Received ThingTalk program');

        return this._errorWrap(async () => {
            const intent = await UserInput.parseThingTalk(thingtalk, this.schemas, this._getContext(null, platformData));
            return this._doHandleCommand(intent, null, [], true);
        }, platformData);
    }

    // set confident = true only if
    // 1) we are not dealing with natural language (code, gui, etc), or
    // 2) we find an exact match
    _doHandleCommand(intent, analyzed, candidates, confident=false) {
        this._lastCommand = analyzed;
        this._lastCandidates = candidates;
        return this._dispatcher.handle(intent, confident);
    }

    _getContext(currentCommand, platformData) {
        return {
            command: currentCommand,
            previousCommand: this._lastCommand,
            previousCandidates: this._lastCandidates,
            platformData: platformData
        };
    }

    setContext(context, options = {}) {
        if (context === null) {
            this._context = {
                timeout: Infinity,
                code: 'null',
                entities: {}
            };
        } else {
            // timeout after 5 minutes
            let timeout = Date.now() + 300000;

            const entities = {};
            options.allocateEntities = true;
            const code = ThingTalk.NNSyntax.toNN(context, '', entities, options).join(' ');

            this._context = { timeout, code, entities };
        }
    }

    async generateAnswer(policyPrediction) {
        const targetAct = ThingTalk.NNSyntax.toNN(policyPrediction, '', this._context.entities, {
            allocateEntities: true
        }).join(' ');
        const result = await this.parser.generateUtterance(this._context, targetAct);
        return result.candidates[0].answer;
    }

    _continueHandleCommand(command, analyzed, platformData) {
        analyzed.utterance = command;
        // parse all code sequences into an Intent
        // this will correctly filter out anything that does not parse
        if (analyzed.candidates.length > 0)
            console.log('Analyzed message into ' + analyzed.candidates[0].code.join(' '));
        else
            console.log('Failed to analyze message');
        return Promise.all(analyzed.candidates.map(async (candidate, beamposition) => {
            let parsed;
            try {
                parsed = await UserInput.parse({ code: candidate.code, entities: analyzed.entities }, this.schemas, this._getContext(command, platformData));
            } catch(e) {
                // Likely, a type error in the ThingTalk code; not a big deal, but we still log it
                console.log(`Failed to parse beam ${beamposition}: ${e.message}`);

                if (this._isUnsupportedError(e))
                    parsed = new UserInput.Unsupported(platformData);
                else
                    return null;
            }
            return { target: parsed, score: candidate.score };
        })).then((candidates) => candidates.filter((c) => c !== null)).then((candidates) => {
            // here we used to do a complex heuristic dance of probabilities and confidence scores
            // we do none of that, because Almond-NNParser does not give us useful scores

            if (candidates.length > 0) {
                let i = 0;
                let choice = candidates[i];
                while (i < candidates.length-1 && choice.target.isUnsupported && choice.score === 'Infinity') {
                    i++;
                    choice = candidates[i];
                }

                this.stats.hit('sabrina-command-good');
                const confident = choice.score === 'Infinity' || this._context.code !== 'null';
                return this._doHandleCommand(choice.target, analyzed, analyzed.candidates, confident);
            } else {
                this._lastCommand = analyzed;
                this._lastCandidates = candidates;

                this.stats.hit('sabrina-failure');
                return this._dispatcher.handle(new UserInput.Failed(command, platformData));
            }
        });
    }

    async _errorWrap(fn, platformData) {
        try {
            try {
                await fn();
            } catch(e) {
                if (this._isUnsupportedError(e))
                    await this._doHandleCommand(new UserInput.Unsupported(platformData), null, [], true);
                else
                    throw e;
            }
        } catch(e) {
            if (e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT') {
                await this.sendReply('Sorry, I cannot contact the Almond service. Please check your Internet connection and try again later.', null);
            } else {
                await this.sendReply(interpolate(this._("Sorry, I had an error processing your command: ${error}"), {
                    error: e.message
                }, { locale: this.platform.locale, timezone: this.platform.timezone }), null);
            }
        }
    }

    _sendUtterance(utterance) {
        let contextCode, contextEntities;
        if (this._prefs.get('experimental-contextual-model')) {
            const now = new Date;
            if (this._context.timeout > now) {
                contextCode = this._context.code;
                contextEntities = this._context.entities;
            } else {
                contextCode = 'null';
                contextEntities = {};
            }
        }
        return this._parser.sendUtterance(utterance, contextCode, contextEntities, {
            expect: this._expecting,
            choices: this._choices,
            store: this._prefs.get('sabrina-store-log') || 'no'
        });
    }

    handleCommand(command, platformData = {}, postprocess) {
        this.stats.hit('sabrina-command');
        this.emit('active');
        if (this._debug)
            console.log('Received assistant command ' + command);

        return this._errorWrap(async () => {
            if (this._raw && command !== null) {
                let intent = new UserInput.Answer(new ThingTalk.Ast.Value.String(command), platformData);
                return this._doHandleCommand(intent, command, [], true);
            }

            const analyzed = await this._sendUtterance(command);
            if (postprocess)
                postprocess(analyzed);
            return this._continueHandleCommand(command, analyzed, platformData);
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

        return Promise.all(this._choices.map((choice, idx) => {
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

    async sendAskSpecial() {
        let what = ValueCategory.toAskSpecial(this._expecting);

        if (this._debug) {
            if (what !== null && what !== 'generic')
                console.log('Almond sends a special request');
            else if (what !== null)
                console.log('Almond expects an answer');
        }
        await this._delegate.sendAskSpecial(what, this._context.code, this._context.entities, this._context.timeout);
    }

    sendResult(message, icon) {
        return this._delegate.sendResult(message, icon);
    }
};
