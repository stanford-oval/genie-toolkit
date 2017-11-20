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
    constructor(platform, engine) {
        super();
        this._engine = engine;
        this._versions = {};
        this._schemas = {};
        this._db = sql.db(platform.getSqliteDB(), platform.getSqliteKey());
    }

    start() {
        return this._ensureConsistency().then(() => {
            this._initVersions().then(() => {this._initSchemas()});
        })
    }

    stop() {
        return Q();
    }

    get versions() {
        return this._versions;
    }

    get schemas() {
        return this._schemas;
    }

    getSchema(table) {
        return this._db.withClient((client) => {
            return sql.selectOne(client, `select args, types from ${prefix}table_meta where name="${table}"`).then((row) => {
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

    getAll(table, version) {
        return this._db.withClient((client) => {
            let where = '';
            if (version) where += `where _id <= ${version}`;
            return sql.selectAll(client, `select * from "${prefix+table}" ${where}`);
        }).catch((e) => {
            console.log('Failed to get data from memory: ' + e);
            console.log(e.stack);
        });
    }

    get(table, version, cols, filters, aggregation) {
        return this._db.withClient((client) => {
            let command = this._genCommand(table, version, cols, filters, aggregation);
            return sql.selectAll(client, command);
        }).catch((e) => {
            console.log('Failed to get data from memory: ' + e);
            console.log(e.stack);
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
            where += `where ${parsed}`;
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
        let subquery = this._queryAggregation(table, aggregation, where);
        if (where)
            where += `and ${aggregation.field} = (${subquery})`;
        else
            where += `where ${aggregation.field} = (${subquery})`;
        return this._queryCommand(table, cols, where);
    }

    _filterParser(expr) {
        if (expr.isTrue || (expr.isAnd && expr.operands.length === 0)) return '_id > -1'; //always true
        if (expr.isFalse || (expr.isOr && expr.operands.length === 0)) return '_id = -1'; //always false
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
                return `substr(${value.toLowerCase()}, ${value.length} - len(${arg}), len(${arg})) = ${arg}`
            // TODO: handle arrays by joins
            case 'contains':
            case 'in_array':
            case 'has_member':
            case 'group_member': throw new Error('Not supported operator in memory: ' + op);
            default:
                return `${arg} ${op} "${value.toJS()}"`;
        }
    }

    _filterCleaning(expr) {
        //TODO: get rid of the True/False in filters
    }

    insertOne(table, data, arg_names, arg_types) {
        if (arg_names && arg_types) {
            return this.createTable(table, arg_names, arg_types).then(() => {
                return this.insertOne(table, data);
            });
        } else {
            return this._db.withClient((client) => {
                let row = `null, datetime("now"), "${data.join('", "')}"`;
                return sql.insertOne(client, `insert into "${prefix+table}" values (${row})`).then((lastId) => {
                    if (lastId)
                        this._versions[prefix+table] = lastId;
                });
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
            return sql.selectOne(client, `select 1 from sqlite_master where type="table" and name="${prefix+name}"`);
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
            sql.create(client, `create table if not exists "${prefix+name}" (_id integer primary key autoincrement, _timestamp datetime ${schema})`);
            sql.insertOne(client, `insert into ${prefix}table_meta values ("${prefix+name}", "${this._toString(args)}", "${this._toString(types)}")`);
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

    _toValue(str) {
        //TODO: from string to Ast.Value
    }

    _toString(arr) {
        //TODO: from Ast.Value to string
        return arr.join(" ");
    }

    _toArray(str) {
        return str.split(" ");
    }

    _initVersions() {
        return this._db.withClient((client) => {
            return sql.selectAll(client, `select name, seq from sqlite_sequence where name like "${prefix}%"`).then((rows) => {
                let versions = {};
                rows.forEach((row) => {
                    versions[row.name] = row.seq;
                });
                this._versions = versions;
            })
        }).catch((e) => {
            console.log('Failed to retrieve versions: ' + e);
            console.log(e.stack);
        });
    }

    _initSchemas() {
        return this._db.withClient((client) => {
            return sql.selectAll(client, `select name, args, types from ${prefix}table_meta`).then((rows) => {
                let schemas = {};
                rows.forEach((row) => {
                    schemas[row.name] = {args: row.args, types: row.types};
                });
                this._schemas = schemas;
            });
        }).catch((e) => {
            console.log('Failed to retrieve schemas: ' + e);
            console.log(e.stack);
        })
    }

    _ensureConsistency() {
        return this._db.withClient((client) => {
            return sql.selectAll(client, `select name from ${prefix}table_meta`).then((rows) => {
                let tables_in_meta = rows.map((row) => row.name);
                this.hasTable('sqlite_sequence').then((exist) => {
                    if (exist) {
                        return sql.selectAll(client, `select name from sqlite_sequence where name like "${prefix}%"`).then((rows) => {
                            let tables_created = rows.map((row) => row.name);
                            tables_created.forEach((t) => {
                                if (tables_in_meta.indexOf(t) === -1) {
                                    t = t.substring(prefix.length);
                                    let [device, channel] = t.split('.');
                                    this._engine.schemas.getMeta(device, 'query', channel).then((meta) => {
                                        this.createTable(t, meta.args, meta.schema);
                                    });
                                }
                            });
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
