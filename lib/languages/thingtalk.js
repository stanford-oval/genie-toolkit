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
const SchemaRetriever = ThingTalk;
const NNSyntax = ThingTalk.NNSyntax;

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

    serialize(ast, sentence, entities) {
        const clone = {};
        Object.assign(clone, entities);

        const sequence = NNSyntax.toNN(ast, sentence, clone);
        //ThingTalk.NNSyntax.fromNN(sequence, {});

        if (sequence.some((t) => t.endsWith(':undefined')))
            throw new TypeError(`Generated undefined type`);

        return sequence;
    }
};
