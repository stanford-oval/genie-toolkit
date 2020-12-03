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

import assert from 'assert';
import * as Tp from 'thingpedia';

import * as I18n from '../../i18n';
import { choose } from '../../utils/random';

import { getDevices } from '../requoting';

import { SentenceFlags, SentenceExample } from '../parsers';

/**
  Augmentation pass that adds "ask ..." prefixes to single-device commands.
*/
export default class SingleDeviceAugmenter {
    private _tpClient : Tp.BaseClient;
    private _deviceNames : Map<string, string>;
    private _init : Promise<void>;
    private _templates : Array<[string, RegExp|null]>;
    private _expandFactor : number;
    private _rng : () => number;

    constructor(locale : string,
                thingpediaClient : Tp.BaseClient,
                expandFactor : number,
                rng : () => number) {
        assert(typeof expandFactor === 'number');
        assert(expandFactor > 0);
        this._tpClient = thingpediaClient;
        this._templates = I18n.get(locale).SINGLE_DEVICE_TEMPLATES;

        this._expandFactor = Math.min(expandFactor, this._templates.length);
        this._rng = rng;

        this._deviceNames = new Map;
        this._init = this._doInit();
    }

    private async _doInit() {
        const names = await this._tpClient.getAllDeviceNames();

        for (const row of names)
            this._deviceNames.set(row.kind, row.kind_canonical);
    }

    async process(ex : SentenceExample) : Promise<SentenceExample[]> {
        await this._init;

        if (this._expandFactor < 1)
            return [];
        if (ex.context && ex.context !== 'null')
            return [];

        const devices = new Set(getDevices(ex.target_code, ['@org.thingpedia.builtin.thingengine.builtin.say']));
        if (devices.size > 1 || devices.size <= 0)
            return [];

        // yay, it's a single-device command
        const exampleDevice = Array.from(devices)[0];
        // remove the "@" at the beginning
        const deviceName = this._deviceNames.get(exampleDevice.substring(1));
        if (!deviceName)
            return [];

        const validTemplates = this._templates.filter(([tmpl, condition]) => {
            return condition === null || condition.test(ex.preprocessed);
        });
        const chosenTemplates = choose(validTemplates, this._expandFactor, this._rng);

        return chosenTemplates.map(([tmpl, ]) => {
            const newUtterance = tmpl.split(' ').map((word) => {
                if (word === '$device')
                    return deviceName;
                else if (word === '$command')
                    return ex.preprocessed;
                else
                    return word;
            }).join(' ');

            const flags : SentenceFlags = {};
            if (ex.flags)
                Object.assign(flags, ex.flags);
            flags.augmented = true;
            return {
                id: ex.id,
                flags: flags,
                type: ex.type,
                utterance: newUtterance,
                preprocessed: newUtterance,
                context: ex.context,
                target_code: ex.target_code
            };
        });
    }
}
