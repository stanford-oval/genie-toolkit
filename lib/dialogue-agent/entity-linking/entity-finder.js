// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2018 Google LLC
//           2018-2020 The Board of Trustees of the Leland Stanford Junior University
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
"use strict";

import editDistance from '../../utils/edit-distance';

// FIXME use the actual tokenizer
function tokenize(string) {
    let tokens = string.split(/(\s+|[,."'!?])/g);
    return tokens.filter((t) => !(/^\s*$/).test(t)).map((t) => t.toLowerCase());
}

export function collectDisambiguationHints(result, idEntities, previousLocations) {
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

export function getBestEntityMatch(searchTerm, entityType, candidates) {
    let best = undefined,
        bestScore = undefined;

    let refinedSearchTerm = removeParenthesis(searchTerm);
    let searchTermTokens = refinedSearchTerm.split(' ');

    for (let cand of candidates) {
        if (cand.canonical === searchTerm)
            return cand;
        let candDisplay = removeParenthesis(cand.canonical);
        let score = 0;
        score -= 0.1 * editDistance(refinedSearchTerm, candDisplay);

        let candTokens = candDisplay.split(' ');
        candTokens = new Set(candTokens);

        for (let candToken of candTokens) {
            let found = false;
            for (let token of searchTermTokens) {
                if (token === candToken || (editDistance(token, candToken) <= 1 && token.length > 1)) {
                    score += 10;
                    found = true;
                } else if (candToken.startsWith(token)) {
                    score += 0.5;
                }
            }

            // give a small boost to ignorable tokens that are missing
            // this offsets the char-level edit distance
            if (!found && ['the', 'hotel', 'house', 'restaurant'].includes(candToken))
                score += 0.1 * candToken.length;

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

function removeParenthesis(str){
    return str.replace(/ \(.*?\)/g, '');
}
