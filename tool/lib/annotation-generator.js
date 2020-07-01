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
const CanonicalGenerator = require('./canonical-generator');

class AutoAnnotationGenerator {
    constructor(classDef, constants, queries, parameterDatasets, options) {
        this.canonicalGenerator = new CanonicalGenerator(classDef, constants, queries, parameterDatasets, options);
    }

    generate() {
        let classDef;
        classDef = this.canonicalGenerator.generate();
        return classDef;
    }
}

module.exports = AutoAnnotationGenerator;
