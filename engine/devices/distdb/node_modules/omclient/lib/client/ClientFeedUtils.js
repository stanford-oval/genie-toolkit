var proto = require("../ldproto");
var crypto = require("crypto");

function FeedUtils(client) {
	this._client = client;
}

FeedUtils.prototype.createFeed = function(cb) {
	var req = new proto.LDCreateFeedRequest();
	req.Feed = new proto.LDFeed();
	req.Feed.Account = this._client.account;
	req.Feed.Key = crypto.pseudoRandomBytes(32);
	this._client.msgCall(req, function(err, resp, req) {
		if (err) {
			cb(err);
		} else {
			this._client.store.getFeeds(function(feedDb) {
				this._client._feed.ensureFeed(feedDb, JSON.stringify(req.Feed.encode()), function(feed) {
					cb(undefined, feed);
				}.bind(this));
			}.bind(this));
		}
	}.bind(this));
}

// callback params:
// (err, feed, existing)
FeedUtils.prototype.getOrCreateFeedWithMembers = function(members, cb) {
	var feedKind = null;
	var accounts = [];
	var identityHashes = [];

	var keepOnKeepingOn = true;
	members.forEach(function(member) {
		if (typeof member == 'string') {
			if (member.indexOf(':') == -1) {
				accounts.push(member);
			} else {
				// raw identity string
				var hashId = this._client.identity.parseRawIdentity(member).getEncodedHashedIdentity();
				identityHashes.push(hashId);				
			}
		} else if (typeof member.account == 'string') {
			accounts.push(member.account);
		} else if (typeof member.getEncodedHashedIdentity == 'function') {
			identityHashes.push(member.getEncodedHashedIdentity());
		} else {
			cb("Unsupported identity type for " + member);
			keepOnKeepingOn = false;
			return false;
		}
	});

	if (!keepOnKeepingOn)
		return;

	var myAccount = this._client.account;
	if (!myAccount) {
		cb("No local account for feed creation");
		return;
	}

	if (accounts.indexOf(myAccount) == -1) {
		accounts.unshift(myAccount);
	}

	this._client.identity.getAccountsForIdentityHashes(identityHashes, function(matchedAccounts, identityHashes) {
		matchedAccounts.forEach(function(account) {
			if (accountsToAdd.indexOf(account) == -1) {
				accountsToAdd.push(account);
			}
		});

		this._client.identity.getAccountsForIdentifiers(accounts, function(accountsToAdd, misses) {
			if (misses.length != 0) {
				cb("Unmatched accounts");
				return;
			}

			var accountIds = accountsToAdd.map(function(a) {
				return this._client.store.getObjectId(a);
			}.bind(this)).filter(function(item, pos, self) {
			    return self.indexOf(item) == pos;
			});

			this._client.store.getFeeds(function(feedsDb) {
				var matched = undefined;
				var feeds = feedsDb._data.data;
				feeds.forEach(function(feed) {
					if (feed.members.length != accountIds.length || feed.invitations.length != identityHashes.length) {
						return;
					}
					var ldFeed = this.getLDFeed(feed);
					if (ldFeed.Kind != feedKind) {
						return false;
					}

					var candidate = true;

					accountIds.forEach(function(account) {
						if (feed.members.indexOf(account) == -1) {
							candidate = false;
							return false;
						}
					}.bind(this));

					identityHashes.forEach(function(identity) {
						if (feed.invitations.indexOf(identity) == -1) {
							candidate = false;
							return false;
						}
					}.bind(this));

					if (candidate) {
						if (matched) {
							if (feed.renderableTime > matched.renderableTime) {
								matched = feed;
							}
						} else {
							matched = feed;
						}
					}
				}.bind(this));

				if (matched) {
					cb(undefined, matched, true);
				} else {
					this._createFeedWithMembers(accountsToAdd, identityHashes, cb);
				}
			}.bind(this));
		}.bind(this));
	}.bind(this));
}

FeedUtils.prototype._createFeedWithMembers = function(accounts, identityHashes, cb) {
	this.createFeed(function(err, feed) {
		if (err) {
			if (typeof cb == 'function')
				cb(err);
			return;
		}
		this.addFeedMembers(feed, accounts, function(err) {
			if (err) {
				if (typeof cb == 'function')
					cb(err);
				return;
			}
			this._inviteIdentitiesToFeed(feed, identityHashes, function(err) {
				if (err) {
					if (typeof cb == 'function')
						cb(err);
					return;
				} else {
					if (typeof cb == 'function')
						cb(undefined, feed, false);
				}
			});
		}.bind(this));
	}.bind(this));	
}

FeedUtils.prototype.addFeedMembers = function(feed, accounts, cb) {
	if (accounts.length == 0) {
		if (typeof cb == 'function')
			cb(undefined);
	} else {
		var ldFeed = this.getLDFeed(feed);
		var account = accounts.shift();
		var req = new proto.LDAddMemberRequest();
		req.Feed = ldFeed;
		req.Member = account.account;
		this._client.msgCall(req, function(err, resp, req) {
			if (err) {
				if (typeof cb == 'function')
					cb(err);
			} else {
				this.addFeedMembers(feed, accounts, cb);
			}
		}.bind(this));
	}
}

FeedUtils.prototype._inviteIdentitiesToFeed = function(feed, identityHashes, cb) {
	if (identityHashes.length == 0) {
		if (typeof cb == 'function')
			cb(undefined);
	} else {
		var ldFeed = this.getLDFeed(feed);
		var identity = identityHashes.shift();
		var req = new proto.LDAddPendingInvitationRequest();
		req.Feed = ldFeed;
		req.IdentityHash = new proto.LDIdentityHash(JSON.parse(identity));
		this._client.msgCall(req, function(err, resp, req) {
			if (err) {
				if (typeof cb == 'function')
					cb(err);
			} else {
				this._inviteIdentitiesToFeed(ldFeed, identityHashes, cb);
			}
		}.bind(this));
	}
}

FeedUtils.prototype.getLDFeed = function(feed) {
	return new proto.LDFeed(JSON.parse(feed.identifier));
}

module.exports = FeedUtils;