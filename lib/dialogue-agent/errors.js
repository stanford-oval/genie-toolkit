// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

class CancellationError extends Error {
    constructor() {
        super("User cancelled");
        this.code = 'ECANCELLED';
    }
}

module.exports = {
    CancellationError
};
