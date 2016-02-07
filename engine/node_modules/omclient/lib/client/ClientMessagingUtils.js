var proto = require("../ldproto");
var ObjTypes = require("./model/ObjTypes");
var OverwriteMessageJob = require('./jobs/OverwriteMessageJob');

function MessagingUtils(client) {
	this._client = client;
}

MessagingUtils.prototype.makeUniqueMessageId = function(feed, ldTypedId) {
	return JSON.stringify({
		f: this._client.store.getObjectId(feed),
		i: ldTypedId.encode()
	});
}

MessagingUtils.prototype._sendObjToTarget = function(target, type, body, callback) {
	if (target.feed) {
		return this._sendObjToFeed(target.feed, type, body, callback);
	} else if (target.recipients) {
		return this._sendObjDirect(target.sender, target.recipients, type, body, callback);
	} else {
		throw new Exception("Unknown target");
	}
}

// Deprecated
MessagingUtils.prototype._sendObj = function(feed, type, body, callback) {
	this._sendObjToFeed(feed, type, body, callback);
}

MessagingUtils.prototype._sendObjToFeed = function(feed, type, body, callback) {
	var job = new OverwriteMessageJob(this._client.account, feed, type, body, callback);
	this._client.longdanDurableJobProcessor.scheduleJob(job);
}

MessagingUtils.prototype._sendObjToFeedImmediate = function(feed, type, body, callback) {
	var job = new OverwriteMessageJob(this._client.account, feed, type, body, callback);
	this._client.longdanDurableJobProcessor.executeJobImmediate(job);
}


// 'msg' is from the messageReceiptsDb
MessagingUtils.prototype._sendLikeForMessage = function(msg) {
	var msgKey = JSON.parse(msg.key); // f, i
	omlib.store.getFeeds(function(feedsDb) {
		feedsDb.getObjectById(msgKey.f, function(feed) {
			omlib.store.getFeedObjects(omlib.store.getObjectId(feed), function(objectsDb) {
				objectsDb.getObjectByKey(omlib.store.getObjectId(msg), function(obj) {
					var referenceKey = this._referenceKeyForMessageId(msg.key);
					var body = {
						Tally: 1 + ((obj.selfLikeCount) ? obj.selfLikeCount : 0),
						Aggregate: (obj.selfAggregateLikeCount) ? obj.selfAggregateLikeCount : 0,
						_messageId: new Buffer(referenceKey).toString("base64")
					}
					omlib.messaging._sendObjToFeed(feed.identifier, 'like', body);
				}.bind(this));
			}.bind(this));
		}.bind(this));
	}.bind(this));
}

MessagingUtils.prototype._referenceKeyForMessageId = function(msgId) {
	var msgKey = JSON.parse(msgId);
	var refKey = new proto.LDMessage();
	refKey.Id = new proto.LDTypedId();
	refKey.Id.Type = msgKey.i.t;
	refKey.Id.Id = new Buffer(msgKey.i.i, "base64");
	refKey.Owner = this._client.account;
	return JSON.stringify(refKey.encode());
}

MessagingUtils.prototype._sendLikeForMessage = function(msg) {
	var msgKey = JSON.parse(msg.key); // f, i
	omlib.store.getFeeds(function(feedsDb) {
		feedsDb.getObjectById(msgKey.f, function(feed) {
			omlib.store.getFeedObjects(omlib.store.getObjectId(feed), function(objectsDb) {
				objectsDb.getObjectByKey(omlib.store.getObjectId(msg), function(obj) {
					// TODO: make referenceId from sender,msgId
					var body = {
						Tally: 1

					}
					omlib.messaging._sendObjToFeed(feed.identifier, 'like', body);
			
				});
			});
		});
	});

}

MessagingUtils.prototype._urlToObj = function(url, cb) {
	var req = new proto.LDUrlToStoryRequest();
	req.Url = url;
	this._client.msgCall(req, function(err, resp, req) {
		if (err) {
			cb(err);
		} else {
			if (resp.ResponseType.startsWith("obj/")) {
				var type = resp.ResponseType.substring(4);
				var data = resp.ResponseData.toString("utf8");
				var body = JSON.parse(data);

				if (type == ObjTypes.PICTURE) {
					if ("imageData" in body) {
					    var bytes = new Buffer(body.imageData, "base64");
					    this._pictureObjFromBytes(bytes, null, cb);
					} else {
					    cb("No image data");
					}
				    return;
				}

				if (type == ObjTypes.ANIMATED_GIF) {
					if (body.imageData !== undefined) {
						var bytes = new Buffer(body.imageData, "base64");
						this._animatedGifObjFromBytes(bytes, cb);
					} else if (body.imageUrl !== undefined) {
						this._client.blob.downloadUrl(body.imageUrl, function(e, bytes) {
							if (e) {
								cb(e);
							} else {
								this._animatedGifObjFromBytes(bytes, cb);
							}
						}.bind(this));
					} else {
						cb("No image data");
					}
					return;
				}

				if (type == ObjTypes.RDL || type == ObjTypes.APP) {
					if ("displayThumbnailData" in body) {
						var bytes = new Buffer(body.displayThumbnailData, "base64");

						this._client.blob.resizeImage(bytes, [540], function(err, resized) {
							var img = resized[0];
							var mimeType = "image/jpeg";
							this._client.blob.uploadBlob(img.data, mimeType, function(err, blobLink) {
								if (err) {
									cb(err);
								} else {
									var hash = this._client.blob.hashFromLongdanUrl(blobLink);
									delete body.displayThumbnailData;
									body.displayThumbnailHash = hash;
									body.thumbnailWidth = img.width;
									body.thumbnailHeight = img.height;
									body._attachments = [
										{
											hash: hash,
											category: "thumbnails",
											source: blobLink,
											mimeType: mimeType
										}
									];
									cb(undefined, type, body);
								}
							}.bind(this));
						}.bind(this));
					} else {
						cb(false, type, body);
					}
					return;
				}


				cb(false, type, body);
			}
		}
	}.bind(this));
}

MessagingUtils.prototype._imageUrlToObj = function(url, cb) {
    this._client.blob.downloadUrl(url, function(err, bytes) {
	if (err) {
	    cb(err);
	} else {
	    this._pictureObjFromBytes(bytes, null, cb);
	}
    }.bind(this));
}

// TODO: It would be better to upload the thumbnail; then
// send the PictureObj + thumbRef; then upload the fullsize + fullRef.
MessagingUtils.prototype._pictureObjFromBytes = function(bytes, mimeType, cb) {
    if (!mimeType)
        mimeType = "image/jpeg";
    var body = {
	_attachments: []
    };

    this._client.blob.resizeImage(bytes, [540, 1920], function(err, resized) {
        if (err)
            return cb(err);

	body.fullSizeWidth = resized[1].width;
	body.fullSizeHeight = resized[1].height;
	this._client.blob.uploadBlob(resized[0].data, mimeType, function(err, blobLink) {
	    if (err) {
		cb(err);
	    } else {
		var hash = this._client.blob.hashFromLongdanUrl(blobLink);
		body.thumbnailHash = hash;
		body._attachments.push({
		    hash: hash,
		    category: "thumbnails",
		    source: blobLink,
		    pushType: ObjTypes.PICTURE,
		    mimeType: mimeType
		});
		this._client.blob.uploadBlob(resized[1].data, mimeType, function(err, blobLink) {
		    if (err) {
			cb(err);
		    } else {
			var hash = this._client.blob.hashFromLongdanUrl(blobLink);
			body.fullSizeHash = hash;
			body._attachments.push({
			    hash: hash,
			    category: "thumbnails",
			    source: blobLink,
			    mimeType: mimeType
			});
			cb(undefined, ObjTypes.PICTURE, body);
		    }
		}.bind(this));
	    }
	}.bind(this));
    }.bind(this));
}

MessagingUtils.prototype._animatedGifObjFromBytes = function(gif, cb) {
	var body = { _attachments: [] };
	this._client.blob.resizeImage(gif, [540], function(err, resized) {
		if (err) {
			cb(err);
			return;
		}

		var thumbnail = resized[0];
		this._client.blob.uploadBlob(thumbnail.data, "image/jpeg", function(err, blobLink) {
			if (err) {
				cb(err);
			} else {
				var hash = this._client.blob.hashFromLongdanUrl(blobLink);
				body.thumbnailHash = hash;
				body._attachments.push({
						hash: hash,
						category: "thumbnails",
						source: blobLink,
						mimeType: "imag/jpeg"
					});

				this._client.blob.uploadBlob(gif, "image/gif", function(err, blobLink) {
					if (err) {
						cb(err);
					} else {
						var hash = this._client.blob.hashFromLongdanUrl(blobLink);
						body.gifHash = hash;
						body._attachments.push({
							hash: hash,
							source: blobLink,
							mimeType: "image/gif",
							pushType: ObjTypes.ANIMATED_GIF
						});
						cb(undefined, ObjTypes.ANIMATED_GIF, body);
					}
				}.bind(this));
			}
		}.bind(this));
	}.bind(this));
}

module.exports = MessagingUtils;
