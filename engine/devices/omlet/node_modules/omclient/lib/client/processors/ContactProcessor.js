var proto = require("../../ldproto");

function ContactProcessor() {

}

ContactProcessor.prototype.processMessage = function(client, db, feed, sender, msg) {
	// TODO: Protocol generator for ldobjects.
   var contact = new proto.LDContactDetails(JSON.parse(msg.Body.toString("utf8")).c);

   if (contact.ProfilePictureLink) {
	   	var hash = client.blob.hashFromLongdanUrl(contact.ProfilePictureLink);
	  	client.blob.ensureBlobSource(hash, contact.ProfilePictureLink);
   }

   var idHashes = contact.Hashidentities.map(function(h) { return JSON.stringify(h.encode()); });

   client._identity.ensureIdentity({
   		account: contact.Account,
   		name: contact.Name,
   		thumbnailHash: hash,
   		hasAppTime: contact.HasAppTime,
   		profileVersion: contact.Version,
         hashidentities: idHashes
         //linkedIdentities: contact.Identities
   }, function(account) {
      var accountId = client.store.getObjectId(account);
      idHashes.forEach(function(idHash) {
         db.identityHashes.getObjectByKey(idHash, function(existing) {
            if (existing) {
               if (existing.accountId != accountId) {
                  existing.accountId = accountId;
                  db.identityHashes.update(existing);
               }
            } else {
               db.identityHashes.insert({
                  identityHash: idHash,
                  accountId: accountId
               });
            }
         }.bind(this))
      }.bind(this));
   }.bind(this));
}

module.exports = ContactProcessor;