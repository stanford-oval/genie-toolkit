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

function arraySubset(small, big) {
    for (let element of small) {
        let good = false;
        for (let candidate of big) {
            if (candidate.equals(element)) {
                good = true;
                break;
            }
        }
        if (!good)
            return false;
    }
    return true;
}

module.export = {
    arraySubset
};
