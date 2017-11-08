const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-adapter-node-websql'));

function viewByTime(doc) {
    if(doc.date) {
        emit(doc.date);
    }
}

module.exports = class iBase {
    constructor(path) {
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

    maintain() {
        this.getSize(). then((size) => {
            if (size > this._size_cap)
                switch (this._strategy) {
                    case this._strategy_type.FIFO:
                        this.fifo(size);
                        break;
                    case this._strategy_type.LRU:
                        this.lru(size);
                        break;
                    case this._strategy_type.LFU:
                        this.lfu(size);
                        break;
                    default:
                        throw new Error('Not supported database maintainance strategy');
                }
        })
    }

    fifo(size) {
        this._db.query(viewByTime, { limit: size }).then((res) => {
            res.rows.forEach((row) => {
                this._db.remove(row.id);
            });
        }).catch((err) => {
            console.log(err);
        })
    }

    lru(size) {
        throw new Error('Not implemented yet');
    }

    lfu(size) {
        throw new Error('Not implemented yet');
    }

    syncDB() {
        throw new Error('Not implemented yet');
    }
}
