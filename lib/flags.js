// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
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
    const [, replaced, augmented, synthetic, id] = /^(R)?(P)?(S)?(.*)$/.exec(ex.id);

    ex.flags = {
        replaced: !!replaced,
        augmented: !!augmented,
        synthetic: !!synthetic
    };
    ex.id = id;
}

function makeId(ex) {
    let prefix = '';
    if (ex.flags.replaced)
        prefix += 'R';
    if (ex.flags.augmented)
        prefix += 'P';
    if (ex.flags.synthetic)
        prefix += 'S';
    return prefix + ex.id;
}

module.exports = {
    parseFlags,
    makeFlags,

    parseId,
    makeId,
};
