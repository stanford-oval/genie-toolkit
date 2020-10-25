// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020 The Board of Trustees of the Leland Stanford Junior University
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//    http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//
// Author: Silei Xu <silei@cs.stanford.edu>


import * as Tp from 'thingpedia';
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


export {
    wikidataQuery,
    getPropertyLabel,
    getPropertyList,
    getExampleValuesForProperty
};
