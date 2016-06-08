// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Config = require('../config');

module.exports = {
    RDF_BASE: Config.RDF_BASE,
    RDF_BASE_REGEX: Config.RDF_BASE_REGEX,
    RDF_TYPE: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#type',

    ME: Config.RDF_BASE + 'me',
    LOCAL: Config.RDF_BASE + 'local',

    ONTOLOGY: Config.ONTOLOGY,
    HAS_PERMISSION: Config.ONTOLOGY + 'hasPermission',

    KEYWORD_CLASS: Config.ONTOLOGY + 'Keyword',
    HAS_VALUE: Config.ONTOLOGY + 'value',

    RECORD_CLASS: Config.ONTOLOGY + 'Record',
    RECORD_TIME: Config.ONTOLOGY + 'recordTime',
}
