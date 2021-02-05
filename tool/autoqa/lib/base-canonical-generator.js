// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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


import { clean } from '../../../lib/utils/misc-utils';
import EnglishLanguagePack from '../../../lib/i18n/english';

function updateDefault(canonical, type) {
    if (!canonical.default)
        canonical.default = type === 'base' ? 'property' : type;
}
function updateCanonical(canonical, type, values) {
    updateDefault(canonical, type);
    if (!Array.isArray(values))
        values = [values];
    canonical[type] = (canonical[type] || []).concat(values);
}

function preprocessName(languagePack, name, ptype) {
    name = clean(name);
    if (name.endsWith(' value'))
        name = name.substring(0, name.length - ' value'.length);

    if (ptype && ptype.isArray)
        name = languagePack.pluralize(name);

    const tags = languagePack.posTag(name.split(' '));
    return [name, tags];
}

function typeEqual(t1, t2) {
    // TODO: replace this once we switch away from adt
    if (t1.isCompound && t2.isCompound) {
        if (t1.name !== t2.name)
            return false;
        if (Object.keys(t1.fields).length !== Object.keys(t2.fields).length)
            return false;
        for (let f in t1.fields) {
            if (!(f in t2.fields))
                return false;
            if (!typeEqual(t1.fields[f].type, (t2.fields[f].type)))
                return false;
        }
        return true;
    } else if (t1.isEnum && t2.isEnum) {
        if (t1.entries.length !== t2.entries.length)
            return false;
        for (let entry of t1.entries) {
            if (!t2.entries.includes(entry))
                return false;
        }
        return true;
    } else {
        return t1.equals(t2);
    }
}

export default function genBaseCanonical(canonical, argname, ptype, functionDef = null) {
    const languagePack = new EnglishLanguagePack('en-US');
    let [name, tags] = preprocessName(languagePack, argname, ptype);

    // e.g., saturatedFatContent
    if (name.endsWith(' content') && ptype.isMeasure) {
        name = name.substring(0, name.length - ' content'.length);
        let base = [name + ' content', name, name + ' amount'];
        let verb = ['contains #' + name.replace(/ /g, '_')];
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
        let noun = name.slice(0, -' of'.length);
        let candidates = [name, `# ${noun}`, `# 's ${noun}`];
        updateCanonical(canonical, 'reverse_property', candidates);
        return;
    }

    // e.g., from_location, to_location, inAlbum
    if (tags.length === 2 && (tags[0] === 'IN' || tags[0] === 'TO') && ['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[1])) {
        let preposition = name.split(' ')[0];
        let noun = name.substring(preposition.length + 1);
        updateDefault(canonical, 'preposition');

        let [hasPrepositionConflict, hasNounConflict] = [false, false];
        if (functionDef) {
            for (let arg of functionDef.iterateArguments()) {
                // stop if already found conflicts
                if (hasPrepositionConflict && hasNounConflict)
                    break;
                // don't consider property with different type
                if (!typeEqual(arg.type, ptype))
                    continue;
                // skip the argument itself
                if (arg.name === argname)
                    continue;
                let [name, tags] = preprocessName(languagePack, arg.name, arg.type);
                // skip itself
                if (tags.length === 2 && (tags[0] === 'IN' || tags[0] === 'TO') && ['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[1])) {
                    let otherProposition = name.split(' ')[0];
                    let otherNoun = name.substring(otherProposition.length + 1);
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
        let tokens = name.split(' ');
        let noun = tokens.slice(0, tokens.length - 1);
        let verb = tokens[tokens.length - 1];
        let verb_phrase = [languagePack.toVerbSingular(verb), ...noun].join(' ');
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
