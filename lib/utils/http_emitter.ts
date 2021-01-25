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
/* -*- mode: js; indent-tabs-mode: nil; -*- */
//
// Copyright (c) 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Permission is hereby granted, free of charge, to any person obtaining a copy
// of this software and associated documentation files (the "Software"), to
// deal in the Software without restriction, including without limitation the
// rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
// sell copies of the Software, and to permit persons to whom the Software is
// furnished to do so, subject to the following conditions:
//
// The above copyright notice and this permission notice shall be included in
// all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
// IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
// FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
// AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
// LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
// FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
// IN THE SOFTWARE.

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
