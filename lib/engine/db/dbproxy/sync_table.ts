// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as Tp from 'thingpedia';
import { SyncRecord, SyncAtReply } from '..';

type Field<RowType> = Exclude<keyof RowType & string, "uniqueId">;

export default class SyncTable<RowType> {
    name : string;
    fields : ReadonlyArray<Field<RowType>>;

    private _baseUrl : string;
    private _auth : string|undefined;

    constructor(name : string, baseUrl : string, accessToken : string|undefined, fields : ReadonlyArray<Field<RowType>>) {
        this.name = name;
        this.fields = fields;
        this._baseUrl = baseUrl;
        this._auth = accessToken !== undefined ? `Bearer ${accessToken}` : undefined;
    }

    async getAll() : Promise<RowType[]> {
        const resp = await Tp.Helpers.Http.get(`${this._baseUrl}/synctable/user_${this.name}`, { auth: this._auth });
        return JSON.parse(resp)['data'];
    }

    async getOne(uniqueId : string) : Promise<RowType|undefined> {
        try {
            const resp = await Tp.Helpers.Http.get(`${this._baseUrl}/synctable/user_${this.name}/${encodeURIComponent(uniqueId)}`, { auth: this._auth });
            return JSON.parse(resp)['data'];
        } catch(err) {
            if (err.code === 404)
                return undefined;
            throw err;
        }
    }

    async getRaw() : Promise<Array<SyncRecord<RowType>>> {
        const resp = await Tp.Helpers.Http.get(`${this._baseUrl}/synctable/raw/user_${this.name}`, { auth: this._auth });
        return JSON.parse(resp)['data'];
    }

    async getChangesAfter(lastModified : number) : Promise<Array<SyncRecord<RowType>>> {
        const resp = await Tp.Helpers.Http.get(`${this._baseUrl}/synctable/changes/user_${this.name}/${lastModified}`, { auth: this._auth });
        return JSON.parse(resp)['data'];
    }

    async handleChanges(changes : Array<SyncRecord<RowType>>) : Promise<boolean[]> {
        const resp = await Tp.Helpers.Http.post(`${this._baseUrl}/synctable/changes/user_${this.name}`,
            JSON.stringify(changes), { dataContentType: 'application/json', auth: this._auth });
        return JSON.parse(resp)['data'];
    }

    async syncAt(lastModified : number, pushedChanges : Array<SyncRecord<RowType>>) : Promise<SyncAtReply<RowType>> {
        const resp = await Tp.Helpers.Http.post(`${this._baseUrl}/synctable/sync/user_${this.name}/${lastModified}`,
            JSON.stringify(pushedChanges), { dataContentType: 'application/json', auth: this._auth });
        return JSON.parse(resp)['data'];
    }

    async replaceAll(data : Array<SyncRecord<RowType>>) : Promise<void> {
        await Tp.Helpers.Http.post(`${this._baseUrl}/synctable/replace/user_${this.name}/`,
            JSON.stringify(data), { dataContentType: 'application/json', auth: this._auth });
    }

    async insertIfRecent(uniqueId : string, lastModified : number, row : Omit<RowType, "uniqueId">) : Promise<boolean> {
        const resp = await Tp.Helpers.Http.post(`${this._baseUrl}/synctable/user_${this.name}/${encodeURIComponent(uniqueId)}/${lastModified}`,
            JSON.stringify(row), { dataContentType: 'application/json', auth: this._auth });
        return JSON.parse(resp)['data'];
    }

    async insertOne(uniqueId : string, row : Omit<RowType, "uniqueId">) : Promise<number> {
        const resp = await Tp.Helpers.Http.post(`${this._baseUrl}/synctable/user_${this.name}/${encodeURIComponent(uniqueId)}`,
            JSON.stringify(row), { dataContentType: 'application/json', auth: this._auth });
        return JSON.parse(resp)['data'];
    }

    async deleteIfRecent(uniqueId : string, lastModified : number) : Promise<boolean> {
        const resp = await Tp.Helpers.Http.request(`${this._baseUrl}/synctable/user_${this.name}/${encodeURIComponent(uniqueId)}/${lastModified}`,
            'DELETE', null, { auth: this._auth });
        return JSON.parse(resp)['data'];
    }

    async deleteOne(uniqueId : string) : Promise<number> {
        const resp = await Tp.Helpers.Http.request(`${this._baseUrl}/synctable/user_${this.name}/${encodeURIComponent(uniqueId)}`,
            'DELETE', null, { auth: this._auth });
        return JSON.parse(resp)['data'];
    }
}
