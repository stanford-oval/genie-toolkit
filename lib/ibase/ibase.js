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

function viewByTime(doc) {
    if(doc.timestamp) {
        emit(doc.timestamp);
    }
}

module.exports = class iBase extends events.EventEmitter {
    constructor(path) {
        super();
        this._size_cap = 10;
        this._period = 24 * 60 * 60;
        this._strategy_type = {'FIFO': 0, 'LRU': 1,'LFU': 2};
        this._strategy = this._strategy_type.FIFO;
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

    query(field, value) {
        return this._db.find({
            selector: {[field]: value}
        }).then((res) => {
            return res;
        }).catch((err) => {
            console.log(err);
        });
    }

    _getAggregation(field, time_start, time_end, aggregation) {
        if (!time_start)
            time_start = new Date(2000, 1, 1);
        if (!time_end)
            time_end = new Date();
        return this._db.find({
            selector: {
                [field]: {$exists: true},
                'timestamp': {$gt: time_start, $lt: time_end}
            }
        }).then(aggregation).catch((err) => {
            console.log(err);
        })
    }


    getMax(field, time_start, time_end) {
        return this._getAggregation(field, time_start, time_end, function(res) {
            if (res.docs.length === 0) return null;
            let max = Number.MIN_SAFE_INTEGER;
            res.docs.forEach((doc)=> {
                if (typeof(doc[field]) === 'number' && doc[field] > max)
                    max = doc[field];
            })
            if (max === Number.MIN_SAFE_INTEGER) return null;
            return max;
        });
    }

    getMin(field, time_start, time_end) {
        return this._getAggregation(field, time_start, time_end, function(res) {
            if (res.docs.length === 0) return null;
            let min = Number.MAX_SAFE_INTEGER;
            res.docs.forEach((doc)=> {
                if (typeof(doc[field]) === 'number' && doc[field] < min)
                    min = doc[field];
            })
            if (min === Number.MIN_SAFE_INTEGER) return null;
            return min;
        });
    }

    getArgMax(field, time_start, time_end, select) {
        return this._getAggregation(field, time_start, time_end, function(res) {
            if (res.docs.length === 0) return [];
            let max = Number.MIN_SAFE_INTEGER;
            let records = [];
            res.docs.forEach((doc)=> {
                if (typeof(doc[field]) === 'number' && doc[field] >= max) {
                    if (max === doc[field])
                        records.push(doc);
                    else {
                        max = doc[field];
                        records = [doc];
                    }
                }
            })
            if (max === Number.MIN_SAFE_INTEGER) return [];
            if (!select) return records;
            return records.map(record => record[select]);
        });
    }

    getArgMin(field, time_start, time_end, select) {
        return this._getAggregation(field, time_start, time_end, function(res) {
            if (res.docs.length === 0) return [];
            let min = Number.MAX_SAFE_INTEGER;
            let records = [];
            res.docs.forEach((doc)=> {
                if (typeof(doc[field]) === 'number' && doc[field] <= min) {
                    if (min === doc[field])
                        records.push(doc);
                    else {
                        min = doc[field];
                        records = [doc];
                    }
                }
            })
            if (min === Number.MAX_SAFE_INTEGER) return [];
            if (!select) return records;
            return records.map(record => record[select]);
        });
    }

    getCount() {

    }

    getDiskUsage() {
        //TODO: take into record size into consideration in caching strategy
    }

    getSize() {
        return this._db.info().then((info) => {
            return info.doc_count;
        })
    }

    destroy() {
        this._db.destroy();
    }

    _maintain() {
        this.getSize(). then((size) => {
            if (size > this._size_cap)
                switch (this._strategy) {
                    case this._strategy_type.FIFO:
                        this._fifo(size);
                        break;
                    case this._strategy_type.LRU:
                        this._lru(size);
                        break;
                    case this._strategy_type.LFU:
                        this._lfu(size);
                        break;
                    default:
                        throw new Error('Not supported database maintainance strategy');
                }
        })
    }

    _fifo(size) {
        this._db.query(viewByTime, { limit: size }).then((res) => {
            res.rows.forEach((row) => {
                this._db.remove(row.id);
            });
        }).catch((err) => {
            console.log(err);
        })
    }

    _lru(size) {
        throw new Error('Not implemented yet');
    }

    _lfu(size) {
        throw new Error('Not implemented yet');
    }

    _updateMeta() {
        //TODO: update metadata of a record after query, e.g., last_queried_time, count, etc.
    }

    syncDB() {
        throw new Error('Not implemented yet');
    }
}
