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

const Tp = require('thingpedia');
const Stream = require('stream');
const fs = require('fs');

const { AVAILABLE_LANGUAGES } = require('../lib/languages');
const TokenizerService = require('../lib/tokenizer');
const { DatasetStringifier } = require('../lib/dataset-parsers');
const StreamUtils = require('../lib/stream-utils');
const Utils = require('../lib/utils');

const ProgressBar = require('./lib/progress_bar');
const { DialogueParser } = require('./lib/dialog_parser');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');

class DialogueToTurnStream extends Stream.Transform {
    constructor(options) {
        super({ objectMode: true });

        this._locale = options.locale;

        this._options = options;
        this._debug = options.debug;
        this._side = options.side;
        this._flags = options.flags;
        this._idPrefix = options.idPrefix;
        this._target = require('../lib/languages/' + options.targetLanguage);
        this._dedupe = options.deduplicate ? new Set : undefined;

        this._tokenized = options.tokenized;
        this._tokenizer = null;
        if (!this._tokenized)
            this._tokenizer = TokenizerService.get('local', true);
    }

    async _preprocess(sentence, contextEntities) {
        let tokenized;
        if (this._tokenized) {
            const tokens = sentence.split(' ');
            const entities = Utils.makeDummyEntities(sentence);
            tokenized = { tokens, entities };
        } else {
            tokenized = await this._tokenizer.tokenize(this._locale, sentence);
        }
        Utils.renumberEntities(tokenized, contextEntities);
        return tokenized;
    }

    _getDedupeKey(context, utterance) {
        return context.join(' ') + '<sep>' + utterance.join(' ');
    }

    async _emitAgentTurn(i, turn, dlg) {
        if (i === 0)
            return;

        const context = await this._target.parse(turn.context, this._options);
        const agentContext = this._target.prepareContextForPrediction(context, 'agent');
        const [contextCode, contextEntities] = this._target.serializeNormalized(agentContext);

        const agentTarget = await this._target.parse(turn.agent_target, this._options);
        const agentCode = await this._target.serializePrediction(agentTarget, '', contextEntities, 'agent');

        const { tokens, } = await this._preprocess(turn.agent, contextEntities);

        if (this._dedupe) {
            const key = this._getDedupeKey(contextCode, tokens);
            if (this._dedupe.has(key))
                return;
            this._dedupe.add(key);
        }

        this.push({
            id: this._flags + '' + this._idPrefix + dlg.id + '/' + i,
            context: contextCode.join(' '),
            preprocessed: tokens.join(' '),
            target_code: agentCode.join(' ')
        });
    }

    async _emitUserTurn(i, turn, dlg) {
        let context, contextCode, contextEntities;
        if (i > 0) {
            // if we have an "intermediate context" (C: block after AT:) we ran the execution
            // after the agent spoke, so we don't need to apply the agent turn any more
            //
            // (this occurs only when annotating multiwoz data, when the agent chooses to complete
            // an action with incomplete information, choosing the value spontaneously)
            if (turn.intermediate_context) {
                context = await this._target.parse(turn.intermediate_context, this._options);
            } else {
                context = await this._target.parse(turn.context, this._options);
                // apply the agent prediction to the context to get the state of the dialogue before
                // the user speaks
                const agentPrediction = await this._target.parse(turn.agent_target, this._options);
                context = this._target.computeNewState(context, agentPrediction);
            }

            const userContext = this._target.prepareContextForPrediction(context, 'user');
            [contextCode, contextEntities] = this._target.serializeNormalized(userContext);
        } else {
            context = null;
            contextCode = ['null'];
            contextEntities = {};
        }

        const { tokens, entities } = await this._preprocess(turn.user, contextEntities);
        const userTarget = await this._target.parse(turn.user_target, this._options);
        const code = await this._target.serializePrediction(userTarget, tokens, entities, 'user');

        if (this._dedupe) {
            const key = this._getDedupeKey(contextCode, tokens);
            if (this._dedupe.has(key))
                return;
            this._dedupe.add(key);
        }

        this.push({
            id: this._flags + '' + this._idPrefix + dlg.id + '/' + i,
            context: contextCode.join(' '),
            preprocessed: tokens.join(' '),
            target_code: code.join(' ')
        });
    }

    async _doTransform(dlg) {
        for (let i = 0; i < dlg.length; i++) {
            const turn = dlg[i];

            try {
                if (this._side === 'agent')
                    await this._emitAgentTurn(i, turn, dlg);
                else
                    await this._emitUserTurn(i, turn, dlg);
            } catch(e) {
                console.error('Failed in dialogue ' + dlg.id);
                console.error(turn);
                throw e;
            }
        }

    }

    _transform(dialog, encoding, callback) {
        this._doTransform(dialog).then(() => callback(null), callback);
    }

    _flush(callback) {
        if (this._tokenizer)
            this._tokenizer.end();
        process.nextTick(callback);
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('dialog-to-contextual', {
            addHelp: true,
            description: "Transform a dialog input file into a contextual dataset (turn by turn)."
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
            type: fs.createWriteStream
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
        });
        parser.addArgument('--tokenized', {
            required: false,
            action: 'storeTrue',
            defaultValue: true,
            help: "The dataset is already tokenized (this is the default)."
        });
        parser.addArgument('--no-tokenized', {
            required: false,
            dest: 'tokenized',
            action: 'storeFalse',
            help: "The dataset is not already tokenized."
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument(['-t', '--target-language'], {
            required: false,
            defaultValue: 'thingtalk',
            choices: AVAILABLE_LANGUAGES,
            help: `The programming language to generate`
        });
        parser.addArgument('--side', {
            required: true,
            choices: ['user', 'agent'],
            help: 'Which side of the conversation should be extracted.'
        });
        parser.addArgument('--flags', {
            required: false,
            defaultValue: '',
            help: 'Additional flags to add to the generated training examples.'
        });
        parser.addArgument('--id-prefix', {
            required: false,
            defaultValue: '',
            help: 'Prefix to add to all sentence IDs (useful to combine multiple datasets).'
        });
        parser.addArgument('--deduplicate', {
            nargs: 0,
            action: 'storeTrue',
            defaultValue: false,
            help: 'Do not output duplicate turns (with the same preprocessed context and utterance)'
        });
        parser.addArgument('--no-deduplicate', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'deduplicate',
            help: 'Output duplicate turns (with the same preprocessed context and utterance)'
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input dialog file; use - for standard input'
        });
        parser.addArgument('--debug', {
            nargs: 0,
            action: 'storeTrue',
            help: 'Enable debugging.',
            defaultValue: true
        });
        parser.addArgument('--no-debug', {
            nargs: 0,
            action: 'storeFalse',
            dest: 'debug',
            help: 'Disable debugging.',
        });
    },

    async execute(args) {
        let tpClient = null;
        if (args.thingpedia)
            tpClient = new Tp.FileClient(args);

        const counter = new StreamUtils.CountStream();

        readAllLines(args.input_file, '====')
            .pipe(new DialogueParser())
            .pipe(counter)
            .pipe(new DialogueToTurnStream({
                locale: args.locale,
                targetLanguage: args.target_language,
                thingpediaClient: tpClient,
                flags: args.flags,
                idPrefix: args.id_prefix,
                side: args.side,
                tokenized: args.tokenized,
                deduplicate: args.deduplicate,
                debug: args.debug
            }))
            .pipe(new DatasetStringifier())
            .pipe(args.output);

        const progbar = new ProgressBar(1);
        counter.on('progress', (value) => {
            //console.log(value);
            progbar.update(value);
        });

        // issue an update now to show the progress bar
        progbar.update(0);

        await StreamUtils.waitFinish(args.output);
    }
};
