// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Config = require('../config');

module.exports = {
    RDF_TYPE: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',

    ME: Config.RDF_BASE + 'me',

    ONTOLOGY: Config.ONTOLOGY,
    HAS_PERMISSION: Config.ONTOLOGY + 'hasPermission',
    KEYWORD_CLASS: Config.ONTOLOGY + 'Keyword',
    HAS_VALUE: Config.ONTOLOGY + 'value',
}
