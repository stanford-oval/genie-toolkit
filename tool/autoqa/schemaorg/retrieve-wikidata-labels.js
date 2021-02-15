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


export function initArgparse(subparsers) {
    subparsers.add_parser('schemaorg-retrieve-wikidata-labels', {
        add_help: true,
        description: "Retrieve the labels of schema.org properties from wikidata."
    });
}

export async function execute() {
    const labels = await retrieveProperties();
    console.log(JSON.stringify(clean(labels), null, 2));
}
