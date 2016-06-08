// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Tp = require('thingpedia');

const Constants = require('../../../../graphdb/constants');

module.exports = new Tp.ChannelClass({
    Name: 'StoreRecord',

    _init: function(engine, device) {
        this.parent();

        this.engine = engine;
        this.device = device;
    },

    sendEvent: function(event) {
        var recordType = Util.normalizeResource(event[0]);
        var recordSubject = event[1];
        var recordProperty = event[2];
        var recordResourceProperties = event[3].map((setting) => {
            var prop = setting[0];
            var val = setting[1];
            return [Util.normalizeResource(prop), Util.normalizeResource(val)];
        });
        var recordLiteralProperties = event[4].map((setting) => {
            var prop = setting[0];
            var val = setting[1];
            return [Util.normalizeResource(prop), val];
        });

        var subject = Util.newResource();

        var triples = [[recordSubject, recordProperty, subject],
                       [subject, Constants.RDF_TYPE, recordType],
                       [subject, Constants.RDF_TYPE, Constants.RECORD_CLASS],
                       [subject, Constants.RECORD_TIME, (new Date).toJSON()]]
                       .concat(recordResourceProperties.map((p) => [subject, p[0], p[1]]))
                       .concat(recordLiteralProperties.map((p) => [subject, p[0], p[1]]));

        this.engine.graphdb.local.put(triples.map((t) => {
            return { subject: t[0], predicate: t[1], object: t[2] };
        }));
    }
})
