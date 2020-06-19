// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const WS = /[ \t\n\r\v\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff]+/;

function makeToken(index, raw, normalized = raw.toLowerCase(), type = null, value = null) {
    // index is the 0-based index of the token in the input string
    // raw is the original text that matches the token regular expression (with the original casing)
    // normalized is a normalized version of the token: words are lowercased, numbers are converted to digits, dates to ISO, etc.
    // type and value are the entity type and value, or null if the token is not an entity
    return { index, raw, normalized, type, value };
}

module.exports = { WS, makeToken };
