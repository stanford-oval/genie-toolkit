// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//         Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Stream = require('stream');

const FlagUtils = require('./flags');

class DatasetStringifier extends Stream.Transform {
    constructor() {
        super({
            writableObjectMode: true,
        });
    }

    _transform(ex, encoding, callback) {
        callback(null, FlagUtils.makeId(ex) + '\t' + ex.preprocessed + '\t' + ex.target_code + '\n');
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

class DatasetParser extends Stream.Transform {
    constructor() {
        super({
            readableObjectMode: true,
            writableObjectMode: true,
        });
    }

    _transform(line, encoding, callback) {
        const [id, preprocessed, target_code] = line.trim().split('\t');
        const ex = {
            id, preprocessed, target_code
        };
        FlagUtils.parseId(ex);
        callback(null, ex);
    }

    _flush(callback) {
        process.nextTick(callback);
    }
}

module.exports = {
    DatasetParser,
    DatasetStringifier
};
