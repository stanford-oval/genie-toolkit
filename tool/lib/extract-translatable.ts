// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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
// Author: Mehrad Moradshahi <mehrad@cs.stanford.edu>

import assert from 'assert';
import * as ThingTalk from 'thingtalk';

import * as I18n from '../../lib/i18n';
import { clean } from '../../lib/utils/misc-utils';
import { Choice, Replaceable } from '../../lib/utils/template-string';

/**
 * Extract all translatable annotations from a ThingTalk manifest or dataset,
 * and return a list of translatable strings.
 *
 * @module
 */

export interface TranslatableString {
    key : string;
    context ?: string;
    comment ?: string;

    object : any;
    field : string|number;
}

// eslint-disable-next-line @typescript-eslint/ban-types
function* extract(key : string, object : object, field : string|number) : IterableIterator<TranslatableString> {
    const str : unknown = (object as any)[field];
    if (typeof str === 'boolean' || typeof str === 'number')
        return;
    if (typeof str === 'string') {
        yield { key, object, field };
    } else if (Array.isArray(str)) {
        for (let i = 0; i < str.length; i++)
            yield* extract(`${key}[${i}]`, str, i);
    } else if (typeof str === 'object' && str !== null) {
        for (const subkey in str) {
            if (subkey === 'type' || subkey === 'default')
                continue;
            yield* extract(`${key}.${subkey}`, str, subkey);
        }
    } else {
        throw new TypeError(`Invalid translatable entry #_[${key}=${str}]`);
    }
}

function makeChoice(choices : Replaceable[]) {
    assert(choices.length > 0);
    if (choices.length === 1)
        return choices[0].toString();
    return new Choice(choices).toString();
}

function* extractFunctionCanonical(langPack : I18n.LanguagePack, key : string, fndef : ThingTalk.Ast.FunctionDef) : IterableIterator<TranslatableString> {
    const normalized = langPack.preprocessFunctionCanonical(fndef.nl_annotations.canonical || clean(fndef.name), fndef.functionType, 'user', fndef.is_list);

    fndef.nl_annotations.canonical = makeChoice(normalized);
    yield { key, context: key, object: fndef.nl_annotations, field: 'canonical' };
}

function* extractParameterCanonical(langPack : I18n.LanguagePack, key : string, argdef : ThingTalk.Ast.ArgumentDef) : IterableIterator<TranslatableString> {
    const normalized = langPack.preprocessParameterCanonical(argdef, 'user');

    // remove the canonical form, and replace them with the translated/normalized form
    const newCanonical : any = {};
    argdef.nl_annotations.canonical = newCanonical;

    newCanonical.default = normalized.default;
    yield {
        key: `${key}.default`,
        context: `${key}.default`,
        comment: 'Translators: this is the POS to use as default for agent replies, it is a POS tag, it should not be translated',
        object: newCanonical,
        field: 'default'
    };

    for (const subkey of ['base', 'base_projection', 'argmin', 'argmax', 'projection', 'filter_phrase'] as const) {
        if (normalized[subkey].length === 0)
            continue;
        const fullkey = `${key}.${subkey}`;
        newCanonical[subkey] = makeChoice(normalized[subkey]);
        yield {
            key: fullkey,
            context: fullkey,
            object: newCanonical,
            field: subkey
        };
    }

    newCanonical.enum_filter = {};
    for (const enum_ in normalized.enum_filter) {
        const enum_options = normalized.enum_filter[enum_];
        if (enum_options.length === 0)
            continue;

        const fullkey = `${key}.enum.${enum_}`;
        newCanonical.enum_filter[enum_] = makeChoice(enum_options);
        yield {
            key: fullkey,
            context: fullkey,
            object: newCanonical.enum_filter,
            field: enum_
        };
    }

    if (argdef.type instanceof ThingTalk.Type.Enum) {
        const typekey = `enum.${argdef.type.entries!.join(',')}`;
        newCanonical.enum_value = {};
        for (const enum_ in normalized.enum_value) {
            const enum_options = normalized.enum_value[enum_];
            const fullkey = `${key}.enum.${enum_}`;
            newCanonical.enum_value[enum_] = makeChoice(enum_options);
            yield {
                key: fullkey,
                // note: the context includes the enum type but it does not include the class/function/argument name
                // this is because enums must be translated consistently across the whole codebase as they are unified by type
                context: typekey,
                object: newCanonical.enum_value,
                field: enum_
            };
        }
    }
}

export function* processLibrary(library : ThingTalk.Ast.Library) : IterableIterator<TranslatableString> {
    const langPack = I18n.get('en-US');

    // parse manifest
    for (const _class of library.classes) {
        for (const key in _class.nl_annotations)
            yield* extract(`${key}`, _class.nl_annotations, key);
        for (const what of ['queries', 'actions'] as const) {
            for (const name in _class[what]) {
                const fndef = _class[what][name];
                yield* extractFunctionCanonical(langPack, `${what}.${name}.canonical`, fndef);
                for (const key in fndef.nl_annotations) {
                    if (key === 'canonical')
                        continue;
                    yield* extract(`${what}.${name}.${key}`, fndef.nl_annotations, key);
                }

                for (const argname of _class[what][name].args) {
                    const arg = _class[what][name].getArgument(argname)!;

                    yield* extractParameterCanonical(langPack, `${what}.${name}.args.${argname}.canonical`, arg);
                    for (const key in arg.nl_annotations) {
                        if (key === 'canonical')
                            continue;
                        yield* extract(`${what}.${name}.args.${argname}.${key}`, arg.nl_annotations, key);
                    }
                }
            }
        }
    }

    // parse dataset
    for (const _class of library.datasets) {
        for (const [ex_id, ex] of _class.examples.entries()) {
            for (const uttr_id of ex.utterances.keys()) {
                const key = `${_class.name}.${ex_id}.${uttr_id}`;
                yield { key, object: ex.utterances, field: uttr_id };
            }
        }
    }
}
