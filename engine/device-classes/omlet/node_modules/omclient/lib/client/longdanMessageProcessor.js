var async = require('async');
var ObjTypes = require("./model/ObjTypes");
var ChatObjectProcessor = require("./processors/chatObjectProcessor");
var FeedDetailsProcessor = require("./processors/feedDetailsProcessor");
var MembershipProcessor = require("./processors/MembershipProcessor");
var BlobRefProcessor = require("./processors/BlobRefProcessor");
var ContactProcessor = require("./processors/ContactProcessor");
var LikeProcessor = require("./processors/LikeProcessor");
var LastReadProcessor = require("./processors/LastReadProcessor");
var FeedInvitationProcessor = require('./processors/FeedInvitationProcessor');

var proto = require("../ldproto");


function LongdanMessageProcessor(client) {
	this._client = client;

	var cop = new ChatObjectProcessor();
	this._durableMessageProcessors = {};
	this._durableMessageProcessors[ObjTypes.TEXT] = cop;
	this._durableMessageProcessors[ObjTypes.ANIMATED_GIF] = cop;
	this._durableMessageProcessors[ObjTypes.PICTURE] = cop;
	this._durableMessageProcessors[ObjTypes.CANVAS] = cop;
	this._durableMessageProcessors[ObjTypes.STICKER] = cop;
	this._durableMessageProcessors[ObjTypes.ILBC] = cop;
	this._durableMessageProcessors[ObjTypes.RDL] = cop;
	this._durableMessageProcessors[ObjTypes.APP] = cop;
	this._durableMessageProcessors[ObjTypes.LOCATION] = cop;
	this._durableMessageProcessors[ObjTypes.FILE] = cop;
	this._durableMessageProcessors[ObjTypes.VIDEO] = cop;
	this._durableMessageProcessors[ObjTypes.COMMENT] = cop;
	this._durableMessageProcessors[ObjTypes.LIKE] = new LikeProcessor();
	this._durableMessageProcessors[ObjTypes.LAST_READ] = new LastReadProcessor();
	this._durableMessageProcessors[ObjTypes.FEED_DETAILS] = new FeedDetailsProcessor();
	this._durableMessageProcessors[ObjTypes.FEED_MEMBERSHIP] = new MembershipProcessor();
	this._durableMessageProcessors[ObjTypes.FEED_INVITATION] = new FeedInvitationProcessor();
	this._durableMessageProcessors[ObjTypes.CONTACT] = new ContactProcessor();
	this._durableMessageProcessors[ObjTypes.BLOB_REFERENCE] = new BlobRefProcessor();
	this._durableMessageProcessors[ObjTypes.EBLOB_REFERENCE] = new BlobRefProcessor();
}

LongdanMessageProcessor.prototype.processDurableMessage = function(message, options) {
	if (this._db) {
		this._processDurableMessage.call(this, message, options);
	} else {
		this._client.store.getFeeds(function(feedsDb) {
			this._client.store.getMessageReceipts(function(receiptsDb) {
				this._client.store.getAccounts(function(accountsDb) {
					this._client.store.getIdentityHashes(function(identityHashesDb) {
						this._db = {
							feeds:feedsDb,
							accounts:accountsDb,
							receipts: receiptsDb,
							identityHashes: identityHashesDb
						};
						this._processDurableMessage.call(this, message, options);
					}.bind(this));
				}.bind(this));
			}.bind(this));
		}.bind(this));
	}
	
}

LongdanMessageProcessor.prototype._processDurableMessage = function(message, options) {
	var db = this._db;
	var proc = this._durableMessageProcessors[message.Id.Type];
	if (typeof(proc) != 'undefined') {
		try {
			var client = this._client;
			var feedIdentifier = JSON.stringify(message.Feed.encode());
			client._feed.ensureFeed(db.feeds, feedIdentifier, function(feed) {
				var ldId = message.Id;
				var receiptId = client.messaging.makeUniqueMessageId(feed, ldId);
				db.receipts.getOrCreateObject(receiptId, function(receipt, existing) {
					if (existing) {
						// TODO: dedupe?
					}
					
					var processMessage = function(sender) {
						var task = undefined;
						if (message.Deleted) {
							if (typeof proc.processDelete == 'function') {
								task = proc.processDelete(client, db, feed, sender, message, receipt);
							}
						} else {
					    	task = proc.processMessage(client, db, feed, sender, message, receipt);
						}
			    		receipt.type = message.Id.Type;
				    	if (task && task.continueWith !== undefined) {
							task.continueWith(function() {
								db.receipts.update(receipt);
							});
				    	} else {
				    		db.receipts.update(receipt);
				    	}
					}.bind(this);

					if (message.Owner) {
						db.accounts.getOrCreateObject(message.Owner, processMessage);
					} else {
						processMessage(null);
					}
				});
			});
		} catch (e) {
			console.error("Error processing message of type " + message.Id.Type, e);
		}
	} else {
		console.log("Not processing message of type " + message.Id.Type);
	}

	if (options != undefined && options.pushed) {
		this._client.events._notifyMessagePushed(message);
	}
}

LongdanMessageProcessor.prototype.processDurableMessages = function(messages) {
	// Run all messages immediately
	/*
	for (var i = 0; i < messages.length; i++) {
		this.processDurableMessage(messages[i]);
	}
	*/

	// Schedule all messages together
	/*
	async.nextTick(function() {
		for (var i = 0; i < messages.length; i++) {
			this.processDurableMessage(messages[i]);
		}
	}.bind(this));
	*/

	// Each message scheduled on main thread
	
	messages.forEach(function(msg) {
		async.nextTick(function() {
			this.processDurableMessage(msg);
		}.bind(this));
	}.bind(this));
	
}

module.exports = LongdanMessageProcessor;
