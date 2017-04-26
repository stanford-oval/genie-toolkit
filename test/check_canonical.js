// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const byline = require('byline');
const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

const ThingpediaClient = require('./http_client');
const LocalSempre = require('./localsempre');
const SempreClient = require('../lib/sempreclient');

const SemanticAnalyzer = require('../lib/semantic');

var sempre, session, schemas;

class CanonicalChecker {
    constructor(canonical, parsed) {
        var analysis = new SemanticAnalyzer(parsed);
        if (!analysis.isRule)
            throw new Error('Canonical utterance is not a rule');

        this.trigger = analysis.trigger;
        this.action = analysis.action;
    }

    _slotFill(obj, required) {
        // make up slots
        var slots = obj.schema.schema.map(function(type, i) {
            return { name: obj.schema.args[i], type: type,
                     question: obj.schema.questions[i] };
        });
        var values = new Array(slots.length);
        var comparisons = [];
        var toFill = [];

        ThingTalk.Generate.assignSlots(slots, obj.args, values, comparisons, required, toFill);

        while (toFill.length > 0) {
            var idx = toFill.pop();
            var param = slots[idx];

            if (param.type.isString)
                values[idx] = Ast.Value.String("bla bla bla");
            else if (param.type.isMeasure)
                values[idx] = Ast.Value.Measure(25, param.type.unit);
            else if (param.type.isNumber)
                values[idx] = Ast.Value.Number(42);
            else if (param.type.isBoolean)
                values[idx] = Ast.Value.Boolean(true);
            else if (param.type.isDate)
                values[idx] = Ast.Value.Date(new Date(2016, 5, 6, 12, 29, 0));
        }

        obj.resolved_args = values;
        obj.resolved_conditions = comparisons;
    }

    run() {
        return schemas.getMeta(this.trigger.kind, 'triggers', this.trigger.channel)
            .then((schema) => {
                this.trigger.schema = schema;
                return schemas.getMeta(this.action.kind, 'actions', this.action.channel);
            }).then((schema) => {
                this.action.schema = schema;

                this._slotFill(this.trigger, false);
                this._slotFill(this.action, true);

                return ThingTalk.Generate.codegenRule(schemas, this.trigger, this.action);
            });
    }
}

function main() {
    if (process.argv[2] === '--with-sempre=local')
        sempre = new LocalSempre();
    else if (process.argv[2] !== undefined && process.argv[2].startsWith('--with-sempre='))
        sempre = new SempreClient(process.argv[2].substr('--with-sempre='.length));
    else
        sempre = new SempreClient();
    sempre.start();
    session = sempre.openSession();
    schemas = new ThingTalk.SchemaRetriever(new ThingpediaClient(), true);

    var linestdin = byline(process.stdin);
    linestdin.setEncoding('utf8');
    linestdin.on('data', function(line) {
        linestdin.pause();
        Q.try(function() {
            var split = line.split('\t');
            if (split.length >= 2)
                return [split[0], split[1]];
            else
                return session.sendUtterance(split[0]).then(function(parsed) {
                    return [split[0], parsed];
                });
        }).spread(function(canonical, parsed) {
            return Q.try(function() {
                if (parsed === null)
                    throw new Error('Parsing failed');
                var checker = new CanonicalChecker(canonical, parsed);
                return checker.run();
            }).then(function(code) {
                console.error('Canonical utterance "' + canonical + '" is valid');
                console.error(code);
                console.log(canonical);
            }).catch(function(e) {
                console.error('Canonical utterance "' + canonical + '" is invalid: ' + e.message);
            });
        }).finally(function() {
            linestdin.resume();
        }).done();
    });
    linestdin.on('end', function() {
        sempre.stop();
    });
    process.stdin.resume();
}

main();
