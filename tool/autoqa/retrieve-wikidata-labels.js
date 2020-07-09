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

const Tp = require('thingpedia');

const URL = 'https://query.wikidata.org/sparql';
const query = `SELECT ?property ?propertyType ?propertyLabel ?propertyDescription ?propertyAltLabel ?schemaProperty WHERE {
  ?property wikibase:propertyType ?propertyType .
  ?property wdt:P1628 ?schemaProperty .
  FILTER(STRSTARTS(STR(?schemaProperty), "http://schema.org")) .
  SERVICE wikibase:label { bd:serviceParam wikibase:language "[AUTO_LANGUAGE],en". }
}
ORDER BY ASC(xsd:integer(STRAFTER(STR(?property), 'P')))`;


async function retrieveProperties() {
    const result = await Tp.Helpers.Http.get(`${URL}?query=${encodeURIComponent(query)}`, {
        accept: 'application/json'
    });
    return JSON.parse(result).results.bindings;
}

function clean(raw) {
    const cleaned = {};
    raw.forEach((p) => {
        const label = p.propertyLabel.value;
        const altLabel = p.propertyAltLabel ? p.propertyAltLabel.value.split(', ') : null;
        const schemaProperty = p.schemaProperty.value.slice('http://schema.org/'.length);
        cleaned[schemaProperty] = {
            property: p.property.value,
            labels: altLabel ? [label, ...altLabel] : [label]
        };
    });
    return cleaned;
}


module.exports = {
    initArgparse(subparsers) {
        subparsers.addParser('retrieve-wikidata-labels', {
            addHelp: true,
            description: "Retrieve the labels of properties from wikidata."
        });
    },

    async execute() {
        const labels = await retrieveProperties();
        console.log(JSON.stringify(clean(labels), null, 2));
    }
};
