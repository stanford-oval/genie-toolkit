var proto = require("../ldproto");
var loki = require("lokijs");
var lokiIndexed = require("./loki-indexed-adapter");
var OmEvent = require('./omevent');
var async = require('async');
var path = require('path');

var persist = true;

function OmStore(client) {
	this._client = client;

	this._pendingOpens = {};
	this._tables = {};
}

OmStore.prototype.getObjectId = function(object) {
	return object['$loki'];
}

OmStore.prototype.openTable = function(name, key, defaultObject, cb) {
	if (!this._tables[name]) {
		var table = new OmTable(this._client, name, key);
		table._defaultObject = defaultObject;
		this._tables[name] = table;
		var cbs = this._pendingOpens[name] = [];
		cbs.push(function() { cb(this._tables[name]); }.bind(this));
		table.load(function() {
			this._pendingOpens[name] = undefined;
			for (var i = 0; i < cbs.length; i++) {
				cbs[i](table);
			}
		}.bind(this))
	} else if (this._pendingOpens[name] != undefined) {
		this._pendingOpens[name].push(function() { cb(this._tables[name]); }.bind(this));
	} else {
		cb(this._tables[name]);
	}
}

function ThingEngineFSAdapter(instance) {
    this.fs = require('fs');
    this.path = require('path');
    this._instance = instance;
}

function safeMkdirSync(fs, dir) {
    try {
        fs.mkdirSync(dir);
    } catch(e) {
        if (e.code !== 'EEXIST')
            throw e;
    }
}

ThingEngineFSAdapter.prototype.loadDatabase = function(dbname, callback) {
    var dir = path.join(platform.getWritableDir(), 'omlet-' + this._instance);
    safeMkdirSync(this.fs, dir);
    this.fs.readFile(path.join(dir, dbname), {
        encoding: 'utf8'
    }, function readFileCallback(err, data) {
        if (err) {
            callback(new Error(err));
        } else {
            callback(data);
        }
    });
};

ThingEngineFSAdapter.prototype.saveDatabase = function(dbname, dbstring, callback) {
    var dir = path.join(platform.getWritableDir(), 'omlet-' + this._instance);
    safeMkdirSync(this.fs, dir);
    this.fs.writeFile(path.join(dir, dbname), dbstring, callback);
};

function OmTable(client, name, key) {
    this._client = client;
    this._name = name;
    this._key = key;
    this._modifiedTimestamp = '_m';

    if(persist) {
	var lokiSettings = {
	    autosave: true,
	    autosaveInterval: 10000,
	};
	if(typeof window !== 'undefined')
	    lokiSettings.adapter = new lokiIndexed("omclient");
        else if (typeof platform !== 'undefined')
            lokiSettings.adapter = new ThingEngineFSAdapter(this._client._instance);
    }
    this._db = new loki(name, lokiSettings);
}

OmTable.prototype.load = function(cb) {
	if(persist) {
		this._db.loadDatabase(undefined, (function() { 
			console.log("loaded " + this._name);
			this._data = this._db.getCollection("data")
			if(!this._data) {
				console.log("creating " + this._name);
				this._data = this._db.addCollection("data")
			}
			this._client.events._notify(OmEvent.prototype.DB_LOADED);
			cb();
		}).bind(this));
	} else { 
		this._data = this._db.addCollection("data")
		cb();
	}
}

OmTable.prototype.insert = function(o, cb) {
	if (typeof(o.toRaw) == 'function')
		o = o.toRaw();

	var b = this._defaultObject();
	for (var k in o) {
		b[k] = o[k];
	}

	if (this._modifiedTimestamp) {
		b[this._modifiedTimestamp] = new Date().getTime();
	}

	var r = this._data.insert(b);
	if (typeof(cb) == 'function') {
		async.nextTick(function() {
			cb(r);
		}, 0);
	}
	this._client.events._notify(this._name);
}

OmTable.prototype._defaultObject = function() {
	return {};
}

OmTable.prototype.update = function(o, cb) {
	if (typeof(o.toRaw) == 'function')
		o = o.toRaw();

	if (this._modifiedTimestamp) {
		o[this._modifiedTimestamp] = new Date().getTime();
	}

	this._data.update(o);
	if (typeof(cb) == 'function') {
		async.nextTick(function() {
			cb(o);
		});
	}
	this._client.events._notify(this._name);
}

OmTable.prototype.getObjectById = function(id, cb) {
	var o = this._data.findOne({ $loki : id });
	async.nextTick(function() {
		cb(o);
	});
}

OmTable.prototype.getObjectByKey = function(key, cb) {
	var query = {};
	query[this._key] = key;
	var r = this._data.findOne(query);
	async.nextTick(function() {
		cb(r);
	})
}

OmTable.prototype.getOrCreateObject = function(key, cb, details) {
    this.getObjectByKey(key, function(existing) {
		if (existing != null) {
			if (typeof(cb) == 'function') {
				cb(existing, true);
			}
		} else {
			var obj = this._defaultObject();
			if (typeof(details) != 'undefined') {
				for (var p in details) {
					obj[p] = details[p];
				}
			}
			obj[this._key] = key;
			this.insert(obj, function(res) {
				if (typeof(cb) == 'function') {
					//async.nextTick(function() {
						cb(res);	
					//});
				}
			});
		}
	}.bind(this));
}

module.exports = OmStore;
