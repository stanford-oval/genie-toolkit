// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import assert from 'assert';
import * as ThingTalk from './thingtalk';
import * as MultiDST from './multidst';

export const AVAILABLE_LANGUAGES = ['multidst', 'thingtalk', 'dlgthingtalk'];

interface Constant {
    display : string;
    value : unknown;
}
export type ConstantMap = { [key : string] : Constant[] };

const _languages = {
    'multidst': MultiDST,
    'thingtalk': ThingTalk
};

export type TargetLanguage = (typeof _languages)[keyof typeof _languages];

export type DialogueState = ReturnType<TargetLanguage['computePrediction']>;
export type Program = ReturnType<TargetLanguage['parse']> extends Promise<infer T> ? T : never;

export type Simulator = ReturnType<TargetLanguage['createSimulator']>;

export function get(targetLanguage ?: string) : TargetLanguage {
    if (targetLanguage === undefined || targetLanguage === 'dlgthingtalk')
        targetLanguage = 'thingtalk';
    assert(targetLanguage === 'multidst' || targetLanguage === 'thingtalk');
    return _languages[targetLanguage];
}
