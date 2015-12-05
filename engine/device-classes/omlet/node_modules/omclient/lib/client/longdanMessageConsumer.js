var proto = require("../ldproto");
var OMFeed = require("./model/OMFeed");
var ObjTypes = require("./model/ObjTypes");
var async = require('async');

var CONCURRENT_FETCHES = 4;

function LongdanMessageConsumer(client) {
    this._client = client;
    this.DEBUG = true;

    this._feedFetchQueue = [];
    this._idleFeedFetchWorkers = [];

    for (var i = 0; i < CONCURRENT_FETCHES; i++) {
	this._idleFeedFetchWorkers.push(new FeedFetchWorker(this));
    }
}

LongdanMessageConsumer.prototype.debug = function(msg) {
    if (this.DEBUG) {
	if (typeof msg == 'string')
	    console.log("Consumer: " + msg);
	else
	    console.log(msg);
    }
}

LongdanMessageConsumer.prototype.start = function() {
    this._client.store.getSettings(this._onLoadSettings.bind(this));
}

LongdanMessageConsumer.prototype._onLoadSettings = function(settings) {
    this._settings = settings;
    this._client.store.getFeeds(this._onLoadFeeds.bind(this));
}

LongdanMessageConsumer.prototype._onLoadFeeds = function(feeds) {
    this._feeds = feeds;
    this._settings.getObjectByKey("sync", function(sync) {
	if (sync == null) {
	    var TWO_WEEKS = 2 * 7 * 24 * 60 * 60 * 1000;
	    var twoWeeksAgo = new Date().getTime() - TWO_WEEKS;
	    sync = {
		key: "sync",
		feedSyncStart: 0,
		feedSyncSplit: twoWeeksAgo * 1000,
		feedSyncEnd: twoWeeksAgo * 1000
	    };
	    this._settings.insert(sync, function(sync) {
		this._sync = sync;
		this._initConnection();
	    }.bind(this));
	} else {
	    this._sync = sync;
	    this._initConnection();
	}
    }.bind(this));
}

LongdanMessageConsumer.prototype._initConnection = function() {
    var conn = this._client._msg;
    conn.onPush = this._onPush.bind(this);
    conn.onSessionEstablished = this._establishConnection.bind(this);
    if (conn.connected) {
	this._establishConnection();
    }
}

LongdanMessageConsumer.prototype._establishConnection = function() {
    this.caughtUp = false;
    this._client.msgCall(new proto.LDSubscribeForAccountInboxRequest(), this._onSubscribe.bind(this));
}

LongdanMessageConsumer.prototype._onPush = function(push) {
    this.debug("Consumer got push:");
    this.debug(push.Message);
    if (push.Message) {
	this._client.longdanMessageProcessor.processDurableMessage(push.Message, { pushed: true });
    }
}

LongdanMessageConsumer.prototype._onSubscribe = function(err, resp, req) {
    // We are now listening for live durable msg pushes

    if (err) {
	console.warn("Subscription failed! " + err);
    }

    this._queueExistingFeedsNeedingWork();
}

LongdanMessageConsumer.prototype._queueExistingFeedsNeedingWork = function(cb) {
    var feeds = this._feeds._data.find({_syncMask: { $ne: 0 }});
    this.debug("Queuing known work for " + feeds.length + " feeds...");
    feeds.forEach(function(feed) {
	this._enqueueFeedForFetch(feed.identifier);
    }.bind(this));

    this._fetchDirtyFeeds();
}

LongdanMessageConsumer.prototype._fetchDirtyFeeds = function() {
    this.debug("fetching dirty feeds while caughtUp=" + this.caughtUp);

    var lastSyncedTime = 0;
    var sync = this._sync;
    if (!this.caughtUp) {
        lastSyncedTime = sync.feedSyncEnd;
    } else if (sync.feedSyncStart < sync.feedSyncSplit) {
        lastSyncedTime = sync.feedSyncStart;
    } else {
    	return;
    }

    console.log("Requesting dirty feeds since " + lastSyncedTime + "...");
    var feedsReq = new proto.LDGetDirtyFeedsRequest();
    feedsReq.Since = lastSyncedTime;
    this._client.msgCall(feedsReq, this._onReceivedDirtyFeeds.bind(this));
}

LongdanMessageConsumer.prototype._onReceivedDirtyFeeds = function(error, resp, req) {
    if (error) {
	console.warn("Failed fetching dirty feeds " + error);
	return;
    }

    this.debug("Received " + resp.Dirty.length + " dirty feeds, partial=" + resp.Partial);

    var sync = this._sync;
    var lastSyncTime = req.Since;

    resp.Dirty.forEach(function(dirty, i) {
	lastSyncTime = Math.max(lastSyncTime, dirty.LastWriteTime);
	var lastRenderableTime = (dirty.LastRenderableTime == null) ? 0 : dirty.LastRenderableTime;
	var identifier = JSON.stringify(dirty.Feed.encode());

	this._client._feed.ensureFeed(this._feeds, identifier, function(f) {
	    f._syncMask |= OMFeed.MASK_NEWER;
	    f._syncMask &= ~OMFeed.MASK_STATE; // state is fetched in batch already
	    f.acceptance = dirty.Acceptance;
	    f.approximateDirtyTime = dirty.LastWriteTime + resp.Window;
	    f.renderableTime = Math.round(lastRenderableTime/1000);
	    this._feeds.update(f, function() {
		this._enqueueFeedForFetch(f.identifier);
	    }.bind(this));
	}.bind(this));
    }, this);

    if (!this.caughtUp) {
    	if (lastSyncTime > sync.feedSyncSplit) {
    	    sync.feedSyncEnd = lastSyncTime;
    	}
    	if (!resp.Partial) {
    	    this.caughtUp = true;
    	}
    } else {
    	if (!resp.Partial) {
	    sync.feedSyncStart = sync.feedSyncSplit;
    	} else {
    	    sync.feedSyncStart = lastSyncTime;
    	}
    }

    this._settings.update(sync);
    this._fetchDirtyFeeds();
}

LongdanMessageConsumer.prototype._enqueueFeedForFetch = function(feedIdentifier) {
    if (!feedIdentifier)
        throw new TypeError('Missing feed identifier');
    this._feedFetchQueue.push(feedIdentifier);
    //console.log("enqueuing. have " + this._feedFetchQueue.length + " feeds queued...");
    var fetcher = this._idleFeedFetchWorkers.shift();
    if (fetcher !== undefined)
	fetcher.fetchNext();
}

function FeedFetchWorker(lmc) {
    this._consumer = lmc;
}

FeedFetchWorker.prototype.fetchNext = function() {
    if (this._consumer._feedFetchQueue.length === 0) {
        this._consumer._idleFeedFetchWorkers.push(this);
        return;
    }

    var feedIdentifier = this._consumer._feedFetchQueue.shift();
    //console.log(feedIdentifier + " pulled next. have " + this._consumer._feedFetchQueue.length + " feeds queued...");

    this._consumer._feeds.getObjectByKey(feedIdentifier, function(feed) {
	if (!feed) {
	    console.warn("Missing feed for sync");
	    async.nextTick(this.fetchNext.bind(this));
	} else {
	    if (feed._syncMask === undefined) {
		console.warn("feed " + feed.name + " missing sync mask...");
		feed._syncMask = OMFeed.MASK_DEFAULT;
	    }

	    this._fetch(feed);
	}
    }.bind(this));
}

FeedFetchWorker.prototype._fetch = function(feed) {
    var tasks = [];

    if ((feed._syncMask & OMFeed.MASK_STATE) != 0) {
	tasks.push(this._fetchFeedState.bind(this, feed));
    }
    if ((feed._syncMask & OMFeed.MASK_DETAILS) != 0) {
	var typedId = new proto.LDTypedId();
	typedId.Type = ObjTypes.FEED_DETAILS;
	typedId.Id = [];
	tasks.push(this._syncMessages.bind(this, feed, typedId, OMFeed.MASK_DETAILS));
    }
    if ((feed._syncMask & OMFeed.MASK_LAST_READ) != 0) {
	var typedId = new proto.LDTypedId();
	typedId.Type = ObjTypes.LAST_READ;
	typedId.Id = new Buffer(this._consumer._client.account);
	tasks.push(this._syncMessages.bind(this, feed, typedId, OMFeed.MASK_LAST_READ));
    }
    if ((feed._syncMask & OMFeed.MASK_MEMBERS) != 0) {
	tasks.push(this._fetchFeedMembers.bind(this, feed, undefined));
    }
    if ((feed._syncMask & OMFeed.MASK_NEWER) != 0) {
	tasks.push(this._fetchFeedMessages.bind(this, feed));
    }
    if ((feed._syncMask & OMFeed.MASK_OLDER) != 0) {
	tasks.push(this._fetchOlderFeedMessages.bind(this, feed));
    }

    async.parallel(tasks, function(err, results) {
	if (err) {
	    this._consumer.debug("Callback failed with error " + err);
	}
	async.nextTick(this.fetchNext.bind(this));
    }.bind(this));
}


FeedFetchWorker.prototype._fetchFeedMembers = function(feed, last, cb) {
    var req = new proto.LDGetMessagesByTypeRequest();
    req.Feed = new OMFeed(feed).getLdFeed();
    req.Type = ObjTypes.FEED_MEMBERSHIP;
    req.NextResult = (typeof(last) != 'undefined') ? last : null;
    this._consumer._client.msgCall(req, this._fetchFeedMembersCallback.bind(this, cb));
}

FeedFetchWorker.prototype._fetchFeedMembersCallback = function(cb, error, resp, req) {
    var err = error || !resp.Messages;
    if (!err)
	this._consumer._client.longdanMessageProcessor.processDurableMessages(resp.Messages);
    var feedIdentifier = JSON.stringify(req.Feed.encode());
    this._consumer._feeds.getObjectByKey(feedIdentifier, function(feed) {
	feed._syncMask &= ~OMFeed.MASK_MEMBERS;
	feed.expired = false;
	feed.hasWriteAccess = true;
	this._consumer._feeds.update(feed);

	if (!err && resp.ContinuationKey != null) {
	    this._fetchFeedMembers(feed, resp.ContinuationKey, cb);
	} else {
	    cb(err);
	}
    }.bind(this));
}

FeedFetchWorker.prototype._fetchFeedMessages = function(feed, cb) {
    var req = new proto.LDGetMessagesSinceRequest();
    req.Timestamp = feed.newestFromService;
    req.Feed = new OMFeed(feed).getLdFeed();
    this._consumer._client.msgCall(req, this._fetchFeedMessagesCallback.bind(this, cb));
}

FeedFetchWorker.prototype._fetchFeedMessagesCallback = function(cb, error, resp, req) {
    var feedIdentifier = JSON.stringify(req.Feed.encode());
    if (error) {
	if (error.permanent) {
	    this._consumer._feeds.getObjectByKey(feedIdentifier, function(feed) {
		if (feed) {
		    feed._syncMask &= ~OMFeed.MASK_NEWER;
		    this._consumer._feeds.update(feed);
		}
	    }.bind(this));

	}
	cb(error);
	return;
    }

    this._consumer.debug("Fetched " + resp.Messages.length + " new messages for processing");
    //this._consumer.debug(resp.Messages);

    var last = null;
    if (resp.Messages.length != 0) {
	this._consumer._client.longdanMessageProcessor.processDurableMessages(resp.Messages);
	last = resp.Messages[resp.Messages.length-1].Timestamp;
    }

    this._consumer._feeds.getObjectByKey(feedIdentifier, (function(feed) {
	if (last) {
	    feed.newestFromService = last;
	}

	if (resp.Partial) {
	    this._consumer._feeds.update(feed, function() {
		this._fetchFeedMessages(feed, cb);
	    }.bind(this));
	} else {
	    var nowish = (new Date().getTime() + this._consumer._client._msg.serverTimeDelta) * 1000;
	    if (nowish > feed.approximateDirtyTime) {
		feed._syncMask &= ~OMFeed.MASK_NEWER;
	    }
	    this._consumer._feeds.update(feed, function() {
		cb();
	    });
	}
    }).bind(this));
}

FeedFetchWorker.prototype.fetchOlderFeedMessages = function(feedIdentifier, option) {
    if(this._consumer._feeds){
	if(option !== 'syncup' && option !== 'fetchold'){
	    return new Error('Option not supported. ' + option);
	}

	this._consumer._feeds.getObjectByKey(feedIdentifier, function(feed){
	    if(feed){
		// already fetch to the oldest message
		if(feed.oldestEnd && option === 'fetchold'){
		    return;
		}

		// only syncup after first fetchold
		if(!feed.oldestFromService && option === 'syncup'){
		    return;
		}

		if(!this._consumer._feedMessageState){
		    this._consumer._feedMessageState = {};
		}
		if(!this._consumer._feedMessageState[feedIdentifier]){
		    this._consumer._feedMessageState[feedIdentifier] = {
			'syncup': {},
			'fetchold': {}
		    };
		}
		if(this._consumer._feedMessageState[feedIdentifier][option].fetching){
		    return;
		}

		var fetchAll;
		var fromNow;
		if(option === 'syncup'){
		    fetchAll = true;
		    fromNow = true;
		}
		if(option === 'fetchold'){
		    fetchAll = false;
		    fromNow = false;
		}

		this._fetchOlderFeedMessages(feed, this._consumer._feedMessageState[feedIdentifier][option], fetchAll, fromNow);
	    }
	}.bind(this));
    }
};

FeedFetchWorker.prototype._fetchOlderFeedMessages = function(feed, concurrent, opt_fetchAll, opt_fromNow, cb) {
    concurrent.fetching = true;

    var req = new proto.LDGetMessagesBeforeRequest();
    if(opt_fromNow || !feed.oldestFromService){
	req.Timestamp = new Date().getTime() * 1000;
    } else {
	req.Timestamp = feed.oldestFromService;
    }

    req.Feed = new OMFeed(feed).getLdFeed();
    this._consumer._client.msgCall(req, this._fetchOlderFeedMessagesCallback.bind(this, concurrent, !!opt_fetchAll, cb));
}

FeedFetchWorker.prototype._fetchOlderFeedMessagesCallback = function(concurrent, fetchAll, cb, error, resp, req) {
    var feedIdentifier = JSON.stringify(req.Feed.encode());
    if (error) {
	concurrent.fetching = false;
	if (error.permanent) {
	    this._consumer._feeds.getObjectByKey(feedIdentifier, function(feed) {
		if (feed) {
		    feed._syncMask &= ~OMFeed.MASK_OLDER;
		    this._consumer._feeds.update(feed);
		}
	    }.bind(this));
	}
	cb(error);
	return;
    }

    this._consumer._client.longdanMessageProcessor.processDurableMessages(resp.Messages);

    this._consumer._feeds.getObjectByKey(feedIdentifier, (function(feed) {
	var synchedUp;
	if(resp.Messages.length > 0){
	    feed.oldestFromService = resp.Messages[resp.Messages.length-1].Timestamp;
	    if(!feed.fetchNewestTimestamp || (resp.Messages[0].Timestamp > feed.fetchNewestTimestamp)){
		feed.fetchNewestTimestamp = resp.Messages[0].Timestamp;
	    }
	    if(feed.oldestFromService <= feed.fetchNewestTimestamp){
				synchedUp = true;
	    }
	}
	if(resp.Messages.length === 0 && !resp.Partial){
	    feed.oldestEnd = true;
	}

	if (resp.Partial && fetchAll && !feed.oldestEnd && !synchedUp) {
	    this._consumer._feeds.update(feed, function() {
		this._fetchOlderFeedMessages(feed, concurrent, fetchAll, cb);
	    }.bind(this));
	} else {
	    feed._syncMask &= ~OMFeed.MASK_OLDER;
	    this._consumer._feeds.update(feed);
	    concurrent.fetching = false;
	    cb();
	}
    }).bind(this));
}

FeedFetchWorker.prototype._fetchFeedState = function(feed, cb) {
    var req = new proto.LDGetFeedStateRequest();
    req.Feed = new OMFeed(feed).getLdFeed();
    this._consumer._client.msgCall(req, this._fetchFeedStateCallback.bind(this, cb));
}

FeedFetchWorker.prototype._fetchFeedStateCallback = function(cb, error, resp, req) {
    if (error) {
	// TODO: requeue
	cb(error);
	return;
    }

    var feedIdentifier = JSON.stringify(req.Feed.encode());
    this._consumer._feeds.getObjectByKey(feedIdentifier, (function(feed) {
	feed._syncMask &= ~OMFeed.MASK_STATE;
	feed.acceptance = resp.AcceptanceState;
	feed.hasWriteAccess = true;
	this._consumer._feeds.update(feed, function() {
	    cb();
	});
    }).bind(this));
}

FeedFetchWorker.prototype._syncMessages = function(feed, id, maskToRemove, cb) {
    var req = new proto.LDGetMessageByIdRequest();
    req.Feed = new proto.LDFeed(JSON.parse(feed.identifier));
    req.Id = id;
    this._consumer._client.msgCall(req, (function(error, resp) {
	feed._syncMask &= ~maskToRemove;
	if (!error && resp.Message) {
	    this._consumer._client.longdanMessageProcessor.processDurableMessage(resp.Message);
	}
	this._consumer._feeds.update(feed, function() {
	    cb(error);
	});
    }).bind(this));
}

module.exports = LongdanMessageConsumer;
