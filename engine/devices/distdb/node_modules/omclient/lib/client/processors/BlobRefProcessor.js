var proto = require("../../ldproto");

function BlobRefProcessor() {

}

BlobRefProcessor.prototype.processMessage = function(client, db, feed, sender, msg) {
	var bref = JSON.parse(msg.Body.toString("utf8"));
	var source = bref.Source;
	if (source == null) {
		throw new Exception("No blob source");
	}

	if (source.startsWith("http://") ||
		source.startsWith("https://") ||
		source.startsWith("hosted://") ||
		source.startsWith("longdan://")) {

		client.blob.ensureBlobSource(bref.Hash, source, msg.Timestamp/1000, feed);
	} else if (source.startsWith("hosted://")) {
		var brl = source + "#" + bref.Hash;
		client.blob.ensureBlobSource(bref.Hash, source, msg.Timestamp/1000, feed);
	}
}

module.exports = BlobRefProcessor;