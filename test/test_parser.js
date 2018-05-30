// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

require('./polyfill');

const assert = require('assert');
const ThingTalk = require('thingtalk');
const Gettext = require('node-gettext');

const ParserClient = require('../lib/parserclient');
const { Intent, ValueCategory } = require('../lib/semantic');
const reconstructCanonical = require('../lib/reconstruct_canonical');

const _mockThingpediaClient = require('./mock_schema_delegate');

const gettext = new Gettext();
gettext.setLocale('en-US');

class MockPreferences {
    constructor() {
        this._store = {};

        // change this line to test the initialization dialog
        this._store['sabrina-initialized'] = true;
        this._store['sabrina-name'] = "Alice Tester";
    }

    get(name) {
        return this._store[name];
    }

    set(name, value) {
        console.log(`preferences set ${name} = ${value}`);
        this._store[name] = value;
    }
}

const mockPrefs = new MockPreferences();
mockPrefs.set('sabrina-store-log', 'no');
const schemas = new ThingTalk.SchemaRetriever(_mockThingpediaClient, null, true);

function each(array, fn) {
    return (function loop(i) {
        if (i === array.length)
            return Promise.resolve();
        else
            return Promise.resolve(fn(array[i], i)).then(() => loop(i+1));
    })(0);
}

function candidateToString(cand) {
    if (cand.isProgram)
        return `Program(${cand.program.prettyprint(true)})`;
    else if (cand.isSetup)
        return `Setup(${cand.program.prettyprint(true)})`;
    else if (cand.isPermissionRule)
        return `PermissionRule(${cand.permissionRule.prettyprint(true)})`;
    else
        return String(cand);
}

function testEverything() {
    const TEST_CASES = require('./parser_test_cases');
    const parser = new ParserClient(null, 'en-US', mockPrefs);

    return each(TEST_CASES, (test, i) => {
        return parser.sendUtterance(test).then((analyzed) => {
            assert(Array.isArray(analyzed.candidates));
            assert(analyzed.candidates.length > 0);

            return Promise.all(analyzed.candidates.map((candidate, beamposition) => {
                return Intent.parse({ code: candidate.code, entities: analyzed.entities }, schemas, analyzed, null, null).catch((e) => {
                    return null;
                });
            })).then((candidates) => candidates.filter((c) => c !== null)).then((candidates) => {
                if (candidates.length === 0)
                    console.log(`${i+1}: ${test} => null`);
                else
                    console.log(`${i+1}: ${test} => ${candidateToString(candidates[0])}`);
            });
        });
    });
}

function testReconstruct() {
    const TEST_CASES = require('./parser_test_cases');
    const parser = new ParserClient(null, 'en-US', mockPrefs);

    return each(TEST_CASES, (test, i) => {
        return parser.sendUtterance(test).then((analyzed) => {
            assert(Array.isArray(analyzed.candidates));
            assert(analyzed.candidates.length > 0);

            return Promise.all(analyzed.candidates.map((candidate, beamposition) => {
                return reconstructCanonical({ manager: { schemas, gettext } }, candidate.code, analyzed.entities).catch((e) => {
                    console.log(`${i+1}-${beamposition+1}: ${e.message}`);
                    return null;
                });
            }));
        });
    });
}

function testExpect() {
    const parser = new ParserClient(null, 'en-US', mockPrefs);

    return Promise.all([
        parser.sendUtterance('42', ValueCategory.Number),
        parser.sendUtterance('yes', ValueCategory.YesNo),
        parser.sendUtterance('21 C', ValueCategory.Measure('C')),
        parser.sendUtterance('69 F', ValueCategory.Measure('C')),
    ]);
}

function testMultipleChoice(text, expected) {
    const parser = new ParserClient(null, 'en-US', mockPrefs);

    return parser.sendUtterance(text, ValueCategory.MultipleChoice,
        [{ title: 'choice number one' }, { title: 'choice number two' }]).then((analyzed) => {
        assert.deepStrictEqual(analyzed.entities, {});
        assert.deepStrictEqual(analyzed.candidates[0].code, ['bookkeeping', 'choice', expected]);
    });
}

function testOnlineLearn() {
    const parser = new ParserClient(null, 'en-US', mockPrefs);

    return parser.onlineLearn('get a cat', ['now', '=>', '@com.thecatapi.get', '=>', 'notify'], 'no');
}

function main() {
    return Promise.all([
        testEverything(),
        testReconstruct(),
        testExpect(),
        testMultipleChoice('choice number one', '0'),
        testMultipleChoice('one', '0'),
        testMultipleChoice('choice number two', '1'),
        testOnlineLearn()
    ]);
}
module.exports = main;
if (!module.parent)
    main();