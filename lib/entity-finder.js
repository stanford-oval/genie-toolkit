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

const editDistance = require('./edit-distance');

function getBestEntityMatch(value, searchTerm, candidates) {
    if (value !== null) {
        for (let cand of candidates) {
            if (value === cand.id.value)
                return cand.id;
        }
    }

    let best = undefined, bestScore = undefined;

    let searchTermTokens = searchTerm.split(' ');

    for (let cand of candidates) {
        let candDisplay = cand.id.display;

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
        }

        //console.log(`candidate ${cand.name} score ${score}`);
        if (bestScore === undefined || score > bestScore) {
            bestScore = score;
            best = cand.id;
        }
    }

    return best;
}

module.exports = { getBestEntityMatch };
