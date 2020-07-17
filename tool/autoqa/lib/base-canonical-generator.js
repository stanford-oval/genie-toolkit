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
"use strict";

const { clean } = require('../../../lib/utils/misc-utils');
const EnglishLanguagePack = require('../../../lib/i18n/american-english');

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

function genBaseCanonical(canonical, name, ptype) {
    const languagePack = new EnglishLanguagePack();
    name = clean(name);
    if (name.endsWith(' value'))
        name = name.substring(0, name.length - ' value'.length);

    if (ptype && ptype.isArray)
        name = languagePack.pluralize(name);

    const tags = languagePack.posTag(name.split(' '));

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
        updateDefault(canonical, 'passive_verb');
        updateCanonical(canonical, ptype.isBoolean ? 'passive_verb_true' : 'passive_verb', preposition);
        updateCanonical(canonical, 'base', name);
        return;
    }

    if (['IN', 'VBN', 'VBG', 'TO'].includes(tags[0])) {
        updateDefault(canonical, 'passive_verb');
        updateCanonical(canonical, ptype.isBoolean ? 'passive_verb_true' : 'passive_verb', name);
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

module.exports = genBaseCanonical;
