// -*- mode: typescript; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of Genie
//
// Copyright 2020-2021 The Board of Trustees of the Leland Stanford Junior University
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

import * as sqlite3 from 'sqlite3';

import DatabaseSchema from './schema.json';
import * as sql from '.';

export function initializeDB(platform : sql.SQLitePlatform) {
    const filename = platform.getSqliteDB();
    const key = platform.getSqliteKey();
    const prefs = platform.getSharedPreferences();
    prefs.set('sqlite-schema-version', currentVersion);

    const db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE);
    return new Promise<void>((resolve, reject) => {
        db.on('error', (err) => {
            console.error('Failed to initialize DB schema', err);
            reject(err);
        });
        db.serialize(() => {
            if (key) {
                console.log('Initializing key in Sqlite DB');
                db.run(sql.makeKeyPragma(key));
            }
            db.run('PRAGMA journal_mode=WAL');
            db.exec(DatabaseSchema);
        });
        db.close((err) => {
            if (!err)
                resolve();
        });
    });
}

const MIGRATIONS = [
function migrateTo1(db : sqlite3.Database) {
    db.serialize(() => {
        // we used to create a table called `keyword` here, we no longer do that
        db.run('drop table if exists channel');
        db.run('create table channel (uniqueId varchar(255) primary key, value text default null)');
    });
},
function migrateTo2(db : sqlite3.Database) {
    // we used to create a the permission tables here, we no longer do that
},
function migrateTo3(db : sqlite3.Database) {
    // we used to create a the permission tables here, we no longer do that
},
function migrateTo4(db : sqlite3.Database) {
    // we used to create a the permission tables here, we no longer do that
},
function migrateTo5(db : sqlite3.Database) {
    // we used to create the matrix tables here, we do not do that
},
function migrateTo6(db : sqlite3.Database) {
    // we uses to create the matrix tables here, we do not do that
},
function migrateTo7(db : sqlite3.Database) {
    // nothing to do, just bump the version number...
},
function migrateTo8(db : sqlite3.Database) {
    // we used to create a table called `memory_table_meta` here, we no longer do that
},
function migrateTo9(db : sqlite3.Database) {
    db.serialize(() => {
        // we used to create a table called `keyword` here, we no longer do that
        db.run('drop table if exists conversation');
        db.run('create table conversation (' +
               'uniqueId varchar(255) primary key, ' +
               'conversationId varchar(255), ' +
               'previousId varchar(255), ' +
               'dialogueId varchar(255), ' +
               'context text default null, ' +
               'agent text default null, ' +
               'agentTimestamp text default null, ' +
               'agentTarget text default null, ' +
               'intermediateContext text default null, ' +
               'user text default null, ' +
               'userTimestamp text default null, ' +
               'userTarget text default null, ' +
               'vote text default null, ' +
               'comment text default null)');
    });
},
function migrateTo10(db : sqlite3.Database) {
    // empty; it used to contain a buggy migration
    // we need to skip this number so people who already
    // migrated will migrate again to a working db
},
function migrateTo11(db : sqlite3.Database) {
    db.serialize(() => {
        db.run('drop table if exists conversation_state');
        db.run('create table conversation_state (' +
            'uniqueId varchar(255) primary key, ' +
            'history text default null, ' +
            'dialogueState text default null, ' +
            'lastMessageId int(11) default null)');
    });
},
function migrateTo12(db : sqlite3.Database) {
    db.serialize(() => {
        db.run('drop table if exists conversation_history');
        db.run(`create table conversation_history (
            uniqueId varchar(255) primary key,
            conversationId varchar(255) not null,
            messageId int(11) not null,
            message text not null
        )`);
        db.run(`create unique index conversation_history_messageId on
                conversation_history(conversationId, messageId)`);

        // sqlite doesn't support dropping columns
        //db.run(`alter table conversation_state drop column history`);
    });
},
function migrateTo13(db : sqlite3.Database) {
    db.serialize(() => {
        db.run('alter table conversation_state add column recording boolean default false');
    });
}];
const currentVersion = MIGRATIONS.length;

export function migrateDB(platform : sql.SQLitePlatform) {
    // cloud migrations are handled out of band
    const filename = platform.getSqliteDB();
    const key = platform.getSqliteKey();
    const prefs = platform.getSharedPreferences();
    let version = prefs.get('sqlite-schema-version') as number|undefined;
    if (version === undefined)
        version = 1;
    if (version === currentVersion)
        return Promise.resolve();
    prefs.set('sqlite-schema-version', currentVersion);

    console.log('Database needs migration...');
    const db = new sqlite3.Database(filename, sqlite3.OPEN_READWRITE);
    return new Promise<void>((callback, errback) => {
        db.on('error', errback);
        if (key)
            db.run(sql.makeKeyPragma(key));
        MIGRATIONS.forEach((migration, migrateTo) => {
            // migrations start at 1 (see above)
            migrateTo = migrateTo+1;
            if (version! < migrateTo)
                migration(db);
        });

        db.close((err) => {
            if (!err)
                console.log('Successfully migrated database to version ' + currentVersion);
            if (err)
                errback(err);
            else
                callback();
        });
    });
}
