// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018-2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//         Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Stream = require('stream');

const ThingTalk = require('thingtalk');
const Grammar = ThingTalk.Grammar;
const NNSyntax = ThingTalk.NNSyntax;

const i18n = require('./i18n');
const Utils = require('./utils');

class ParaphraseValidator {
    constructor(schemaRetriever, tokenizer, locale, row, counter = {}, debug) {
        this._schemas = schemaRetriever;
        this._tokenizer = tokenizer;
        this._locale = locale;

        this._noIdea = i18n.get(locale).NO_IDEA;
        this._counter = counter;
        this.id = row.id;
        this.target_code = row.target_code;
        this.paraphrase = row.paraphrase;
        this.synthetic = row.synthetic;
        this.context = row.context;
        this._debug = debug;
    }

    async clean() {
        this.ast = await Grammar.parseAndTypecheck(this.target_code, this._schemas);

        this.paraphrase = this.paraphrase.replace(/([.?])(["”])/g, '$2$1');
        const tokenized = await this._tokenizer.tokenize(this._locale, this.paraphrase);

        if (this.context && this.context !== 'null') {
            const context = await Grammar.parseAndTypecheck(this.context, this._schemas);
            const contextEntities = {};
            this.context_preprocessed = NNSyntax.toNN(context, '', contextEntities, { allocateEntities: true });
            Utils.renumberEntities(tokenized, contextEntities);
        } else {
            this.context_preprocessed = 'null';
        }

        this.preprocessed = tokenized.tokens;
        this.entities = tokenized.entities;
    }

    isValid() {
        if (this.isNoIdea())
            return false;
        else if (!this.checkValues())
            return false;
        return true;
    }

    isNoIdea() {
        if (this.paraphrase.length < 5) {
            this._counter['no_idea'] += 1;
            return true;
        }
        for (let noidea of this._noIdea) {
            if (this.paraphrase === noidea || this.paraphrase.indexOf(noidea) > -1) {
                this._counter['no_idea'] += 1;
                return true;
            }
        }
        return false;
    }

    checkValues() {
        // try to conver to NN syntax
        // this will automatically trigger entity assignment in ThingTalk
        try {
            const clone = {};
            Object.assign(clone, this.entities);
            let target_code = NNSyntax.toNN(this.ast, this.preprocessed, clone);
            this.target_preprocessed = target_code;

            let inString = false;
            let prevToken = null;
            for (let token of target_code) {
                if (token === '"') {
                    inString = !inString;
                    prevToken = token;
                    continue;
                }
                if (inString)
                    continue;
                if (prevToken === '"') {
                    // we just closed a literal string in the thingtalk code
                    // if the string was of String, Entity(tt:hashtag) or Entity(tt:username) type,
                    // we reject the program, as those should be QUOTED_STRING/HASHTAG/USERNAME entities
                    // instead, so we can replace them later
                    if (!token.startsWith('^^') || token === '^^tt:hashtag' || token === '^^tt:username') {
                        this._counter['quoting'] ++;
                        return false;
                    }
                }
                prevToken = token;
            }
            if (prevToken === '"') {
                // the last token was a '"', closing a literal string (unquoted string)
                // reject the program with bad quoting
                this._counter['quoting'] ++;
                return false;
            }

            return true;
        } catch(e) {
            if (this._debug)
                console.log(String(this.id), e.message, '|||', this.paraphrase);

            // HACK should be an error subclass in ThingTalk
            if (!e.message.startsWith('Cannot find entity'))
                throw e;
            this._counter['values'] ++;
            return false;
        }
    }
}

class ParaphraseValidatorFilter extends Stream.Transform {
    constructor(schemaRetriever, tokenizer, options) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._schemas = schemaRetriever;
        this._tokenizer = tokenizer;

        this._locale = options.locale;
        this._counter = {
            'good': 0,
            'no_idea': 0,
            'values': 0,
            'quoting': 0,
            'manual': 0
        };

        this._debug = options.debug;

        this._validationCounts = options.validationCounts;
        this._validationThreshold = options.validationThreshold;
    }

    async _validate(row) {
        const paraphrase = new ParaphraseValidator(this._schemas, this._tokenizer, this._locale,
            row, this._counter, this._debug);

        try {
            await paraphrase.clean();
            if (!paraphrase.isValid()) {
                //if (this._debug)
                //    console.log(`Rejected paraphrase ${row.id} (of ${row.synthetic_id}): ${row.paraphrase}`);
                return null;
            }

            if (this._validationCounts) {
                let count = this._validationCounts.get(String(row.id));

                // `count` could be undefined if this paraphrase was not voted on at all
                // (either it was excluded from the mturk validation task because its
                // corresponding synthetic had not enough paraphrases, or all validators
                // working on this paraphrase were rejected
                if (!count || !(count.same_count >= this._validationThreshold)) {
                    this._counter['manual'] ++;
                    return null;
                }
            }

            row.preprocessed = paraphrase.preprocessed.join(' ');
            row.target_preprocessed = paraphrase.target_preprocessed.join(' ');
            if (row.context)
                row.context_preprocessed = paraphrase.context_preprocessed.join(' ');

            this._counter['good'] ++;
            return row;
        } catch(e) {
            console.error(`Failed paraphrase ${row.id} (${row.synthetic_id}): ${e.message}`);
            return null;
        }
    }

    _transform(row, encoding, callback) {
        this._validate(row).then(
            (validated) => callback(null, validated),
            (err) => callback(err)
        );
    }

    _flush(callback) {
        if (this._debug) {
            console.log('Validation Statistics:');
            for (let key in this._counter)
                console.log(`  ${key} = ${this._counter[key]}`);
        }

        process.nextTick(callback);
    }
}

module.exports = {
    ParaphraseValidator,
    ParaphraseValidatorFilter
};
