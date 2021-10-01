// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Silei Xu <silei@cs.stanford.edu>
//         Giovanni Campagna <gcampagn@cs.stanford.edu>


import Stream from 'stream';

import { Ast, SchemaRetriever } from 'thingtalk';

import * as I18n from '../../i18n';
import * as Utils from '../../utils/misc-utils';
import { EntityMap } from '../../utils/entity-utils';
import * as ThingTalkUtils from '../../utils/thingtalk';

export interface MTurkParaphraseExample {
    id : string;
    synthetic_id : string;
    target_code : string;
    paraphrase : string;
    synthetic : string;
    context ?: string;

    preprocessed ?: string;
    target_preprocessed ?: string;
    context_preprocessed ?: string;
}

export interface Statistics {
    good : number;
    no_idea : number;
    values : number;
    quoting : number;
    manual : number;
}

class ParaphraseValidator {
    private _locale : string;
    private _timezone : string;
    private _schemas : SchemaRetriever;
    private _tokenizer : I18n.BaseTokenizer;
    private _noIdea : string[];
    private _counter : Statistics;
    id : string;
    target_code : string;
    paraphrase : string;
    synthetic : string;
    context : string|undefined;
    target_preprocessed : string[] = [];
    context_preprocessed : string[] = [];
    preprocessed : string[] = [];
    entities : EntityMap = {};
    ast : Ast.Input|undefined;

    private _debug : boolean;

    constructor(schemaRetriever : SchemaRetriever,
                langPack : I18n.LanguagePack,
                tokenizer : I18n.BaseTokenizer,
                locale : string,
                timezone : string,
                row : MTurkParaphraseExample,
                counter : Statistics,
                debug : boolean) {
        this._locale = locale;
        this._timezone = timezone;
        this._schemas = schemaRetriever;
        this._tokenizer = tokenizer;
        this._noIdea = langPack.NO_IDEA;
        this._counter = counter;
        this.id = row.id;
        this.target_code = row.target_code;
        this.paraphrase = row.paraphrase;
        this.synthetic = row.synthetic;
        this.context = row.context;
        this._debug = debug;
    }

    async clean() {
        this.ast = await ThingTalkUtils.parse(this.target_code, this._schemas);

        this.paraphrase = this.paraphrase.replace(/([.?])(["”])/g, '$2$1');
        const tokenized = this._tokenizer.tokenize(this.paraphrase);

        if (this.context && this.context !== 'null') {
            const context = await ThingTalkUtils.parse(this.context, this._schemas);
            const contextEntities = {};
            [this.context_preprocessed,] = ThingTalkUtils.serializeNormalized(context, contextEntities);
            Utils.renumberEntities(tokenized, contextEntities);
        } else {
            this.context_preprocessed = ['null'];
        }

        this.preprocessed = tokenized.tokens;
        this.entities = tokenized.entities;
    }

    isValid() : boolean {
        if (this.isNoIdea())
            return false;
        else if (!this.checkValues())
            return false;
        return true;
    }

    isNoIdea() : boolean {
        if (this.paraphrase.length < 5) {
            this._counter['no_idea'] += 1;
            return true;
        }
        for (const noidea of this._noIdea) {
            if (this.paraphrase === noidea || this.paraphrase.indexOf(noidea) > -1) {
                this._counter['no_idea'] += 1;
                return true;
            }
        }
        return false;
    }

    checkValues() : boolean {
        // try to conver to NN syntax
        // this will automatically trigger entity assignment in ThingTalk
        try {
            const target_code = ThingTalkUtils.serializePrediction(this.ast!, this.preprocessed, this.entities, {
                locale: this._locale,
                timezone: this._timezone,
            });
            this.target_preprocessed = target_code;

            let inString = false;
            let prevToken = null;
            for (const token of target_code) {
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

type ValidationCountMap = Map<string, {
    same_count : number,
    diff_count : number
}>;

interface ParaphraseValidatorFilterOptions {
    locale : string;
    timezone : string;
    debug : boolean;
    validationCounts ?: ValidationCountMap;
    validationThreshold ?: number;
}

class ParaphraseValidatorFilter extends Stream.Transform {
    private _schemas : SchemaRetriever;
    private _locale : string;
    private _timezone : string;
    private _langPack : I18n.LanguagePack;
    private _tokenizer : I18n.BaseTokenizer;
    private _counter : Statistics;
    private _debug : boolean;
    private _validationCounts : ValidationCountMap|undefined;
    private _validationThreshold : number;

    constructor(schemaRetriever : SchemaRetriever,
                options : ParaphraseValidatorFilterOptions) {
        super({
            readableObjectMode: true,
            writableObjectMode: true
        });

        this._schemas = schemaRetriever;

        this._locale = options.locale;
        this._timezone = options.timezone;
        this._langPack = I18n.get(options.locale);
        this._tokenizer = this._langPack.getTokenizer();
        this._counter = {
            'good': 0,
            'no_idea': 0,
            'values': 0,
            'quoting': 0,
            'manual': 0
        };

        this._debug = options.debug;

        this._validationCounts = options.validationCounts;
        this._validationThreshold = options.validationThreshold || 0;
    }

    private async _validate(row : MTurkParaphraseExample) : Promise<MTurkParaphraseExample|null> {
        const paraphrase = new ParaphraseValidator(this._schemas, this._langPack, this._tokenizer, this._locale,
            this._timezone, row, this._counter, this._debug);

        try {
            await paraphrase.clean();
            if (!paraphrase.isValid()) {
                //if (this._debug)
                //    console.log(`Rejected paraphrase ${row.id} (of ${row.synthetic_id}): ${row.paraphrase}`);
                return null;
            }

            if (this._validationCounts) {
                const count = this._validationCounts.get(String(row.id));

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

    _transform(row : MTurkParaphraseExample, encoding : BufferEncoding, callback : (err : Error|null, res ?: MTurkParaphraseExample|null) => void) {
        this._validate(row).then(
            (validated) => callback(null, validated),
            (err) => callback(err)
        );
    }

    _flush(callback : () => void) {
        if (this._debug) {
            console.log('Validation Statistics:');
            for (const key in this._counter)
                console.log(`  ${key} = ${this._counter[key as keyof Statistics]}`);
        }

        process.nextTick(callback);
    }
}

export {
    ParaphraseValidator,
    ParaphraseValidatorFilter
};
