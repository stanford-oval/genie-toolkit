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

import * as Tp from 'thingpedia';
import * as events from 'events';
import * as uuid from 'uuid';
import * as ThingTalk from 'thingtalk';

import { getProgramIcon } from '../../utils/icons';
import { Describer, getProgramName } from '../../utils/thingtalk/describe';
import * as I18n from '../../i18n';

import AppSql from '../db/app';
import AppExecutor from './app_executor';

import type Engine from '../index';

interface AppRow {
    uniqueId : string;
    code : string;
    name : string;
    description : string;
    state : string;
}

interface AppMeta {
    icon ?: string|null;
    conversation ?: string;
    description ?: string;
}

/**
 * The collection of all running and configured ThingTalk programs.
 */
export default class AppDatabase extends events.EventEmitter {
    private _apps : Record<string, AppExecutor>;
    private _engine : Engine;
    private _platform : Tp.BasePlatform;
    private _db : AppSql;

    /**
     * Construct the app database for this engine.
     *
     * There is only one app database instance per engine,
     * and it is accessible as {@link Engine#apps}.
     * @package
     */
    constructor(engine : Engine) {
        super();

        this._apps = {};

        this._engine = engine;
        this._platform = engine.platform;
        this._db = new AppSql(engine.platform);
    }

    private _getAll() : Promise<AppRow[]> {
        return this._db.getAll();
    }

    private _insertOne(row : AppRow) {
        return this._db.insertOne(row.uniqueId, row);
    }

    private _deleteOne(uniqueId : string) {
        return this._db.deleteOne(uniqueId);
    }

    private async _doStartApp(app : AppExecutor, isNewApp : boolean) {
        try {
            if (isNewApp)
                await app.runCommand();
            // only start and save into db apps that actually have some rules
            if (app.hasRule) {
                this._enableApp(app);
                if (isNewApp)
                    await this._saveApp(app);
            } else {
                await this._removeAppInternal(app.uniqueId!);
            }
        } catch(e) {
            if (e.code === 'ECANCELLED')
                return;
            console.error('Failed to add app: ' + e);
            console.error(e.stack);
            app.reportError(e);
        }
    }

    async createApp(program : ThingTalk.Ast.Program, options : {
            uniqueId ?: string;
            name ?: string;
            description ?: string;
            icon ?: string;
            conversation ?: string;
        } = {}) {
        const uniqueId = options.uniqueId || 'uuid-' + uuid.v4();

        const name = options.name || getProgramName(program);
        delete options.name;

        let description = options.description;
        if (!description) {
            // if we don't have a description already, compute one using
            // the Describer
            const allocator = new ThingTalk.Syntax.SequentialEntityAllocator({});
            const describer = new Describer(this._platform.locale, this._platform.timezone, allocator);

            // retrieve the relevant primitive templates
            const kinds = new Set<string>();
            for (const [, prim] of program.iteratePrimitives(false))
                kinds.add(prim.selector.kind);
            for (const kind of kinds)
                describer.setDataset(kind, await this._engine.schemas.getExamplesByKind(kind));

            description = describer.describeProgram(program);

            // apply the usual postprocessing
            const langPack = I18n.get(this._platform.locale);
            // treat it as an agent sentence for purposes of postprocessing
            // (which disables randomization)
            // even though it is a user-side sentence (ie, it says "my")
            description = langPack.postprocessNLG(langPack.postprocessSynthetic(description, program, null, 'agent'), allocator.entities, {
                timezone: this._platform.timezone,
                getPreferredUnit: (type) => {
                    const pref = this._platform.getSharedPreferences();
                    return pref.get('preferred-' + type) as string|undefined;
                }
            });
        }

        delete options.description;
        const icon = options.icon || getProgramIcon(program);
        const conversation = options.conversation;

        return this._loadOneApp(program.prettyprint(), { icon, conversation }, uniqueId, name, description, true);
    }

    private async _loadOneApp(code : string,
                              metadata : AppMeta,
                              uniqueId : string,
                              name : string,
                              description : string,
                              isNewApp : boolean) {
        const app = new AppExecutor(this._engine, code, metadata, name, description);
        try {
            this._addAppInternal(app, uniqueId);

            await app.compile();

            // run the rest of app loading asynchronously
            this._doStartApp(app, isNewApp);
        } catch(e) {
            console.error('Failed to add app: ' + e);
            app.reportError(e);
            this._removeAppInternal(app.uniqueId!);
            if (!isNewApp)
                await this._deleteOne(uniqueId);
        }

        return app;
    }

    async start() {
        await this._getAll().then((rows) => Promise.all(rows.map((row) => {
            const code = row.code;
            const metadata = JSON.parse(row.state);
            return this._loadOneApp(code, metadata, row.uniqueId, row.name, row.description, false);
        })));
    }

    async stop() {
    }

    private async _removeAppInternal(uniqueId : string) {
        const app = this._apps[uniqueId];
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

    private _addAppInternal(app : AppExecutor, uniqueId : string) {
        if (app.uniqueId === undefined) {
            app.uniqueId = uniqueId;
        } else {
            if (uniqueId !== undefined && app.uniqueId !== uniqueId)
                throw new Error('App unique id is different from stored value');
        }

        if (this._apps[app.uniqueId!])
            throw new Error('Multiple apps with the same ID, delete one first');
        this._apps[app.uniqueId!] = app;
    }

    private _enableApp(app : AppExecutor) {
        app.isEnabled = true;
        this.emit('app-added', app);
    }

    private _saveApp(app : AppExecutor) {
        return this._insertOne({
            uniqueId: app.uniqueId!,
            state: JSON.stringify(app.metadata),
            code: app.code,
            name: app.name,
            description: app.description
        });
    }

    async removeApp(app : AppExecutor) {
        await this._removeAppInternal(app.uniqueId!);
        await this._deleteOne(app.uniqueId!);
    }

    getAllApps() : AppExecutor[] {
        const apps = [];
        for (const id in this._apps)
            apps.push(this._apps[id]);
        return apps;
    }

    getApp(id : string) : AppExecutor|undefined {
        return this._apps[id];
    }

    hasApp(id : string) : boolean {
        return this._apps[id] !== undefined;
    }
}
