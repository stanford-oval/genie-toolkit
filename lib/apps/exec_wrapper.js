// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const ThingTalk = require('thingtalk');
const ExecEnvironment = ThingTalk.ExecEnvironment;
const TriggerRunner = require('./trigger_runner');

const { Timer, AtTimer } = require('./timers');
const DeviceView = require('../devices/device_view');

function safeInvoke(promise) {
    return Promise.resolve(promise).then((x) => x, (e) => {
        if (e.code === 'ECANCELLED')
            return [];
        else
            throw e;
    });
}

function extendParams(output, input) {
    for (let key in input) {
         if (Object.prototype.hasOwnProperty.call(output, key))
             continue;
         output[key] = input[key];
    }
}

module.exports = class ExecWrapper extends ExecEnvironment {
    constructor(engine, app, output) {
        super(engine.platform.locale, engine.platform.timezone, engine.schemas,
              engine.platform.getCapability('gettext'));
        this.engine = engine;
        this.app = app;
        this._programId = new ThingTalk.Entity(this.app.uniqueId, null);
        this._output = output;

        this._trigger = null;

        this._execCache = [];
    }

    get program_id() {
        return this._programId;
    }

    endProgram() {
        if (this._trigger)
            this._trigger.end();
        // otherwise just wait for the query/action to end
    }

    stopTrigger() {
        if (this._trigger)
            this._trigger.stop();
    }

    releaseAll() {
        // nothing to do
    }

    _wrapClearCache(asyncIterable) {
        const self = this;
        return {
            async next() {
                const value = await asyncIterable.next();
                self.clearGetCache();
                return value;
            }
        };
    }

    invokeTimer(base, interval) {
        this._trigger = new Timer(base, interval);
        this._trigger.start();
        return this._wrapClearCache(this._trigger);
    }
    invokeAtTimer(time) {
        this._trigger = new AtTimer(time);
        this._trigger.start();
        return this._wrapClearCache(this._trigger);
    }

    invokeMonitor(kind, attrs, fname, params) {
        this._trigger = new TriggerRunner(this, new DeviceView(kind, attrs), fname, params);
        this._trigger.start();
        return this._wrapClearCache(this._trigger);
    }

    _findInCache(kindKey, fnameKey, params) {
        for (let cached of this._execCache) {
            let [kind, fname, cachedparams, result] = cached;
            if (kind === kindKey && fname === fnameKey &&
                ThingTalk.Builtin.equality(cachedparams, params))
                return result;
        }
        return null;
    }
    clearGetCache() {
        this._execCache = [];
    }

    _getDevices(kind, attrs) {
        const deviceView = new DeviceView(this.engine.devices, kind, attrs);
        deviceView.start();
        const devices = deviceView.values();
        deviceView.stop();
        return devices;
    }

    invokeQuery(kind, attrs, fname, params) {
        const cached = this._findInCache(kind, fname, params);
        if (cached)
            return Promise.resolve(cached);

        const devices = this._getDevices(kind, attrs);
        const js_function_name = 'get_' + fname;
        const filter = ThingTalk.Ast.BooleanExpression.True;

        const list = Promise.all(devices.map((d) =>
            safeInvoke(d[js_function_name](params, filter))
        )).then((results) => {
            // TODO make this streaming

            let list = [];
            results.forEach((result, i) => {
                let device = devices[i];
                let outputType = device.kind + ':' + fname;
                for (let element of result) {
                    extendParams(element, params);
                    list.push([outputType, element]);
                }
            });
            return list;
        });
        // cache now, rather than when the query completes, because ThingTalk might
        // invoke multiple queries in parallel
        this._execCache.push([kind, fname, params, list]);
        return list;
    }

    readState(stateId) {
        return this.app.readState(stateId);
    }
    writeState(stateId, state) {
        return this.app.writeState(stateId);
    }

    invokeAction(kind, attrs, fname, params) {
        const devices = this._getDevices(kind, attrs);
        const js_function_name = 'do_' + fname;
        return Promise.all(devices.map((d) => d[js_function_name](params, this)));
    }

    /* TODO sql
    _acquirePreparedQuery(qid) {
        const query = this._sqlStatements[qid];
        console.log(`command`, query);

        if (!this._preparedSqlStatements[qid])
            this._preparedSqlStatements[qid] = new TimedReference(30000, false, (stmt) => Q.ninvoke(stmt, 'finalize'));

        return this._preparedSqlStatements[qid].acquire(() =>
            this.engine.memory.prepare(query));
    }

    invokeMemoryQuery(query, binders) {
        console.log('query', query, binders);
        return this._acquirePreparedQuery(query).then((stmt) => {
            let timedRef = this._preparedSqlStatements[query];

            const iterator = new AsyncQueue();
            stmt.each(binders, (err, row) => {
                if (err)
                    iterator.cancelWait(err);
                else
                    iterator.push({ done: false, value: row });
            }, (err, numrows) => {
                timedRef.release();

                if (err)
                    iterator.cancelWait(err);
                else
                    iterator.push({ done: true });
            });

            return ({
                [Symbol.iterator]() {
                    return iterator;
                }
            });
        });
    }*/

    sendEndOfFlow(principal, flow) {
        return this.engine.remote.sendEndOfFlow(principal, this.program_id, flow);
    }

    get icon() {
        return this.app.icon;
    }

    reportError(message, error) {
        console.error(message, error);
        this.app.error = error;
        return this._output.error(this.icon, error);
    }

    output(outputType, outputValues) {
        return this._output.output(this.icon, outputType, outputValues);
    }

    say(message) {
        return this._output.say(this.icon, message);
    }

    askQuestion(type, question) {
        return this._output.question(this.icon, type, question);
    }
};
