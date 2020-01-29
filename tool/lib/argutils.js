// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const fs = require('fs');
const byline = require('byline');
const argparse = require('argparse');

const StreamUtils = require('../../lib/stream-utils');

function maybeCreateReadStream(filename) {
    if (filename === '-')
        return process.stdin;
    else
        return fs.createReadStream(filename);
}

function readAllLines(files, separator = '') {
    return StreamUtils.chain(files.map((s) => s.setEncoding('utf8').pipe(byline())), { objectMode: true, separator });
}

class ActionSetFlag extends argparse.Action {
    call(parser, namespace, values) {
        if (!namespace.flags)
            namespace.set('flags', {});
        for (let value of values)
            namespace.flags[value] = this.constant;
    }
}

module.exports = {
    ActionSetFlag,
    maybeCreateReadStream,
    readAllLines
};
