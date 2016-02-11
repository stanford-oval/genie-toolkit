var proto = require("../../ldproto");
var crypto = require("crypto");

function FeedHelpers(client) {
	this._client = client;
}

FeedHelpers.prototype.ensureFeed = function(feedsDb, identifier, cb) {
	var ld = new proto.LDFeed(JSON.parse(identifier));
	var details = {
		kind: ld.Kind
	};
	feedsDb.getOrCreateObject(identifier, cb, details);
}

FeedHelpers.prototype.ensureFeedMember = function(feed, member) {
	var addMember = function(member) {
		var accountId = this._client.store.getObjectId(member);
	   	var feedId = this._client.store.getObjectId(feed);

	   	var needed = true;
	   	for (var i = 0; i < feed.members.length; i++) {
	   		if (feed.members[i] == accountId) {
	   			needed = false;
	   			break;
	   		}
	   	}
	   	if (needed) {
	   		feed.members.push(accountId)
	   		this._client.store.getFeeds(function(feeds) {
	   			feeds.update(feed);
	   		}.bind(this));

			member.feeds.push(feedId);
			this._client.store.getAccounts(function(accounts) {
				accounts.update(member, function(member) {
					this.generateFeedName(feedId);
				}.bind(this));
			}.bind(this));
	   	}
	}.bind(this);

	if (typeof(member) == 'string') {
		this._client.store.getAccounts(function(accounts) {
			accounts.getOrCreateObject(member, addMember);
		}.bind(this));
	} else {
		addMember(member);
	}
}

FeedHelpers.prototype.generateFeedName = function(feedId) {
	this._client.store.getFeeds(function(feedsDb) {
		feedsDb.getObjectById(feedId, function(feed) {
			if (!feed.specifiedName) {
				this._client.store.getAccounts(function(accounts) {
					var members = accounts._data.find({$loki: {$in: feed.members}});
					members = members.filter(function(a) { return !a.owned; })
						.map(function(a) { return !a.name ? "Someone" : a.name; });
					feed.name = members.join(", ");
					feedsDb.update(feed);
				}.bind(this));
			}
		}.bind(this));
	}.bind(this));
}

FeedHelpers.prototype.getLDFeed = function(feed) {
	return new proto.LDFeed(JSON.parse(feed.identifier));
}

module.exports = FeedHelpers;