// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Sabrina
//
// Copyright 2016 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

module.exports = {
    promptConfigure(dialog, kinds) {
        return dialog.manager.thingpedia.getDeviceSetup(kinds).then((factories) => {
            for (var name in factories) {
                var factory = factories[name];

                if (factory.type === 'multiple') {
                    dialog.reply("You don't have a " + name);
                    if (factory.choices.length > 0) {
                        dialog.reply("You might want to configure one of: " + factory.choices.join(', '));
                        dialog.replyLink("Go to Dashboard", "/apps");
                    }
                } else {
                    dialog.reply("You don't have a " + factory.text);
                    switch (factory.type) {
                    case 'oauth2':
                        dialog.replyLink("Configure " + factory.text, '/devices/oauth2/' + factory.kind);
                        break;
                    case 'link':
                        dialog.replyLink("Configure " + factory.text, factory.href);
                        break;
                    case 'none':
                        dialog.replyLink("Enable " + factory.text, '/devices/create/' + factory.kind);
                    }
                }
            }
        });
    }
}
