// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const fs = require('fs');
const readline = require('readline');
const Stream = require('stream');
const Tp = require('thingpedia');

const ParserClient = require('./lib/parserclient');
const { DialogSerializer } = require('./lib/dialog_parser');
const StreamUtils = require('../lib/stream-utils');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

class Annotator extends Stream.Readable {
    constructor(rl, options) {
        super({ objectMode: true });

        this._rl = rl;

        const tpClient = new Tp.FileClient(options);
        this._schemas = new ThingTalk.SchemaRetriever(tpClient, null, true);
        this._parser = ParserClient.get(options.server, 'en-US');

        this._state = 'loading';

        this._serial = 0;

        this._currentDialog = [];

        this._dialogState = undefined;
        this._context = undefined;
        this._utterance = undefined;
        this._preprocessed = undefined;
        this._entities = undefined;
        this._candidates = undefined;

        rl.on('line', async (line) => {
            if (this._state === 'done')
                return;

            line = line.trim();

            if (line.length === 0 || this._state === 'loading') {
                rl.prompt();
                return;
            }

            if (line === 'q') {
                this.quit();
                return;
            }

            if (line === 'h' || line === '?') {
                this._help();
                return;
            }

            if (line === 'd') {
                this.nextDialog();
                return;
            }

            if (this._state === 'input') {
                this._utterance = line;
                this._handleInput().catch((e) => this.emit('error', e));
                return;
            }

            if (this._state === 'code') {
                this._learnThingTalk(line).catch((e) => this.emit('error', e));
                return;
            }

            if (Number.isFinite(parseInt(line))) {
                this._learnNumber(parseInt(line));
            } else if (line === 'n') {
                this._more();
            } else if (line.startsWith('e ')) {
                this._edit(parseInt(line.substring(2).trim()));
            } else if (line.startsWith('t ')) {
                this._learnThingTalk(line.substring(2)).catch((e) => this.emit('error', e));
            } else if (line === 't') {
                this._state = 'code';
                rl.setPrompt('TT: ');
                rl.prompt();
            } else {
                console.log('Invalid command');
                rl.prompt();
            }
        });
    }

    _read() {}

    quit() {
        if (this._currentDialog.length > 0)
            this.push(this._currentDialog);
        this._state = 'done';
        this.push(null);
    }

    _help() {
        console.log('Available commands:');
        console.log('q: quit');
        console.log('d: (done/drop) complete the current dialog and start the next one');
        console.log('<0-9>: make a choice');
        console.log('n: (next) show more choices');
        console.log('e <0-9>: edit a choice');
        console.log('t: (thingtalk) write code directly');
        console.log('? or h: this help');
    }

    async start() {
        await this._parser.start();
        this.nextDialog();
    }
    async stop() {
        await this._parser.stop();
    }

    async _learnThingTalk(code) {
        let program;
        try {
            program = await ThingTalk.Grammar.parseAndTypecheck(code, this._schemas);

            const clone = {};
            Object.assign(clone, this._entities);
            ThingTalk.NNSyntax.toNN(program, this._preprocessed, clone);
        } catch(e) {
            console.log(`${e.name}: ${e.message}`);
            this._rl.setPrompt('TT: ');
            this._rl.prompt();
            return;
        }

        if (!this._applyReplyToContext(program)) {
            this._rl.setPrompt('TT: ');
            this._rl.prompt();
            return;
        }

        this._currentDialog.push(
            this._preprocessed,
            program.prettyprint()
        );
        this._computeAssistantAction();
        this.nextTurn();
    }

    _edit(i) {
        if (Number.isNaN(i) || i < 1 || i > this._candidates.length) {
            console.log('Invalid number');
            this._rl.setPrompt('$ ');
            this._rl.prompt();
            return;
        }
        i -= 1;
        const program = this._candidates[i];
        this._state = 'code';
        this._rl.setPrompt('TT: ');
        this._rl.write(program.prettyprint(true));
        this._rl.prompt();
    }

    _learnNumber(i) {
        if (i < 1 || i > this._candidates.length) {
            console.log('Invalid number');
            this._rl.setPrompt('$ ');
            this._rl.prompt();
            return;
        }
        i -= 1;

        const program = this._candidates[i];
        if (!this._applyReplyToContext(program)) {
            this._rl.setPrompt('$ ');
            this._rl.prompt();
            return;
        }

        this._currentDialog.push(
            this._preprocessed,
            program.prettyprint()
        );
        this._computeAssistantAction();
        this.nextTurn();
    }

    _more() {
        if (this._state === 'top3') {
            this._state = 'full';
            console.log(`Sentence #${this._serial+1} (${this._id}): ${this._utterance}`);
            for (let i = 0; i < this._candidates.length; i++)
                console.log(`${i+1}) ${this._candidates[i].code.join(' ')}`);
            this._rl.setPrompt('$ ');
            this._rl.prompt();
        } else {
            this._state = 'code';
            this._rl.setPrompt('TT: ');
            this._rl.prompt();
        }
    }

    _computeAssistantAction() {
        for (let [schema, slot] of this._context.iterateSlots()) {
            if (slot instanceof Ast.Selector)
                continue;
            if (slot.value.isUndefined) {
                this._currentDialog.push(`# assistant asks for ${slot.name}`);
                console.log(`A: asks for ${slot.name}`);

                let argname = slot.name;
                let type = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];
                if (slot instanceof Ast.BooleanExpression && slot.operator === 'contains')
                    type = type.elem;
                this._dialogState = type.isString ? 'raw' : 'slot-fill';
                return;
            }
        }

        if (this._context.isProgram && this._context.rules.every((r) => !r.stream && r.actions.every((a) => a.isInvocation && a.invocation.selector.isBuiltin))) {
            this._currentDialog.push(`# assistant shows result`);
            console.log(`A: shows result`);
            this._dialogState = 'result';
            return;
        }

        if (this._dialogState === 'confirm') {
            this._currentDialog.push(`# assistant executes`);
            console.log(`A: consider it done`);
            this._dialogState = 'initial';
            return;
        }

        this._currentDialog.push(`# assistant confirms`);
        console.log(`A: confirms`);
        this._dialogState = 'confirm';
    }

    _applyReplyToContext(newCommand) {
        if (newCommand.isProgram || newCommand.isPermissionRule) {
            this._context = newCommand;
            this._dialogState = 'initial';
            return true;
        }

        if (newCommand.isBookkeeping && this._context !== null) {
            if (this._dialogState === 'slot-fill') {
                // while slot filling, treat yes/no as true/false
                if (newCommand.intent.isSpecial &&
                    (newCommand.intent.type === 'yes' || newCommand.intent.type === 'no')) {
                    newCommand = new Ast.Input.Bookkeeping(null,
                        new Ast.BookkeepingIntent.Answer(null, new Ast.Value.Boolean(newCommand.intent.type === 'yes'))
                    );
                }
            }

            if (newCommand.intent.isAnswer) {
                if (this._dialogState !== 'slot-fill' && this._dialogState !== 'raw') {
                    console.log(`Unexpected answer`);
                    return false;
                }

                for (let [schema, slot] of this._context.iterateSlots()) {
                    if (slot instanceof Ast.Selector)
                        continue;
                    if (!slot.value.isUndefined)
                        continue;
                    let argname = slot.name;
                    let type = schema.inReq[argname] || schema.inOpt[argname] || schema.out[argname];
                    if (slot instanceof Ast.BooleanExpression && slot.operator === 'contains')
                        type = type.elem;

                    if (!ThingTalk.Type.isAssignable(newCommand.intent.value.getType(), type)) {
                        console.log(`Answer has the wrong type (expected ${type})`);
                        return false;
                    }
                    slot.value = newCommand.intent.value;
                    console.log(this._context.prettyprint());
                    return true;
                }

                throw new Error('??? slot-fill state without a slot?');
            }

            if (newCommand.intent.isSpecial) {
                if (newCommand.intent.type === 'nevermind' || newCommand.intent.type === 'stop') {
                    console.log(`Unexpected stop/nevermind, use "d" to terminate the current dialog`);
                    return false;
                }

                // in the confirm state, accept a single "yes" w/ no change in context
                if (this._dialogState === 'confirm' && newCommand.intent.type === 'yes')
                    return true;
            }
        }

        console.log(`Unexpected command ${newCommand.prettyprint()}`);
        return false;
    }

    nextDialog() {
        if (this._currentDialog.length > 0)
            this.push(this._currentDialog);

        if (this._serial > 0)
            console.log();
        console.log(`Dialog #${this._serial+1}`);
        this._serial++;

        this._currentDialog = [];
        this._context = null;
        this._dialogState = 'initial';
        this.nextTurn();
    }
    nextTurn() {
        this._state = 'input';
        this._utterance = undefined;
        console.log('Context: ' + (this._context ? this._context.prettyprint() : 'null'));
        this._rl.setPrompt('U: ');
        this._rl.prompt();
    }

    async _handleInput() {
        if (this._dialogState === 'raw') {
            const program = new Ast.Input.Bookkeeping(null,
                new Ast.BookkeepingIntent.Answer(null, new Ast.Value.String(this._utterance)));
            if (!this._applyReplyToContext(program)) {
                this._rl.setPrompt('$ ');
                this._rl.prompt();
                return;
            }

            this._currentDialog.push(
                this._preprocessed,
                program.prettyprint()
            );
            this._computeAssistantAction();
            this.nextTurn();
            return;
        }

        this._state = 'loading';

        let contextCode, contextEntities = {};
        if (this._context !== null)
            contextCode = ThingTalk.NNSyntax.toNN(this._context, '', contextEntities, { allocateEntities: true });
        else
            contextCode = ['null'];
        const parsed = await this._parser.sendUtterance(this._utterance, false, contextCode, contextEntities);

        this._state = 'top3';
        this._preprocessed = parsed.tokens.join(' ');
        this._entities = parsed.entities;
        this._candidates = (await Promise.all(parsed.candidates.map(async (cand) => {
            try {
                const program = ThingTalk.NNSyntax.fromNN(cand.code, parsed.entities);
                await program.typecheck(this._schemas);

                // convert the program to NN syntax once, which will force the program to be syntactically normalized
                // (and therefore rearrange slot-fill by name rather than Thingpedia order)
                ThingTalk.NNSyntax.toNN(program, '', {}, { allocateEntities: true });
                return program;
            } catch(e) {
                return null;
            }
        }))).filter((c) => c !== null);

        for (var i = 0; i < 3 && i < this._candidates.length; i++)
            console.log(`${i+1}) ${this._candidates[i].prettyprint()}`);
        this._rl.setPrompt('$ ');
        this._rl.prompt();
    }
}

module.exports = {
    initArgparse(subparsers) {
        const parser = subparsers.addParser('manual-annotate-dialog', {
            addHelp: true,
            description: `Interactive create a dialog dataset, by annotating each sentence turn-by-turn.`
        });
        parser.addArgument(['-o', '--output'], {
            required: true,
        });
        parser.addArgument(['-l', '--locale'], {
            required: false,
            defaultValue: 'en-US',
            help: `BGP 47 locale tag of the natural language being processed (defaults to en-US).`
        });
        parser.addArgument('--thingpedia', {
            required: true,
            help: 'Path to ThingTalk file containing class definitions.'
        });
        parser.addArgument('--server', {
            required: false,
            defaultValue: 'https://almond-nl.stanford.edu',
            help: `The URL of the natural language server. Use a file:// URL pointing to a model directory to evaluate using a local instance of decanlp.`
        });
    },

    async execute(args) {
        const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
        rl.setPrompt('$ ');

        const annotator = new Annotator(rl, args);
        rl.on('SIGINT', () => annotator.quit());
        await annotator.start();
        //process.stdin.on('end', quit);

        await StreamUtils.waitFinish(annotator
            .pipe(new DialogSerializer())
            .pipe(fs.createWriteStream(args.output, { flags: 'a' }))
        );

        console.log('Bye\n');
        rl.close();

        await annotator.stop();
    }
};
