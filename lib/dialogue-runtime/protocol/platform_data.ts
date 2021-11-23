
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
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>

/**
 * Additional platform-specific metadata associated with each command from the user.
 */
export interface PlatformData {
    /**
     * The originator of this command.
     *
     * This should be a principal string, consisting of a prefix indicating
     * the protocol, followed by an account identifier.
     *
     * Examples:
     * - `phone:+1555123456`: command received over SMS
     * - `email:bob@example.com`: received over email
     */
    from ?: string;

    /**
     * Any contact mention in the command that were resolved by the platform.
     *
     * This property allows to support interactive @-mentions in a command,
     * similar to those available on typical messengers.
     *
     * The expectation is that the actual mention in the command will be replaced
     * by @ followed by an opaque identifier, which will be picked up by the
     * tokenizer. This array maps the opaque identifier to an actual contact.
     */
    contacts ?: Array<{
        /**
         * The opaque identifier of this contact in the command.
         */
        value : string;
        /**
         * The contact string, of the form protocol`:`identifier
         */
        principal : string;
        /**
         * The user-visible name of this contact, for subsequent references.
         */
        display : string;
    }>;
}
