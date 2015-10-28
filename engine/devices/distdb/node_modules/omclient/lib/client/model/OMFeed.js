var proto = require("../../ldproto");

function OMFeed(feed) {
	this._feed = feed;
}

OMFeed.prototype.toRaw = function() {
	return this._feed;
}

OMFeed.prototype.getLdFeed = function() {
	return new proto.LDFeed(JSON.parse(this._feed.identifier));
}

OMFeed.MASK_NEWER = 1 << 0;
OMFeed.MASK_STATE = 1 << 1;
OMFeed.MASK_DETAILS = 1 << 2;
OMFeed.MASK_LAST_READ = 1 << 3;
OMFeed.MASK_MEMBERS = 1 << 4;
OMFeed.MASK_OLDER = 1 << 5;
OMFeed.MASK_DEFAULT = OMFeed.MASK_NEWER | OMFeed.MASK_STATE | OMFeed.MASK_DETAILS | OMFeed.MASK_LAST_READ | OMFeed.MASK_MEMBERS;

module.exports = OMFeed;