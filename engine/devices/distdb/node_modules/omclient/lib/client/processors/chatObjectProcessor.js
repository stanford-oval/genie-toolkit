var proto = require("../../ldproto");
var tpl = require("../../tpl");

function ChatObjectProcessor() {

}

ChatObjectProcessor.prototype.processMessage = function(client, db, feed, sender, msg, receipt) {
  var tcs = new tpl.TaskCompletionSource();
  var t = Math.round(msg.Timestamp / 1000);
  var body = JSON.parse(msg.Body);
  body.type = msg.Id.Type;
  body.senderId = client.store.getObjectId(sender);
  body.serverTimestamp = t;
  body.msgId = client.store.getObjectId(receipt);
  var feedId = client.store.getObjectId(feed);

  client.store.getFeedObjects(feedId, function(objectsDb) {
      if (feed.renderableTime < t) {
          feed.renderableTime = t;
          feed.renderableObj = body;
      }
      feed.messageCount++;

      db.feeds.update(feed);
      objectsDb.getObjectByKey(body.msgId, function(existing) {
        if (existing) {
            existing.serverTimestamp = t;
            objectsDb.update(existing, function() {
                tcs.setResult(true);
            }.bind(this));
        } else {
            objectsDb.insert(body, function() {
               tcs.setResult(true);
            });
        }
      }.bind(this));
  }.bind(this));

  return tcs.task;
}

module.exports = ChatObjectProcessor;