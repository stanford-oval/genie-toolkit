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
import * as fs from 'fs';
import * as path from 'path';
import Gettext from 'node-gettext';
import * as gettextParser from 'gettext-parser';
import * as Units from 'thingtalk-units';

import BaseTokenizer from './tokenizer/base';

import {
    Phrase,
    Concatenation,
    Replaceable
} from '../utils/template-string';
import {
    EntityMap,
    AnyEntity,
    GenericEntity,
    MeasureEntity,
    TimeEntity,
    LocationEntity,
} from '../utils/entity-utils';

export interface UnitPreferenceDelegate {
    timezone : string;

    getPreferredUnit(type : string) : string|undefined;
}

function capitalize(word : string) : string {
    return word[0].toUpperCase() + word.substring(1);
}

export interface NormalizedParameterCanonical {
    default : string;
    projection_pronoun ?: string[];

    base : Phrase[];
    base_projection : Phrase[];
    argmin : Phrase[];
    argmax : Phrase[];
    filter : Concatenation[];
    enum_filter : Record<string, Phrase[]>;
    projection : Phrase[];
}

const POS_RENAME : Record<string, string> = {
    'npp': 'property',
    'npi': 'reverse_property',
    'avp': 'verb',
    'pvp': 'passive_verb',
    'apv': 'adjective',
};

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
    _ : (x : string) => string;
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

    private _toTemplatePhrase(canonical : unknown, isFilter : true) : Concatenation;
    private _toTemplatePhrase(canonical : unknown, isFilter ?: false) : Phrase;
    private _toTemplatePhrase(canonical : unknown, isFilter : boolean) : Phrase|Concatenation;
    private _toTemplatePhrase(canonical : unknown, isFilter = false) : Replaceable {
        let tmpl = String(canonical);
        if (isFilter) {
            tmpl = tmpl.replace('#', '${value}');
            if (!/\$(\{value\}|value)/.test(tmpl))
                tmpl += ' ${value}';
        } else if (tmpl.includes('|')) {
            // backward compatibility with old projection phrases that use |
            tmpl = tmpl.replace('|', '//');
        }
        const parsed = Replaceable.parse(tmpl).preprocess(this, isFilter ? ['value'] : []);
        if (isFilter) {
            if (parsed instanceof Concatenation)
                return parsed;
            // this can happen if the original template was empty
            return new Concatenation([parsed], {}, {});
        } else {
            assert(parsed instanceof Phrase);
        }
        return parsed;
    }

    /**
     * Apply load-time transformations to the canonical annotation of a function. This normalizes
     * the form to the expected sets of POS, and adds any automatically generated
     * plural/gender/case forms as necessary.
     */
    preprocessFunctionCanonical(canonical : unknown, forItem : 'query'|'action'|'stream', forSide : 'user'|'agent', isList : boolean) : Phrase[] {
        if (canonical === undefined || canonical === null)
            return [];
        if (Array.isArray(canonical))
            return canonical.map((c) => this._toTemplatePhrase(forSide === 'agent' ? this.toAgentSideUtterance(String(c)) : c));
        else
            return [this._toTemplatePhrase(forSide === 'agent' ? this.toAgentSideUtterance(String(canonical)) : canonical)];
    }

    /**
     * Apply load-time transformations to the canonical annotation of a parameter. This normalizes
     * the form to the expected sets of POS, and adds any automatically generated
     * plural/gender/case forms as necessary.
     */
    preprocessParameterCanonical(canonical : unknown) : NormalizedParameterCanonical {
        // NOTE: we don't make singular/plural forms of parameters, even in English,
        // because things like "with Chinese and Italian foods" are awkward
        // and "with Chinese and Italian food" is better
        // but "with #cat and #dog hashtag" is wrong, and "with #cat and #dog hashtags" is
        // the correct form
        //
        // the template will choose any available form that does not have a "plural"
        // flag, so it will generate "food" for the servesCuisine case when used
        // in the template "with ${values} ${npp_filter[plural=other]}"
        //
        // for the cases where it makes sense to have singular/plural form,
        // the developer should add the phrases and flags manually
        // (or AutoQA should generate the canonical form with appropriate flags)

        const normalized : NormalizedParameterCanonical = {
            default: 'base',
            base: [],
            base_projection: [],
            argmin: [],
            argmax: [],
            filter: [],
            enum_filter: {},
            projection: [],
        };
        if (canonical === undefined || canonical === null)
            return normalized;
        if (typeof canonical === 'string') {
            normalized.base = [this._toTemplatePhrase(canonical)];
            normalized.filter = [this._toTemplatePhrase(canonical, true)];
            for (const phrase of normalized.filter) {
                if (!phrase.flags.pos)
                    phrase.flags.pos = 'property';
            }
            return normalized;
        }
        if (Array.isArray(canonical)) {
            normalized.base = canonical.map((c) => this._toTemplatePhrase(c));
            normalized.filter = canonical.map((c) => this._toTemplatePhrase(c, true));
            for (const phrase of normalized.filter) {
                if (!phrase.flags.pos)
                    phrase.flags.pos = 'property';
            }
            return normalized;
        }

        const record = canonical as Record<string, unknown>;
        for (let key in record) {
            let value = record[key];
            if (value === null || value === undefined)
                continue;
            if (key === 'default') {
                normalized[key] = String(value);
                continue;
            }
            if (key === 'projection_pronoun') {
                if (Array.isArray(value))
                    normalized[key] = value as string[];
                else
                    normalized[key] = [String(value)];
                continue;
            }

            if ((key === 'npv' || key === 'implicit_identity') && value) {
                // convert implicit_identity to reverse_property
                key = 'reverse_property';
                value = '#';
            }
            if ((key === 'apv' || key === 'adjective') && typeof value === 'boolean') {
                if (!value)
                    continue;
                key = 'adjective';
                value = '#';
            }

            if (key.endsWith('_true') || key.endsWith('_false')) {
                let boolean, pos;
                if (key.endsWith('_true')) {
                    boolean = 'true';
                    pos = key.substring(0, key.length - '_true'.length);
                } else {
                    boolean = 'false';
                    pos = key.substring(0, key.length - '_false'.length);
                }
                let phrases;
                if (Array.isArray(value))
                    phrases = value.map((c) => this._toTemplatePhrase(c));
                else
                    phrases = [this._toTemplatePhrase(value)];

                pos = POS_RENAME[pos]||pos;
                for (const phrase of phrases)
                    phrase.flags.pos = pos;

                if (normalized.enum_filter[boolean])
                    normalized.enum_filter[boolean].push(...phrases);
                else
                    normalized.enum_filter[boolean] = phrases;
            } else if (key === 'enum_filter' || key.endsWith('_enum')) {
                // new-style canonical for enums
                for (const enumerand in value as Record<string, unknown>) {
                    const enumCanonical = (value as Record<string, unknown>)[enumerand];
                    if (enumCanonical === null || enumCanonical === undefined)
                        continue;
                    let enumNormalized;
                    if (Array.isArray(enumCanonical))
                        enumNormalized = enumCanonical.map((c) => this._toTemplatePhrase(c));
                    else
                        enumNormalized = [this._toTemplatePhrase(enumCanonical)];

                    if (key !== 'enumerands') {
                        let pos = key.substring(0, key.length - '_enum'.length);
                        pos = POS_RENAME[pos]||pos;
                        for (const phrase of enumNormalized)
                            phrase.flags.pos = pos;
                    }
                    for (const phrase of enumNormalized) {
                        // add the default POS, but only if we don't have a POS already
                        if (!phrase.flags.pos)
                            phrase.flags.pos = 'base';
                    }

                    if (normalized.enum_filter[enumerand])
                        normalized.enum_filter[enumerand].push(...enumNormalized);
                    else
                        normalized.enum_filter[enumerand] = enumNormalized;
                }
            } else {
                let into : 'base' | 'base_projection' | 'filter' | 'projection' | 'argmin' | 'argmax';
                let pos : string|undefined;
                let isFilter = false;
                if (key === 'base' || key === 'base_projection') {
                    into = key;
                    pos = 'base';
                } else if (key.endsWith('_projection')) {
                    into = 'projection';
                    pos = key.substring(0, key.length - '_projection'.length);
                } else if (key.endsWith('_argmin')) {
                    into = 'argmin';
                    pos = key.substring(0, key.length - '_argmin'.length);
                } else if (key.endsWith('_argmax')) {
                    into = 'argmax';
                    pos = key.substring(0, key.length - '_argmax'.length);
                } else if (key === 'filter' || key === 'projection'
                            || key === 'argmin' || key === 'argmax') {
                    into = key;
                    pos = undefined;
                    isFilter = key === 'filter';
                } else {
                    into = 'filter';
                    pos = key;
                    isFilter = true;
                }

                let phrases;
                if (Array.isArray(value))
                    phrases = value.map((c) => this._toTemplatePhrase(c, isFilter));
                else
                    phrases = [this._toTemplatePhrase(value, isFilter)];

                if (pos !== undefined) {
                    pos = POS_RENAME[pos]||pos;
                    for (const phrase of phrases)
                        phrase.flags.pos = pos;
                }
                // HACK: this is not the right type signature, but it works in practice
                // due to the logic around isFilter
                normalized[into].push(...(phrases as Array<Concatenation & Phrase>));
            }
        }

        return normalized;
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

    /**
     * Convert a date object to a user-visible string, displaying only the date part.
     *
     * @param {Date} date - the time to display
     * @return {string} the formatted time
     */
    private _dateToString(date : Date, format : string, timezone : string) : string {
        const now = new Date;
        if (format !== 'absolute') {
            if (date.getDate() === now.getDate() &&
                date.getMonth() === now.getMonth() &&
                date.getFullYear() === now.getFullYear())
                return this._("today");

            const yesterday = new Date(now.getTime() - 86400 * 1000);
            if (date.getDate() === yesterday.getDate() &&
                date.getMonth() === yesterday.getMonth() &&
                date.getFullYear() === yesterday.getFullYear())
                return this._("yesterday");

            const tomorrow = new Date(now.getTime() + 86400 * 1000);
            if (date.getDate() === tomorrow.getDate() &&
                date.getMonth() === tomorrow.getMonth() &&
                date.getFullYear() === tomorrow.getFullYear())
                return this._("tomorrow");

            // same week
            if (Math.abs(date.getTime() - now.getTime()) <= 7 * 86400 * 1000) {
                const weekday = date.toLocaleString(this.locale, { weekday: 'long' });
                return (date.getTime() < now.getTime() ? this._("last ${weekday}") : this._("next ${weekday}")).replace('${weekday}',  weekday);
            }
        }

        // generic date
        const options : Intl.DateTimeFormatOptions = {
            weekday: undefined,
            day: 'numeric',
            month: 'long',
            year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
            timeZone: timezone
        };
        return date.toLocaleDateString(this.locale, options);
    }

    /**
     * Convert a date object to a user-visible string, displaying _only_ the time part.
     *
     * @param {Date} date - the time to display
     * @return {string} the formatted time
     */
    private _timeToString(date : Date, format : string, timezone : string) : string {
        const options : Intl.DateTimeFormatOptions = {
            hour: 'numeric',
            minute: '2-digit',
            second: undefined,
            timeZoneName: undefined,
            timeZone: timezone
        };
        return date.toLocaleTimeString(this.locale, options);
    }

    /**
     * Convert a date object to a user-visible string, displaying both the date and the time part.
     *
     * @param {Date} date - the time to display
     * @return {string} the formatted time
     */
    private _dateAndTimeToString(date : Date, format : string, timezone : string) : string {
        return this._("${date} at ${time}")
            .replace('${date}', this._dateToString(date, format, timezone))
            .replace('${time}', this._timeToString(date, format, timezone));
    }

    getDefaultTemperatureUnit() : string {
        return 'C';
    }

    protected displayEntity(token : string,
                            entityValue : AnyEntity,
                            delegate : UnitPreferenceDelegate,
                            format = '') : string {
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
            return this._timeToString(time, format, delegate.timezone);
        }

        if (token.startsWith('DATE_')) {
            const date = entityValue as Date;
            // check for midnight local, and midnight UTC, to mean date without time
            if ((date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0) ||
                (date.getUTCHours() === 0 && date.getUTCMinutes() === 0 && date.getUTCSeconds() === 0))
                return this._dateToString(date, format, delegate.timezone);
            else
                return this._dateAndTimeToString(date, format, delegate.timezone);
        }

        if (token.startsWith('LOCATION_')) {
            const loc = entityValue as LocationEntity;
            if (loc.display) {
                return loc.display;
            } else {
                return this._("[Latitude: ${latitude} deg, Longitude: ${longitude} deg]")
                    .replace('${latitude}', loc.latitude.toFixed(3))
                    .replace('${longitude}', loc.longitude.toFixed(3));
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

        const tokens = answer.split(' ');
        const lexicalized = [];
        for (let i = 0; i < tokens.length; i++) {
            const token = tokens[i];
            const nextToken = tokens[i+1];
            if (token in entities) {
                if (nextToken.startsWith('-')) {
                    // nextToken is a marker to tell us how to display this entity
                    lexicalized.push(this.displayEntity(token, entities[token], delegate, nextToken.substring(1)));

                    // ignore the next token
                    i++;
                } else {
                    lexicalized.push(this.displayEntity(token, entities[token], delegate));
                }
            } else {
                // capitalize certain tokens that should be capitalized in English
                if (this.MUST_CAPITALIZE_TOKEN.has(token))
                    lexicalized.push(capitalize(token));
                else
                    lexicalized.push(token);
            }
        }
        answer = this.detokenizeSentence(lexicalized);

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
     * Check if a phrase looks like a social media user name.
     *
     * This is a coarse check that is used to override
     * {@link DefaultLanguagePack#isGoodWord} to account for foreign person
     * names and loan words.
     */
    isGoodUserName(word : string) : boolean {
        return /^([0-9|\w]+)$/.test(word);
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
