// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2016-2020 The Board of Trustees of the Leland Stanford Junior University
//           2018 Google LLC
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const editDistance = require('../../utils/edit-distance');

// FIXME use the actual tokenizer
function tokenize(string) {
    var tokens = string.split(/(\s+|[,."'!?])/g);
    return tokens.filter((t) => !(/^\s*$/).test(t)).map((t) => t.toLowerCase());
}

function collectDisambiguationHints(result, idEntities, previousLocations) {
    for (let key in result.value) {
        const value = result.value[key];
        if (previousLocations && value.isLocation && value.value.isAbsolute)
            previousLocations.push(value.value);

        if (key === 'id') {
            const id = result.value.id;
            if (!id.isEntity || !id.display)
                continue;
            const idType = id.type;
            const idEntity = {
                value: id.value,
                name: id.display,
                canonical: tokenize(id.display).join(' ')
            };
            if (idEntities.has(idType))
                idEntities.get(idType).push(idEntity);
            else
                idEntities.set(idType, [idEntity]);
        }
    }
}

function getBestEntityMatch(searchTerm, entityType, candidates) {
    let best = undefined, bestScore = undefined;

    let searchTermTokens = searchTerm.split(' ');

    for (let cand of candidates) {
        let candDisplay = cand.canonical;

        let score = 0;
        score -= 0.1 * editDistance(searchTerm, candDisplay);

        let candTokens = candDisplay.split(' ');

        for (let candToken of candTokens) {
            let found = false;
            for (let token of searchTermTokens) {
                if (token === candToken) {
                    score += 10;
                    found = true;
                } else if (candToken.startsWith(token)) {
                    score += 0.5;
                }
            }

            // give a small boost to ignorable tokens that are missing
            // this offsets the char-level edit distance
            if (!found && ['the', 'hotel', 'house', 'restaurant'].includes(candToken))
                score += 1;

            if (entityType === 'imgflip:meme_id' && candToken === 'x')
                score += 1;
        }

        //console.log(`candidate ${cand.name} score ${score}`);
        if (bestScore === undefined || score > bestScore) {
            bestScore = score;
            best = cand;
        }
    }

    return best;
}

module.exports = { collectDisambiguationHints, getBestEntityMatch };
