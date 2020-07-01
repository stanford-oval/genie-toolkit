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
const seedrandom = require('seedrandom');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const interpolate = require('string-interp');
const AsyncQueue = require('consumer-queue');

const ValueCategory = require('./value-category');
const DialogueExecutor = require('./execution/dialogue_executor');
const StatementExecutor = require('./execution/statement_executor');
const QueueItem = require('./dialogue_queue');
const { CancellationError } = require('./errors');

const Helpers = require('./helpers');
const { showNotification, showError } = require('./notifications');
const { chooseDevice, concretizeValue } = require('./entity-linking');
const { collectDisambiguationHints } = require('./entity-linking/entity-finder');
const { getFallbackExamples } = require('./fallback');
const { computeNewState, prepareContextForPrediction } = require('./dialogue_state_utils');
const DialoguePolicy = require('./dialogue_policy');

const POLICY_NAME = 'org.thingpedia.dialogue.transaction';

function collectDisambiguationHintsForState(state) {
    const idEntities = new Map;
    const previousLocations = [];

    // collect all ID entities and all locations from the state
    for (let item of state.history) {
        if (item.results === null)
            continue;

        for (let result of item.results.results)
            collectDisambiguationHints(result, idEntities, previousLocations);
    }

    return { idEntities, previousLocations };
}

module.exports = class DialogueLoop {
    constructor(manager, engine, debug) {
        this._userInputQueue = new AsyncQueue();
        this._notifyQueue = new AsyncQueue();

        this._debug = debug;
        this.manager = manager;
        this.engine = engine;
        this._prefs = engine.platform.getSharedPreferences();
        this.formatter = new ThingTalk.Formatter(manager.platform.locale, manager.platform.timezone, manager.schemas, manager.gettext);
        this.icon = null;
        this.expecting = null;
        this.platformData = null;
        this._choices = null;
        this._executor = new DialogueExecutor(new StatementExecutor(this));

        this._mgrResolve = null;
        this._mgrPromise = null;

        this._beforeInput = null;

        this._rng = Math.random;
        if (manager._options.testMode || process.env.ALMOND_PSEUDO_RANDOM === '1')
            this._rng = seedrandom.alea('almond is awesome');


        this._policy = new DialoguePolicy(this.manager, this._rng);
        this._dialogueState = null; // thingtalk dialogue state
        this._executorState = undefined; // private object managed by DialogueExecutor
        this._lastNotificationApp = undefined;
    }

    async init() {
        await this._policy.init();
    }

    get rng() {
        return this._rng;
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

    setBeforeInput(handler) {
        this._beforeInput = handler;
    }

    async _getNextIntent() {
        await this.manager.sendAskSpecial();
        this._mgrPromise = null;
        this._mgrResolve();
        const intent = await this._userInputQueue.pop();
        this.platformData = intent.platformData;
        return intent;
    }

    async _prepareForExecution(state) {
        // FIXME this method can cause a few questions that
        // bypass the neural network, which is not great
        //
        // In particular, the following questions need to be fixed:
        // - "Who do you want to contact?" (from contact_search)
        // - "Where are you now?" / "What is your home address?" ... (from user_context)
        //
        // OTOH, questions that use "askChoices" or raw mode are fine,
        // because those are intentionally skipping the neural network
        //
        // (OTOOH, a proper IoT skill would probably use a more conversational
        // model for device choice, so the user can say "use the light in this room"
        // or "use the light closest to me", or similar)

        // save the current dialogue act and param, which we'll
        // override later to do device choice & entity disambiguation
        const dialogueAct = state.dialogueAct;
        const dialogueActParam = state.dialogueActParam;
        const hints = collectDisambiguationHintsForState(state);

        for (let slot of state.iterateSlots2()) {
            if (slot instanceof Ast.Selector) {
                state.dialogueAct = 'sys_ask_device';
                state.dialogueActParam = null;
                await this.setContext(state, { typeAnnotations: false });
                let ok = await chooseDevice(this, slot);
                if (!ok)
                    return false;
            } else {
                state.dialogueAct = 'sys_ask_concretize_value';
                state.dialogueActParam = null;
                //dlg.icon = Helpers.getIcon(slot.primitive);
                this.icon = null;
                await this.setContext(state, { typeAnnotations: false });
                let ok = await concretizeValue(this, slot, hints);
                if (!ok)
                    return false;
            }
        }

        state.dialogueAct = dialogueAct;
        state.dialougeActParam = dialogueActParam;

        return true;
    }

    _checkPolicy(policyName) {
        if (policyName !== POLICY_NAME) {
            // TODO we should download the policy from Thingpedia
            throw new Error(`Invalid dialogue policy ${policyName}`);
        }
    }

    async _computePrediction(intent) {
        // handle all intents generated internally and by the UI:
        //
        // - Failed when parsing fails
        // - Answer when the user clicks a button, or when the agent is in "raw mode"
        // - NeverMind when the user clicks the X button
        // - Debug when the user clicks/types "debug"
        // - WakeUp when the user says the wake word and nothing else
        if (intent.isFailed) {
            await getFallbackExamples(this, intent.utterance);
            return null;
        }
        if (intent.isUnsupported) {
            await this.reply(this._("Sorry, I don't know how to do that yet."));
            return null;
        }
        if (intent.isAnswer) {
            const handled = await this._policy.handleAnswer(intent.value);
            if (!handled) {
                await this.fail();
                return null;
            }
            return handled;
        }

        if (intent.isProgram) {
            // convert thingtalk programs to dialogue states so we can use "\t" without too much typing
            const prediction = new Ast.DialogueState(null, 'org.thingpedia.dialogue.transaction', 'execute', null, []);
            for (let stmt of intent.program.rules)
                 prediction.history.push(new Ast.DialogueHistoryItem(null, stmt, null, 'accepted'));
            return prediction;
        }

        if (intent.isUICommand) {
            switch (intent.type) {
            case 'stop':
                // stop means cancel, but without a failure message
                throw new CancellationError();

            case 'nevermind':
                await this.reset();
                throw new CancellationError();

            case 'debug':
                await this.reply("Current State:\n" + this._dialogueState.prettyprint());
                return null;

            case 'wakeup':
                // nothing to do
                return null;

            default:
                await this.fail();
                return null;
            }
        }

        assert(intent.isDialogueState);
        return intent.prediction;
    }

    _useNeuralNLG() {
        return this._prefs.get('experimental-use-neural-nlg');
    }

    async _handleUserInput(intent) {
        for (;;) {
            const prediction = await this._computePrediction(intent);
            if (prediction === null) {
                intent = await this.nextIntent();
                continue;
            }

            this._dialogueState = computeNewState(this._dialogueState, prediction);
            this._checkPolicy(this._dialogueState.policy);

            if (!await this._prepareForExecution())
                throw new CancellationError(); // cancel the dialogue if we failed to set up a device or lookup a contact

            //console.log(`Before execution:`);
            //console.log(state.prettyprint());

            [this._dialogueState, this._executorState] = await this._executor.executeState(this._dialogueState, this._executorState);
            //console.log(`Execution state:`);
            //console.log(state.prettyprint());

            let policyPrediction, utterance;
            if (this._useNeuralNLG()) {
                [policyPrediction,] = await this._policy.chooseAction(this._dialogueState);
                //console.log(`Agent act:`);
                //console.log(policyPrediction.prettyprint());

                const context = prepareContextForPrediction(this._dialogueState, 'agent');
                await this.setContext(context, { allocateEntities: true, typeAnnotations: false });

                utterance = await this.manager.generateAnswer(policyPrediction);
            } else {
                [policyPrediction, utterance] = await this._policy.chooseAction(this._dialogueState);
            }

            this._dialogueState = computeNewState(this._dialogueState, policyPrediction);
            //dlg.icon = Helpers.getProgramIcon(state);
            this.icon = null;
            await this.reply(utterance);

            const context = prepareContextForPrediction(this._dialogueState, 'user');
            await this.setContext(context, { typeAnnotations: false });

            const interactionState = this._policy.getInteractionState(this._dialogueState);
            if (interactionState.isTerminal)
                return;
            await this.setExpected(interactionState.expect);

            intent = await this.nextIntent();
        }
    }

    async _handleAPICall(call) {
        if (call.isNotification) {
            await showNotification(this, call.appId, call.icon, call.outputType, call.outputValue, this._lastNotificationApp);
            this._lastNotificationApp = call.appId;
        } else if (call.isError) {
            await showError(this, call.appId, call.icon, call.error, this._lastNotificationApp);
            this._lastNotificationApp = call.appId;
        }
    }

    async _loop(showWelcome) {
        for (;;) {
            this.icon = null;
            const item = await this.nextQueueItem();
            try {
                if (item.isUserInput) {
                    this._lastNotificationApp = undefined;
                    await this._handleUserInput(item.intent);
                } else {
                    await this._handleAPICall(item);
                    this._dialogueState = null;
                }
            } catch(e) {
                if (e.code === 'ECANCELLED') {
                    this._dialogueState = null;
                    await this.setContext(null);
                    await this.setExpected(null);
                } else {
                    if (item.isUserInput) {
                        await this.replyInterp(this._("Sorry, I had an error processing your command: ${error}."), {//"
                            error: Helpers.formatError(this, e)
                        });
                    } else {
                        await this.replyInterp(this._("Sorry, that did not work: ${error}."), {
                            error: Helpers.formatError(this, e)
                        });
                    }
                    console.error(e);
                }
            }
        }
    }

    async nextIntent() {
        let intent = await this._getNextIntent();
        while (this._beforeInput !== null && await this._beforeInput(this, intent))
            intent = await this._getNextIntent();
        return intent;
    }
    async nextQueueItem() {
        this.setExpected(null);
        await this.manager.sendAskSpecial();
        this._mgrPromise = null;
        this._mgrResolve();
        const queueItem = await this._notifyQueue.pop();
        if (queueItem.isUserInput)
            this.platformData = queueItem.intent.platformData;
        else
            this.platformData = {};
        return queueItem;
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

    setExpected(expected) {
        if (expected === undefined)
            throw new TypeError();
        this.expecting = expected;
        this.manager.expect(expected);
    }
    setContext(context, options) {
        this.manager.setContext(context, options);
    }

    /**
     * Ask a question to the user.
     *
     * This is a legacy method used for certain scripted interactions.
     */
    async ask(expected, question, args) {
        await this.replyInterp(question, args);
        await this.setExpected(expected);
        let intent = await this.nextIntent();
        while (!intent.isAnswer || intent.category !== expected) {
            await this.fail();
            intent = await this.nextIntent();
        }
        if (expected === ValueCategory.YesNo)
            return intent.value.value;
        else
            return intent.value;
    }
    async askChoices(question, choices) {
        await this.reply(question);
        this.setExpected(ValueCategory.MultipleChoice);
        this._choices = choices;
        for (let i = 0; i < choices.length; i++)
            await this.replyChoice(i, choices[i]);
        let intent = await this.nextIntent();
        while (!intent.isMultipleChoiceAnswer) {
            await this.fail();
            intent = await this.nextIntent();
        }
        return intent.value;
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

    async replyChoice(idx, title) {
        await this.manager.sendChoice(idx, title);
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

    _isInDefaultState() {
        return this._notifyQueue.hasWaiter();
    }

    dispatchNotify(appId, icon, outputType, outputValue) {
        let item = new QueueItem.Notification(appId, icon, outputType, outputValue);
        this._pushQueueItem(item);
    }
    dispatchNotifyError(appId, icon, error) {
        let item = new QueueItem.Error(appId, icon, error);
        this._pushQueueItem(item);
    }

    start(showWelcome) {
        let promise = this._waitNextIntent();
        this._loop(this, showWelcome).then(() => {
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

        this._notifyQueue.push(item);
    }

    _waitNextIntent() {
        let promise = new Promise((callback, errback) => {
            this._mgrResolve = callback;
        });
        this._mgrPromise = promise;
        return promise;
    }

    pushIntent(intent, confident = false) {
        this._pushQueueItem(new QueueItem.UserInput(intent, confident));
    }

    async handle(intent, confident=false) {
        // wait until the dialog is ready to accept commands
        await this._mgrPromise;
        assert(this._mgrPromise === null);

        const promise = this._waitNextIntent();

        if (this._isInDefaultState())
            this.pushIntent(intent, confident);
        else
            this._userInputQueue.push(intent);

        return promise;
    }
};
