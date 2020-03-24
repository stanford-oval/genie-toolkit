// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const initDialog = require('./legacy-dialogs/init');
const { chooseDevice } = require('./legacy-dialogs/device_choice');
const { concretizeValue } = require('./legacy-dialogs/slot_filling');
const Helpers = require('./helpers');

const POLICIES = require('./policies');
const LEGACY_POLICY_NAME = 'org.thingpedia.dialogue.legacy';
const BUILTIN_POLICY_NAME = 'org.thingpedia.dialogue.builtin';

const Semantic = require('./semantic');
const ValueCategory = Semantic.ValueCategory;
const QueueItem = require('./dialogue_queue');

const { computeNewState, prepareContextForPrediction } = require('./dialogue_state_utils');

const USE_NEURAL_NLG = false;
const EXPLICIT_STRINGS_IN_USER_CONTEXT = false;

class CancellationError extends Error {
    constructor(intent = null) {
        super("User cancelled");
        this.code = 'ECANCELLED';
        this.intent = intent;
    }
}

// FIXME this should move elsewhere
async function legacyHandleGeneric(dlg, command) {
    if (command.isFailed) {
        if (dlg.expecting !== null) {
            await dlg.fail();
            return true;
        }
        // don't handle this if we're not expecting anything
        // (it will fall through to whatever dialog.handle()
        // is doing, which is calling FallbackDialog for DefaultDialog,
        // actually showing the fallback for FallbackDialog,
        // and doing nothing for all other dialogs)
        return false;
    }
    if (command.isTrain) {
        // in the middle of a dialogue, reset and reinject
        if (dlg.expecting !== null)
            throw new CancellationError(command);

        // at the default state, handle normally
        return false;
    }
    if (command.isDebug) {
        if (dlg.expecting === null)
            await dlg.reply("I'm in the default state");
        else
            await dlg.reply("I'm expecting a " + dlg.expecting);
        //for (var key of this.manager.stats.keys())
        //    await this.reply(key + ": " + this.manager.stats.get(key));
        return true;
    }
    if (command.isHelp) {
        if (dlg.expecting !== null) {
            await dlg.lookingFor();
            return true;
        } else {
            return false;
        }
    }
    if (command.isWakeUp) // nothing to do
        return true;

    // if we're expecting the user to click on More... or press cancel,
    // three things can happen
    if (dlg.expecting === ValueCategory.More) {
        // if the user clicks more, more we let the intent through to rule.js
        if (command.isMore)
            return false;
        // if the user says no, cancel or stop, we inject the cancellation error but we don't show
        // a failure message to the user
        if (command.isNeverMind || command.isNo || command.isStop)
            throw new CancellationError();
        // if the user says anything else, we cancel the current dialog
        throw new CancellationError(command);
    }

    // stop means cancel, but without a failure message
    if (command.isStop)
        throw new CancellationError();
    if (command.isNeverMind) {
        await dlg.reset();
        throw new CancellationError();
    }

    if (dlg.expecting !== null && (!command.isAnswer || !command.category.equals(dlg.expecting))) {
        if (command.isNo) {
            await dlg.reset();
            throw new CancellationError();
        }
        if (dlg.expecting === ValueCategory.Password &&
            command.isAnswer && command.category === ValueCategory.RawString)
            return false;

        if (dlg.expecting === ValueCategory.Command &&
            (command.isProgram || command.isCommandList || command.isBack || command.isMore || command.isEmpty))
            return false;
        if (dlg.expecting === ValueCategory.Predicate &&
            (command.isPredicate || command.isBack || command.isMore))
            return false;
        if (dlg.expecting === ValueCategory.PermissionResponse &&
            (command.isPredicate || command.isPermissionRule || command.isMore || command.isYes || command.isMaybe || command.isBack))
            return false;

        // if given an answer of the wrong type have Almond complain
        if (command.isYes) {
            await dlg.reply(dlg._("Yes what?"));
            return true;
        }
        if (command.isAnswer) {
            await dlg.unexpected();
            return true;
        }

        // anything else, just switch the subject
        throw new CancellationError(command);
    }
    if (dlg.expecting === ValueCategory.MultipleChoice) {
        let index = command.value;
        if (index !== Math.floor(index) ||
            index < 0 ||
            index > dlg._choices.length) {
            await dlg.reply(dlg._("Please click on one of the provided choices."));
            await dlg.manager.resendChoices();
            return true;
        }
    }

    return false;
}

async function legacyDialogueHandler(dlg, input) {
    if (await legacyHandleGeneric(dlg, input.intent))
        return;

    const legacyPolicy = POLICIES[LEGACY_POLICY_NAME];
    dlg.setBeforeInput(legacyHandleGeneric);
    try {
        await legacyPolicy.handleInput(dlg, input.intent, input.confident);
    } finally {
        dlg.setBeforeInput(null);
    }
}

async function handleLegacyAPICall(dlg, input, lastApp) {
    const legacyPolicy = POLICIES[LEGACY_POLICY_NAME];
    dlg.setBeforeInput(legacyHandleGeneric);
    try {
        return await legacyPolicy.handleAPICall(dlg, input, lastApp);
    } finally {
        dlg.setBeforeInput(null);
    }
}

async function computePrediction(dlg, policy, state, intent) {
    // handle all intents generated internally and by the UI:
    //
    // - Failed when parsing fails
    // - Answer when the user clicks a button, or when the agent is in "raw mode"
    // - NeverMind when the user clicks the X button
    // - Train when the user clicks/types "train"
    // - Debug when the user clicks/types "debug"
    // - WakeUp when the user says the wake word and nothing else
    if (intent.isFailed) {
        await dlg.fail();
        return null;
    }
    if (intent.isAnswer && policy !== null)
        return policy.handleAnswer(state, intent.value);
    // stop means cancel, but without a failure message
    if (intent.isStop)
        throw new CancellationError();
    if (intent.isNeverMind) {
        dlg.reset();
        throw new CancellationError();
    }
    if (intent.isTrain) // TODO
        throw new Error('not implemented');
    if (intent.isDebug) {
        await dlg.reply("Current State:\n" + state.prettyprint());
        return null;
    }
    if (intent.isWakeUp) {
        // nothing to do
        return null;
    }

    if (!intent.isDialogueState) {
        // legacy intent
        // delegate to the legacy
        throw new CancellationError(intent);
    }

    return intent.prediction;
}

function tokenize(string) {
    var tokens = string.split(/(\s+|[,."'!?])/g);
    return tokens.filter((t) => !(/^\s*$/).test(t)).map((t) => t.toLowerCase());
}

function collectDisambiguationHints(state) {
    const idEntities = new Map;
    const previousLocations = [];

    // collect all ID entities and all locations from the state

    for (let item of state.history) {
        if (item.results === null)
            continue;

        for (let result of item.results.results) {
            for (let key in result.value) {
                const value = result.value[key];
                if (value.isLocation && value.value.isAbsolute)
                    previousLocations.push(value.value);

                if (key === 'id') {
                    if (!result.value.id.isEntity)
                        continue;

                    const id = result.value.id;
                    const idType = id.type;
                    const idEntity = {
                        value: id.value,
                        name: id.display,
                        canonical: tokenize(id.display).join(' ')
                    };
                    if (idEntities.has(idType))
                        idEntities.get(idType).push(idEntity);
                    else
                        idEntities.set(idType, [idEntity]);
                }
            }
        }
    }

    return { idEntities, previousLocations };
}

async function prepareForExecution(dlg, state) {
    // FIXME this method can cause quite a few questions that
    // bypass the neural network, which is not great

    // save the current dialogue act and param, which we'll
    // override later to do device choice & entity disambiguation
    const policy = state.policy;
    const dialogueAct = state.dialogueAct;
    const dialogueActParam = state.dialogueActParam;
    state.policy = BUILTIN_POLICY_NAME;

    const hints = collectDisambiguationHints(state);

    for (let slot of state.iterateSlots2()) {
        if (slot instanceof Ast.Selector) {
            state.dialogueAct = 'sys_ask_device';
            state.dialogueActParam = null;
            await dlg.setContext(state, { explicitStrings: EXPLICIT_STRINGS_IN_USER_CONTEXT, typeAnnotations: false });
            let ok = await chooseDevice(dlg, slot);
            if (!ok)
                return false;
        } else {
            state.dialogueAct = 'sys_ask_concretize_value';
            state.dialogueActParam = null;
            dlg.icon = Helpers.getIcon(slot.primitive);
            await dlg.setContext(state, { explicitStrings: EXPLICIT_STRINGS_IN_USER_CONTEXT, typeAnnotations: false });
            let ok = await concretizeValue(dlg, slot, hints);
            if (!ok)
                return false;
        }
    }

    state.policy = policy;
    state.dialogueAct = dialogueAct;
    state.dialougeActParam = dialogueActParam;

    return true;
}


async function newStyleDialogueHandler(dlg, state, intent) {
    let policy = state ? POLICIES[state.policy] : null;
    for (;;) {
        const prediction = await computePrediction(dlg, policy, state, intent);
        if (prediction === null) {
            intent = await dlg.nextIntent();
            continue;
        }

        state = computeNewState(state, prediction);
        policy = POLICIES[state.policy];
        if (!policy)
            throw new Error(`Invalid dialogue policy ${state.policy}`);

        if (!await prepareForExecution(dlg, state))
            throw new CancellationError(); // cancel the dialogue if we failed to set up a device or lookup a contact

        //console.log(`Before execution:`);
        //console.log(state.prettyprint());

        await dlg.executeState(state);
        //console.log(`Execution state:`);
        //console.log(state.prettyprint());

        const policyPrediction = await policy.chooseAction(dlg, state);
        //console.log(`Agent act:`);
        //console.log(policyPrediction.prettyprint());

        let context = prepareContextForPrediction(state, 'agent');
        await dlg.setContext(context, { explicitStrings: false, allocateEntities: true, typeAnnotations: false });

        state = computeNewState(state, policyPrediction);
        dlg.icon = Helpers.getProgramIcon(state);
        if (USE_NEURAL_NLG) {
            const utterance = await dlg.manager.generateAnswer(policyPrediction);
            await dlg.reply(utterance);
        } else {
            await policy.reply(dlg, state);
        }

        context = prepareContextForPrediction(state, 'user');
        await dlg.setContext(context, { explicitStrings: EXPLICIT_STRINGS_IN_USER_CONTEXT, typeAnnotations: false });

        const interactionState = policy.getInteractionState(state);
        if (interactionState.isTerminal)
            return state;
        await dlg.setExpected(interactionState.expect);

        intent = await dlg.nextIntent();
    }
}

async function handleUserInput(dlg, state, input) {
    // before entering the loop, if the intent is not a
    // dialogue state we kick it to the legacy policy
    // this includes also internal intents (never mind, stop, etc.) that the
    // new style dialogue loop would handle
    if (!input.intent.isDialogueState) {
        await legacyDialogueHandler(dlg, input);
        return null;
    }

    // new-style policy: we run the loop ourselves, and only call the policy
    return newStyleDialogueHandler(dlg, state, input.intent);
}

module.exports = async function loop(dlg, showWelcome) {
    await initDialog(dlg, showWelcome);

    let lastApp = undefined, currentDialogueState = null, next = undefined;
    for (;;) {
        dlg.icon = null;
        let current;
        if (next !== undefined) {
            current = next;
            next = undefined;
        } else {
            current = await dlg.nextQueueItem();
        }

        try {
            let value;

            if (current.isUserInput) {
                lastApp = undefined;
                currentDialogueState = await handleUserInput(dlg, currentDialogueState, current);
            } else {
                [value, lastApp] = await handleLegacyAPICall(dlg, current, lastApp);
                currentDialogueState = null;
            }

            current.resolve(value);
        } catch(e) {
            current.reject(e);
            if (e.code === 'ECANCELLED') {
                currentDialogueState = null;
                await dlg.setContext(null);
                await dlg.setExpected(null);
                if (e.intent) {
                    // reinject the intent if this caused the cancellation
                    next = new QueueItem.UserInput(e.intent, true);
                }
            } else {
                if (current.isUserInput) {
                    await dlg.replyInterp(dlg._("Sorry, I had an error processing your command: ${error}."), {
                        error: Helpers.formatError(dlg, e)
                    });
                } else {
                    await dlg.replyInterp(dlg._("Sorry, that did not work: ${error}."), {
                        error: Helpers.formatError(dlg, e)
                    });
                }
                console.error(e);
            }
        }
    }
};
