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

const ThingTalk = require('thingtalk');
const SchemaRetriever = ThingTalk.SchemaRetriever;
const NNSyntax = ThingTalk.NNSyntax;
const Ast = ThingTalk.Ast;

const { Constant } = require('../sentence-generator/runtime');
const { makeDummyEntity } = require('../utils');

module.exports = {
    async parse(code, entities, options) {
        const program = ThingTalk.NNSyntax.fromNN(code, entities);

        const tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, !options.debug);
        const schemas = options.schemaRetriever;
        await program.typecheck(schemas, false);
        return program;
    },

    extractConstants(ast) {
        // TODO
        // (not needed because this is only used in contextual mode)
        return {};
    },
    createConstants(token, type, maxConstants) {
        const escapedToken = token.replace(/[:._]/g, (match) => {
            if (match === '_')
                return '__';
            let code = match.charCodeAt(0);
            return code < 16 ? '_0' + code.toString(16) : '_' + code.toString(16);
        });
        const constants = [];
        for (let i = 0; i < maxConstants; i++) {
            const value = new Ast.Value.VarRef(`__const_${escapedToken}_${i}`, type);
            value.constNumber = i;
            constants.push(new Constant(token, i, value));
        }
        return constants;
    },

    serialize(ast, sentence, entities) {
        const clone = {};
        Object.assign(clone, entities);

        const sequence = NNSyntax.toNN(ast, sentence, clone);
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
            return ThingTalk.NNSyntax.toNN(program, '', entities, { allocateEntities: true }).join(' ');
        } catch(e) {
            console.error(code);
            throw e;
        }
    }
};
