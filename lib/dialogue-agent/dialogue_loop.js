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

const { chooseDevice, concretizeValue } = require('./entity-linking');
const { collectDisambiguationHints } = require('./entity-linking/entity-finder');
const { showNotification, showError } = require('./notifications');
const { getFallbackExamples } = require('./fallback');

const Helpers = require('./helpers');

const QueueItem = require('./dialogue_queue');
const { CancellationError } = require('./errors');

const { computeNewState, prepareContextForPrediction } = require('./dialogue_state_utils');
const DialoguePolicy = require('./dialogue_policy');

const USE_NEURAL_NLG = false;
const EXPLICIT_STRINGS_IN_USER_CONTEXT = false;
const POLICY_NAME = 'org.thingpedia.dialogue.transaction';

const policies = new WeakMap;
async function getOrCreatePolicy(dlg, policyName) {
    // lazily create the policy object associated with this dispatcher (dlg)

    if (policyName !== POLICY_NAME) {
        // TODO we should download the policy from Thingpedia
        throw new Error(`Invalid dialogue policy ${policyName}`);
    }

    let policy = policies.get(dlg);
    if (!policy) {
        policy = new DialoguePolicy(dlg);
        await policy.init();
        policies.set(dlg, policy);
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
    
    if (intent.isProgram) {
        // handle legacy program intents so we can use "\t" without too much typing
        const prediction = new Ast.DialogueState(null, 'org.thingpedia.dialogue.transaction', 'execute', null, []);
        for (let stmt of intent.program.rules)
             prediction.history.push(new Ast.DialogueHistoryItem(null, stmt, null, 'accepted'));
        return prediction;
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
    const dialogueAct = state.dialogueAct;
    const dialogueActParam = state.dialogueActParam;
    const hints = collectDisambiguationHintsForState(state);

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
            //dlg.icon = Helpers.getIcon(slot.primitive);
            dlg.icon = null;
            await dlg.setContext(state, { explicitStrings: EXPLICIT_STRINGS_IN_USER_CONTEXT, typeAnnotations: false });
            let ok = await concretizeValue(dlg, slot, hints);
            if (!ok)
                return false;
        }
    }

    state.dialogueAct = dialogueAct;
    state.dialougeActParam = dialogueActParam;

    return true;
}


async function newStyleDialogueHandler(dlg, state, intent) {
    let policyName = state ? state.policy : POLICY_NAME;
    let policy = await getOrCreatePolicy(dlg, policyName);
    let executorState = undefined;
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

        [state, executorState] = await dlg.executeState(state, executorState);
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
        //dlg.icon = Helpers.getProgramIcon(state);
        dlg.icon = null;
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
    
    if (!input.intent.isDialogueState && !input.intent.isProgram) {
        if (input.intent.isFailed)
            await getFallbackExamples(dlg, input.intent.command);
        else if (input.intent.isUnsupported)
            await dlg.reply(dlg._("Sorry, I don't know how to do that yet."));
        else if (input.intent.isExample)
            await Helpers.presentSingleExample(dlg, input.intent.utterance, input.intent.targetCode);
        else
            dlg.fail();
        return null;
    }

    // new-style policy: we run the loop ourselves, and only call the policy
    return newStyleDialogueHandler(dlg, state, input.intent);
}

async function handleAPICall(dlg, call, lastApp) {
    let value;
    if (call.isNotification) {
        value = await showNotification(dlg, call.appId, call.icon, call.outputType, call.outputValue, lastApp);
        lastApp = call.appId;
    } else if (call.isError) {
        value = await showError(dlg, call.appId, call.icon, call.error, lastApp);
        lastApp = call.appId;
    }

    return [value, lastApp];
}

module.exports = async function loop(dlg, showWelcome) {
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
                [value, lastApp] = await handleAPICall(dlg, current, lastApp);
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
