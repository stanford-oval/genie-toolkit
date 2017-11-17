// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details

const events = require('events');
const sql = require('./sqlite');
const Q = require('q');
const assert = require('assert');
const ThingTalk = require('thingtalk');

const prefix = 'memory_';

module.exports = class Memory extends events.EventEmitter {
    constructor(platform) {
        super();
        this._db = sql.db(platform.getSqliteDB(), platform.getSqliteKey());
        this._db.withClient((client) => {
            sql.create(client, `create table if not exists ${prefix}table_meta (
                name text primary key, 
                args text,
                types text
            );`);
        });
    }

    get(table, version, cols, filters, aggregation) {
        //TODO: argmax & argmin
        return this._db.withClient((client) => {
            let select = aggregation ? `${aggregation}(${cols.join(", ")})` : `${cols.join(", ")}`
            console.log(select);
            let where = '';
            if (version)
                filters.push({field:'_id', op:'<=', value:version});
            if (filters.length !== 0)
                where += 'where ' + filters.map((f) => `${f.field} ${f.op} ${f.value}`).join(", ");
            console.log(`select ${select} from ${prefix+table} where ${where};`);
            return sql.selectAll(client, `select ${select} from ${prefix+table} ${where};`)
        }).catch((e) => {
            console.log('Failed to get data from memory: ' + e);
            console.log(e.stack);
        });
    }

    getAll(table, version) {
        return this._db.withClient((client) => {
            let where = '';
            if (version) where += `where _id <= ${version}`;
            return sql.selectAll(client, `select * from ${prefix+table} ${where};`);
        }).catch((e) => {
            console.log('Failed to get data from memory: ' + e);
            console.log(e.stack);
        });
    }

    getSchema(table) {
        return this._db.withClient((client) => {
            return sql.selectOne(client, `select args, types from ${prefix}table_meta where name="${table}";`).then((row) => {
                let schema = {};
                schema.args = this._toArray(row.args);
                schema.types = this._toArray(row.types).map((t) => ThingTalk.Type.fromString(t));
                return schema;
            });
        }).catch((e) => {
            console.log('Failed to retrieve schema of table ' + table);
            console.log(e.stack);
        });
    }

    getVersions() {
        return this._db.withClient((client) => {
            return sql.selectAll(client, `select name, seq from sqlite_sequence where name like "${prefix}%"`).then((rows) => {
                let versions = {};
                rows.forEach((row) => {
                    versions[row.name] = row.seq;
                });
                return versions;
            })
        }).catch((e) => {
            console.log('Failed to retrieve versions: ' + e);
            console.log(e.stack);
        });
    }

    insertOne(table, data, arg_names, arg_types) {
        if (arg_names && arg_types) {
            return this.createTable(table, arg_names, arg_types).then(() => {
                return this.insertOne(table, data);
            });
        } else {
            return this._db.withClient((client) => {
                let row = `null, datetime("now"), "${data.join('", "')}"`;
                return sql.insertOne(client, `insert into ${prefix + table} values (${row});`);
            }).catch((e) => {
                console.log("Failed to store the data: " + e);
                console.log(e.stack);
            });
        }
    }

    deleteTable(name) {
        return this._db.withClient((client) => {
            return sql.drop(client, `drop table if exists ${prefix+name};`);
        });
    }

    hasTable(name) {
        return this._db.withClient((client) => {
            return sql.selectOne(client, `select 1 from sqlite_master where type="table" and name="${prefix+name}";`);
        });
    }

    createTable(name, args, types) {
        assert(args.length === types.length);
        return this._db.withTransaction((client) => {
            let schema = '';
            let sqlite_types = types.map((type) => this._transferTypes(type));
            args.forEach((name, i) => {
                schema += `, ${name} ${sqlite_types[i]}`
            });
            sql.create(client, `create table if not exists ${prefix+name} (_id integer primary key autoincrement, _timestamp datetime ${schema});`);
            sql.insertOne(client, `insert into ${prefix}table_meta values ("${name}", "${this._toString(args)}", "${this._toString(types)}");`);
        }).catch((e) => {
            console.log('Failed to create new table: ' + name);
            console.log(e.stack);
        });;
    }

    _transferTypes(type) {
        // transfer ThingTalk.Type to SQLite affinity names
        if (type.isBoolean) return 'boolean';
        if (type.isNumber) return 'real';
        if (type.isDate) return 'datetime';
        if (type.isTime) return 'time';
        return 'text';
    }

    _toString(arr) {
        return arr.join(" ");
    }

    _toArray(str) {
        return str.split(" ");
    }

};