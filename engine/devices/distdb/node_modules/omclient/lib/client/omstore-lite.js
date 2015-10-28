var proto = require("../ldproto");

function OmStore(client) {
	this._client = client;
	this._tables = {};
}

OmStore.openTable = function(name, key, defaultObject, cb) {
	if (!this._tables[name]) {
		this._tables[name] = new OmTable(name, key, defaultObject);
	}
	cb(this._tables[name]);
}

function OmTable(name, key) {
	var DEBUG = true;
	this._nextId = 1;
	this._name = name;
	this._key = key;
	this._data = {};
	this._keyLookup = {};
}

OmTable.prototype.insert = function(o, cb) {
	var id = this._nextId++;
	o._id = id;
	this._data[id] = o;
	if (this._key) {
		this._keyLookup[o[this._key]] = id;
	}
	if (typeof(cb) == 'function')
		cb(false, o);
}

OmTable.prototype.update = function(o, cb) {
	this._data[o._id] = o;
	if (typeof(cb) == 'function')
		cb(false, o);
}

OmTable.prototype.getObjectById = function(id, cb) {
	var o = this._data[id];
	if (typeof(cb) == 'function')
		cb(o);
}

OmTable.prototype.getObjectByKey = function(key, cb) {
	var id = this._keyLookup[key];
	this.getObjectById(id, cb);
}

module.exports = OmStore;