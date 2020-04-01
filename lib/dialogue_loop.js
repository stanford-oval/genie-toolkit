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

const { handleLegacyAPICall, legacyDialogueHandler } = require('./policies/legacy');

const Helpers = require('./helpers');

const POLICIES = require('./policies');
const NULL_POLICY_NAME = 'org.thingpedia.dialogue.null';

const QueueItem = require('./dialogue_queue');
const { CancellationError } = require('./errors');

const { computeNewState, prepareContextForPrediction } = require('./dialogue_state_utils');

const USE_NEURAL_NLG = false;
const EXPLICIT_STRINGS_IN_USER_CONTEXT = false;

const policies = new WeakMap;
async function getOrCreatePolicy(dlg, policyName) {
    // lazily create the policy object associated with this dispatcher (dlg)
    //
    // policies maps a dlg object to a map from string to policy object

    let dlgpolicies = policies.get(dlg);
    if (!dlgpolicies) {
        dlgpolicies = new Map;
        policies.set(dlg, dlgpolicies);
    }

    let policy = dlgpolicies.get(policyName);
    if (!policy) {
        const policyFactory = POLICIES[policyName];
        if (!policyFactory) // TODO we should download the policy from Thingpedia
            throw new Error(`Invalid dialogue policy ${policyName}`);
        policy = await policyFactory(dlg);
        dlgpolicies.set(policyName, policy);
    }

    return policy;
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
    if (intent.isAnswer && policy !== null) {
        const handled = await policy.handleAnswer(intent.value);
        if (!handled) {
            await dlg.fail();
            return null;
        }
    }

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
    const policy = state.policy;
    const dialogueAct = state.dialogueAct;
    const dialogueActParam = state.dialogueActParam;
    state.policy = NULL_POLICY_NAME;

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
    let policyName = state ? state.policy : NULL_POLICY_NAME;
    let policy = await getOrCreatePolicy(dlg, policyName);
    for (;;) {
        const prediction = await computePrediction(dlg, policy, state, intent);
        if (prediction === null) {
            intent = await dlg.nextIntent();
            continue;
        }

        state = computeNewState(state, prediction);
        policy = await getOrCreatePolicy(dlg, state.policy);
        if (!policy)
            throw new Error(`Invalid dialogue policy ${state.policy}`);

        if (!await prepareForExecution(dlg, state))
            throw new CancellationError(); // cancel the dialogue if we failed to set up a device or lookup a contact

        //console.log(`Before execution:`);
        //console.log(state.prettyprint());

        await dlg.executeState(state);
        //console.log(`Execution state:`);
        //console.log(state.prettyprint());

        let policyPrediction, utterance;
        if (USE_NEURAL_NLG) {
            [policyPrediction,] = await policy.chooseAction(state, false);
            //console.log(`Agent act:`);
            //console.log(policyPrediction.prettyprint());

            const context = prepareContextForPrediction(state, 'agent');
            await dlg.setContext(context, { explicitStrings: false, allocateEntities: true, typeAnnotations: false });

            utterance = await dlg.manager.generateAnswer(policyPrediction);
        } else {
            [policyPrediction, utterance] = await policy.chooseAction(state, true);
        }

        state = computeNewState(state, policyPrediction);
        dlg.icon = Helpers.getProgramIcon(state);
        await dlg.reply(utterance);

        const context = prepareContextForPrediction(state, 'user');
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
