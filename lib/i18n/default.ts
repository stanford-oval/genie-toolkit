// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

import assert from 'assert';
import interpolate from 'string-interp';
import * as fs from 'fs';
import * as path from 'path';
import Gettext from 'node-gettext';
import * as gettextParser from 'gettext-parser';
import * as Units from 'thingtalk-units';

import BaseTokenizer from './tokenizer/base';

import {
    EntityMap,
    AnyEntity,
    GenericEntity,
    MeasureEntity,
    TimeEntity,
    LocationEntity,
} from '../utils/entity-utils';

interface UnitPreferenceDelegate {
    timezone : string;

    getPreferredUnit(type : string) : string|undefined;
}

function capitalize(word : string) : string {
    return word[0].toUpperCase() + word.substring(1);
}

/**
 * Base class for all code that is specific to a certain natural language
 * in Genie.
 */
export default class DefaultLanguagePack {
    ARGUMENT_NAME_OVERRIDES ! : { [key : string] : string[] };
    IGNORABLE_TOKENS ! : { [key : string] : string[] };
    _NO_SPACE_TOKENS ! : Set<string>;
    NO_IDEA ! : string[];
    CHANGE_SUBJECT_TEMPLATES ! : string[];
    SINGLE_DEVICE_TEMPLATES ! : Array<[string, RegExp|null]>;
    DEFINITE_ARTICLE_REGEXP ! : RegExp|undefined;
    MUST_CAPITALIZE_TOKEN  ! : Set<string>;

    // FIXME
    ABBREVIATIONS ! : any;

    protected _tokenizer : BaseTokenizer|undefined;

    /**
     * The actual locale string to use, which can be a subvariant of
     * the language implementing this language pack.
     */
    readonly locale : string;

    private _gt : Gettext;
    gettext : (x : string) => string;
    private _ : (x : string) => string;
    // do not use ngettext, use ICU syntax `${foo:plural:one{}other{}}` instead

    constructor(locale : string) {
        this.locale = locale;

        this._gt = new Gettext();
        this._gt.setLocale(locale);
        this.gettext = this._gt.dgettext.bind(this._gt, 'genie-toolkit');
        this._ = this.gettext;

        if (!/^en(-|$)/.test(locale))
            this._loadTranslations();
    }

    private _loadTranslations() {
        // try the path relative to our build location first (in dist/lib/dialogue-agent)
        let modir = path.resolve(path.dirname(module.filename), '../../../po');
        if (!fs.existsSync(modir)) {
            // if that fails, try the path relative to our source location
            // (running with ts-node)
            modir = path.resolve(path.dirname(module.filename), '../../po');
            assert(fs.existsSync(modir));
        }

        const split = this.locale.split(/[-_.@]/);
        let mo = modir + '/' + split.join('_') + '.mo';

        while (!fs.existsSync(mo) && split.length) {
            split.pop();
            mo = modir + '/' + split.join('_') + '.mo';
        }
        if (split.length === 0) {
            console.error(`No translations found for locale ${this.locale}`);
            return;
        }
        try {
            const loaded = gettextParser.mo.parse(fs.readFileSync(mo), 'utf-8');
            this._gt.addTranslations(this.locale, 'genie-toolkit', loaded);
        } catch(e) {
            console.log(`Failed to load translations for ${this.locale}: ${e.message}`);
        }
    }

    /**
     * Return an instance of the tokenizer used by this language.
     */
    getTokenizer() : BaseTokenizer {
        if (this._tokenizer)
            return this._tokenizer;
        return this._tokenizer = new BaseTokenizer();
    }

    /**
     * Apply final touches to a newly generated synthetic sentence
     *
     * This function should correct coreferences, conjugations and other
     * grammar/readability issues that are too inconvenient to prevent
     * using the templates.
     */
    postprocessSynthetic(sentence : string, program : unknown, rng : (() => number)|null, forTarget : 'user'|'agent') : string {
        return sentence;
    }

    /**
     * Convert a tokenized sentence back into a correctly spaced, correctly
     * punctuated sentence.
     *
     * This is a low-level method called by {@link DefaultLanguagePack#detokenizeSentence}.
     * It can be used to detokenize one token at a time.
     */
    detokenize(sentence : string, prevtoken : string|null, token : string) : string {
        if (sentence && !this._NO_SPACE_TOKENS.has(token))
            sentence += ' ';
        sentence += token;
        return sentence;
    }

    /**
     * Convert a tokenized sentence back into a correctly spaced, correctly
     * punctuated sentence.
     *
     * This is used for sentences presented to an MTurk worker for paraphrasing,
     * and it is used for the agent replies before they are shown to the user.
     */
    detokenizeSentence(tokens : string[]) : string {
        let sentence = '';
        let prevToken = '';
        for (const token of tokens) {
            sentence = this.detokenize(sentence, prevToken, token);
            prevToken = token;
        }
        return sentence;
    }

    /**
     * Retrieve the list of units to use for a given base unit. This defaults
     * to metric units, but subclasses can override to choose a different
     * unit.
     *
     * The best unit for a given value (i.e., the one with the fewest digits)
     * will be chosen to display. If there are ties, the first unit will be chosen.
     */
    protected _getPossibleUnits(baseUnit : string) : string[] {
        switch (baseUnit) {
        case 'ms':
            return ['ms', 's', 'min', 'h', 'day', 'week', 'mon', 'year', 'decade', 'century'];
        case 'm':
            return ['mm', 'cm', 'm', 'km', 'ly'];
        case 'm2':
            return ['mm2', 'cm2', 'm2', 'km2'];
        case 'm3':
            // prefer liquid over solid units
            return ['ml', 'cl', 'hl', 'l', 'mm3', 'cm3', 'm3', 'km3'];
        case 'mps':
            return ['mps', 'kmph'];
        case 'kg':
            return ['mg', 'g', 'kg'];
        case 'Pa':
            return ['Pa', 'bar'];
        case 'C':
            return ['C', 'K'];
        case 'kcal':
            return ['kcal', 'kJ'];
        case 'byte':
            // avoid IEC units
            return ['byte', 'KB', 'MB', 'GB', 'TB'];
        case 'W':
            return ['W', 'kW'];
        default:
            return [baseUnit];
        }
    }

    private _getBestUnit(value : number, baseUnit : string) {
        // default to metric units

        const possibleUnits = this._getPossibleUnits(baseUnit).map((unit) => {
            const transformed = Units.transformFromBaseUnit(value, unit);
            // score how close the representation is to 1
            // add a penalty for 0.something
            const cost = Math.abs(Math.log10(transformed)) + (2 * +(Math.abs(transformed) < 1));
            return { unit, cost };
        });
        possibleUnits.sort((a, b) => {
            return a.cost - b.cost;
        });
        return possibleUnits[0].unit;
    }

    private _measureToString(value : number, unit : string, precision = 1) : string {
        const transformed = Units.transformFromBaseUnit(value, unit);
        // TODO use value.toLocaleString() with unit formatting
        //      it depends on https://github.com/tc39/proposal-unified-intl-numberformat
        //      which is part of ES2020 (so node 14 or later?)
        return this._numberToString(transformed, precision) + ' ' + unit;
    }

    private _numberToString(value : number, precision = 1) : string {
        return value.toLocaleString(this.locale, {
            minimumFractionDigits: 0,
            maximumFractionDigits: precision
        });
    }

    private _dateToString(date : Date, timezone : string, options ?: Intl.DateTimeFormatOptions) : string {
        if (!options) {
            options = {
                weekday: undefined,
                day: 'numeric',
                month: 'long',
                year: 'numeric',
            };
        }
        options.timeZone = timezone;

        return date.toLocaleDateString(this.locale, options);
    }

    /**
     * Convert a date object to a user-visible string, displaying _only_ the time part.
     *
     * This is a small wrapper over {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Date/toLocaleString|Date.toLocaleString}
     * that applies the correct timezone.
     *
     * @param {Date} date - the time to display
     * @param {Object} [options] - additional options to pass to `toLocaleString`
     * @return {string} the formatted time
     */
    private _timeToString(date : Date, timezone : string, options ?: Intl.DateTimeFormatOptions) : string {
        if (!options) {
            options = {
                hour: 'numeric',
                minute: '2-digit',
                timeZoneName: undefined,
            };
            if (date.getSeconds() !== 0)
                options.second = '2-digit';
        }
        options.timeZone = timezone;
        return date.toLocaleTimeString(this.locale, options);
    }

    private _dateAndTimeToString(date : Date, timezone : string, options : Intl.DateTimeFormatOptions = {}) : string {
        options.timeZone = timezone;
        return date.toLocaleString(this.locale, options);
    }

    getDefaultTemperatureUnit() : string {
        return 'C';
    }

    protected displayEntity(token : string,
                            entityValue : AnyEntity,
                            delegate : UnitPreferenceDelegate) : string {
        if (token.startsWith('GENERIC_ENTITY_')) {
            const entity = entityValue as GenericEntity;
            return (entity.display || entity.value!);
        }

        if (token.startsWith('QUOTED_STRING_'))
            return String(entityValue).replace(/[ \t\v\r\n]+/g, ' ').trim();
        if (token.startsWith('USERNAME_'))
            return '@' + entityValue;
        if (token.startsWith('HASHTAG_'))
            return '#' + entityValue;

        if (token.startsWith('MEASURE_')) {
            const [,baseUnit] = /^MEASURE_([A-Za-z0-9_]+)_[0-9]+$/.exec(token)!;
            const entity = entityValue as MeasureEntity;
            let fromUnit = entity.unit;
            if (fromUnit.startsWith('default')) {
                switch (fromUnit) {
                case 'defaultTemperature':
                    fromUnit = delegate.getPreferredUnit('temperature') || this.getDefaultTemperatureUnit();
                    break;
                default:
                    throw new TypeError('Unexpected default unit ' + fromUnit);
                }
            }
            const value = Units.transformToBaseUnit(entity.value, fromUnit);

            let toUnit;
            if (baseUnit === 'C') {
                const maybeUnit = delegate.getPreferredUnit('temperature');
                toUnit = maybeUnit || this.getDefaultTemperatureUnit();
            } else {
                toUnit = this._getBestUnit(value, baseUnit);
            }
            return this._measureToString(value, toUnit);
        }
        if (token.startsWith('NUMBER_'))
            return this._numberToString(entityValue as number);
        if (token.startsWith('CURRENCY_')) {
            const entity = entityValue as MeasureEntity;
            const options = {
                style: 'currency',
                currency: entity.unit.toUpperCase()
            };
            return entity.value.toLocaleString(this.locale, options);
        }

        if (token.startsWith('TIME_')) {
            const entity = entityValue as TimeEntity;
            const time = new Date;
            time.setHours(entity.hour);
            time.setMinutes(entity.minute);
            time.setSeconds(entity.second);
            time.setMilliseconds(0);
            return this._timeToString(time, delegate.timezone);
        }

        if (token.startsWith('DATE_')) {
            const date = entityValue as Date;
            // check for midnight local, and midnight UTC, to mean date without time
            if ((date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) ||
                (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0))
                return this._dateToString(date, delegate.timezone);
            else
                return this._dateAndTimeToString(date, delegate.timezone);
        }

        if (token.startsWith('LOCATION_')) {
            const loc = entityValue as LocationEntity;
            if (loc.display) {
                return loc.display;
            } else {
                return interpolate(this._("[Latitude: ${loc.latitude:.3} deg, Longitude: ${loc.longitude:.3} deg]"), { loc },
                    { locale: this.locale, timezone: delegate.timezone })||'';
            }
        }

        return String(entityValue);
    }

    /**
     * Post-process a sentence generated by the neural NLG for display to
     * the user.
     *
     * This includes true-casing, detokenizing, and replacing entity tokens
     * with actual values.
     */
    postprocessNLG(answer : string, entities : EntityMap, delegate : UnitPreferenceDelegate) : string {
        // small hack, fix untokenized commas generated by describe (which uses I18n.ListFormat)
        answer = answer.replace(/([^ ]),/g, '$1 ,');

        const tokens = answer.split(' ').map((token) => {
            if (token in entities)
                return this.displayEntity(token, entities[token], delegate);

            // capitalize certain tokens that should be capitalized in English
            if (this.MUST_CAPITALIZE_TOKEN.has(token))
                return capitalize(token);
            return token;
        });
        answer = this.detokenizeSentence(tokens);

        // simple true-casing: uppercase all letters at the beginning of the sentence
        // and after a period, question or exclamation mark
        answer = answer.replace(/(^|[.?!] )([a-z])/g, (_, prefix, letter) => prefix + letter.toUpperCase());

        // remove duplicate spaces
        answer = answer.replace(/\s+/g, ' ');

        // sometimes, we end up with two periods at the end of a sentence, because
        // a #[result] phrase includes a period, or because a value includes a period
        // (this happens with jokes)
        // clean that up
        answer = answer.replace(/\.\.$/, '.');

        return answer;
    }

    /**
     * Convert a word or phrase to plural form.
     *
     * This function should return `undefined` if there is no plural form
     * of the given phrase.
     */
    pluralize(phrase : string) : string|undefined {
        // no plural form
        return undefined;
    }

    /**
     * Convert a word or verb phrase to past tense.
     *
     * This function should return `undefined` if there is no past tense
     * of the given phrase.
     */
    toVerbPast(phrase : string) : string|undefined {
        // no past
        return undefined;
    }

    /**
     * Convert a phrase from the side of the user to the side of the agent.
     *
     * This function takes a phrase that talks about "my devices" (uttered by
     * the user) and converts to a phrase that talks about "your devices"
     * uttered by the agent.
     */
    toAgentSideUtterance(phrase : string) : string {
        // by default, no change
        return phrase;
    }

    /**
     * Filter out words that cannot be in the dataset, because they would be
     * either tokenized/preprocessed out or they are unlikely to be used with
     * voice.
     */
    isGoodWord(word : string) : boolean {
        // all words are good words
        return true;
    }

    /**
     * Filter out phrases that should not be used as a parameter on their own.
     *
     * This is mainly used to remove phrases that would be syntatically
     * ambiguous, and would not be immediately recognized as a parameter.
     * A good rule of thumb is to filter out all phrases that consist entirely
     * of stop words.
     */
    isGoodSentence(sentence : string) : boolean {
        // all sentences are good words
        return true;
    }

    /**
     * Check if a numeric phrase is valid for the given language.
     *
     * This covers ASCII digits as well as language-specific number systems,
     * like Arabic digits.
     */
    isGoodNumber(number : string) : boolean {
        return /^([0-9|\u0660-\u0669]+)$/.test(number);
    }

    /**
     * Check if a phrase looks like a person name.
     *
     * This is a coarse check that is used to override
     * {@link DefaultLanguagePack#isGoodWord} to account for foreign person
     * names and loan words.
     */
     isGoodPersonName(word : string) : boolean {
        return this.isGoodWord(word) || /^(\w+\s\w\s?\.)$/.test(word);
    }

    /**
     * Add a definite article ("the") to the given phrase.
     *
     * If the language has no concept of definite articles, this function
     * must return `undefined`.
     */
    addDefiniteArticle(phrase : string) : string|undefined {
        return undefined;
    }
}

/**
 * Override the canonical form of argument names for synthetic generation
 * (to generate filters and projections)
 *
 * More than one form can be provided for each argument name, in which case
 * all are used.
 */
DefaultLanguagePack.prototype.ARGUMENT_NAME_OVERRIDES = {
};

/**
 * Tokens that can be ignored in the names of entities, by entity type.
 *
 * This should cover abbreviations, prefixes and suffixes that are usually
 * omitted in colloquial speech.
 */
DefaultLanguagePack.prototype.IGNORABLE_TOKENS = {
    'sportradar': ['fc', 'ac', 'us', 'if', 'as', 'rc', 'rb', 'il', 'fk', 'cd', 'cf'],
    'tt:stock_id': ['l.p.', 's.a.', 'plc', 'n.v', 's.a.b', 'c.v.'],
    'org:freedesktop:app_id': ['gnome']
};

/**
 * Interchangeable abbreviations for entity names
 *
 * Each entry in this array is a set (in array form) of abbreviations with the same
 * meaning; while expanding parameters, one of the possible forms is chosen at random
 *
 * Use this to fix tokenization inconsistencies in the entity database, to add
 * colloquial forms, and to add robustness to punctuation.
 */
DefaultLanguagePack.prototype.ABBREVIATIONS = {};

/**
 * Tokens that should not be preceded by a space.
 * This is used by the default {@link DefaultLanguagePack#detokenize}
 * implementation.
 */
DefaultLanguagePack.prototype._NO_SPACE_TOKENS = new Set(['.', ',', '?', '!', ':']);

/**
 * All the different forms in which MTurk workers write "no idea" for a sentence
 * they don't understand.
 *
 * This is usually empirically collected by looking at the results and finding
 * sentences that don't validate or are too short.
 */
DefaultLanguagePack.prototype.NO_IDEA = [];

DefaultLanguagePack.prototype.CHANGE_SUBJECT_TEMPLATES = [];

/**
 * Different ways to add an explicit reference to a skill name for a command.
 */
DefaultLanguagePack.prototype.SINGLE_DEVICE_TEMPLATES = [];

/**
 * A regular expression used to identify a definite article ("the") at the
 * beginning of a (tokenized) phrase.
 *
 * A language without definite articles should leave this to `undefined`.
 */
DefaultLanguagePack.prototype.DEFINITE_ARTICLE_REGEXP = undefined;

/**
 * A set of tokens that must always be capitalized.
 */
DefaultLanguagePack.prototype.MUST_CAPITALIZE_TOKEN = new Set([
    'spotify', 'twitter', 'yelp', 'google', 'facebook',
]);
