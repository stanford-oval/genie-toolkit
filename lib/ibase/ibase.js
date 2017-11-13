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

    _map(cols, filters, reduction) {
        let selector = {};
        cols.forEach((col) => {
            selector[col] = {$exists: true}
        });
        filters.forEach((filter) => {
            selector[filter.field] = {$exists: true, [filter.op]: filter.value}
        });
        return this._db.find({ selector: selector }).then(reduction).catch((e) => {
            console.log('Failed to query the database: ' + e);
            console.log(e.stack);
        });
    }

    query(cols, filters) {
        return this._map(cols, filters, (res) => {
            if (cols.length === 0) return res.docs;
            return res.docs.map((doc) => (
                cols.reduce((selected, col) => (selected[col] = doc[col], selected), {})
            ));
        });
    }

    getCount(filters) {
        return this._map([], filters, (res) => {
            return res.docs.length;
        });
    }

    getMax(field, filters) {
        return this._map([field], filters, (res) => {
            if (res.docs.length === 0) return null;
            return res.docs.map((doc) => (doc[field])).reduce((max, current) => (max > current) ? max : current);
        });
    }

    getMin(field, filters) {
        return this._map([field], filters, (res) => {
            if (res.docs.length === 0) return null;
            return res.docs.map((doc) => (doc[field])).reduce((min, current) => (min < current) ? min : current);
        });
    }

    getSum(field, filters) {
        return this._map([field], filters, (res) => {
            if (res.docs.length === 0) return null;
            return res.docs.map((doc) => (doc[field])).reduce((sum, current) => sum += current);
        });
    }

    getAvg(field, filters) {
        return this._map([field], filters, (res) => {
            if (res.docs.length === 0) return null;
            return res.docs.map((doc) => (doc[field])).reduce((sum, current) => sum += current) / res.docs.length;
        });
    }


    getArgmax(cols, field, filters) {
        if (!(field in cols)) cols.push(field);
        return this._map(cols, filters, (res) => {
            if (res.docs.length === 0) return [];
            let max = Number.MIN_SAFE_INTEGER;
            let records = [];
            res.docs.forEach((doc)=> {
                if (doc[field] >= max)
                    if (max === doc[field]) records.push(doc);
                    else { max = doc[field]; records = [doc]; }
            });
            if (cols.length === 1) return records;
            return records.map((doc) => (
                cols.reduce((selected, col) => (selected[col] = doc[col], selected), {})
            ));
        });
    }

    getArgmin(cols, field, filters) {
        if (!(field in cols)) cols.push(field);
        return this._map(cols, filters, (res) => {
            if (res.docs.length === 0) return [];
            let min = Number.MAX_SAFE_INTEGER;
            let records = [];
            res.docs.forEach((doc)=> {
                if (doc[field] <= min)
                    if (min === doc[field]) records.push(doc);
                    else { min = doc[field]; records = [doc]; }
            });
            if (cols.length === 1) return records;
            return records.map((doc) => (
                cols.reduce((selected, col) => (selected[col] = doc[col], selected), {})
            ));
        });
    }


    destroy() {
        this._db.destroy();
    }
}
