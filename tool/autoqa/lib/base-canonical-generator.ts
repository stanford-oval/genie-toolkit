// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as ThingTalk from 'thingtalk';
import { clean } from '../../../lib/utils/misc-utils';
import EnglishLanguagePack from '../../../lib/i18n/english';

export const PARTS_OF_SPEECH = [
    'base',
    'property',
    'property_true',
    'property_false',
    'reverse_property',
    'reverse_property_true',
    'reverse_property_false',
    'verb',
    'verb_true',
    'verb_false',
    'passive_verb',
    'passive_verb_true',
    'passive_verb_false',
    'adjective',
    'adjective_true',
    'adjective_false',
    'preposition',
    'preposition_true',
    'preposition_false',
    'reverse_verb'
];

export const PROJECTION_PARTS_OF_SPEECH = [
    'base',
    'reverse_verb',
];

export interface Canonicals {
    base ?: string[],
    base_projection ?: string[],
    property ?: string[],
    property_true ?: string[],
    property_false ?: string[],
    reverse_property ?: string[],
    reverse_property_true ?: string[],
    verb ?: string[],
    verb_true ?: string[],
    passive_verb ?: string[],
    passive_verb_true ?: string[],
    adjective ?: string[],
    adjective_argmin ?: string[],
    adjective_argmax ?: string[],
    adjective_true ?: string[],
    preposition ?: string[]
    preposition_true ?: string[],
    reverse_verb ?: string[]
}

export interface CanonicalAnnotation extends Canonicals {
    default ?: string
}

function updateDefault(canonical : CanonicalAnnotation, type : keyof Canonicals) {
    if (!canonical.default)
        canonical.default = type === 'base' ? 'property' : type;
}
function updateCanonical(canonical : CanonicalAnnotation, type : keyof Canonicals, values : string[]|string) {
    updateDefault(canonical, type);
    if (!Array.isArray(values))
        values = [values];
    canonical[type] = (canonical[type] || []).concat(values);
}

function preprocessName(languagePack : EnglishLanguagePack, name : string, ptype : ThingTalk.Type) : [string, string[]] {
    name = clean(name);
    if (name.endsWith(' value'))
        name = name.substring(0, name.length - ' value'.length);

    if (ptype && ptype.isArray)
        name = languagePack.pluralize(name);

    const tags = languagePack.posTag(name.split(' '));
    return [name, tags];
}

export default function genBaseCanonical(canonical : CanonicalAnnotation, 
                                         argname : string, 
                                         ptype : ThingTalk.Type, 
                                         functionDef : ThingTalk.Ast.FunctionDef|null = null) {
    const languagePack = new EnglishLanguagePack('en-US');
    const processedName = preprocessName(languagePack, argname, ptype);
    let [name, ] = processedName;
    const [, tags] = processedName;

    // e.g., saturatedFatContent
    if (name.endsWith(' content') && ptype.isMeasure) {
        name = name.substring(0, name.length - ' content'.length);
        const base = [name + ' content', name, name + ' amount'];
        const verb = ['contains #' + name.replace(/ /g, '_')];
        updateCanonical(canonical, 'verb', verb);
        updateCanonical(canonical, 'base', base);
        return;
    }

    // e.g. hasWifi, hasDeliveryMethod
    if (name.startsWith('has ')) {
        name = name.substring('has '.length);
        if (ptype.isBoolean) {
            updateDefault(canonical, 'property');
            updateCanonical(canonical, 'property_true', name);
            updateCanonical(canonical, 'property_false', `no ${name}`);
        } else {
            updateCanonical(canonical, 'base', name);
        }
        return;
    }

    // e.g., isBasedOn, is_unisex
    if (name.startsWith('is ')) {
        name = name.substring('is '.length);
        if (['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[tags.length - 1]) || name.endsWith(' of')) {
            updateDefault(canonical, 'reverse_property');
            updateCanonical(canonical, ptype.isBoolean ? 'reverse_property_true' : 'reverse_property', name);
            return;
        } else if (['VBN', 'JJ', 'JJR'].includes(tags[1])) {
            if (ptype.isBoolean) {
                updateDefault(canonical, 'adjective');
                updateCanonical(canonical, 'adjective_true', name);
            } else {
                updateCanonical(canonical, 'passive_verb', name);
            }
            return;
        }
    }

    // e.g, servesCuisine
    if (['VBP', 'VBZ', 'VBD'].includes(tags[0])) {
        if (!ptype.isBoolean && tags.length === 2 && ['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[1])) {
            updateCanonical(canonical, 'verb', name.replace(' ', ' # '));
            updateCanonical(canonical, 'base', name.split(' ')[1]);
        } else {
            updateDefault(canonical, 'verb');
            updateCanonical(canonical, ptype.isBoolean ? 'verb_true' : 'verb', name);
        }
        return;
    }

    // e.g., memberOf
    if (name.endsWith(' of')) {
        const noun = name.slice(0, -' of'.length);
        const candidates = [name, `# ${noun}`, `# 's ${noun}`];
        updateCanonical(canonical, 'reverse_property', candidates);
        return;
    }

    // e.g., from_location, to_location, inAlbum
    if (tags.length === 2 && (tags[0] === 'IN' || tags[0] === 'TO') && ['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[1])) {
        const preposition = name.split(' ')[0];
        const noun = name.substring(preposition.length + 1);
        updateDefault(canonical, 'preposition');

        let [hasPrepositionConflict, hasNounConflict] = [false, false];
        if (functionDef) {
            for (const arg of functionDef.iterateArguments()) {
                // stop if already found conflicts
                if (hasPrepositionConflict && hasNounConflict)
                    break;
                // don't consider property with different type
                if (!arg.type.equals(ptype))
                    continue;
                // skip the argument itself
                if (arg.name === argname)
                    continue;
                const [name, tags] = preprocessName(languagePack, arg.name, arg.type);
                // skip itself
                if (tags.length === 2 && (tags[0] === 'IN' || tags[0] === 'TO') && ['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[1])) {
                    const otherProposition = name.split(' ')[0];
                    const otherNoun = name.substring(otherProposition.length + 1);
                    if (preposition === otherProposition)
                        hasPrepositionConflict = true;
                    if (noun === otherNoun)
                        hasNounConflict = true;
                }
            }
        }

        if (!hasPrepositionConflict)
            updateCanonical(canonical, ptype.isBoolean ? 'preposition_true' : 'preposition', preposition);
        updateCanonical(canonical, ptype.isBoolean ? 'preposition_true' : 'preposition', name);

        if (!hasNounConflict)
            updateCanonical(canonical, 'base', noun);
        else
            updateCanonical(canonical, 'base', name);
        return;
    }

    // e.g., petsAllowed
    if (ptype.isBoolean && tags.length >= 2 && ['VBN', 'VBD'].includes(tags[tags.length - 1])) {
        const tokens = name.split(' ');
        const noun = tokens.slice(0, tokens.length - 1);
        const verb = tokens[tokens.length - 1];
        const verb_phrase = [languagePack.toVerbSingular(verb), ...noun].join(' ');
        updateDefault(canonical, 'property');
        updateCanonical(canonical, 'property_true', name);
        updateCanonical(canonical, 'verb_true', verb_phrase);
        return;
    }

    if (['IN', 'VBN', 'VBG', 'TO'].includes(tags[0])) {
        updateDefault(canonical, 'preposition');
        updateCanonical(canonical, ptype.isBoolean ? 'preposition_true' : 'preposition', name);
        return;
    }

    if (['JJ', 'JJR'].includes(tags[0]) && !['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[tags.length - 1])) {
        // this one is actually somewhat problematic
        // e.g., all non-words are recognized as JJ, including issn, dateline, funder
        if (ptype.isBoolean) {
            updateDefault(canonical, 'adjective');
            updateCanonical(canonical, 'adjective_true', name);
        } else {
            updateCanonical(canonical, 'passive_verb', name);
        }
        return;
    }

    // fallback to base
    updateDefault(canonical, 'property');
    updateCanonical(canonical, ptype.isBoolean? 'property_true' : 'base', name);
}
