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
const systemOntology = require('./system-ontology');
const Ast = require('../../lib/languages/multidst/ast');

const ALL_SLOTS = new Set;
const PROPOSABLE_SLOTS = new Set([
    'restaurant-name',
    'restaurant-food',
    'restaurant-area',
    'restaurant-price-range',
    'hotel-name',
    'hotel-area',
    'hotel-type',
    'hotel-price-range',
    'hotel-parking',
    'hotel-stars',
    'hotel-internet',
    'attraction-area',
    'attraction-name',
    'attraction-type',
]);
const NAME_SLOTS = new Set([
    'attraction-name',
    'restaurant-name',
    'hotel-name'
]);
const SEARCH_SLOTS = new Set([
    'restaurant-food',
    'restaurant-area',
    'restaurant-price-range',
    'hotel-area',
    'hotel-type',
    'hotel-price-range',
    'hotel-parking',
    'hotel-stars',
    'hotel-internet',
    'attraction-area',
    'attraction-type',
    'train-day',
    'train-departure',
    'train-destination',
    'train-leave-at'
]);
const REQUESTABLE_SEARCH_SLOTS = new Set([
    'restaurant-food',
    'restaurant-area',
    'restaurant-price-range',
    'hotel-area',
    'hotel-type',
    'hotel-price-range',
    'hotel-parking',
    'hotel-stars',
    'hotel-internet',
    'attraction-area',
    'attraction-type',
]);

const TRANSACTION_REQUIRED_SLOTS = {
    attraction: new Set(),
    hotel: new Set([
        'hotel-book-day',
        'hotel-book-people',
        'hotel-book-stay',
    ]),
    restaurant: new Set([
        'restaurant-book-day',
        'restaurant-book-people',
        'restaurant-book-time',
    ]),
    taxi: new Set([
        'taxi-arrive-by',
        'taxi-departure',
        'taxi-destination',
        'taxi-leave-at',
    ]),
    train: new Set([
        'train-arrive-by',
        'train-book-people',
        'train-day',
        'train-departure',
        'train-destination',
        'train-leave-at'
    ])
};
const SYSTEM_SLOTS = {
    attraction: new Set([
        'addr',
        'post',
        'phone',
        'open',
        'fee'
    ]),
    hotel: new Set([
        'addr',
        'post',
        'phone',
        'ref',
    ]),
    restaurant: new Set([
        'addr',
        'post',
        'phone',
        'ref',
    ]),
    taxi: new Set([
        'car',
        'ref'
    ]),
    train: new Set([
        'id'
    ])
};
const ALL_SYSTEM_SLOTS = new Set;
const NON_REQUESTABLE_SYSTEM_SLOTS = new Set(['hotel-system-ref', 'restaurant-system-ref', 'taxi-system-ref', 'train-system-id']);

function searchIsComplete(ctx) {
    for (let key of NAME_SLOTS) {
        if (ctx.has(key))
            return true;
    }

    if (ctx.domain === 'taxi') {
        return ctx.has('taxi-departure') && ctx.has('taxi-destination')
            && (ctx.has('taxi-arrive-by') || ctx.has('taxi-leave-at'));
    }

    if (ctx.domain === 'train') {
        return ctx.has('train-departure') && ctx.has('train-destination')
            && (ctx.has('train-arrive-by') || ctx.has('train-leave-at'));
    }

    return false;
}

function init($grammar, $runtime) {
    $grammar.declareSymbol('constant_Any');
    $grammar.declareSymbol('constant_Any_system');
    $grammar.declareSymbol('constant_name');
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
        if (NAME_SLOTS.has(normalized_slot_key)) {
            $grammar.addRule('constant_name', [new $runtime.NonTerminal('constant_' + ident_slot_key)], $runtime.simpleCombine((v) => {
                return new Slot(normalized_slot_key, v);
            }));
        }
    }

    for (let domain in SYSTEM_SLOTS) {
        for (let slot_name of SYSTEM_SLOTS[domain]) {
            const slot_key = domain + '-system-' + slot_name;
            ALL_SYSTEM_SLOTS.add(slot_key);
            const ident_slot_key = slot_key.replace(/[ -]/g, '_');
            $grammar.declareSymbol('constant_' + ident_slot_key);

            for (let value of systemOntology[slot_name])
                $grammar.addRule('constant_' + ident_slot_key, value.split(' '), $runtime.simpleCombine(() => new Ast.ConstantValue(value)));

            $grammar.addRule('constant_Any_system', [new $runtime.NonTerminal('constant_' + ident_slot_key)], $runtime.simpleCombine((v) => {
                return new SystemSlot(slot_key, v);
            }));
        }
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
class SystemSlot {
    constructor(key, value) {
        assert(ALL_SYSTEM_SLOTS.has(key));
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
    if (slot.key === null) {
        if (np.domain === null) {
            const clone = np.clone();
            clone.domain = slot.domain;
            return clone;
        }
        return np;
    }
    if (np.has(slot.key))
        return null;
    const clone = np.clone();
    clone.set(slot.key, slot.value);
    return clone;
}

function compatibleDomains(s1, s2) {
    assert(s1.domain === null || typeof s1.domain === 'string');
    assert(s2.domain === null || typeof s2.domain === 'string');

    return s1.domain === null || s2.domain === null || s1.domain === s2.domain;
}

function propose(proposal) {
    if (proposal.size < 1)
        return null;
    for (let key of proposal.keys()) {
        if (!PROPOSABLE_SLOTS.has(key))
            return null;
    }

    return proposal;
}

function proposalIsCompatible(proposal, ctx) {
    if (!compatibleDomains(proposal, ctx))
        return false;
    for (let [key, value] of proposal) {
        if (ctx.has(key)) {
            if (!ctx.get(key).equals(value))
                return false;
        }
    }
    return true;
}

function errorIsCompatible(error, ctx) {
    if (!compatibleDomains(error, ctx))
        return false;
    for (let [key, value] of error) {
        if (!ctx.has(key) || !ctx.get(key).equals(value))
            return false;
    }
    return true;
}

function infoIsCompatible(info, ctx) {
    if (!compatibleDomains(info, ctx))
        return false;
    for (let [key, value] of info) {
        if (ctx.has(key)) {
            const ctxvalue = ctx.get(key);
            if (ctxvalue !== Ast.QUESTION && !ctxvalue.equals(value))
                return false;
        } else if (NAME_SLOTS.has(key)) {
            return false;
        }
    }
    return true;
}

function checkInfoNounPhrase(info) {
    for (let key of info.keys()) {
        if (!REQUESTABLE_SEARCH_SLOTS.has(key))
            return null;
    }
    return info;
}

function counterRequest(ctx, counterrequest, intent, allowOverride = false) {
    const clone = ctx.clone();
    // override all slots based on the counterrequest

    let anydifferent = false;
    for (let [key, value] of counterrequest) {
        if (!clone.has(key) || !clone.get(key).equals(value))
            anydifferent = true;
        if (!allowOverride && clone.has(key) && !clone.get(key).equals(value))
            return null;
        clone.set(key, value);
    }
    // if we did not make any change, no dice
    if (!anydifferent)
        return null;

    if (clone.domain === null)
        clone.domain = counterrequest.domain;
    clone.intent = intent;
    return clone;
}

function userAskQuestions(proposal, params) {
    const state = new Ast.DialogState;
    for (let param of params) {
        const domain = param.split('-')[0];
        if (proposal.domain !== null && domain !== proposal.domain)
            return null;
        if (proposal.has(param))
            return null;

        state.set(param, Ast.QUESTION);
    }

    return state;
}

function systemAnswerInfo(ctx, [info, intent]) {
    if (!infoIsCompatible(info, ctx))
        return null;

    for (let [key, value] of ctx) {
        if (value === Ast.QUESTION && !info.has(key))
            return null;
    }
    for (let [key,] of info) {
        if (ALL_SYSTEM_SLOTS.has(key) && !ctx.has(key))
            return null;
        if (NON_REQUESTABLE_SYSTEM_SLOTS.has(key))
            return null;
    }

    const clone = ctx.clone();
    for (let [key, value] of ctx.keys()) {
        if (value === Ast.QUESTION)
            clone.delete(key);
    }
    for (let [key, value] of info) {
        if (ALL_SYSTEM_SLOTS.has(key))
            continue;
        clone.set(key, value);
    }
    clone.intent = intent;
    return clone;
}

module.exports = {
    init,

    Slot,
    SystemSlot,
    EmptySlot,
    checkAndAddSlot,
    compatibleDomains,

    searchIsComplete,

    propose,
    proposalIsCompatible,
    PROPOSABLE_SLOTS,
    counterRequest,
    checkInfoNounPhrase,

    errorIsCompatible,
    infoIsCompatible,
    userAskQuestions,
    systemAnswerInfo,

    ALL_SYSTEM_SLOTS,
    NAME_SLOTS,
    SEARCH_SLOTS,
    TRANSACTION_REQUIRED_SLOTS,
    REQUESTABLE_SEARCH_SLOTS,
    NON_REQUESTABLE_SYSTEM_SLOTS
};
