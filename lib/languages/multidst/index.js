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

const Ast = require('./ast');

module.exports = {
    async parse(code, entities, options) {
        const dialoguestate = new Ast.DialogState;

        let parserState = 'begin';
        if (typeof code === 'string')
            code = code.split(' ');

        if (code.length === 1 && code[0] === 'none')
            return dialoguestate;

        let currentBuffer = [];
        let currentSlotKey = undefined;

        for (let token of code) {
            switch (parserState) {
            case 'begin':
                if (['"', 'is', 'yes', 'no', 'dontcare', 'none'].includes(token) || token.startsWith('SLOT_'))
                    throw new Error(`Unexpected token ${token} in state ${parserState}`);
                currentBuffer.push(token);
                parserState = 'name';
                break;

            case 'name':
                if (['"', 'yes', 'no', 'dontcare', 'none'].includes(token))
                    throw new Error(`Unexpected token ${token} in state ${parserState}`);
                if (token === 'is')
                    parserState = 'is';
                else
                    currentBuffer.push(token);
                break;

            case 'is':
                currentSlotKey = currentBuffer.join('-');
                currentBuffer.length = 0;
                if (['yes', 'no', 'dontcare', 'none'].includes(token)) {
                    dialoguestate.set(currentSlotKey, new Ast.TristateValue(token));
                    parserState = 'begin';
                } else if (token.startsWith('SLOT_')) {
                    dialoguestate.set(currentSlotKey, new Ast.SlotValue(token));
                    parserState = 'begin';
                } else {
                    if (token !== '"')
                        throw new Error(`Unexpected token ${token} in state ${parserState}`);
                    parserState = 'string';
                }
                break;

            case 'string':
                if (token === '"') {
                    dialoguestate.set(currentSlotKey, new Ast.ConstantValue(currentBuffer.join(' ')));
                    currentBuffer.length = 0;
                    parserState = 'begin';
                } else {
                    currentBuffer.push(token);
                }
            }
        }

        if (parserState !== 'begin')
            throw new Error(`Unexpected end-of-stream in state ${parserState}`);

        return dialoguestate;
    },

    serialize(ast, sentence, entities) {
        return ast.prettyprint().split(' ');
    }
};
