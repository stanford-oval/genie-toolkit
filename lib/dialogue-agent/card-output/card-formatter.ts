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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

import interpolate from 'string-interp';
import { SchemaRetriever } from 'thingtalk';

import * as I18n from '../../i18n';
import {
    FORMAT_TYPES,
    FormattedObjectSpec,
    FormattedObject,
    FormattedObjectClass,
    isNull
} from './format_objects';

type PlainObject = { [key : string] : unknown };

interface TextSpec {
    type : 'text';
    text : string;
}

type FormatSpecChunk = string | FormattedObjectSpec | TextSpec;
export type FormatSpec = FormatSpecChunk[];
export type FormattedChunk = string | FormattedObject;

/**
 * An object that is able to convert structured ThingTalk results
 * into interactive cards suitable to supplement text or speech output.
 */
export default class CardFormatter extends interpolate.Formatter {
    private _schemas : SchemaRetriever;
    private _ : (key : string) => string;

    /**
     * Construct a new formatter.
     *
     * @param locale - the user's locale, as a BCP47 tag
     * @param timezone - the user's timezone, as a string in the IANA timezone database (e.g. America/Los_Angeles, Europe/Rome)
     * @param schemaRetriever - the interface to access Thingpedia for formatting information
     */
    constructor(locale : string,
                timezone : string|undefined,
                schemaRetriever : SchemaRetriever) {
        super(locale, timezone);
        this._schemas = schemaRetriever;
        this._ = I18n.get(locale).gettext;
    }

    replaceInString(str : unknown, argMap : PlainObject) : string|null {
        if (typeof str !== 'string')
            return null;

        const replaced = interpolate(str, argMap, {
            locale: this._locale,
            timezone: this._timezone,
            nullReplacement: this._("N/A")
        });
        if (replaced === undefined)
            return null;
        return replaced;
    }

    async formatForType(outputType : string, outputValue : PlainObject, options : { removeText : boolean }) : Promise<FormattedChunk[]> {
        // apply masquerading for @remote.receive
        if (outputType === 'org.thingpedia.builtin.thingengine.remote:receive')
            outputType = String(outputValue.__kindChannel);

        if (outputType === null)
            return [];

        // ignore multiple output types (legacy join)
        if (outputType.indexOf('+') >= 0) {
            const types = outputType.split('+');
            outputType = types[types.length-1];
        }

        const aggregation = /^([a-zA-Z]+)\(([^)]+)\)$/.exec(outputType);
        if (aggregation !== null)
            return [];

        const [kind, function_name] = outputType.split(':');
        const formatspec = (await this._schemas.getFormatMetadata(kind, function_name)) as FormatSpecChunk[];

        return this._normalize(formatspec.map((f : FormatSpecChunk, i : number) : FormattedChunk|null => {
            if (typeof f === 'string')
                f = { type: 'text', text: f };

            if (f.type === 'text') {
                // when this method is called to supplement text output, we pass removeText=true and ignore
                // any purely textual output in the #_[formatted] annotation
                // when this method is called to form notification or for $event, we pass removeText=false
                // and use the textual output in #_[formatted]
                //
                // FIXME text in #_[formatted] should be always removed and we should always use the
                // state machine and #_[result] to form the output text
                if (options.removeText)
                    return null;
                else
                    return this.replaceInString(f.text, outputValue);
            }

            const formatType = FORMAT_TYPES[f.type as keyof typeof FORMAT_TYPES] as FormattedObjectClass;
            if (!formatType) {
                console.log(`WARNING: unrecognized format type ${f.type}`);
                return null;
            }
            const obj = new formatType(f);
            obj.replaceParameters(this, outputValue);

            if (!obj.isValid())
                return null;

            return obj;
        }));
    }

    private _normalize(formatted : Array<FormattedChunk|null>) : FormattedChunk[] {
        // filter out null/undefined in the array
        const filtered = formatted.filter((formatted) => !isNull(formatted)) as Array<FormattedChunk[]|FormattedChunk>;
        // flatten formatted (returning array in function causes nested array)
        const empty : FormattedChunk[] = [];
        return empty.concat(...filtered);
    }
}
