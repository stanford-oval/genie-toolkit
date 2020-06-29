// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const { clean } = require('../../lib/utils');
const { pluralize, posTag } = require('../../lib/i18n/american-english');

function genBaseCanonical(canonical, name, ptype) {
    name = clean(name);
    if (name.endsWith(' value'))
        name = name.substring(0, name.length - ' value'.length);

    if (ptype && ptype.isArray)
        name = pluralize(name);

    if (name.endsWith(' content') && ptype.isMeasure) {
        name = name.substring(0, name.length - ' content'.length);
        let base = [name + ' content', name, name + ' amount'];
        let verb = ['contains #' + name.replace(/ /g, '_')];
        canonical.verb = (canonical.verb || []).concat(verb);
        canonical.base = (canonical.base || []).concat(base);
    } else if (name.startsWith('has ')) {
        name = [name.substring('has '.length)];
        canonical.base = (canonical.base || [] ).concat(name);
    } else if (name.startsWith('is ')) {
        name = name.substring('is '.length);
        let tags = posTag(name.split(' '));

        if (['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[tags.length - 1]) || name.endsWith(' of'))
            canonical.reverse_property = (canonical.reverse_property || []).concat([name]);
        else if (['VBN', 'JJ', 'JJR'].includes(tags[0]))
            canonical.passive_verb = (canonical.passive_verb || []).concat([name]);
    } else {
        let tags = posTag(name.split(' '));
        if (['VBP', 'VBZ', 'VBD'].includes(tags[0])) {
            if (tags.length === 2 && ['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[1])) {
                canonical.verb = (canonical.verb || []).concat([name.replace(' ', ' # ')]);
                canonical.base = (canonical.base || []).concat([name.split(' ')[1]]);
            } else {
                canonical.verb = (canonical.verb || []).concat([name]);
            }
        } else if (name.endsWith(' of')) {
            let noun = name.slice(0, -' of'.length);
            let canonicals = [name, `# ${noun}`, `# 's ${noun}`];
            canonical.reverse_property = (canonical.reverse_property || []).concat(canonicals);
        } else if (tags.length === 2 && (tags[0] === 'IN' || tags[0] === 'TO') && ['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[1])) {
            let [preposition, noun] = name.split(' ');
            canonical.passive_verb = (canonical.passive_verb || []).concat([preposition]);
            canonical.base = (canonical.base || []).concat([noun]);
        } else if (['IN', 'VBN', 'VBG', 'TO'].includes(tags[0])) {
            canonical.passive_verb = (canonical.passive_verb || []).concat([name]);
        } else if (['JJ', 'JJR'].includes(tags[0]) && !['NN', 'NNS', 'NNP', 'NNPS'].includes(tags[tags.length - 1])) {
            // this one is actually somewhat problematic
            // e.g., all non-words are recognized as JJ, including issn, dateline, funder
            canonical.passive_verb = (canonical.passive_verb || []).concat([name]);
        } else {
            canonical.base = (canonical.base || []).concat(name);
        }
    }
    return canonical;
}

module.exports = genBaseCanonical;
