// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019-2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const RemoteParserClient = require('./remoteparserclient');
const LocalParserClient = require('./localparserclient');

const URL = 'https://almond-nl.stanford.edu';

module.exports = {
    get(url = URL, locale, platform) {
        if (url.startsWith('file://'))
            return new LocalParserClient(url.substring('file://'.length), locale, platform);
        else
            return new RemoteParserClient(url, locale, platform);
    }
};
