// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as path from 'path';
import { Ast, } from 'thingtalk';

import * as I18n from '../i18n';

import {
    ContextTable,
    ContextPhrase,
} from '../sentence-generator/types';
import type SentenceGenerator from '../sentence-generator/generator';
import type { SentenceGeneratorOptions } from '../sentence-generator/generator';
import { DialogueInterface  } from './interface';

import type ThingpediaLoader from '../templates/load-thingpedia';
import * as TransactionPolicy from '../templates/transactions';

/**
 * A callback that implements the logic of the agent.
 *
 * This is exported as {@link PolicyModule.policy} by the agent policy module.
 */
export type PolicyFunction = (dlg : DialogueInterface, startMode : PolicyStartMode) => Promise<void>;

/**
 * Enum defining how the agent policy function is started.
 */
export enum PolicyStartMode {
    /**
     * The agent policy is started normally: the agent should start a new
     * dialogue with the user.
     */
    NORMAL,
    /**
     * An existing dialogue was resumed. The agent policy should inspect
     * the current state of the dialogue to proceed.
     */
    RESUME,
    /**
     * The agent policy is starting for the first time ever for this user.
     * The agent can decide to show additional onboarding messages.
     */
    USER_FIRST_TIME,
    /**
     * The agent policy is started normally, and the agent should start a new
     * dialogue with the user, but no welcome message should be shown to
     * the user.
     */
    NO_WELCOME,
}

/**
 * The abstract interface of a dialogue policy module.
 *
 * This interface defines the functions that a policy module should export.
 */
export interface PolicyModule {
    /**
     * The policy manifest.
     *
     * This is used to check the generated dialogue states for correctness.
     */
    MANIFEST : {
        name : string,
        terminalAct : string,
        dialogueActs : {
            user : readonly string[],
            agent : readonly string[],
            withParam : readonly string[]
        },
    },

    initializeTemplates(agentOptions : SentenceGeneratorOptions, langPack : I18n.LanguagePack, grammar : SentenceGenerator, tpLoader : ThingpediaLoader) : Promise<void>;

    policy(dlg : DialogueInterface, startMode : PolicyStartMode) : Promise<void>;
    getContextPhrasesForState(state : Ast.DialogueState|null, tpLoader : ThingpediaLoader, contextTable : ContextTable) : ContextPhrase[]|null;

    interpretAnswer?(state : Ast.DialogueState, value : Ast.Value, tpLoader : ThingpediaLoader, contextTable : ContextTable) : Ast.DialogueState|null;

    notification?(appName : string | null, program : Ast.Program, result : Ast.DialogueHistoryResultItem) : Ast.DialogueState|null;
    notifyError?(appName : string | null, program : Ast.Program, error : Ast.Value) : Ast.DialogueState|null;
}

export async function load(policyName ?: string) : Promise<PolicyModule> {
    if (policyName)
        return import(path.resolve(policyName));
    else
        return TransactionPolicy;
}
