// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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

import assert from 'assert';
import { Ast } from 'thingtalk';

import editDistance from '../../utils/edit-distance';

// FIXME use the actual tokenizer
function tokenize(string : string) : string[] {
    const tokens = string.split(/(\s+|[,."'!?])/g);
    return tokens.filter((t) => !(/^\s*$/).test(t)).map((t) => t.toLowerCase());
}

export interface EntityRecord {
    value : string,
    name : string,
    canonical : string
}

export function collectDisambiguationHints(result : Ast.DialogueHistoryResultItem,
                                           idEntities : Map<string, EntityRecord[]>,
                                           previousLocations : Ast.Location[]) : void {
    for (const key in result.value) {
        const value = result.value[key];
        if (previousLocations && value instanceof Ast.LocationValue && value.value instanceof Ast.AbsoluteLocation)
            previousLocations.push(value.value);

        if (key === 'id') {
            const id = result.value.id;
            if (!(id instanceof Ast.EntityValue) || !id.display)
                continue;
            const idType = id.type;
            const idEntity = {
                value: id.value!,
                name: id.display,
                canonical: tokenize(id.display).join(' ')
            };
            if (idEntities.has(idType))
                idEntities.get(idType)!.push(idEntity);
            else
                idEntities.set(idType, [idEntity]);
        }
    }
}

export function getBestEntityMatch(searchTerm : string, entityType : string, candidates : EntityRecord[]) : EntityRecord {
    let best : EntityRecord|undefined = undefined,
        bestScore : number|undefined = undefined;

    const refinedSearchTerm = removeParenthesis(searchTerm);
    const searchTermTokens = refinedSearchTerm.split(' ');

    for (const cand of candidates) {
        const candDisplay = removeParenthesis(cand.canonical);
        let score = 0;
        score -= 0.1 * editDistance(refinedSearchTerm, candDisplay);

        const candTokens = new Set(candDisplay.split(' '));

        for (const candToken of candTokens) {
            let found = false;
            for (const token of searchTermTokens) {
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
                score += 0.1 * (1 + candToken.length); // add 1 to account for the space

            if (entityType === 'imgflip:meme_id' && candToken === 'x')
                score += 1;
        }
        //console.log(`candidate ${cand.name} score ${score}`);
        if (bestScore === undefined || score > bestScore) {
            bestScore = score;
            best = cand;
        }
    }

    assert(best);
    return best;
}

function removeParenthesis(str : string) : string {
    return str.replace(/ \(.*?\)/g, '');
}
