// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Almond
//
// Copyright 2016 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const Ast = ThingTalk.Ast;

module.exports = {
    isPlatformBuiltin(kind) {
        return kind.startsWith('org.thingpedia.builtin.thingengine');
    },

    getProgramIcon(program) {
        let icon = null;
        for (let [, prim] of program.iteratePrimitives()) {
            if (prim.selector.isBuiltin)
                continue;
            let newIcon = this.getIcon(prim);
            // ignore builtin/platform devices when choosing the icon
            if (!newIcon || this.isPlatformBuiltin(newIcon))
                continue;
            icon = newIcon;
        }
        return icon;
    },

    getIcon(prim) {
        let kind;
        if (prim === null)
            return null;
        if (prim instanceof Ast.PermissionFunction)
            kind = prim.kind;
        else if (prim.selector.isDevice)
            kind = prim.selector.kind;

        if (kind && kind !== 'remote' && !kind.startsWith('__dyn')) {
            if (prim.selector && prim.selector.device)
                return prim.selector.device.kind;
            else
                return kind;
        } else {
            return null;
        }
    }
};
