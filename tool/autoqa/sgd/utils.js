// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";

module.exports = {
    cleanEnumValue(v) {
        // replace dash with space
        v = v.replace(/-/g, ' ');
        // camelcase the value
        v = v.replace(/(?:^|\s+|-)[A-Za-z]/g, (letter) => letter.trim().toUpperCase());
        // add underscore prefix if value starts with number
        if (/^\d.*/.test(v))
            v = '_' + v;
        return v;
    }
};
