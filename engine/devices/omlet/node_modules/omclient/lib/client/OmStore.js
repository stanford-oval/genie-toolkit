var proto = require("../ldproto");
var OmStoreLoki = require("./OmStore-loki");
var OMFeed = require('./model/OMFeed');

function OmStore(client) {
	this._storeImpl = new OmStoreLoki(client);

}

OmStore.prototype.getObjectId = function(object) {
	return this._storeImpl.getObjectId(object);
}

OmStore.prototype.getFeeds = function(cb) {
	var defaultObject = function() {
		var TWO_WEEKS = 2 * 7 * 24 * 60 * 60 * 1000;
		var twoWeeksAgo = (new Date().getTime() - TWO_WEEKS) * 1000;
		return {
			name: "",
			kind: undefined,
			members: [],
			invitations: [],
			specifiedName: null,
			specifiedThumbnailHash: null,
			renderableTime: 0,
			messageCount: 0,
			_syncMask: OMFeed.MASK_DEFAULT,
			newestFromService: twoWeeksAgo - 1
		}
	};
	return this._storeImpl.openTable("feeds", "identifier", defaultObject, cb);
}

OmStore.prototype.getAccounts = function(cb) {
	var defaultObject = function() {
		return {
			name: "",
			thumbnailHash: null,
			feeds: [],
			hasAppTime: null,
			profileVersion: 0,
			owned: false,
			upToDate: false
		};
	};
	return this._storeImpl.openTable("accounts", "account", defaultObject, cb);
}

OmStore.prototype.getIdentityHashes = function(cb) {
	var defaultObject = function() {
		return {
			accountId: null,
			identityHash: null,

		};
	};
	return this._storeImpl.openTable("identity-hashes", "identityHash", defaultObject, cb);
}

OmStore.prototype.getBlobs = function(cb) {
	var defaultObject = function() {
		return {
			sources: []
		};
	};
	return this._storeImpl.openTable("blobs", "hash", defaultObject, cb);
}

OmStore.prototype.getSettings = function(cb) {
	var defaultObject = function() {
		return {};
	};
	return this._storeImpl.openTable("settings", "key", defaultObject, cb);
}

OmStore.prototype.getMessageReceipts = function(cb) {
	var defaultObject = function() {
		return {};
	};
	return this._storeImpl.openTable("messages", "key", defaultObject, cb);
}

// DEPRECATED, use getFeedObjects
OmStore.prototype.getFeedMessages = function(feedId, cb) {
	this.getFeedObjects(feedId, cb);
}

OmStore.prototype.getFeedObjects = function(feedId, cb) {
	var defaultObject = function() {
	 return {
           likes: {},
           likeCount: 0,
           selfLikeCount: 0,
           aggregateLikes: {},
           aggregateLikeCount: 0,
           aggregateSelfLikeCount: 0
       };
	};
	return this._storeImpl.openTable("feed-object-" + feedId, "msgId", defaultObject, cb);
}

// interface OmTable
//   insert(obj, cb)
//   update(obj, cb)
//   getObjectById(id, cb)
//   getObjectByKey(key, cb)
//   getOrCreateObject(key, cb)
//   query????
//

module.exports = OmStore;