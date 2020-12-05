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

import assert from 'assert';
import * as Tp from 'thingpedia';
import * as TT from 'thingtalk';
import * as stream from 'stream';

import Engine from '../../index';
import ExecWrapper, { CompiledQueryHints } from '../../apps/exec_wrapper';

// A placeholder object for builtin triggers/queries/actions that
// don't have any better place to live, such as those related to
// time
export default class MiscellaneousDevice extends Tp.BaseDevice {
    constructor(engine : Engine, state : { kind : string }) {
        super(engine, state);

        this.isTransient = true;
        this.uniqueId = 'thingengine-own-global';
        this.name = engine._("Miscellaneous Interfaces");
        this.description = engine._("Time, randomness and other non-device specific things.");
    }

    get ownerTier() {
        // this pseudo-device does not live anywhere specifically
        return Tp.Tier.GLOBAL;
    }

    async checkAvailable() {
        return Tp.Availability.AVAILABLE;
    }

    get_get_date() {
        return [{ date: new Date }];
    }
    get_get_time() {
        const now = new Date;
        // FIXME convert to the right timezone...
        return [{ time: new Tp.Value.Time(now.getHours(), now.getMinutes(), now.getSeconds()) }];
    }
    get_get_random_between({ low, high } : { low : number, high : number }) {
        low = (low === null || low === undefined) ?  1 : low;
        high = (high === null || high === undefined) ?  6 : high;
        return [{ random: Math.round(low + (Math.random() * (high - low))) }];
    }

    async get_get_gps() {
        const gps = this.engine.platform.getCapability('gps');
        if (gps === null)
            throw new Error((this.engine as Engine)._("Sorry, I cannot access your location in this version of Almond."));
        const location = await gps.getCurrentLocation();
        if (location) {
            return [{ location: { x: location.longitude, y: location.latitude, display: location.display },
                      altitude: location.altitude,
                      bearing: location.bearing,
                      speed: location.speed }];
        } else {
            return [{ location: { x: 0, y: 0, display: (this.engine as Engine)._("Unknown") },
                      altitude: 0,
                      bearing: 0,
                      speed: 0 }];
        }
    }
    subscribe_get_gps() {
        const gps = this.engine.platform.getCapability('gps');
        if (gps === null)
            throw new Error((this.engine as Engine)._("Sorry, I cannot access your location in this version of Almond."));
        const gpsstream = new stream.Readable({ objectMode: true, read() {} });

        gps.onlocationchanged = (location) => {
            if (location !== null) {
                gpsstream.push({ location: { x: location.longitude, y: location.latitude, display: location.display },
                                 altitude: location.altitude,
                                 bearing: location.bearing,
                                 speed: location.speed });
            }
        };
        gps.start();
        gpsstream.destroy = () => gps.stop();
        return gpsstream;
    }

    async get_device() {
        // TODO use hints
        // TODO make lazy

        const everything = [];
        for (let page = 0; ; page++) {
            const devices = await this.engine.thingpedia.getDeviceList(undefined, page, 10);
            for (let j = 0; j < Math.min(devices.length, 10); j++) {
                const device = devices[j];
                everything.push({
                    id: new Tp.Value.Entity(device.primary_kind, device.name),
                    description: device.description,
                    category: device.subcategory
                });
            }
            if (devices.length <= 10)
                break;
        }

        return everything;
    }

    async get_commands(params : unknown, hints ?: CompiledQueryHints) {
        let dataset;
        if (hints && hints.filter) {
            for (const [pname, op, value] of hints.filter) {
                if (pname === 'device' && op === '==') {
                    dataset = this.engine.thingpedia.getExamplesByKinds([String(value)]);
                    break;
                } else if (pname === 'device' && op === 'in_array') {
                    dataset = this.engine.thingpedia.getExamplesByKinds((value as unknown[]).map((v) => String(v)));
                    break;
                }
            }
        }
        if (!dataset)
            dataset = this.engine.thingpedia.getAllExamples();

        const code = await dataset;
        let parsed;
        try {
            parsed = TT.Syntax.parse(code);
        } catch(e) {
            if (e.name !== 'SyntaxError')
                throw e;
            // try parsing using legacy syntax too in case we're talking
            // to an old Thingpedia that has not been migrated
            parsed = TT.Syntax.parse(code, TT.Syntax.SyntaxType.Legacy);
        }
        await parsed.typecheck(this.engine.schemas, false);
        assert(parsed instanceof TT.Ast.Library);

        return parsed.datasets[0].examples.map((ex) => {
            let device;
            // find the device name for the example
            ex.visit(new class extends TT.Ast.NodeVisitor {
                visitDeviceSelector(sel : TT.Ast.DeviceSelector) {
                    device = sel.kind;
                    return false;
                }
            });
            return {
                id: String(ex.id),
                device: device,
                program: new Tp.Value.Entity(ex.prettyprint(), ex.utterances[0])
            };
        });
    }

    do_debug_log(args : { message : string }) {
        console.log('DEBUG:', args.message);
    }
    do_say(args : { message : string }) {
        return { message_output: args.message };
    }
    do_open_url({ url } : { url : unknown }) {
        const cap = this.engine.platform.getCapability('app-launcher');
        if (!cap)
            throw new Error((this.engine as Engine)._("Opening files is not implemented in this Almond"));
        return cap.launchURL(String(url));
    }

    do_configure(args : unknown, env : ExecWrapper) : never {
        /*
        var conversation = env.app.getConversation();
        if (!conversation)
            throw new Error(this.engine._("User not available"));
        // run it asynchronously, or we'll deadlock
        Promise.resolve(conversation.interactiveConfigure(String(args.device))).catch((err) => {
            // the error has already been logged by Almond, and the user has been informed
        });
        */
        throw new Error('not implemented');
    }
    do_discover(args : unknown, env : ExecWrapper) : never {
        /*
        var conversation = env.app.getConversation();
        if (!conversation)
            throw new Error(this.engine._("User not available"));
        // run it asynchronously, or we'll deadlock
        Promise.resolve(conversation.interactiveConfigure(null)).catch((err) => {
            // the error has already been logged by Almond, and the user has been informed
        });
        */
        throw new Error('not implemented');
    }
}
