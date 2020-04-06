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

const assert = require('assert');

const LOCATION_TYPE = {
    latitude: { isArray: false, type: 'tt:Number' },
    longitude: { isArray: false, type: 'tt:Number' }
};

function makeMetadata(prefix, args) {
    const meta = {};

    for (let arg of args) {
        const type = arg.type;
        const name = arg.name;
        if (name === 'id')
            continue;
        if (name.indexOf('.') >= 0)
            continue;

        let ptype = type;
        if (type.isArray)
            ptype = type.elem;
        assert(!ptype.isArray);

        let typemeta;
        if (ptype.isEntity && ptype.type.startsWith(`${prefix}.`))
            typemeta = ptype.type.substring(ptype.type.indexOf(':') + 1);
        else if (ptype.isEntity && ptype.type === 'tt:country')
            typemeta = 'tt:EntityLower';
        else if (ptype.isEntity)
            typemeta = 'tt:Entity';
        else if (ptype.isMeasure && ptype.unit === 'ms')
            typemeta = 'tt:Duration';
        else if (ptype.isMeasure)
            typemeta = 'tt:Measure';
        else if (ptype.isCompound)
            typemeta = makeMetadata(prefix, Object.values(ptype.fields));
        else if (ptype.isLocation)
            typemeta = LOCATION_TYPE;
        else
            typemeta = 'tt:' + ptype;

        meta[name] = {
            isArray: type.isArray,
            type: typemeta
        };
    }

    return meta;
}

module.exports = {
    makeMetadata
};
