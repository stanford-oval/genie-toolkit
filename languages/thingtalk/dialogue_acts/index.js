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

Object.assign(module.exports,
    require('./action-results'),
    require('./coref-actions'),
    require('./coref-questions'),
    require('./empty-search'),
    require('./initial-request'),
    require('./list-proposal'),
    require('./recommendation'),
    require('./refinement'),
    require('./related-questions'),
    require('./results'),
    require('./search-questions'),
    require('./slot-fill'),
);
