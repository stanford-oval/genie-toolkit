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

const assert = require('assert');

const {
    getPropertyLabel,
    getPropertyList,
    getExampleValuesForProperty
} = require('../tool/autoqa/wikidata/utils');

const TEST_CASES_PROPERTY_LABELS = [
    ['P31', 'instance of'],
    ['P569', 'date of birth']
];

const TEST_CASES_PROPERTY_LIST = [
    ['Q5', [
        'P18', 'P19', 'P20', 'P21', 'P22', 'P25', 'P26', 'P27', 'P39', 'P40', 'P102', 'P103', 'P106', 'P108', 'P119',
        'P140', 'P172', 'P451', 'P463', 'P509', 'P569', 'P570', 'P734', 'P735', 'P937', 'P1050', 'P1196', 'P1317',
        'P1412', 'P1477', 'P1559', 'P1636', 'P2048', 'P2067', 'P3342', 'P3373'
    ]],
    ['Q515', [
        'P17', 'P18', 'P31', 'P41', 'P47', 'P94', 'P131', 'P150', 'P190', 'P227', 'P242', 'P268', 'P281', 'P421',
        'P473', 'P571', 'P625', 'P910', 'P935', 'P948', 'P982', 'P1082', 'P1464', 'P1465', 'P1566', 'P1740', 'P1792',
        'P2044', 'P2046', 'P4290']

    ]
];

const TEST_CASES_EXAMPLE_VALUES = [
    ['Q5', 'P735', 5],
    ['Q515', 'P30', 5]
];


async function main() {
    let anyFailed = false;
    for (let [id, expected] of TEST_CASES_PROPERTY_LABELS) {
        const label = await getPropertyLabel(id);
        try {
            assert.strictEqual(label, expected);
        } catch(e) {
            console.error(`Test case "${id}" failed`);
            console.error(e);
            anyFailed = true;
        }
    }
    for (let [id, expected] of TEST_CASES_PROPERTY_LIST) {
        const properties = await getPropertyList(id);
        try {
            assert.deepStrictEqual(properties, expected);
        } catch(e) {
            console.error(`Test case "${id}" failed`);
            console.error(e);
            anyFailed = true;
        }
    }
    for (let [domainId, propertyId, size] of TEST_CASES_EXAMPLE_VALUES) {
        const values = await getExampleValuesForProperty(domainId, propertyId, size);
        try {
            for (let value of values) {
                assert(value.id.startsWith('http://www.wikidata.org/entity/Q'));
                assert.strictEqual(typeof value.label, 'string');
            }
        } catch(e) {
            console.error(`Test case "${domainId}.${propertyId}" failed`);
            console.error(e);
            anyFailed = true;
        }
    }
    if (anyFailed)
        throw new Error('Some test failed');
}

module.exports = main;
if (!module.parent)
    main();
