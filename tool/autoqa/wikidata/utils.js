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

/**
 * Run SPARQL query on wikidata endpoint and retrieve results
 * @param {string} query: SPARQL query
 * @returns {Promise<*>}
 */
async function wikidataQuery(query) {
    const result = await Tp.Helpers.Http.get(`${URL}?query=${encodeURIComponent(query)}`, {
        accept: 'application/json'
    });
    return JSON.parse(result).results.bindings;
}

/**
 * Get the label of a give property
 * @param {string} propertyId: the id of the property
 * @returns {Promise<null|string>}: the label of the property
 */
async function getPropertyLabel(propertyId) {
    const query = `SELECT DISTINCT ?propLabel WHERE {
         ?prop wikibase:directClaim wdt:${propertyId} .
         SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT 1`;
    const result = await wikidataQuery(query);
    if (result.length > 0)
        return result[0].propLabel.value;
    return null;
}

/**
 * Get a list of common properties given a domain
 * @param {string} domainId: the id of the domain, e.g. "Q5" for human domain
 * @returns {Promise<Array.string>}: a list of property ids
 */
async function getPropertyList(domainId) {
    const query = `SELECT ?property WHERE {
        wd:${domainId} wdt:P1963 ?property . 
    }`;
    const result = await wikidataQuery(query);
    return result.map((r) => r.property.value.slice('http://www.wikidata.org/entity/'.length));
}


async function getExampleValuesForProperty(domainId, propertyId, size) {
    const query = `SELECT DISTINCT ?value ?valueLabel WHERE {
        ?item wdt:P31 wd:${domainId} .
        ?item wdt:${propertyId} ?value .
        SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
    } LIMIT ${size}`;
    const result = await wikidataQuery(query);
    return result.map((r) => {
        return { id: r.value.value, label: r.valueLabel.value };
    });
}


module.exports = {
    wikidataQuery,
    getPropertyLabel,
    getPropertyList,
    getExampleValuesForProperty
};
