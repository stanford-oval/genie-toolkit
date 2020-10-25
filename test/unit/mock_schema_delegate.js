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


import * as path from 'path';
import * as Tp from 'thingpedia';

export default new Tp.FileClient({
    locale: 'en',
    thingpedia: path.resolve(path.dirname(module.filename), '../data/en-US/thingpedia.tt'),
    entities: path.resolve(path.dirname(module.filename), '../data/en-US/entities.json'),
    dataset: path.resolve(path.dirname(module.filename), '../data/en-US/dataset.tt')
});
