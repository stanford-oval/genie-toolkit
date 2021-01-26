// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as events from 'events';
import * as Tp from 'thingpedia';

// HttpEmitter wraps http calls in EventEmitter interface
export default class HttpEmitter extends events.EventEmitter {
    private _url : string;
    private _host : string;

    constructor(url : string, host : string) {
        super();
        this._url = url;
        this._host = host;
    }

    write(msg : unknown, callback ?: (err : Error|null|undefined) => void) : void {
        Tp.Helpers.Http.post(this._url, JSON.stringify(msg), {
            dataContentType: 'application/json',
            extraHeaders: {'Host': this._host}
        }).then((res) => {
            const parsed = JSON.parse(res);
            if (parsed.predictions) {
                this.emit('data', JSON.parse(parsed.predictions));
            } else {
                if (callback) {
                    callback(new Error(`Unexpected http response: ${res}`));
                }
            }
        }, callback);
    }
}
