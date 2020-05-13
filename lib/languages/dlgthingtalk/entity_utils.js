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


function tokensEquals(one, two) {
    if (one === two)
        return true;
    // FIXME stemming
    //if (Stemmer.stem(one).equals(Stemmer.stem(two)))
    //    return true;
    if (one === 'cardinals' && two === 'cardinal')
        return true;
    if (one === 'cardinal' && two === 'cardinals')
        return true;
    if (one === 'yourself' && two === 'yourselves')
        return true;
    if (one === 'yourselves' && two === 'yourself')
        return true;
    return false;
}

function getBestEntityMatch(searchTerm, candidates) {
    let best = undefined, bestScore = undefined;

    let searchTermTokens = searchTerm.split(' ');

    for (let cand of candidates) {
        let score = 0;
        if (cand.value === searchTerm)
            score += 10;

        let candTokens = cand.canonical.split(' ');

        for (let candToken of candTokens) {
            let found = false;
            for (let token of searchTermTokens) {
                if (tokensEquals(token, candToken)) {
                    score += 1;
                    found = true;
                } else if (token === "la" && (candToken === "los" || candToken === "angeles")) {
                    // FIXME is this needed? is it for "la lakers" vs "los angeles lakers"?
                    score += 0.5;
                    found = true;
                } else if (candToken.startsWith(token)) {
                    score += 0.5;
                }
            }
            if (!found)
                score -= 0.1;
        }

        //console.log(`candidate ${cand.name} score ${score}`);
        if (bestScore === undefined || score > bestScore) {
            bestScore = score;
            best = cand;
        }
    }

    return best;
}

module.exports = { getBestEntityMatch };
