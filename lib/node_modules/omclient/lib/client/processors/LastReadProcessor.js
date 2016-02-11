var proto = require("../../ldproto");

function LastReadProcessor() {

}

LastReadProcessor.prototype.processMessage = function(client, db, feed, sender, msg) {
   //console.log("LastRead " + JSON.parse(msg.Body.toString("utf8")));
}

module.exports = LastReadProcessor;