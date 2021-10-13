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

import * as ThingTalk from 'thingtalk';
import * as Tp from 'thingpedia';
import CanonicalGenerator from './canonical-generator';

export default class AutoAnnotationGenerator {
    private canonicalGenerator; 

    constructor(classDef : ThingTalk.Ast.ClassDef, 
                entities : Tp.BaseClient.EntityTypeRecord[],
                constants : Record<string, any[]>, 
                queries : string[], 
                options : any) {
        this.canonicalGenerator = new CanonicalGenerator(classDef, entities, constants, queries, options);
    }

    generate() {
        return this.canonicalGenerator.generate();
    }
}
