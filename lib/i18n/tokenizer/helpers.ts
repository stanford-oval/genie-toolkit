// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

// white spaces
export const WS = /[ \t\n\r\v\u180e\u2000-\u200b\u202f\u205f\u3000\ufeff]+/;

export function makeToken<T>(index : number,
                             raw : string,
                             normalized = raw.toLowerCase(),
                             type : string|null = null,
                             value : T|null = null) {
    // index is the 0-based index of the token in the input string
    // raw is the original text that matches the token regular expression (with the original casing)
    // normalized is a normalized version of the token: words are lowercased, numbers are converted to digits, dates to ISO, etc.
    // type and value are the entity type and value, or null if the token is not an entity
    return { index, raw, normalized, type, value };
}
