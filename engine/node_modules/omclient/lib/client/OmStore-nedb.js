var proto = require("../ldproto");
var Datastore = require("nedb");

function OmStore(client) {
	this._client = client;

	this.feeds = new OmTable("feeds", "identifier");

	this._data = {};
	this._data._sync = {
	  caughtUp: false,
	  feedSyncStart: 0,
	  feedSyncEnd: 0,
	  feedSyncSplit: 0,
	};
}

function OmTable(name, key) {
	var DEBUG = true;
	this._name = name;
	this._key = key;
	this._data = new Datastore({
		filename: "db/" + name + ".db",
		inMemoryOnly: DEBUG
	});
	if (key) {
		this._data.ensureIndex({ fieldName: key });
	}
	this._data.loadDatabase();
}

OmTable.prototype.insert = function(o, cb) {
	this._data.insert(o, cb);
}

OmTable.prototype.update = function(o, cb) {
	this._data.update({ _id: o._id }, o, {}, cb);
}

OmTable.prototype.getObjectById = function(id, cb) {
	return this._data.findOne({ _id : id }, cb);
}

OmTable.prototype.getObjectByKey = function(key, cb) {
	var query = {};
	query[this._key] = key;
	this._data.findOne(query, cb)
}

module.exports = OmStore;