// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2016-2018 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const assert = require('assert');

const IpAddress = require('../lib/util/ip_address');

module.exports = async function testUtil(engine) {
    const addresses = await IpAddress.getServerAddresses();
    addresses.forEach((address) => {
        assert(/^([0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}|[0-9a-fA-F:]+)$/.test(address));
    });
    await IpAddress.getServerName();
};
if (!module.parent)
    module.exports();
