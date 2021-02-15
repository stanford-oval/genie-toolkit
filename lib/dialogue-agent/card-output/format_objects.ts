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

import interpolate from 'string-interp';
import { Builtin } from 'thingtalk';

import * as I18n from '../../i18n';
import type CardFormatter from './card-formatter';
type PlainObject = { [key : string] : unknown };
type GenericFormatSpec = { [key : string] : string|null };

export function isNull(value : unknown) : boolean {
    // all false-y values except false itself are "null"
    if (value === undefined || value === null || value === '' || Number.isNaN(value))
        return true;
    // empty arrays are "null"
    if (Array.isArray(value) && value.length === 0)
        return true;
    // invalid dates are "null"
    if (value instanceof Date && isNaN(+value))
        return true;
    return false;
}

/**
 * Namespace for format objects.
 *
 * Classes in this namespace are not accessible directly, but objects
 * of this classes are returned by {@link Formatter} methods.
 *
 * @name FormatObjects
 * @namespace
 */

/**
 * The base class of all formatting objects.
 *
 * Formatting objects are created from spec objects provided in the `#_[formatted]`
 * function annotation.
 */
export abstract class BaseFormattedObject {
    /**
     * A string identifying the type of this formatted object.
     */
    abstract type : string;

    /**
     * Check if this formatted object is valid.
     *
     * A formatted object is valid if the required properties are substituted with
     * valid values (not null, undefined, empty or NaN). Invalid formatted objects
     * are not displayed to the user.
     *
     * @return {boolean} true if this formatted object is valid, false otherwise
     */
    abstract isValid() : boolean;

    /**
     * Convert this formatted object to a localized string.
     *
     * The resulting string is suitable for speech, or for displaying to user in
     * a text-only interface. It is also suitable as a fallback for all formatting
     * objects not recognized by the application.
     *
     * @param {string} locale - the locale to localize any message into
     * @return {string} a string representation of this formatted object
     */
    abstract toLocaleString(locale : string) : string;

    /**
     * Replace all placeholders in this object, using the provided structured result.
     *
     * @param {Formatter} formatter - the formatter to use for replacement
     * @param {Object.<string,any>} argMap - the structured ThingTalk result with the values to substitute
     */
    replaceParameters(formatter : CardFormatter, argMap : PlainObject) : void {
        for (const key in this) {
            if (key === 'type')
                continue;

            (this as unknown as GenericFormatSpec)[key] = formatter.replaceInString((this as unknown as GenericFormatSpec)[key], argMap);
        }
    }
}


function localeCompat(locale : string) : [(x : string) => string, string|undefined] {
    return [I18n.get(locale).gettext, locale];
}

interface PictureSpec {
    type : 'picture';
    url : string;
}

/**
 * A simple still picture.
 *
 * @alias FormatObjects~Picture
 * @extends FormatObjects~FormattedObject
 */
class Picture extends BaseFormattedObject implements PictureSpec {
    type : 'picture';
    url : string;

    /**
     * Construct a new picture object.
     *
     * @param {Object} spec
     * @param {string} spec.url - the URL of the picture to display
     */
    constructor(spec : PictureSpec) {
        super();

        /**
         * A string identifying the type of this formatted object. Always the value `picture`.
         *
         * @readonly
         * @type {string}
         */
        this.type = 'picture';
        this.url = spec.url;
    }

    isValid() : boolean {
        return !isNull(this.url);
    }

    toLocaleString(locale : string) : string {
        const [_, localestr] = localeCompat(locale);
        return interpolate(_("Picture: ${url}"), {
            url: this.url
        }, { locale: localestr })||'';
    }
}

interface RDLSpec {
    type : 'rdl';
    callback ?: string;
    webCallback : string;
    displayTitle : string;
    displayText ?: string;
    pictureUrl ?: string;
}

/**
 * A rich deep link (also known as a card).
 *
 * An RDL is expected to be displayed as a clickable card with optional
 * description and picture.
 *
 * @alias FormatObjects~RDL
 * @extends FormatObjects~FormattedObject
 */
class RDL extends BaseFormattedObject implements RDLSpec {
    type : 'rdl';
    callback : string|undefined;
    webCallback : string;
    displayTitle : string;
    displayText : string|undefined;
    pictureUrl : string|undefined;

    /**
     * Construct a new RDL
     *
     * If displayTitle is unspecified but displayText is, displayText is moved to displayTitle.
     * If callback is not specified, it is set to the same value as webCallback.
     *
     * @param {Object} spec
     * @param {string} spec.displayTitle - the title of the link
     * @param {string} [spec.displayText] - the description associated with the link
     * @param {string} spec.webCallback - the link target
     * @param {string} [spec.callback] - a different link target, to use on plaforms where deep-linking is allowed (e.g. Android)
     * @param {string} [spec.pictureUrl] - a picture associated with this link
     */
    constructor(spec : RDLSpec) {
        super();

        /**
         * A string identifying the type of this formatted object. Always the value `rdl`.
         *
         * @readonly
         * @type {string}
         */
        this.type = 'rdl';
        this.callback = spec.callback;
        this.webCallback = spec.webCallback;
        this.displayTitle = spec.displayTitle;
        this.displayText = spec.displayText;
        this.pictureUrl = spec.pictureUrl;
    }

    replaceParameters(formatter : CardFormatter, argMap : PlainObject) : void {
        super.replaceParameters(formatter, argMap);
        if (!this.webCallback && this.callback)
            this.webCallback = this.callback;
        if (!this.callback && this.webCallback)
            this.callback = this.webCallback;
        if (!this.displayTitle && this.displayText) {
            this.displayTitle = this.displayText;
            this.displayText = undefined;
        }
        if (!this.displayTitle)
            this.displayTitle = this.webCallback;
        if (!this.pictureUrl)
            this.pictureUrl = undefined;
    }

    isValid() : boolean {
        return !isNull(this.webCallback);
    }

    toLocaleString(locale : string) : string {
        const [_, localestr] = localeCompat(locale);
        return interpolate(_("Link: ${title} <${link}>"), {
            title: this.displayTitle,
            link: this.webCallback
        }, { locale: localestr })||'';
    }
}

interface MapFOSpec {
    type : 'map';
    lat : number;
    lon : number;
    display ?: string;
}

/**
 * A map, with a single pin at the specified location (indicated as latitude, longitude)
 *
 * Whether the map is interactive (can be panned, zoomed) is implementation-dependent.
 *
 * The name `MapFO` is chosen to avoid confusion by JavaScript's builtin
 * [Map](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Map)
 * data structure.
 *
 * @alias FormatObjects~MapFO
 * @extends FormatObjects~FormattedObject
 */
class MapFO extends BaseFormattedObject implements MapFOSpec {
    type : 'map';
    lat : number;
    lon : number;
    display : string|undefined;

    /**
     * Construct a new map format object.
     *
     * @param {Object} spec
     * @param {string|number} spec.lat - latitude; this can be a string with placeholders, or a number
     * @param {string|number} spec.lon - longitude; this can be a string with placeholders, or a number
     * @param {string} [spec.display] - a label for the pin (the name of the location being selected)
     */
    constructor(spec : MapFOSpec) {
        super();

        /**
         * A string identifying the type of this formatted object. Always the value `map`.
         *
         * @readonly
         * @type {string}
         */
        this.type = 'map';
        this.lat = spec.lat;
        this.lon = spec.lon;
        this.display = spec.display;
    }

    replaceParameters(formatter : CardFormatter, argMap : PlainObject) : void {
        super.replaceParameters(formatter, argMap);
        this.lat = Number(this.lat);
        this.lon = Number(this.lon);
    }

    isValid() : boolean {
        return !isNull(this.lat) && !isNull(this.lon);
    }

    toLocaleString(locale : string) : string {
        const [_, localestr] = localeCompat(locale);
        return interpolate(_("Location: ${location}"), {
            location: new Builtin.Location(this.lat, this.lon, this.display)
        }, { locale: localestr })||'';
    }
}

interface SoundEffectSpec {
    type : 'sound';
    name : string;
}

/**
 * A short notification sound from a predefined library.
 *
 * @alias FormatObjects~SoundEffect
 * @extends FormatObjects~FormattedObject
*/
class SoundEffect extends BaseFormattedObject implements SoundEffectSpec {
    type : 'sound';
    name : string;

    /**
     * Construct a new sound effect object.
     *
     * @param {Object} spec
     * @param {string} spec.name - the name of the sound, from the {@link http://0pointer.de/public/sound-theme-spec.html|Freedesktop Sound Theme Spec}
     *                             (with a couple Almond-specific extensions)
     */
    constructor(spec : SoundEffectSpec) {
        super();

        /**
         * A string identifying the type of this formatted object. Always the value `sound`.
         *
         * @readonly
         * @type {string}
         */
        this.type = 'sound';
        this.name = spec.name;
    }

    isValid() : boolean {
        return !isNull(this.name);
    }

    toLocaleString(locale : string) : string {
        const [_, localestr] = localeCompat(locale);
        return interpolate(_("Sound effect: ${name}"), {
            name: this.name
        }, { locale: localestr })||'';
    }
}

interface MediaSpec {
    type : 'media';
    url : string;
}

/**
 * Audio/video display with controls
 *
 * @alias FormatObjects~Media
 * @extends FormatObjects~FormattedObject
*/
class Media extends BaseFormattedObject implements MediaSpec {
    type : 'media';
    url : string;

    /**
     * Construct a new media object.
     *
     * Whether the URL is audio or video will be identified
     * based on Content-Type, URL patterns and potentially
     * file extension.
     *
     * @param {Object} spec
     * @param {string} spec.url - the URL of the music/video to display
     */
    constructor(spec : MediaSpec) {
        super();

        /**
         * A string identifying the type of this formatted object. Always the value `media`.
         *
         * @readonly
         * @type {string}
         */
        this.type = 'media';
        this.url = spec.url;
    }

    isValid() : boolean {
        return !isNull(this.url);
    }

    toLocaleString(locale : string) : string {
        const [_, localestr] = localeCompat(locale);
        return interpolate(_("Media: ${url}"), {
            url: this.url
        }, { locale: localestr })||'';
    }
}

interface ButtonSpec {
    type : 'button';
    title : string;
    code : string;
}

/**
 * A button that maps to a specific ThingTalk program, suggested to the user.
*/
class Button extends BaseFormattedObject implements ButtonSpec {
    type : 'button';
    title : string;
    code : string;

    /**
     * Construct a new button object.
     *
     * @param {Object} spec
     * @param {string} spec.title - the title of the button to show to the user
     * @param {string} spec.code - the associated ThingTalk code (which can be a control command or a program)
     */
    constructor(spec : ButtonSpec) {
        super();

        /**
         * A string identifying the type of this formatted object. Always the value `media`.
         *
         * @readonly
         * @type {string}
         */
        this.type = 'button';
        this.title = spec.title;
        this.code = spec.code;
    }

    isValid() : boolean {
        return !isNull(this.title) && !isNull(this.code);
    }

    toLocaleString(locale : string) : string {
        const [_, localestr] = localeCompat(locale);
        return interpolate(_("Suggestion: ${title}"), {
            title: this.title
        }, { locale: localestr })||'';
    }
}

export interface FormattedObjectClass {
    new (obj : FormattedObjectSpec) : FormattedObject;
}

export const FORMAT_TYPES = {
    'picture': Picture,
    'rdl': RDL,
    'map': MapFO,
    'sound': SoundEffect,
    'media': Media,
    'button': Button,
};

export type FormattedObjectSpec =
    PictureSpec |
    RDLSpec |
    MapFOSpec |
    SoundEffectSpec |
    MediaSpec |
    ButtonSpec;

export type FormattedObject =
    Picture |
    RDL |
    MapFO |
    SoundEffect |
    Media |
    Button;
