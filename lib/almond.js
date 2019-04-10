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

const ThingTalk = require('thingtalk');

const Semantic = require('./semantic');
const Intent = Semantic.Intent;
const ValueCategory = Semantic.ValueCategory;
const ParserClient = require('./parserclient');
const Dispatcher = require('./dispatcher');

const DEFAULT_GETTEXT = {
    dgettext: (domain, msg) => msg,
    dngettext: (domain, msg, msgp, n) => (n === 1 ? msg : msgp),
    dpgettext: (domain, ctx, msg) => msg,
};

function apiCompat(user, manager) {
    if (user.principal === undefined)
        user.principal = user.speakerId ? 'speaker:' + user.speakerId : 'user:' + user.id;

    if (user.isOwner === undefined)
        user.isOwner = true;
    if (user.canConfigureDevice === undefined)
        user.canConfigureDevice = function() { return this.isOwner; };
    if (user.canCreatePermissionRule === undefined)
        user.canCreatePermissionRule = function() { return this.isOwner; };
    if (user.canExecute === undefined) {
        user.canExecute = async function(program) {
            if (this.isOwner)
                return true;
            if (program.principal) // never allow remote execution
                return false;

            // check for permission without modifying the program (quick check on incomplete programs)
            return manager.permissions.checkCanBeAllowed(this.principal, program);
        };
    }
    if (user.applyPermissionRules === undefined) {
        user.applyPermissionRules = async function(program) {
            if (this.isOwner)
                return program;
            if (program.principal) // never allow remote execution
                return null;

            // check for permission and potentially modify the program
            return manager.permissions.checkIsAllowed(this.principal, program);
        };
    }

    // hooks to modify a program/policy (eg add a filter/condition to restrict to data of a certain user)
    // after confirmation but before calling to thingengine-core
    if (user.adjustPermissionRule === undefined)
        user.adjustPermissionRule = async function(policy, description) { return [policy, description, {}]; };
    if (user.adjustProgram === undefined)
        user.adjustProgram = async function(program, description, metadata) { return [program, description, metadata]; };

    // hooks to log that a program is being executed or a policy added
    if (user.logProgramExecution === undefined)
        user.logProgramExecution = async function(uniqueId, program, description) {};
    if (user.logPermissionRule === undefined)
        user.logPermissionRule = async function(uniqueId, policy, description, metadata) {};
}

const DummyStatistics = {
    hit() {
    }
};

module.exports = class Almond extends events.EventEmitter {
    constructor(engine, conversationId, user, delegate, options) {
        super();
        this._engine = engine;
        this._user = user;

        // API compat
        apiCompat(user, this);

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
        this.parser = new ParserClient(this._options.sempreUrl,
            engine.platform.locale, engine.platform.getSharedPreferences());

        this._dispatcher = new Dispatcher(this, this._debug);
        this._choices = [];

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

    get discovery() {
        return this._engine.discovery;
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
        this._raw = (expecting === ValueCategory.RawString || expecting === ValueCategory.Password);
    }

    start() {
        return this._dispatcher.start(this._options.showWelcome, this._options.configureMessaging);
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
            const intent = await Intent.parse(root, this.schemas, null, this._lastCommand, this._lastCandidates, platformData);
            return this._doHandleCommand(intent, null, [], true);
        }, platformData);
    }

    handleThingTalk(thingtalk, platformData = {}) {
        this.stats.hit('sabrina-thingtalk-command');
        this.emit('active');
        if (this._debug)
            console.log('Received ThingTalk program');

        return this._errorWrap(async () => {
            const intent = await Intent.parseProgram(thingtalk, this.schemas, platformData);
            return this._doHandleCommand(intent, null, [], true);
        }, platformData);
    }

    // set confident = true only if
    // 1) we are not dealing with natural language (code, gui, etc), or
    // 2) we find an exact match
    _doHandleCommand(intent, analyzed, candidates, confident=false) {
        if (!intent.isTrain) {
            this._lastCommand = analyzed;
            this._lastCandidates = candidates;
        }

        return this._dispatcher.handle(intent, confident);
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
                parsed = await Intent.parse({ code: candidate.code, entities: analyzed.entities }, this.schemas, analyzed, this._lastCommand, this._lastCandidates, platformData);
            } catch(e) {
                // Likely, a type error in the ThingTalk code; not a big deal, but we still log it
                console.log(`Failed to parse beam ${beamposition}: ${e.message}`);

                if (this._isUnsupportedError(e))
                    parsed = new Intent.Unsupported(platformData);
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
                return this._doHandleCommand(choice.target, analyzed, analyzed.candidates);
            } else {
                this._lastCommand = analyzed;
                this._lastCandidates = candidates;

                this.stats.hit('sabrina-failure');
                return this._dispatcher.handle(new Intent.Failed(analyzed, platformData));
            }
        });
    }

    async _errorWrap(fn, platformData) {
        try {
            try {
                await fn();
            } catch(e) {
                if (this._isUnsupportedError(e))
                    await this._doHandleCommand(new Intent.Unsupported(platformData), null, []);
                else
                    throw e;
            }
        } catch(e) {
            if (e.code === 'EHOSTUNREACH' || e.code === 'ETIMEDOUT')
                this.sendReply('Sorry, I cannot contact the Almond service. Please check your Internet connection and try again later.', null);
            else
                this.sendReply(this._("Sorry, I had an error processing your command: %s").format(e.message), null);
        }
    }

    handleCommand(command, platformData = {}, postprocess) {
        this.stats.hit('sabrina-command');
        this.emit('active');
        if (this._debug)
            console.log('Received assistant command ' + command);

        return this._errorWrap(async () => {
            if (this._raw && command !== null) {
                let intent = new Intent.Answer(this._expecting, ThingTalk.Ast.Value.String(command), platformData);
                return this._doHandleCommand(intent, command, []);
            }

            const analyzed = await this.parser.sendUtterance(command, this._expecting, this._choices);
            if (postprocess)
                postprocess(analyzed);
            return this._continueHandleCommand(command, analyzed, platformData);
        });
    }

    presentExample(utterance, targetCode) {
        return Promise.resolve().then(() => {
            return this._doHandleCommand(Intent.Example(utterance, targetCode), null, []);
        }).catch((e) => {
            this.sendReply(this._("Sorry, I had an error processing your command: %s").format(e.message), null);
            console.error(e.stack);
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
};
module.exports.Intent = Intent;
module.exports.ParserClient = ParserClient;
module.exports.Formatter = ThingTalk.Formatter;
