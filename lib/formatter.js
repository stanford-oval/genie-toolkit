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
        console.log('output type: ' + outputType);
        let [kind, channel] = outputType.split(':');
        if (kind === 'com.nest' && channel === 'new_event') {
            return Promise.resolve({ formatted: [(argMap, hint, formatter) => {
                console.log('argMap', argMap);
                var timeString = formatter.dateAndTimeToString(argMap.start_time);

                var title;
                if (argMap.has_person)
                    title = "Person detected on your camera at %s".format(timeString);
                else if (argMap.has_sound && argMap.has_motion)
                    title = "Sound and motion detected on your camera at %s".format(timeString);
                else if (argMap.has_sound)
                    title = "Sound detected on your camera at %s".format(timeString);
                else if (argMap.has_motion)
                    title = "Motion detected on your camera at %s".format(timeString);
                else
                    title = "Something detected on your camera at %s".format(timeString);
                return title;
            }], args: [{name:'start_time'}, {name:'has_sound'}, {name: 'has_motion'}, {name: 'has_person'}, {name: 'picture_url'}] });
        }

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

        // apply masquerading for @remote.receive
        // outputValue[2] is the real underlying output type, and outputValue.slice(3)
        // is the real data
        if (outputType === 'org.thingpedia.builtin.thingengine.remote:receive') {
            outputType = String(outputValue[2]);
            outputValue = outputValue.slice(3);
        }

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
