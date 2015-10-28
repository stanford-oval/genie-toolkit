var proto = require("../../ldproto");

function LikeProcessor() {

}

LikeProcessor.prototype.processMessage = function(client, db, feed, sender, msg) {
	var fake = new proto.LDMessage(JSON.parse(msg.Id.Id.toString()));
	var ldId = fake.Id;
	var referenceKey = client.messaging.makeUniqueMessageId(feed, ldId);
	var like = JSON.parse(msg.Body);
	this._processLike(client, db, feed, sender, referenceKey, like);
}

LikeProcessor.prototype.processDelete = function(client, db, feed, sender, msg) {
	var fake = new proto.LDMessage(JSON.parse(msg.Id.Id.toString()));
	var ldId = fake.Id;
	var referenceKey = client.messaging.makeUniqueMessageId(feed, ldId);
	var like = { Tally: 0, Aggregate: 0 };
	var senderAccount = fake.Owner;
	db.accounts.getObjectByKey(senderAccount, function(sender) {
		this._processLike(client, db, feed, sender, referenceKey, like);
	}.bind(this));
}

LikeProcessor.prototype._processLike = function(client, db, feed, sender, referenceKey, like) {
	
	db.receipts.getObjectByKey(referenceKey, function(receipt) {
		if (receipt) {
			var msgId = client.store.getObjectId(receipt);
			var feedId = client.store.getObjectId(feed);
			client.store.getFeedObjects(feedId, function(objectsDb) {
				objectsDb.getObjectByKey(msgId, function(obj) {
					if (obj) {
						var liker = client.store.getObjectId(sender);

						// Direct
						obj.likes[liker] = like.Tally;
						if (!obj.likes[liker]) {
							delete obj.likes[liker];
						}
						var totalLikes = 0;
						for (var k in obj.likes) {
							totalLikes += obj.likes[k];
						}
						obj.likeCount = totalLikes;

						// Aggregate
						obj.aggregateLikes[liker] = like.Aggregate;
						if (!obj.aggregateLikes[liker]) {
							delete obj.aggregateLikes[liker];
						}
						var totalAgg = 0;
						for (var k in obj.aggregateLikes) {
							totalAgg += obj.aggregateLikes[k];
						}
						obj.aggregateLikeCount = totalAgg;

						if (sender.owned) {
							obj.selfLikeCount = like.Tally;
							obj.aggregateSelfLikeCount = like.Aggregate;
						}

						objectsDb.update(obj, function() {
							// poke for listeners
							db.receipts.update(receipt);
						}.bind(this));
					}
				}.bind(this));
			}.bind(this));
		}
	});
}

module.exports = LikeProcessor;