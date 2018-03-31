// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 The Board of Trustees of the Leland Stanford Junior University
//
// Author: Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
"use strict";

const events = require('events');
const Q = require('q');
const assert = require('assert');
const ThingTalk = require('thingtalk');

const sql = require('./sqlite');
const AsyncQueue = require('../util/async_queue');

const prefix = 'memory_';

module.exports = class Memory extends events.EventEmitter {
    constructor(platform, engine) {
        super();
        this._engine = engine;
        this._versions = {};
        this._db = sql.db(platform.getSqliteDB(), platform.getSqliteKey());
        this._remote = null;

        this._remoteTableCache = new Map;
    }

    setRemote(remote) {
        this._remote = remote;
    }

    start() {
        return this._ensureConsistency().then(() => {
            return this._initVersions();
        });
    }

    stop() {
        return Q();
    }

    _getRemoteSchema(table, principal) {
        if (this._remote === null)
            return Q.reject(new Error('Communication is disabled in this ThingEngine'));

        let cacheKey = principal + ':' + table;
        let cached = this._remoteTableCache.get(cacheKey);
        if (cached)
            return cached;

        let request = this._remote.getTableSchemaRemote(principal, table);
        this._remoteTableCache.set(cacheKey, request);
        request.catch((e) => {
            this._remoteTableCache.delete(cacheKey);
        });
        return request;
    }

    getSchema(table, principal) {
        if (principal !== null)
            return this._getRemoteSchema(table, principal);

        return this._db.withClient((client) => {
            return sql.selectOne(client, `select args, types from ${prefix}table_meta where name = ?`, [prefix+table]).then((row) => {
                if (!row)
                    return null;
                let schema = {};
                schema.args = this._toArray(row.args);
                schema.types = this._toArray(row.types).map((t) => ThingTalk.Type.fromString(t));
                return schema;
            });
        }).catch((e) => {
            console.log('Failed to retrieve schema of table ' + table);
            console.log(e.stack);
            return null;
        });
    }

    prepare(sql) {
        return this._db.withClient((client) => {
            return new Promise((resolve, reject) => {
                const stmt = client.prepare(sql, (err) => {
                    if (err)
                        reject(err);
                    else
                        resolve(stmt);
                });
            });
        });
    }

    get(table, version, cols, filters, aggregation) {
        return this._db.withClient((client) => {
            const command = this._genCommand(table, version, cols, filters, aggregation);
            console.log(`command`, command);

            const iterator = new AsyncQueue();
            client.each(command, (err, row) => {
                if (err) {
                    iterator.cancelWait(err);
                } else {
                    let result_list = Object.keys(row).map((k) => row[k]);
                    iterator.push({ done: false, value: [null, null, result_list] });
                }
            }, (err, numrows) => {
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

    _genCommand(table, version, cols, filters, aggregation) {
        let where = '';
        if (version) {
            let v = ThingTalk.Ast.Value.Number(version);
            let vfilter = ThingTalk.Ast.BooleanExpression.Atom(ThingTalk.Ast.Filter('_id', '<=', v));
            filters = ThingTalk.Ast.BooleanExpression.And([filters, vfilter]);
        }
        let parsed = this._filterParser(filters);
        if (parsed.length > 0)
            where += `where ${parsed} `;
        if (!aggregation)
            return this._queryCommand(table, cols, where);
        else if (aggregation.type.startsWith('argm'))
            return this._queryArgm(table, cols, aggregation, where);
        else
            return this._queryAggregation(table, aggregation, where);
    }

    _queryCommand(table, cols, where) {
        return `select ${cols.length ? cols.join(', ') : '*'} from "${prefix+table}" ${where}`;
    }

    _queryAggregation(table, aggregation, where) {
        return `select ${aggregation.type}(${aggregation.field}) from "${prefix+table}" ${where}`;
    }

    _queryArgm(table, cols, aggregation, where) {
        aggregation.type = aggregation.type.substring('arg'.length);
        if (aggregation.count) {
            let order = (aggregation.type === 'max') ? 'desc' : 'asc';
            where += `order by ${aggregation.field} ${order} limit ${aggregation.count}`;
        } else {
            let subquery = this._queryAggregation(table, aggregation, where);
            if (where)
                where += `and ${aggregation.field} = (${subquery}) `;
            else
                where += `where ${aggregation.field} = (${subquery}) `;
        }
        return this._queryCommand(table, cols, where);
    }

    _filterParser(expr) {
        if (!expr || expr.isTrue || (expr.isAnd && expr.operands.length === 0)) return '1'; //always true
        if (expr.isFalse || (expr.isOr && expr.operands.length === 0)) return '0'; //always false
        if ((expr.isAnd || expr.isOr) && expr.operands.length === 1) return this._filterParser(expr.operands[0]);
        if (expr.isAnd)
            return '(' + expr.operands.map(this._filterParser).reduce((x, y) => `${x} and ${y}`) + ')';
        if (expr.isOr)
            return '(' + expr.operands.map(this._filterParser).reduce((x, y) => `${x} or ${y}`) + ')';
        if (expr.isNot)
            return `not (${this._filterParser(expr.expr)})`;
        if (expr.isExternal)
            throw new Error("Not implemented yet.");

        let filter = expr.filter;
        let arg = filter.name;
        let op = filter.operator;
        let value = filter.value;
        switch (op) {
            case '~=': return `lower(${arg}) like "%${value.toLowerCase()}%"`;
            case '=~': return `instr("${value.toLowerCase()}", lower(${arg})) > 0`;
            case 'starts_with': return `lower(${arg}) like "${value.toLowerCase()}%"`;
            case 'ends_with': return `lower(${arg}) like "%${value.toLowerCase()}"`;
            case 'prefix_of':
                return `substr(${value.toLowerCase()}, 0, len(${arg})) = ${arg}`;
                //return `instr("${value.toLowerCase()}", lower(${arg})) = 1`;
            case 'suffix_of':
                return `substr(${value.toLowerCase()}, ${value.length} - len(${arg}), len(${arg})) = ${arg}`;
            // TODO: handle arrays by joins
            case 'contains':
            case 'in_array':
            case 'has_member':
            case 'group_member': throw new Error('Not supported operator in memory: ' + op);
            default:
                return `${arg} ${op} "${value.toJS()}"`;
        }
    }

    getVersion(table) {
        return this._versions[prefix+table];
    }

    insertOne(table, versions, data) {
        return this._db.withTransaction((client) => {
            for (let dependent in versions) {
                if (this._versions[prefix+dependent] > versions[dependent])
                    return false;
            }

            let row;
            if (data.length > 0)
                row = `null, datetime("now"), ${data.map(() => '?').join(',')}`;
            else
                row = `null, datetime("now")`;
            return sql.insertOne(client, `insert into "${prefix+table}" values (${row})`, data).then((lastId) => {
                if (lastId) {
                    this._versions[prefix + table] = lastId;
                    this._newRecordAdded(table, lastId, data);
                }
                return true;
            });
        });
    }

    deleteTable(name) {
        return this._db.withTransaction((client) => {
            return sql.drop(client, `drop table if exists ${prefix+name};`);
        });
    }

    hasTable(name) {
        return this._db.withClient((client) => {
            if (!name.startsWith('sqlite_')) name = prefix + name;
            return sql.selectOne(client, `select 1 from sqlite_master where type="table" and name="${name}"`);
        });
    }

    createTable(name, args, types) {
        assert(args.length === types.length);
        return this._db.withTransaction((client) => {
            let schema = '';
            let sqlite_types = types.map((type) => this._transferTypes(type));
            args.forEach((name, i) => {
                schema += `, ${name} ${sqlite_types[i]}`;
            });
            sql.create(client, `create table if not exists "${prefix+name}" (_id integer primary key autoincrement, _timestamp datetime ${schema})`);
            sql.insertOne(client, `insert into ${prefix}table_meta values (?, ?, ?)`, [prefix+name, this._toString(args), this._toString(types)]);
        }).catch((e) => {
            console.log('Failed to create new table: ' + name);
            console.log(e.stack);
        });
    }

    _newRecordAdded(table, version, data) {
        this.emit('new-record-added', table, version, data);
    }

    _transferTypes(type) {
        // transfer ThingTalk.Type to SQLite affinity names
        if (type.isBoolean) return 'boolean';
        if (type.isNumber) return 'real';
        if (type.isDate) return 'datetime';
        if (type.isTime) return 'time';
        return 'text';
    }

    _toValue(str) {
        //TODO: from string to Ast.Value
    }

    _toString(arr) {
        //TODO: from Ast.Value to string
        return arr.join(" ");
    }

    _toArray(str) {
        if (!str)
            return [];
        return str.split(" ");
    }

    _initVersions() {
        this._versions = {};
        return this._db.withClient((client) => {
            return sql.selectAll(client, `select name, seq from sqlite_sequence where name like "${prefix}%"`).then((rows) => {
                rows.forEach((row) => {
                    this._versions[row.name] = row.seq;
                });
            });
        }).catch((e) => {
            // if we have no tables, sqlite will not have a sqlite_sequence table yet
            // eat the error in that case
            if (e.message === 'SQLITE_ERROR: no such table: sqlite_sequence')
                return;
            console.log('Failed to retrieve versions: ' + e);
            console.log(e.stack);
        });
    }

    _ensureConsistency() {
        return this._db.withTransaction((client) => {
            return sql.selectAll(client, `select name from ${prefix}table_meta`).then((rows) => {
                if (rows.length === 0)
                    return Q();
                let tables_in_meta = rows.map((row) => row.name);
                return this.hasTable('sqlite_sequence').then((exist) => {
                    if (exist) {
                        return sql.selectAll(client, `select name from sqlite_sequence where name like "${prefix}%"`).then((rows) => {
                            let tables_created = rows.map((row) => row.name);
                            tables_in_meta.forEach((t) => {
                                if (tables_created.indexOf(t) === -1)
                                    sql.drop(client, `delete from ${prefix}table_meta where name = ${t}`);
                            });
                        });
                    } else {
                        return sql.drop(client, `delete from ${prefix}table_meta`);
                    }
                });


            });
        });
    }

};
