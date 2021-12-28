// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as Tp from 'thingpedia';

import {
    DialogueHandler,
    CommandAnalysisType,
    ReplyResult,
    CommandAnalysisResult
} from '../dialogue-loop';
import { UserInput } from '../user-input';
import ValueCategory from '../value-category';

interface AnalysisTypeAdapter<InnerAnalysisType extends Tp.DialogueHandler.CommandAnalysisResult> extends CommandAnalysisResult {
    inner : InnerAnalysisType|null;
}

/**
 * Helper class to adapt a Thingpedia device into a Genie dialogue handler.
 *
 * Thingpedia dialogue handlers are simplified to avoid leaking some details
 * of the ThingTalk dialogue loop.
 */
export default class ThingpediaDialogueHandler<AnalysisType extends Tp.DialogueHandler.CommandAnalysisResult, StateType>
implements DialogueHandler<AnalysisTypeAdapter<AnalysisType>, StateType> {
    private _iface : Tp.DialogueHandler<AnalysisType, StateType>;
    uniqueId : string;

    constructor(device : Tp.BaseDevice) {
        this.uniqueId = device.uniqueId!;
        this._iface = device.queryInterface('dialogue-handler')!;
    }

    get priority() {
        return this._iface.priority;
    }

    get icon() {
        return this._iface.icon;
    }

    private _mapReplyResult(result : Tp.DialogueHandler.ReplyResult) : ReplyResult {
        return {
            expecting: result.expecting ? ValueCategory.fromType(result.expecting) : null,
            messages: result.messages,
            context: result.context,
            agent_target: result.agent_target
        };
    }
    private _mapConfidence(confidence : Tp.DialogueHandler.Confidence) : CommandAnalysisType {
        switch (confidence) {
        case Tp.DialogueHandler.Confidence.EXACT_IN_DOMAIN_COMMAND:
            return CommandAnalysisType.EXACT_IN_DOMAIN_COMMAND;

        case Tp.DialogueHandler.Confidence.STRONGLY_CONFIDENT_IN_DOMAIN_COMMAND: // FIXME
            return CommandAnalysisType.STRONGLY_CONFIDENT_IN_DOMAIN_COMMAND;

        case Tp.DialogueHandler.Confidence.CONFIDENT_IN_DOMAIN_COMMAND:
            return CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND;

        case Tp.DialogueHandler.Confidence.EXACT_IN_DOMAIN_FOLLOWUP:
            return CommandAnalysisType.EXACT_IN_DOMAIN_FOLLOWUP;

        case Tp.DialogueHandler.Confidence.STRONGLY_CONFIDENT_IN_DOMAIN_FOLLOWUP:
            return CommandAnalysisType.STRONGLY_CONFIDENT_IN_DOMAIN_FOLLOWUP;

        case Tp.DialogueHandler.Confidence.CONFIDENT_IN_DOMAIN_FOLLOWUP:
            return CommandAnalysisType.CONFIDENT_IN_DOMAIN_FOLLOWUP;

        case Tp.DialogueHandler.Confidence.NONCONFIDENT_IN_DOMAIN_COMMAND:
            return CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND;

        case Tp.DialogueHandler.Confidence.NONCONFIDENT_IN_DOMAIN_FOLLOWUP:
            return CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_FOLLOWUP;

        case Tp.DialogueHandler.Confidence.OUT_OF_DOMAIN_COMMAND:
            return CommandAnalysisType.OUT_OF_DOMAIN_COMMAND;
        default:
            throw new TypeError();
        }
    }

    async initialize(initialState : StateType | undefined, showWelcome : boolean) : Promise<ReplyResult | null> {
        const result = await this._iface.initialize(initialState, showWelcome);
        if (result === null)
            return null;

        return this._mapReplyResult(result);
    }

    getState() : StateType {
        return this._iface.getState();
    }

    reset() : void {
        return this._iface.reset();
    }

    async analyzeCommand(command : UserInput) : Promise<AnalysisTypeAdapter<AnalysisType>> {
        if (command.type !== 'command') {
            return {
                type: CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND,
                utterance: '',
                user_target: '',
                inner: null
            };
        }

        const inner = await this._iface.analyzeCommand(command.utterance);
        return {
            type: this._mapConfidence(inner.confident),
            utterance: inner.utterance,
            user_target: inner.user_target,
            inner
        };
    }

    async getReply(command : AnalysisTypeAdapter<AnalysisType>) : Promise<ReplyResult> {
        return this._mapReplyResult(await this._iface.getReply(command.inner!));
    }

    async getFollowUp() : Promise<ReplyResult | null> {
        return null;
    }
}
