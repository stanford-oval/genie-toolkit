// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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

import assert from 'assert';
import util from 'util';
import * as fs from 'fs';
import * as ThingTalk from 'thingtalk';

async function loadClassDef(
    thingpedia : string, 
    options : ThingTalk.Syntax.ParseOptions = { locale : 'en-US', timezone: undefined }
) : Promise<ThingTalk.Ast.ClassDef> {
    const classes = await loadClassDefs(thingpedia, options);
    assert(classes.length === 1);
    return classes[0];
}

async function loadClassDefs(
    thingpedia : string, 
    options : ThingTalk.Syntax.ParseOptions = { locale : 'en-US', timezone: undefined }
) : Promise<ThingTalk.Ast.ClassDef[]> {
    const library = ThingTalk.Syntax.parse(await util.promisify(fs.readFile)(thingpedia, { encoding: 'utf8' }), ThingTalk.Syntax.SyntaxType.Normal, options);
    assert(library instanceof ThingTalk.Ast.Library);
    return library.classes;
}

function cleanEnumValue(v : string) : string {
    // replace dash with space
    v = v.replace(/-/g, ' ');
    // camelcase the value
    v = camelcase(v);
    // add underscore prefix if value starts with number
    if (/^\d.*/.test(v))
        v = '_' + v;
    // normalize accent
    v = v.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return v;
}

function camelcase(v : string) : string {
    return v.replace(/(?:^|\s+|-)[A-Za-z]/g, (letter) => letter.trim().toUpperCase());
}

function snakecase(v : string) : string {
    return v.replace(/[() _-]+/g, '_').toLowerCase();
}

function titleCase(v : string) : string {
    return v.split(' ').map((word) => word[0].toUpperCase() + word.substring(1)).join(' ');
}

const DEFAULT_ENTITIES = [
    { "type":"tt:contact","name":"Contact Identity","is_well_known":1,"has_ner_support":0 },
    { "type":"tt:contact_name","name":"Contact Name","is_well_known":1,"has_ner_support":0 },
    { "type":"tt:device","name":"Device Name","is_well_known":1,"has_ner_support":0 },
    { "type":"tt:email_address","name":"Email Address","is_well_known":1,"has_ner_support":0 },
    { "type":"tt:flow_token","name":"Flow Identifier","is_well_known":1,"has_ner_support":0 },
    { "type":"tt:function","name":"Function Name","is_well_known":1,"has_ner_support":0 },
    { "type":"tt:hashtag","name":"Hashtag","is_well_known":1,"has_ner_support":0 },
    { "type":"tt:path_name","name":"Unix Path","is_well_known":1,"has_ner_support":0 },
    { "type":"tt:phone_number","name":"Phone Number","is_well_known":1,"has_ner_support":0 },
    { "type":"tt:picture","name":"Picture","is_well_known":1,"has_ner_support":0 },
    { "type":"tt:program","name":"Program","is_well_known":1,"has_ner_support":0 },
    { "type":"tt:url","name":"URL","is_well_known":1,"has_ner_support":0 },
    { "type":"tt:username","name":"Username","is_well_known":1,"has_ner_support":0 }
];

export {
    loadClassDef,
    loadClassDefs,
    cleanEnumValue,
    camelcase,
    snakecase,
    titleCase,
    DEFAULT_ENTITIES
};
