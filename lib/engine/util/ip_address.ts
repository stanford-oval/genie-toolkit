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


import os from 'os';
import dns from 'dns';
import ip from 'ip';
import util from 'util';

function getPublicIP() {
    // try the ipv4 address first, then the ipv6, then
    // fallback on ipv4 if both are private

    const ipv4 = ip.address('public', 'ipv4');
    if (!ip.isPrivate(ipv4))
        return ipv4;

    const ipv6 = ip.address('public', 'ipv6');
    if (!ip.isPrivate(ipv6))
        return ipv6;

    return ip.address('private', 'ipv4');
}

export function getServerName() {
    // first check if the hostname resolves to a public routable IP
    // if so, we return that because it's likely to be human readable
    const hostname = os.hostname();
    return Promise.all([util.promisify(dns.resolve4)(hostname), util.promisify(dns.resolve6)(hostname)]).then(([resolved4, resolved6]) => {
        // in a well configured system, the hostname *always* resolves to something
        // but that something might be 127.0.0.1 or another private IP
        const public4 = resolved4.filter((a) => !ip.isPrivate(a));
        const public6 = resolved6.filter((a) => !ip.isPrivate(a));
        if (public4.length > 0 || public6.length > 0)
            return hostname;

        return getPublicIP();
    }).catch((e) => {
        // ignore dns resolution errors
        return getPublicIP();
    });
}

export function getServerAddresses(host : string) {
    const ifaces = os.networkInterfaces();
    const addresses  : string[] = [];
    for (const iface in ifaces) {
        ifaces[iface]!.forEach((_if) => {
            addresses.push(_if.address);
        });
    }
    return addresses.filter((a) => !ip.isLoopback(a) && a !== host);
}
