var proto = require("../../ldproto");

function FeedDetailsProcessor() {

}

FeedDetailsProcessor.prototype.processMessage = function(client, db, feed, sender, msg) {
  var details = JSON.parse(msg.Body.toString("utf8"));
  
  feed.specifiedName = details.name;  	
  if (details.name) {
  	feed.name = details.name;
  }
  if (details.thumbnailLink) {
  	var hash = client.blob.hashFromLongdanUrl(details.thumbnailLink);
  	client.blob.ensureBlobSource(hash, details.thumbnailLink);
  	feed.thumbnailHash = feed.specifiedThumbnailHash = hash;
  }
  db.feeds.update(feed);
}

module.exports = FeedDetailsProcessor;