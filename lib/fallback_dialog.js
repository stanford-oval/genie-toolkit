// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const Dialog = require('./dialog');
const ValueCategory = require('./semantic').ValueCategory;

function tokenize(string) {
    var tokens = string.split(/(\s+|[,\.\"\'])/g);
    return tokens.filter((t) => !(/^\s*$/).test(t)).map((t) => t.toLowerCase());
}

function scoreExample(example, keyTokens) {
    var exampleTokens = tokenize(example.utterance);
    example.tokens = exampleTokens;

    // score is 2 for finding the right device kind,
    // 1 for each matched word and 0.5 for each matched
    // argument name

    var score = keyTokens.has(example.kind) >= 0 ? 2 : 0;

    for (var t of exampleTokens) {
        if (t.startsWith('$')) {
            if (keyTokens.has(t.substr(1)))
                score += 0.5;
        } else {
            if (keyTokens.has(t))
                score += 1;
        }
    }

    example.score = score;
}

module.exports = class FallbackDialog extends Dialog {
    constructor(raw) {
        super();

        this.raw = raw;
        this.target_json === null;
    }

    start() {
        this.manager.thingpedia.getExamplesByKey(this.raw, true).then((examples) => {
            if (examples.length === 0)
                return this.fail();

            var keyTokens = new Set(tokenize(this.raw));
            for (var ex of examples) {
                scoreExample(ex, keyTokens);
            }

            // sort highest score first
            // in case of ties, sort shortest first
            examples.sort((a, b) => {
                if (b.score === a.score)
                    return a.tokens.length - b.tokens.length;
                else
                    return b.score - a.score;
            });

            var jsonChoices = new Set();
            var toAdd = [];

            for (var ex of examples) {
                if (toAdd.length >= 5)
                    break;

                if (jsonChoices.has(ex.target_json))
                    continue;
                jsonChoices.add(ex.target_json);

                var tokens = ex.tokens.map((t) => t.startsWith('$') ? '_____' : t);
                toAdd.push([tokens.join(' '), ex.target_json]);
            }

            if (toAdd.length === 1) {
                this.ask(ValueCategory.YesNo, "Sorry I did not understand that. Did you mean " + toAdd[0][0] + "?");
                this.target_json = toAdd[0][1];
            } else {
                this.failWithOptions();
                for (var i = 0; i < toAdd.length; i++)
                    this.replyButton((i+1) + ") " + toAdd[i][0], toAdd[i][1]);
                this.switchToDefault();
            }
        }).done();
        return true;
    }

    handle(command) {
        if (this.handleGeneric(command))
            return true;

        if (this.expecting === ValueCategory.YesNo &&
            this.target_json !== null) {
            if (command.isYes) {
                this.switchToDefault();
                // handle the command at the next event loop iteration
                // to avoid reentrancy
                setImmediate(() => {
                    this.manager.handleCommand(null, this.target_json);
                });
                return true;
            } else {
                this.reset();
            }
        }
    }
}
