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

import type { UserInput as Command } from './user-input';

class QueueItem {
}

type JSError = Error;

namespace QueueItem {
    export class UserInput extends QueueItem {
        constructor(public command : Command) {
            super();
        }

        toString() {
            return `UserInput(${this.command})`;
        }
    }

    export class Notification extends QueueItem {
        constructor(public appId : string,
                    public outputType : string,
                    public outputValue : Record<string, unknown>) {
            super();
        }

        toString() {
            return `Notification(${this.appId}, ${this.outputType})`;
        }
    }

    export class Error extends QueueItem {
        constructor(public appId : string,
                    public error : JSError) {
            super();
        }

        toString() {
            return `Error(${this.appId}, ${this.error})`;
        }
    }
}
export default QueueItem;
