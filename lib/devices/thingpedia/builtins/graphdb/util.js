// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const uuid = require('node-uuid');

const Constants = require('../../../../graphdb/constants');

const Prefixes = {
    'tt:': Constants.RDF_BASE,
    'tto:': Constants.ONTOLOGY,
    'foaf:': 'http://xmlns.com/foaf/0.1/',
    'rdf:': 'http://www.w3.org/1999/02/22-rdf-syntax-ns#',
}

module.exports = {
    normalizeResource(res) {
        if (res.indexOf(':') < 0)
            return Constants.RDF_BASE + res;

        for (var prefix of Prefixes) {
            if (res.startsWith(prefix))
                return Prefixes[prefix] + res.substr(prefix.length);
        }

        return res;
    },

    newResource() {
        return Constants.RDF_BASE + '/uuid/' + uuid.v4();
    }
}
