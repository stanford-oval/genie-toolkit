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

export interface SentenceFlags {
    replaced ?: boolean;
    augmented ?: boolean;
    contextual ?: boolean;
    synthetic ?: boolean;
    eval ?: boolean;
}

// Note that the order of flags is important here
// e.g. in some dialog examples ids are prefixed ('SNG' --> 'ESNG') to avoid incorrect parsing of flags
export const flagsMap : Record<string, keyof SentenceFlags> = {
    'R': 'replaced',
    'P': 'augmented',
    'C': 'contextual',
    'S': 'synthetic',
    'E': 'eval'
};

export function parseFlags(flags : string) {
    const parsed : SentenceFlags = {};
    for (const flag of flags.split(','))
        parsed[flag as keyof SentenceFlags] = true;
    return parsed;
}

export function makeFlags(flags : SentenceFlags) : string {
    return Object.keys(flags).filter((k) => !!(flags as Record<string, boolean>)[k]).join(',');
}

interface Example {
    id : string;
    flags : SentenceFlags;
}

export function parseId(ex : Example) {
    const [, replaced, augmented, contextual, synthetic, _eval, id] = /^(R)?(P)?(C)?(S)?(E)?(.*)$/.exec(ex.id)!;

    ex.flags = {
        replaced: !!replaced,
        augmented: !!augmented,
        contextual: !!contextual,
        synthetic: !!synthetic,
        eval: !!_eval,
    };
    ex.id = id;
}

export function makeId(ex : Example) : string {
    if (!ex.flags)
        return ex.id;

    let prefix = '';
    for (const [flag, value] of Object.entries(flagsMap)) {
        if (ex.flags[value])
            prefix += flag;
    }

    return prefix + ex.id;
}
