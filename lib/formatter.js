// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const adt = require('adt');
const ThingTalk = require('thingtalk');

function makeArgMap(event, args) {
    let argMap = {};
    args.forEach((arg, i) => {
        argMap[arg.name] = event[i];
    });
    return argMap;
}

module.exports = class Formatter extends ThingTalk.Formatter {
    constructor(manager) {
        super(manager.platform.locale, manager.platform.timezone);

        this._manager = manager;
    }

    _getFormatMetadata(outputType) {
        let [kind, channel] = outputType.split(':');

        return this._manager.devices.factory.getManifest(kind).then((manifest) => {
            let block;
            if (manifest.triggers[channel])
                block = manifest.triggers[channel];
            else if (manifest.queries[channel])
                block = manifest.queries[channel];
            else
                console.log('Cannot find channel ' + channel + ' in manifest of ' + kind);
            return block;
        });
    }

    formatForType(outputType, outputValue, currentChannel, hint) {
        if (outputType === null)
            return outputValue.map(String);

        return this._getFormatMetadata(outputType).then((metadata) => {
            if (metadata && metadata.formatted && metadata.formatted.length)
                return this.format(metadata.formatted, makeArgMap(outputValue, metadata.args), hint);

            if (currentChannel && currentChannel.formatEvent) {
                console.log('WARNING: using legacy formatting for ' + outputType + '; Thingpedia info needs to be updated');
                return this.formatForChannel(currentChannel, currentChannel.channelType, outputValue, [], hint);
            } else {
                return outputValue.join(' ');
            }
        });
    }
}
