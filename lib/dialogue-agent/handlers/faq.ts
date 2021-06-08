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

import { UserInput } from "../user-input";
import {
    DialogueHandler,
    CommandAnalysisType,
    ReplyResult,
    DialogueLoop
} from "../dialogue-loop";

interface FAQCommandAnalysisType {
    type : CommandAnalysisType;
    utterance : string;
    user_target : string;
    answer : string;
}

const CONFIDENCE_THRESHOLD = 0.4;

export default class FAQDialogueHandler implements DialogueHandler<FAQCommandAnalysisType, undefined> {
    priority = Tp.DialogueHandler.Priority.SECONDARY;
    icon = null;
    uniqueId : string;
    private _loop : DialogueLoop;
    private _url : string;

    constructor(loop : DialogueLoop,
                uniqueId : string,
                url : string) {
        this.uniqueId = 'faq/' + uniqueId;
        this._loop = loop;
        this._url = url;
    }

    async initialize() : Promise<ReplyResult | null> {
        return null;
    }
    getState() : undefined {
        return undefined;
    }
    reset() : void {
    }

    async analyzeCommand(command : UserInput) : Promise<FAQCommandAnalysisType> {
        if (command.type !== 'command')
            return { type: CommandAnalysisType.OUT_OF_DOMAIN_COMMAND, utterance: '', user_target: '', answer: '' };

        if (!this._loop.conversation.dialogueFlags.faqs)
            return { type: CommandAnalysisType.OUT_OF_DOMAIN_COMMAND, utterance: command.utterance, user_target: '', answer: '' };

        const response = await Tp.Helpers.Http.post(this._url, JSON.stringify({
            instances: [command.utterance]
        }), { dataContentType: 'application/json' });

        const best : { answer : string, score : number } = JSON.parse(response).predictions[0];

        const confidence = best.score >= CONFIDENCE_THRESHOLD ?
            CommandAnalysisType.CONFIDENT_IN_DOMAIN_COMMAND :
            CommandAnalysisType.NONCONFIDENT_IN_DOMAIN_COMMAND;

        return {
            type: confidence,
            utterance: command.utterance,
            user_target: '$dialogue @org.thingpedia.dialogue.faq.question;',
            answer: best.answer
        };
    }
    async getReply(command : FAQCommandAnalysisType) : Promise<ReplyResult> {
        return {
            messages: [command.answer],
            context: '$dialogue @org.thingpedia.dialogue.faq.question;',
            agent_target: '$dialogue @org.thingpedia.dialogue.faq.answer;',
            expecting: null,
        };
    }
    async getFollowUp() : Promise<ReplyResult | null> {
        return null;
    }
}
