var proto = require("../../ldproto");

function FeedInvitationProcessor() {

}

FeedInvitationProcessor.prototype.processMessage = function(client, db, feed, sender, msg) {
  //var ldHash = new proto.LDIdentityHash(JSON.parse(msg.Id.Id.toString("utf8")));
  var ldHashString = msg.Id.Id.toString("utf8");

  var feedId = client.store.getObjectId(feed);
  db.feeds.getObjectById(feedId, function(feed) {
      if (!feed) {
        console.warn("Feed was removed while adding invitation!");
        return;
      }

      if (!feed.invitations)
        feed.invitations = [];

      var needed = true;
      feed.invitations.forEach(function(invitation) {
        if (invitation == ldHashString) {
          needed = false;
          return false;
        }
      });

      if (needed) {
        feed.invitations.push(ldHashString);
        db.feeds.update(feed);
      }
  })
}

module.exports = FeedInvitationProcessor;