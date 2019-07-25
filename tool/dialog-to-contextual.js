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
const Stream = require('stream');
const fs = require('fs');

const TokenizerService = require('../lib/tokenizer');
const { DatasetStringifier } = require('../lib/dataset-parsers');
const StreamUtils = require('../lib/stream-utils');
const Utils = require('../lib/utils');

const FileThingpediaClient = require('./lib/file_thingpedia_client');
const { DialogParser } = require('./lib/dialog_parser');
const { maybeCreateReadStream, readAllLines } = require('./lib/argutils');

class DialogToTurnStream extends Stream.Transform {
    constructor(options) {
        super({ objectMode: true });

        this._locale = options.locale;
        this._tokenizer = options.tokenizer;
        this._schemas = options.schemas;
        this._tokenized = options.tokenized;
        this._debug = options.debug;
    }

    _applyReplyToContext(context, newCommand) {
        if (newCommand.isProgram || newCommand.isPermissionRule) {
            return newCommand;
        } else if (newCommand.isBookkeeping && newCommand.intent.isAnswer) {
            for (let [,slot] of context.iterateSlots()) {
                if (slot instanceof ThingTalk.Ast.Selector)
                    continue;
                if (!slot.value.isUndefined)
                    continue;
                slot.value = newCommand.intent.value;
                return context;
            }
            throw new Error('???');
        } else if (newCommand.isBookkeeping && newCommand.intent.isSpecial) {
            if (newCommand.intent.type === 'nevermind' || newCommand.intent.type === 'stop')
                return null;
            else // yes/no
                return context;
        } else {
            console.log(newCommand);
            throw new Error('????');
        }
    }

    async _doTransform(dialog) {
        let context = null;
        let contextNN = ['null'];
        let contextEntities = {};

        for (let i = 0; i < dialog.length; i += 2) {
            const input = dialog[i];
            const targetCode = dialog[i+1];

            const targetCommand = ThingTalk.Grammar.parse(targetCode);
            await targetCommand.typecheck(this._schemas);

            // skip raw string answers (which are handled by the dialog agent) because it does not make sense to
            // evaluate them
            if (targetCommand.isBookkeeping && targetCommand.intent.isAnswer && targetCommand.intent.value.isString)
                continue;

            let tokens;
            let entities;
            if (this._tokenized) {
                tokens = input.split(' ');
                entities = Utils.makeDummyEntities(input);
                Object.assign(entities, contextEntities);
            } else {
                const tokenized = await this._tokenizer.tokenize(this._locale, input);
                Utils.renumberEntities(tokenized, contextEntities);
                tokens = tokenized.tokens;
                entities = tokenized.entities;
            }

            const targetNN = ThingTalk.NNSyntax.toNN(targetCommand, tokens, entities);

            this.push({
                id: 'dlg' + dialog.id + ':' + i,
                context: contextNN.join(' '),
                preprocessed: tokens.join(' '),
                target_code: targetNN.join(' ')
            });

            context = this._applyReplyToContext(context, targetCommand);
            contextEntities = {};
            if (context !== null)
                contextNN = ThingTalk.NNSyntax.toNN(context, '', contextEntities, { allocateEntities: true });
            else
                contextNN = ['null'];
        }

    }

    _transform(dialog, encoding, callback) {
        this._doTransform(dialog).then(() => callback(null), callback);
    }

    _flush(callback) {
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
        parser.addArgument('--tokenized', {
            required: false,
            action: 'storeTrue',
            defaultValue: false,
            help: "The dataset is already tokenized."
        });
        parser.addArgument('--no-tokenized', {
            required: false,
            dest: 'tokenized',
            action: 'storeFalse',
            help: "The dataset is not already tokenized (this is the default)."
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('input_file', {
            nargs: '+',
            type: maybeCreateReadStream,
            help: 'Input dialog file; use - for standard input'
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the language to evaluate (defaults to 'en-US', English)`
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
        const tpClient = new FileThingpediaClient(args);
        const schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
        const tokenizer = TokenizerService.get('local');

        readAllLines(args.input_file, '====')
            .pipe(new DialogParser())
            .pipe(new DialogToTurnStream({
                locale: args.locale,
                tokenizer,
                schemas,
                tokenized: args.tokenized,
                debug: args.debug
            }))
            .pipe(new DatasetStringifier())
            .pipe(args.output);

        await StreamUtils.waitFinish(args.output);
        await tokenizer.end();
    }
};
