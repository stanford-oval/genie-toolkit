// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const adt = require('adt');

const ThingTalk = require('thingtalk');

// FINISHME: move this to actual thingpedia
const Parameter = adt.data({
    Constant: { value: adt.any },
    Input: { question: adt.only(String), type: adt.only(ThingTalk.Type) }
});

module.exports = {
    // FIXME this is mostly unused
    NounToKindMap: {
        'tv': 'tv',
        'lightbulb': 'lightbulb',
        'scale': 'scale'
    },
    NounToTriggerMap: {
        'weight': ['extern Weight : (Date, Measure(kg));', 'Weight(_, %s)',
                   ThingTalk.Type.Measure('kg')],
        'picture': [],
        'movie': [],
        'show': [],
    },
    DeviceVerbToActionMap: {
        'scale': {},
        'tv': {
            'turn on': ['setpower', Parameter.Constant(true)],
            'turn off': ['setpower', Parameter.Constant(false)]
        },
        'lightbulb': {
            'turn on': ['setpower', Parameter.Constant(true)],
            'turn off': ['setpower', Parameter.Constant(false)]
        },
    },
    AbsoluteVerbToActionMap: {
        'tweet': ['twitter', 'sink', Parameter.Input("What do you want me to tweet?",
                                                     ThingTalk.Type.String)]
    },

    VerbToActionMap: {
        'tt:device.action.post': {
            'tt:missing': ['twitter', 'facebook'],
            'tt:device.twitter': ['twitter', 'sink', Parameter.Input("What do you want me to tweet?",
                                                                     ThingTalk.Type.String)],
            'tt:device.facebook': ['facebook', 'post', Parameter.Input("What do you want me to post on Facebook?",
                                                                       ThingTalk.Type.String)]
        }
    },
};
