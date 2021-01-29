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

import * as Tp from 'thingpedia';

import RemoteParserClient from './remoteparserclient';
import LocalParserClient, { LocalParserOptions } from './localparserclient';
import { ExactMatcher } from './types';
export * from './types';

const URL = 'https://almond-nl.stanford.edu';

export type ParserClient = RemoteParserClient | LocalParserClient;

export function get(url = URL,
                    locale : string,
                    platform ?: Tp.BasePlatform,
                    exactmatcher ?: ExactMatcher,
                    tpClient ?: Tp.BaseClient,
                    options ?: LocalParserOptions) : ParserClient {
    if (url.startsWith('file://') || /^kf\+https?:/.test(url))
        return new LocalParserClient(url, locale, platform, exactmatcher, tpClient, options);
    else
        return new RemoteParserClient(url, locale, platform, tpClient);
}
