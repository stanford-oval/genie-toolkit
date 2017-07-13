// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016-2017 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');
const assert = require('assert');

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;
const Type = ThingTalk.Type;
const Generate = ThingTalk.Generate;
const Describe = ThingTalk.Describe;

const ValueCategory = require('../semantic').ValueCategory;
const Helpers = require('../helpers');

const discovery = require('./discovery');

module.exports = function* configDialog(dlg, kind) {
    let factories = yield this.manager.thingpedia.getDeviceSetup([kind]);
    let factory = factories[kind];
    if (!factory) {
        dlg.reply(dlg._("I'm so sorry, I can't find %s in my database.").format(kind));
    } else if (factory.type === 'none') {
        dlg.reply(dlg._("%s doesn't need configuration.").format(kind));
    } else if (factory.type === 'multiple') {
        if (factory.choices.length > 0) {
            dlg.reply(dlg._("You might want to configure one of: %s").format(factory.choices.join(', ')));
            dlg.replyLink(dlg._("Go to My Goods"), "/apps");
        } else {
            dlg.reply(dlg._("Sorry, I don't know how to configure %s.").format(kind));
        }
    } else if (factory.type === 'discovery') {
        yield* discovery(dlg, factory.discoveryType, factory.kind, factory.text);
    } else {
        dlg.reply(dlg._("OK, here's the link to configure %s.").format(kind));
        switch (factory.type) {
            case 'oauth2':
                dlg.replyLink(dlg._("Configure %s").format(factory.text),
                              '/devices/oauth2/%s?name=%s'.format(factory.kind, factory.text));
                break;
            case 'link':
                dlg.replyLink(dlg._("Configure %s").format(factory.text, factory.href));
                break;
            case 'form':
                dlg.replyLink(dlg._("Configure %s").format(factory.text || dlg.kind),
                              '/devices/configure/%s?name=%s&controls=%s'.format(factory.kind, factory.text || dlg.kind,
                              JSON.stringify(factory.fields)));
        }
    }
}
