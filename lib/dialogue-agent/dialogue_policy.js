// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const ValueCategory = require('../semantic').ValueCategory;
const { CancellationError } = require('../errors');
const I18n = require('../../i18n');
const { SentenceGenerator}  = require('../../sentence-generator');

const MAX_DEPTH = 9;
const TARGET_PRUNING_SIZE = 50;

module.exports = class DialoguePolicy {
    constructor(dlg) {
        this._dlg = dlg;

        this._langPack = I18n.get(dlg.locale);

        assert(dlg.rng);
        this._sentenceGenerator = new SentenceGenerator({
            contextual: true,
            rootSymbol: '$agent',
            flags: {
                // FIXME
                dialogues: true,
                inference: true,
            },
            rng: dlg.rng,
            locale: dlg.manager.locale,
            templateFiles: [require.resolve('../../languages/thingtalk/en/dialogue.genie')],
            targetLanguage: 'dlgthingtalk',
            thingpediaClient: dlg.manager.thingpedia,
            schemaRetriever: dlg.manager.schemas,
            maxDepth: MAX_DEPTH,
            targetPruningSize: TARGET_PRUNING_SIZE,
            debug: true,
        });
    }

    async init() {
        await this._sentenceGenerator.initialize();
        return this;
    }

    handleAnswer(value) {
        // TODO
        return null;
    }

    async chooseAction(state) {
        const derivation = this._sentenceGenerator.generateOne({ context: state });
        if (derivation === undefined) {
            await this._dlg.fail();
            throw new CancellationError();
        }

        let sentence = derivation.toString();
        sentence = this._langPack.postprocessSynthetic(sentence, derivation.value, this._dlg.rng, 'agent');
        sentence = this._langPack.postprocessNLG(sentence, {});

        return [derivation.value, sentence];
    }

    _findParameterType(state, argname) {
        // find the current program and the next program, if any
        let next = null, current = null;
        for (const item of state.history) {
            if (item.results === null) {
                next = item;
                break;
            }
            current = item;
        }
        if (current !== null) {
            const isTable = !!(current.stmt.table && current.stmt.actions.every((a) => a.isNotify));
            if (isTable) {
                const schema = current.stmt.table.schema;
                const arg = schema.getArgument(argname);
                if (arg && !arg.is_input)
                    return arg.type;
            } else {
                for (let action of current.stmt.actions) {
                    if (action.isNotify)
                        continue;
                    const schema = action.schema;
                    const arg = schema.getArgument(argname);
                    if (arg && !arg.is_input)
                        return arg.type;
                }
            }
        }
        if (next !== null) {
            for (let action of next.stmt.actions) {
                const schema = action.schema;
                const arg = schema.getArgument(argname);
                if (arg && arg.is_input)
                    return arg.type;
            }
        }

        return undefined;
    }

    getInteractionState(state) {
        // TODO there needs to be a way to specify the terminal dialogue act
        const isTerminal = state.dialogueAct === 'sys_end';

        // XXX this is a hacky
        //
        // the assumption is that if the dialogue act has a parameter, the parameter
        // is a thingtalk parameter name for the current or next program (rather than a
        // device attribute, or a context variable, or a random identifier) and the agent
        // is asking for that parameter
        // (this is true for the transaction policy)
        //
        // FIXME this does not handle yes/no correctly
        let expect = undefined;

        // if there is only one parameter for the dialogue act, the expectation
        // depends on the type of that parameter
        if (state.dialogueActParam && state.dialogueActParam.length === 1) {
            const type = this._findParameterType(state, state.dialogueActParam[0]);
            if (type)
                expect = ValueCategory.fromType(type);
        }
        if (expect === undefined)
            expect = ValueCategory.Command;

        // FIXME
        // if the ValueCategory is RawString, we'll enter raw mode, which we don't handle
        // so we override that to ValueCategory.Command
        if (expect === ValueCategory.RawString)
            expect = ValueCategory.Command;

        return { isTerminal, expect };
    }
};
