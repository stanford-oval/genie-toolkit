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

const StatementSimulator = require('../dialogue_agent/execution/statement_simulator');
const DialogueExecutor = require('../dialogue_agent/execution/dialogue_executor');
const { computeNewState, computePrediction, prepareContextForPrediction } = require('../dialogue_agent/dialogue_state_utils');

const MAX_CONSTANTS = 20;
const MAX_SMALL_INTEGER = 12;

module.exports = {
    async parse(code, options) {
        const tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, true);

        assert(code);
        const state = await ThingTalk.Grammar.parseAndTypecheck(code, options.schemaRetriever, false);
        assert(state instanceof Ast.DialogueState);
        return state;
    },

    extractConstants(ast) {
        const constants = {};
        function addConstant(token, display, value) {
            if (constants[token])
                constants[token].push({ display, value });
            else
                constants[token] = [{ display, value }];
        }

        ast.visit(new class extends Ast.NodeVisitor {
            visitStringValue(value) {
                addConstant('QUOTED_STRING', value.value, value);
            }

            visitEntityValue(value) {
                switch (value.type) {
                case 'tt:url':
                    addConstant('URL', value.value, value);
                    break;

                case 'tt:username':
                    addConstant('USERNAME', value.value, value);
                    break;

                case 'tt:hashtag':
                    addConstant('HASHTAG', value.value, value);
                    break;

                case 'tt:phone_number':
                    addConstant('PHONE_NUMBER', value.value, value);
                    break;

                case 'tt:email_address':
                    addConstant('EMAIL_ADDRESS', value.value, value);
                    break;

                case 'tt:path_name':
                    addConstant('PATH_NAME', value.value, value);
                    break;

                default:
                    addConstant('GENERIC_ENTITY_' + value.type, value.display, value);
                    break;
                }
            }

            visitNumberValue(value) {
                addConstant('NUMBER', String(value.value), value);
            }

            visitCurrencyValue(value) {
                addConstant('CURRENCY', String(value.value) + ' ' + value.unit, value);
            }

            visitLocationValue(value) {
                if (value.value instanceof Ast.Location.Absolute && value.value.display)
                    addConstant('LOCATION', value.value.display, value);
                else if (value.value instanceof Ast.Location.Unresolved && value.value.name)
                    addConstant('LOCATION', value.value.name, value);
            }

            visitTimeValue(value) {
                if (!(value.value instanceof Ast.Time.Absolute))
                    return;
                const time = value.value;
                addConstant('TIME', `${time.hour}:${time.minute < 10 ? '0' : ''}${time.minute}:${time.second < 10 ? '0' : ''}${time.second}`, value);
            }

            visitDateValue(value) {
                if (!(value.value instanceof Date))
                    return;
                addConstant('DATE', value.date.toISOString(), value);
            }
        });

        return constants;
    },
    createConstants(token, type, maxConstants) {
        // ignore maxConstants, because it's too low (5) and there is no way to set it differently

        const constants = [];
        for (let i = 0; i < MAX_CONSTANTS; i++) {
            switch (token) {
            case 'NUMBER':
                constants.push({
                    display: 'NUMBER_' + i,
                    value: new Ast.Value.Number(MAX_SMALL_INTEGER + 1 + i)
                });
                break;
            case 'QUOTED_STRING':
                constants.push({
                    display: 'QUOTED_STRING_' + i,
                    value: new Ast.Value.String('str:QUOTED_STRING::' + i + ':')
                });
                break;
            case 'URL':
                constants.push({
                    display: 'URL_' + i,
                    value: new Ast.Value.Entity('str:URL::' + i + ':', 'tt:url')
                });
                break;
            case 'USERNAME':
                constants.push({
                    display: 'USERNAME_' + i,
                    value: new Ast.Value.Entity('str:USERNAME::' + i + ':', 'tt:username')
                });
                break;
            case 'HASHTAG':
                constants.push({
                    display: 'HASHTAG_' + i,
                    value: new Ast.Value.Entity('str:HASHTAG::' + i + ':', 'tt:hashtag')
                });
                break;
            case 'PHONE_NUMBER':
                constants.push({
                    display: 'PHONE_NUMBER_' + i,
                    value: new Ast.Value.Entity('str:PHONE_NUMBER::' + i + ':', 'tt:phone_number')
                });
                break;
            case 'EMAIL_ADDRESS':
                constants.push({
                    display: 'EMAIL_ADDRESS_' + i,
                    value: new Ast.Value.Entity('str:EMAIL_ADDRESS::' + i + ':', 'tt:email_address')
                });
                break;
            case 'PATH_NAME':
                constants.push({
                    display: 'PATH_NAME_' + i,
                    value: new Ast.Value.Entity('str:PATH_NAME::' + i + ':', 'tt:path_name')
                });
                break;
            case 'CURRENCY':
                constants.push({
                    display: 'CURRENCY_' + i,
                    value: new Ast.Value.Currency(2 + i, 'usd')
                });
                break;
            case 'DURATION':
                constants.push({
                    display: 'DURATION_' + i,
                    value: new Ast.Value.Measure(2 + i, 'ms')
                });
                break;
            case 'LOCATION':
                constants.push({
                    display: 'LOCATION_' + i,
                    value: new Ast.Value.Location(new Ast.Location.Absolute(2 + i, 2 + i, null))
                });
                break;
            case 'DATE':
                constants.push({
                    display: 'DATE_' + i,
                    value: new Ast.Value.Date(new Date(2018, 0, 2 + i))
                });
                break;
            case 'TIME':
                constants.push({
                    display: 'TIME_' + i,
                    value: new Ast.Value.Time(new Ast.Time.Absolute(Math.floor(i/4), [0, 15, 30, 45][i % 4], 0))
                });
                break;
            default: {
                assert(token.startsWith('GENERIC_ENTITY_'));
                const string = `str:ENTITY_${type.type}::${i}:`;
                constants.push({
                    display: token + '_' + i,
                    value: new Ast.Value.Entity(string, type.type, string)
                });
            }
            }
        }
        return constants;
    },

    async parsePrediction(code, entities, options) {
        const tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, true);

        const schemas = options.schemaRetriever;
        try {
            if (typeof code === 'string')
                code = code.split(' ');
            const state = ThingTalk.NNSyntax.fromNN(code, entities);
            await state.typecheck(schemas, true);
            assert(state instanceof Ast.DialogueState);

            // convert the program to NN syntax once, which will force the program to be syntactically normalized
            // (and therefore rearrange slot-fill by name rather than Thingpedia order)
            ThingTalk.NNSyntax.toNN(state, '', {}, { allocateEntities: true });
            return state;
        } catch(e) {
            return null;
        }
    },

    serializeNormalized(program) {
        const entities = {};
        const code = ThingTalk.NNSyntax.toNN(program, '', entities, { allocateEntities: true, typeAnnotations: false });
        return [code, entities];
    },

    computeNewState(oldState, prediction, forTarget) {
        return computeNewState(oldState, prediction, forTarget);
    },

    /**
     * Compute the information that the neural network must predict to compute the new state
     * in a turn.
     *
     * This applies to either the network interpreting the user input, the one controlling the
     * dialogue policy.
     *
     * This should return a new state, roughly corresponding to the
     * delta between `oldState` and `newState`.
     * Neither `oldState` nor `newState` must be modified in-place.
     *
     * @param {ThingTalk.Ast.DialogueState} oldState - the previous dialogue state, before the turn
     * @param {ThingTalk.Ast.DialogueState} newState - the new state of the dialogue, after the turn
     * @param {string} forTarget - who is speaking now: either `user` or `agent`
     */
    computePrediction(oldState, newState, forTarget) {
        return computePrediction(oldState, newState, forTarget);
    },

    /**
     * Convert the prediction to a sequence of tokens to predict.
     *
     * @param {ThingTalk.Ast.DialogueState} oldState - the previous dialogue state, before the turn
     * @param {ThingTalk.Ast.DialogueState} newState - the new state of the dialogue, after the turn
     * @param {string[]} sentence - the utterance spoken at this turn
     * @param {Object} entities - entities contained in the utterance or the context
     * @param {string} forTarget - who is speaking now: either `user` or `agent`
     * @return {string[]} - the delta to predict, as a sequence of tokens
     */
    serializePrediction(prediction, sentence, entities, forTarget) {
        return ThingTalk.NNSyntax.toNN(prediction, sentence, entities, { allocateEntities: forTarget === 'agent', typeAnnotations: false });
    },

    createSimulator(options = {}) {
        const tpClient = options.thingpediaClient;
        if (!options.schemaRetriever)
            options.schemaRetriever = new SchemaRetriever(tpClient, null, true);
        return new DialogueExecutor(new StatementSimulator(options));
    },

    prepareContextForPrediction(context, forTarget) {
        return prepareContextForPrediction(context, forTarget);
    },
};
