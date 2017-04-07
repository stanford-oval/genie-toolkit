// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const events = require('events');

const Dialog = require('./dialog');

const SPARQL_PRELUDE = 'prefix foaf: <http://xmlns.com/foaf/0.1/> ' +
                       'prefix tt: <http://thingengine.stanford.edu/rdf/0.1/> ' +
                       'prefix tto: <http://thingengine.stanford.edu/ontology/0.1/#> ';

module.exports = class QuestionDialog extends Dialog {
    constructor() {
        super();

        this.running = false;
    }

    handle(command) {
        return this.handleGeneric(command).then((handled) => {
            if (handled)
                return true;
            else
                return this._continue(command);
        });
    }

    _continue(command) {
        if (this.running)
            return;

        var sparql = SPARQL_PRELUDE + command.query;
        var stream = this.manager.sparql.runQuery(sparql);

        stream.on('data', (d) => {
            if (!this.running)
                return;
            this.sendReply(util.inspect(d));
        });
        stream.on('end', () => {
            if (!this.running)
                return;
            this.sendReply("Done");
            this.running = false;
            this.switchToDefault();
        });
        stream.on('error', (e) => {
            if (!this.running)
                return;
            this.sendReply("Error: " + e.message);
            this.running = false;
            this.switchToDefault();
        });

        this.running = true;
        return true;
    }
}

