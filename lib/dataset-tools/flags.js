// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

function parseFlags(flags) {
    const parsed = {};
    for (let flag of flags.split(','))
        parsed[flag] = true;
    return parsed;
}

function makeFlags(flags) {
    return Object.keys(flags).filter((k) => !!flags[k]).join(',');
}

function parseId(ex) {
    const [, replaced, augmented, contextual, synthetic, _eval, id] = /^(R)?(P)?(C)?(S)?(E)?(.*)$/.exec(ex.id);

    ex.flags = {
        replaced: !!replaced,
        augmented: !!augmented,
        contextual: !!contextual,
        synthetic: !!synthetic,
        eval: !!_eval,
    };
    ex.id = id;
}

function makeId(ex) {
    if (!ex.flags)
        return ex.id;

    let prefix = '';
    if (ex.flags.replaced)
        prefix += 'R';
    if (ex.flags.augmented)
        prefix += 'P';
    if (ex.flags.contextual)
        prefix += 'C';
    if (ex.flags.synthetic)
        prefix += 'S';
    if (ex.flags.eval)
        prefix += 'E';
    return prefix + ex.id;
}

module.exports = {
    parseFlags,
    makeFlags,

    parseId,
    makeId,
};
