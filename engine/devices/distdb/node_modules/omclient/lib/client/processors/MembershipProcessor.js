var proto = require("../../ldproto");

function MembershipProcessor() {

}

MembershipProcessor.prototype.processMessage = function(client, db, feed, sender, msg) {
   var account = msg.Id.Id.toString("utf8");
   client._feed.ensureFeedMember(feed, account);

   client._identity.ensureIdentity({
    		account: account,
    		profileVersion: Number.MIN_VALUE
   });
}

module.exports = MembershipProcessor;