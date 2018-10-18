// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');

module.exports = async function testHTTPClient(engine) {
    await ThingTalk.Grammar.parseAndTypecheck('now => @com.xkcd.get_comic() => notify;', engine.schemas, false);

    // do it again, to check that it is cached
    await ThingTalk.Grammar.parseAndTypecheck('now => @com.xkcd.get_comic() => notify;', engine.schemas, false);

    // now with metas
    await ThingTalk.Grammar.parseAndTypecheck('now => @com.xkcd.get_comic() => notify;', engine.schemas, true);
};
