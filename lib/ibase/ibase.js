const PouchDB = require('pouchdb');
PouchDB.plugin(require('pouchdb-adapter-node-websql'));

module.exports = class iBase {
    constructor() {
        this._db = new PouchDB('ibase.db', {adapter: 'websql'});
    }

    showAll() {
        this._db.allDocs({include_docs: true}, function(err, doc) {
            doc.rows.forEach((row) => {
                console.log(row.id);
                console.log(row.doc);
            });
        });
    }

    insertOne(record) {
        this._db.put(record);
    }

    destroy() {
        this._db.destroy();
    }

    syncDB() {

    }
}
