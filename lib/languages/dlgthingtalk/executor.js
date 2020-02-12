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

/**
 * Abstract interface to executing ThingTalk code.
 *
 * This abstracts the thingengine-core API into
 * something that can be simulated at training time.
 */
class AbstractThingTalkExecutor {
    /* instanbul ignore next */
    async executeStatement(stmt, execState) {
        throw new Error('abstract method');
    }
}
module.exports = AbstractThingTalkExecutor;
