// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2017 Silei Xu <silei@cs.stanford.edu>
//
// See COPYING for details
const events = require('events');
const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-adapter-node-websql'));
PouchDB.plugin(require('pouchdb-find'));

module.exports = class iBase extends events.EventEmitter {
    constructor(path) {
        super();
        this._path = path;
        this._db = new PouchDB(this._path, {adapter: 'websql'});
    }

    showAll() {
        this._db.allDocs({include_docs: true}, (err, doc) => {
            doc.rows.forEach((row) => {
                console.log(row.id);
                console.log(row.doc);
            });
        });
    }

    insertOne(record) {
        this._db.put(record);
        this.emit('new-record', record);
    }

    _getRecords(field, field_type, filters, time_start=new Date(2000, 1, 1), time_end=new Date(), reduction) {
        let selector = {};
        if (field) {
            selector[field] = {$exists: true};
            if (field_type)
                selector[field]['$type'] = field_type;
        }
        if (filters)
            filters.forEach((filter) => {
                selector[filter.field] = {$exists: true, [filter.op]: filter.value}
            })
        return this._db.find({
            selector: selector
        }).then(reduction).catch((e) => {
            console.log(e.stack);
        });
    }

    _getAggregation(field, field_type, time_start=new Date(2000, 1, 1), time_end=new Date(), aggregation) {
        return this._db.find({
            selector: {
                [field]: {$exists: true, $type: field_type},
                'timestamp': {$gt: time_start, $lt: time_end}
            }
        }).then(aggregation).catch((e) => {
            console.log(e.stack);
        })
    }

    query(field, field_type, filters, time_start, time_end) {
        return this._getRecords(field, field_type, filters, time_start, time_end, function(res) {
            return res.docs.map((doc) => doc[field]);
        });
    }

    getCount(filters, time_start, time_end) {
        return this._getRecords(null, null, filters, time_start, time_end, function(res) {
            return res.docs.length;
        });
    }


    getMax(field, time_start, time_end) {
        return this._getAggregation(field, 'number', time_start, time_end, function(res) {
            if (res.docs.length === 0) return null;
            let max = Number.MIN_SAFE_INTEGER;
            res.docs.forEach((doc)=> {
                if (doc[field] > max)
                    max = doc[field];
            });
            return max;
        });
    }

    getMin(field, time_start, time_end) {
        return this._getAggregation(field, 'number', time_start, time_end, function(res) {
            if (res.docs.length === 0) return null;
            let min = Number.MAX_SAFE_INTEGER;
            res.docs.forEach((doc)=> {
                if (doc[field] < min)
                    min = doc[field];
            });
            return min;
        });
    }

    getArgmax(field, select, time_start, time_end) {
        return this._getAggregation(field, 'number', time_start, time_end, function(res) {
            if (res.docs.length === 0) return [];
            let max = Number.MIN_SAFE_INTEGER;
            let records = [];
            res.docs.forEach((doc)=> {
                if (doc[field] >= max) {
                    if (max === doc[field])
                        records.push(doc);
                    else {
                        max = doc[field];
                        records = [doc];
                    }
                }
            });
            if (!select) return records;
            return records.map(record => record[select]);
        });
    }

    getArgmin(field, select, time_start, time_end) {
        return this._getAggregation(field, 'number', time_start, time_end, function(res) {
            if (res.docs.length === 0) return [];
            let min = Number.MAX_SAFE_INTEGER;
            let records = [];
            res.docs.forEach((doc)=> {
                if (doc[field] <= min) {
                    if (min === doc[field])
                        records.push(doc);
                    else {
                        min = doc[field];
                        records = [doc];
                    }
                }
            });
            if (!select) return records;
            return records.map(record => record[select]);
        });
    }

    getSum(field, time_start, time_end) {
        return this._getAggregation(field, 'number', time_start, time_end, function(res) {
            if (res.docs.length === 0) return null;
            let records = []
            res.docs.forEach((doc)=> {
                records.push(doc[field]);
            });
            return records.reduce((a, b) => a + b);
        });
    }

    getAvg(field, time_start, time_end) {
        return this._getAggregation(field, 'number', time_start, time_end, function(res) {
            if (res.docs.length === 0) return null;
            let records = []
            res.docs.forEach((doc)=> {
                records.push(doc[field]);
            });
            return records.reduce((a, b) => a + b) / records.length;
        });
    }

    destroy() {
        this._db.destroy();
    }
}
