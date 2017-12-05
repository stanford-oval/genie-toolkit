// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const Q = require('q');

const ThingTalk = require('thingtalk');
const ExecEnvironment = ThingTalk.ExecEnvironment;
const TriggerRunner = require('./trigger_runner');

const TimedReference = require('../util/timed_ref');
const AsyncQueue = require('../util/async_queue');
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

module.exports = class ExecWrapper extends ExecEnvironment {
    constructor(engine, app, functions, sqlStatements, output) {
        super(engine.platform.locale, engine.platform.timezone);
        this.engine = engine;
        this.app = app;
        this._programId = new ThingTalk.Entity(this.app.uniqueId, null);
        this._output = output;

        this._functions = functions;
        this._sqlStatements = sqlStatements;
        this._trigger = null;
        this._preparedSqlStatements = new Array(sqlStatements.length);

        this._execCache = [];
    }

    get program_id() {
        return this._programId;
    }

    _acquireFunction(fnid) {
        const fn = this._functions[fnid];
        return new DeviceView(this.engine.devices, fn.selector);
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
        for (let i = 0; i < this._preparedSqlStatements.length; i++) {
            if (this._preparedSqlStatements[i])
                this._preparedSqlStatements[i].releaseNow();
        }
    }

    invokeTimer(base, interval) {
        this._trigger = new Timer(base, interval);
        this._trigger.start();
        return this._trigger;
    }
    invokeAtTimer(time) {
        this._trigger = new AtTimer(time);
        this._trigger.start();
        return this._trigger;
    }
    invokeMonitor(fnid, params) {
        const fn = this._functions[fnid];
        this._trigger = new TriggerRunner(this, this._acquireFunction(fnid), fn.channel, params);
        this._trigger.start();
        return this._trigger;
    }

    _findInCache(fnid, params) {
        const fn = this._functions[fnid];

        for (let cached of this._execCache) {
            let [kind, channel, cachedparams, result] = cached;
            if (kind === fn.selector.kind && channel === fn.channel &&
                ThingTalk.Builtin.equality(cachedparams, params))
                return result;
        }
        return null;
    }

    /* TODO saving
    save(table, versions, data) {
        return this.engine.memory.insertOne(table, versions, data);
    }*/

    /* TODO table versioning
    getTableVersion(table) {
        return Q(this.engine.memory.getVersion(table));
    }*/

    invokeQuery(fnid, params) {
        const cached = this._findInCache(fnid, params);
        if (cached)
            return Q(cached);

        const fn = this._functions[fnid];
        const deviceView = this._acquireFunction(fnid);
        deviceView.start();
        const devices = deviceView.values();
        deviceView.stop();

        const function_name = 'get_' + fn.channel;
        // TODO filters
        const filter = ThingTalk.Ast.BooleanExpression.True;

        return Q.all(devices.map((d) =>
            safeInvoke(d[function_name](params, filter))
        )).then((results) => {
            // TODO make this streaming

            let list = [];
            results.forEach((result, i) => {
                let device = devices[i];
                let outputType = device.kind + ':' + fn.channel;
                for (let element of result)
                    list.push([outputType, device, element]);
            });
            this._execCache.push([fn.selector.kind, fn.channel, params, list]);
            return list;
        });
    }

    invokeAction(fnid, params) {
        const fn = this._functions[fnid];
        const deviceView = this._acquireFunction(fnid);
        deviceView.start();
        const devices = deviceView.values();
        deviceView.stop();

        const function_name = 'do_' + fn.channel;

        return Q.all(devices.map((d) => d[function_name](params)));
    }

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
    }

    sendEndOfFlow(principal, flow) {
        return this.engine.remote.sendEndOfFlow(principal, this.program_id, flow);
    }

    clearGetCache() {
        this._execCache.length = 0;
    }

    get icon() {
        return this.app.icon;
    }

    reportError(message, error) {
        console.error(message);
        this.app.error = error;
        return this._output.error(this.icon, error);
    }

    output(outputType, outputValues, currentChannel) {
        return this._output.output(this.icon, outputType, outputValues, currentChannel);
    }

    say(message) {
        return this._output.say(this.icon, message);
    }

    askQuestion(type, question) {
        return this._output.question(this.icon, type, question);
    }
};
