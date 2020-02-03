// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const SchemaRetriever = ThingTalk.SchemaRetriever;
const NNSyntax = ThingTalk.NNSyntax;

const POLICIES = require('./policies');

const { makeDummyEntity } = require('../../utils');

module.exports = {
    async parse(code, entities, options) {
        const state = ThingTalk.NNSyntax.fromNN(code, entities);
        assert(state instanceof Ast.DialogueState);

        const tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, !options.debug);
        const schemas = options.schemaRetriever;
        await state.typecheck(schemas, false);

        const policy = POLICIES[state.policy];
        if (!policy)
            throw new Error(`Invalid dialogue policy ${state.policy}`);
        state.delegate = policy.initState(state);
        return state;
    },

    serialize(ast, sentence, entities) {
        const clone = {};
        Object.assign(clone, entities);

        const sequence = NNSyntax.toNN(ast, sentence, clone, { typeAnnotations: false });
        //ThingTalk.NNSyntax.fromNN(sequence, {});

        if (sequence.some((t) => t.endsWith(':undefined')))
            throw new TypeError(`Generated undefined type`);

        return sequence;
    },

    async normalize(code, options) {
        try {
            const program = ThingTalk.NNSyntax.fromNN(code.split(' '), makeDummyEntity);
            await program.typecheck(options.schemaRetriever, false);

            const entities = {};
            return ThingTalk.NNSyntax.toNN(program, '', entities, { allocateEntities: true, typeAnnotations: false }).join(' ');
        } catch(e) {
            console.error(code);
            throw e;
        }
    }
};
