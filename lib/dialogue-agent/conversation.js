// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
"use strict";

const events = require('events');

const interpolate = require('string-interp');
const ThingTalk = require('thingtalk');

const ParserClient = require('../prediction/parserclient');

const UserInput = require('./user-input');
const ValueCategory = require('./value-category');
const DialogueLoop = require('./dialogue-loop');
const { MessageType } = require('./protocol');


const DummyStatistics = {
    hit() {
    }
};

const DEFAULT_CONVERSATION_TTL = 60000; // 1 minute

module.exports = class Conversation extends events.EventEmitter {
    constructor(engine, conversationId, user, options) {
        super();
        this._engine = engine;
        this._user = user;

        this._conversationId = conversationId;
        this._gettext = this._engine.platform.getCapability('gettext');
        this._ngettext = this._engine.ngettext;
        this._ = this._engine.gettext;

        this._stats = this._engine.platform.getCapability('statistics');
        if (this._stats === null)
            this._stats = DummyStatistics;

        this._raw = false;
        this._options = options || {};
        this._debug = !!this._options.debug;

        this.rng = options.rng || Math.random;

        this._prefs = engine.platform.getSharedPreferences();
        this._nlu = ParserClient.get(this._options.nluServerUrl, engine.platform.locale, engine.platform,
            null, engine.thingpedia);
        if (this._options.nlgServerUrl)
            this._nlg = ParserClient.get(this._options.nlgServerUrl, engine.platform.locale, engine.platform);
        else
            this._nlg = this._nlu;
        this._lastCommand = null;
        this._lastCandidates = null;

        this._loop = new DialogueLoop(this, this._engine, this._debug);
        this._choices = [];
        this.setContext(null);
        this._delegates = new Set;
        this._history = [];
        this._nextMsgId = 0;

        this._inactivityTimeout = null;
        this._inactivityTimeoutSec = options.inactivityTimeout || DEFAULT_CONVERSATION_TTL;
        this._contextResetTimeout = null;
        this._contextResetTimeoutSec = options.contextResetTimeout || this._inactivityTimeoutSec;
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

    get schemas() {
        return this._engine.schemas;
    }

    get thingpedia() {
        return this._engine.thingpedia;
    }

    notify() {
        return this._loop.dispatchNotify.apply(this._loop, arguments);
    }

    notifyError() {
        return this._loop.dispatchNotifyError.apply(this._loop, arguments);
    }

    expect(expecting) {
        this._expecting = expecting;
        this._choices = [];
        this._raw = (expecting === ValueCategory.RawString || expecting === ValueCategory.Password);
    }

    async start() {
        await this._nlu.start();
        if (this._nlu !== this._nlg)
            await this._nlg.start();
        this._resetInactivityTimeout();
        return this._loop.start(this._options.showWelcome);
    }

    async stop() {
        await this._nlu.stop();
        if (this._nlu !== this._nlg)
            await this._nlg.stop();
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

    // set confident = true only if
    // 1) we are not dealing with natural language (code, gui, etc), or
    // 2) we find an exact match
    _doHandleCommand(intent, analyzed, candidates, confident=false) {
        this._lastCommand = analyzed;
        this._lastCandidates = candidates;
        return this._loop.handle(intent, confident);
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
                code: ['null'],
                entities: {}
            };
        } else {
            const entities = {};
            options.allocateEntities = true;
            const code = ThingTalk.NNSyntax.toNN(context, '', entities, options);
            this._context = { code, entities };
        }
    }

    async generateAnswer(policyPrediction) {
        const targetAct = ThingTalk.NNSyntax.toNN(policyPrediction, '', this._context.entities, {
            allocateEntities: true
        }).join(' ');
        const result = await this._nlg.generateUtterance(this._context, targetAct);
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
                return this._loop.handle(new UserInput.Failed(command, platformData));
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
                console.error(e);
            }
        }
    }

    _sendUtterance(utterance) {
        return this._nlu.sendUtterance(utterance, this._context.code, this._context.entities, {
            expect: this._expecting,
            choices: this._choices,
            store: this._prefs.get('sabrina-store-log') || 'no'
        });
    }

    _resetInactivityTimeout() {
        // after "options.inactivityTimeout" milliseconds we inform the app that the conversation
        // is inactive (turn off LEDs, close the microphone, etc.)
        if (this._inactivityTimeout)
            clearTimeout(this._inactivityTimeout);
        if (this._inactivityTimeoutSec > 0) {
            this._inactivityTimeout = setTimeout(() => {
                this.emit('inactive');
            }, this._inactivityTimeoutSec);
        }

        // after "options.contextResetTimeout", we reset the context, forgetting the state of the
        // conversation
        if (this._contextResetTimeout)
            clearTimeout(this._contextResetTimeout);
        if (this._contextResetTimeoutSec) {
            this._contextResetTimeout = setTimeout(() => {
                this.setContext(null);
            }, this._contextResetTimeoutSec);
        }
    }

    async addOutput(out, replayHistory = true) {
        this._delegates.add(out);
        if (replayHistory) {
            for (let msg of this._history)
                await out.addMessage(msg);
        }
    }
    async removeOutput(out) {
        this._delegates.delete(out);
    }

    async _addMessage(msg) {
        msg.id = this._nextMsgId ++;
        this._history.push(msg);
        if (this._history.length > 30)
            this._history.shift();
        await Promise.all(Array.from(this._delegates).map((out) => out.addMessage(msg)));
    }

    async handleCommand(command, platformData = {}, postprocess) {
        this.stats.hit('sabrina-command');
        this.emit('active');
        this._resetInactivityTimeout();
        await this._addMessage({ type: MessageType.COMMAND, command });
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

    async handleParsedCommand(root, title, platformData = {}) {
        this.stats.hit('sabrina-parsed-command');
        this.emit('active');
        this._resetInactivityTimeout();
        if (typeof root === 'string')
            root = JSON.parse(root);
        await this._addMessage({ type: MessageType.COMMAND, command: title, json: root });
        if (this._debug)
            console.log('Received pre-parsed assistant command');
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

    async handleThingTalk(thingtalk, platformData = {}) {
        this.stats.hit('sabrina-thingtalk-command');
        this.emit('active');
        this._resetInactivityTimeout();
        await this._addMessage({ type: MessageType.COMMAND, command: '\\t ' + thingtalk });
        if (this._debug)
            console.log('Received ThingTalk program');

        return this._errorWrap(async () => {
            const intent = await UserInput.parseThingTalk(thingtalk, this.schemas, this._getContext(null, platformData));
            return this._doHandleCommand(intent, null, [], true);
        }, platformData);
    }

    setHypothesis(hypothesis) {
        return Promise.all(Array.from(this._delegates).map((out) => out.setHypothesis(hypothesis)));
    }

    sendAskSpecial() {
        let what = ValueCategory.toAskSpecial(this._expecting);

        if (this._debug) {
            if (what !== null && what !== 'generic')
                console.log('Genie sends a special request');
            else if (what !== null)
                console.log('Genie expects an answer');
        }

        return Promise.all(Array.from(this._delegates).map((out) => out.setExpected(what, this._context)));
    }

    sendReply(message, icon) {
        if (this._debug)
            console.log('Genie says: ' + message);
        return this._addMessage({ type: MessageType.TEXT, text: message, icon });
    }

    sendResult(message, icon) {
        return this._addMessage({ type: MessageType.RESULT, text: message.toLocaleString(this._locale), result: message, icon });
    }

    sendPicture(url, icon) {
        if (this._debug)
            console.log('Genie sends picture: '+ url);
        return this._addMessage({ type: MessageType.PICTURE, url, icon });
    }

    sendRDL(rdl, icon) {
        if (this._debug)
            console.log('Genie sends RDL: '+ rdl.callback);
        return this._addMessage({ type: MessageType.RDL, rdl, icon });
    }

    sendChoice(idx, title) {
        if (this._expecting !== ValueCategory.MultipleChoice)
            console.log('UNEXPECTED: sendChoice while not expecting a MultipleChoice');

        this._choices[idx] = title;
        if (this._debug)
            console.log('Genie sends multiple choice button: '+ title);
        return this._addMessage({ type: MessageType.CHOICE, idx, title });
    }

    async resendChoices() {
        if (this._expecting !== ValueCategory.MultipleChoice)
            console.log('UNEXPECTED: sendChoice while not expecting a MultipleChoice');

        for (let idx = 0; idx < this._choices.length; idx++)
            await this._addMessage({ type: MessageType.CHOICE, idx, title: this._choices[idx] });
    }

    sendButton(title, json) {
        if (this._debug)
            console.log('Genie sends generic button: '+ title);
        return this._addMessage({ type: MessageType.BUTTON, json, title });
    }

    sendLink(title, url) {
        if (this._debug)
            console.log('Almond sends link: '+ url);
        return this._addMessage({ type: MessageType.LINK, url, title });
    }
};
