// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingTalk
//
// Copyright 2017-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

function replaceMeMy(sentence) {
    sentence = sentence.replace(/\b((?!(?:let|inform|notify|alert|send)\b)[a-zA-Z0-9]+) me\b/g, '$1 them');

    return sentence.replace(/\b(my|i|mine)\b/g, (what) => {
        switch(what) {
        case 'me':
            return 'them';
        case 'my':
            return 'their';
        case 'mine':
            return 'theirs';
        case 'i':
            return 'they';
        default:
            return what;
        }
    });
}

module.exports = function postprocess(sentence, program) {
    if (program.isProgram && program.principal !== null)
        sentence = replaceMeMy(sentence);

    return sentence.replace(/ new (their|my|the|a) /, (_, what) => ` ${what} new `)
        .replace(/ 's (my|their|his|her) /, ` 's `) //'
        .trim();
};
