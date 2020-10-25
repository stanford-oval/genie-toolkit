// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
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


import * as events from 'events';
import * as uuid from 'uuid';
import * as ThingTalk from 'thingtalk';

import { getProgramIcon } from '../../utils/icons';

import AppSql from '../db/app';
import AppExecutor from './app_executor';

/**
 * The collection of all running and configured ThingTalk programs.
 */
export default class AppDatabase extends events.EventEmitter {
    /**
     * Construct the app database for this engine.
     *
     * There is only one app database instance per engine,
     * and it is accessible as {@link Engine#apps}.
     * @package
     */
    constructor(engine) {
        super();

        this._apps = {};

        this._engine = engine;
        this._platform = engine.platform;
        this._db = new AppSql(engine.platform);
    }

    _getAll() {
        return this._db.getAll();
    }

    _insertOne(uniqueId, row) {
        return this._db.insertOne(uniqueId, row);
    }

    _deleteOne(uniqueId) {
        return this._db.deleteOne(uniqueId);
    }

    async _doStartApp(app, isNewApp) {
        try {
            if (isNewApp)
                await app.runCommand();
            // only start and save into db apps that actually have some rules
            if (app.rules.length > 0) {
                this._enableApp(app);
                if (isNewApp)
                    await this._saveApp(app);
            } else {
                await this._removeAppInternal(app.uniqueId);
            }
        } catch(e) {
            if (e.code === 'ECANCELLED')
                return;
            console.error('Failed to add app: ' + e);
            console.error(e.stack);
            app.notifyError(e);
        }
    }

    async createApp(program, options = {}) {
        const uniqueId = options.uniqueId || 'uuid-' + uuid.v4();

        const gettext = this._platform.getCapability('gettext');
        const describer = new ThingTalk.Describe.Describer(gettext, this._platform.locale, this._platform.timezone);
        const name = options.name || ThingTalk.Describe.getProgramName(gettext, program);
        delete options.name;
        const description = options.description || describer.describeProgram(program);
        delete options.description;
        options.icon = options.icon || getProgramIcon(program);

        return this._loadOneApp(program.prettyprint(), options, uniqueId, name, description, true);
    }

    async _loadOneApp(code, metadata, uniqueId, name, description, isNewApp) {
        const app = new AppExecutor(this._engine, code, metadata, name, description);
        try {
            this._addAppInternal(app, uniqueId);

            await app.compile();

            // run the rest of app loading asynchronously
            this._doStartApp(app, isNewApp);
        } catch(e) {
            console.error('Failed to add app: ' + e);
            app.reportError(e);
            this._removeAppInternal(app.uniqueId);
            if (!isNewApp)
                await this._deleteOne(uniqueId);
        }

        return app;
    }

    start() {
        return this._getAll().then((rows) => Promise.all(rows.map((row) => {
            const code = row.code;
            const metadata = JSON.parse(row.state);
            return this._loadOneApp(code, metadata, row.uniqueId, row.name, row.description, false);
        })));
    }

    stop() {
        return Promise.resolve();
    }

    async _removeAppInternal(uniqueId) {
        let app = this._apps[uniqueId];
        delete this._apps[uniqueId];

        if (app !== undefined) {
            this.emit('app-removed', app);
            try {
                await app.destroy();
            } catch(e) {
                console.error('Failed to destroy app ' + uniqueId + ': ' + e.message);
            }
        }
    }

    _addAppInternal(app, uniqueId) {
        if (app.uniqueId === undefined) {
            app.uniqueId = uniqueId;
        } else {
            if (uniqueId !== undefined && app.uniqueId !== uniqueId)
                throw new Error('App unique id is different from stored value');
        }

        if (this._apps[app.uniqueId])
            throw new Error('Multiple apps with the same ID, delete one first');
        this._apps[app.uniqueId] = app;
    }

    _enableApp(app) {
        app.isEnabled = true;
        this.emit('app-added', app);
    }

    _saveApp(app) {
        return this._insertOne(app.uniqueId, {
            state: JSON.stringify(app.metadata),
            code: app.code,
            name: app.name,
            description: app.description
        });
    }

    removeApp(app) {
        return this._removeAppInternal(app.uniqueId).then(() => {
            return this._deleteOne(app.uniqueId);
        });
    }

    getAllApps() {
        let apps = [];
        for (let id in this._apps)
            apps.push(this._apps[id]);
        return apps;
    }

    getApp(id) {
        return this._apps[id];
    }

    hasApp(id) {
        return this._apps[id] !== undefined;
    }
}
