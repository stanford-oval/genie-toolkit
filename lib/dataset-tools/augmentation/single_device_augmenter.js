// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2019 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const I18n = require('../../i18n');
const { choose } = require('../../utils/random');

/**
  Augmentation pass that adds "ask ..." prefixes to single-device commands.
*/
module.exports = class SingleDeviceAugmenter {
    constructor(locale, thingpediaClient, expandFactor, rng) {
        this._tpClient = thingpediaClient;

        this._deviceNames = new Map;
        this._init = (async () => {
            const names = await this._tpClient.getAllDeviceNames();

            for (let row of names)
                this._deviceNames.set(row.kind, row.kind_canonical);
        })();

        this._templates = I18n.get(locale).SINGLE_DEVICE_TEMPLATES;

        this._expandFactor = Math.min(expandFactor, this._templates.length);
        this._rng = rng;
    }

    async process(ex) {
        await this._init;

        if (this._expandFactor < 1)
            return [];

        let exampleDevice = undefined;
        let in_string = false;
        for (let token of ex.target_code.split(' ')) {
            if (token === '"')
                in_string = !in_string;
            if (in_string)
                continue;
            if (token.startsWith('@')) {
                // @builtin.say is considered to apply to all skills
                if (token === '@org.thingpedia.builtin.thingengine.builtin.say')
                    continue;

                let dot = token.lastIndexOf('.');
                let device = token.substring(1, dot);

                if (exampleDevice === undefined) {
                    exampleDevice = device;
                } else if (device !== exampleDevice) {
                    // not a single-device command
                    return [];
                }
            }
        }

        // yay, it's a single-device command
        const deviceName = this._deviceNames.get(exampleDevice);
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

            let flags = {};
            if (ex.flags)
                Object.assign(flags, ex.flags);
            flags.exact = false;
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
};
