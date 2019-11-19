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

const assert = require('assert');
const ontology = require('./ontology');
const Ast = require('../../lib/languages/multidst/ast');

const ALL_SLOTS = new Set;
function init($grammar, $runtime) {
    $grammar.declareSymbol('constant_Any');
    for (let slot_key in ontology) {
        const normalized_slot_key = slot_key.replace(/ /g, '-');
        ALL_SLOTS.add(normalized_slot_key);
        const ident_slot_key = slot_key.replace(/[ -]/g, '_');
        $grammar.declareSymbol('constant_' + ident_slot_key);

        for (let value of ontology[slot_key])
            $grammar.addRule('constant_' + ident_slot_key, value.split(' '), $runtime.simpleCombine(() => new Ast.ConstantValue(value)));

        $grammar.addRule('constant_Any', [new $runtime.NonTerminal('constant_' + ident_slot_key)], $runtime.simpleCombine((v) => {
            return new Slot(normalized_slot_key, v);
        }));
    }
}

class Slot {
    constructor(key, value) {
        assert(ALL_SLOTS.has(key));
        this.key = key;
        this.value = value;
        this.domain = key.split('-')[0];
    }
}
class EmptySlot {
    constructor(domain) {
        this.key = null;
        this.value = null;
        this.domain = domain;
    }
}

function checkAndAddSlot(np, slot) {
    if (np.domain !== null && np.domain !== slot.domain)
        return null;
    if (slot.key === null)
        return np;
    if (np.has(slot.key))
        return null;
    const clone = np.clone();
    clone.set(slot.key, slot.value);
    return clone;
}

module.exports = {
    init,

    Slot,
    EmptySlot,
    checkAndAddSlot
}
