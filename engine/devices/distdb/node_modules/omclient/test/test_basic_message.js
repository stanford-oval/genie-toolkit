var om;
if (typeof window === 'undefined') {
    om = require('../lib/om');
} else {
    om = require('omclient');
}

assert = om.assert;

function abort(cause) {
    console.log("aborting because connection was severed");
    throw cause;
}

var client = new om.client.Client();
assert.ok(client.account);
client.onInterrupted = abort;

var push_received = 0;
function onpush(push) {
    console.log(push);
    ++push_received;
}

client._msg.onPush = onpush;

client.enable();

function subscribe() {
    client.msgCall(new om.proto.LDSubscribeForAccountInboxRequest(), onsubscribe);
}
function onsubscribe(error, resp, req) {
    assert.ifError(error);
    console.log("subscribed");
    createfeed();
}

var test_feed = null;
function createfeed() {
    test_feed = new om.proto.LDFeed();
    test_feed.Account = client.account;
    test_feed.Key = om.createNonce();
    var req = new om.proto.LDCreateFeedRequest();
    req.Feed = test_feed;
    client.msgCall(req, oncreatedfeed);
}

function oncreatedfeed(error, resp, req) {
    assert.ifError(error);
    console.log("created");
    sendmessage();
}

function sendmessage() {
    var req = new om.proto.LDOverwriteMessageRequest();
    req.Feed = test_feed;
    req.AnyMemberWritable = false;
    req.Body = om.createNonce();
    req.Id = new om.proto.LDTypedId();
    req.Id.Type = "test";
    req.Id.Id = new om.Buffer("123");
    req.Version = 0;
    client.msgCall(req, onsentmessage);
}

function onsentmessage(error, resp, req) {
    assert.ifError(error);
    console.log("sent");
    sendfailmessage();
}

function sendfailmessage() {
    var req = new om.proto.LDAddMessageRequest();
    req.Feed = test_feed;
    req.AnyMemberWritable = false;
    req.Body = new om.Buffer("bar");
    req.Id = new om.proto.LDTypedId();
    req.Id.Type = "test";
    req.Id.Id = new om.Buffer("123");
    req.Version = 0;
    client.msgCall(req, onsentfailmessage);
}

function onsentfailmessage(error, resp, req) {
    assert.ok(error);
    assert.equal(om.client.PermanentFailure, error.constructor);
    assert.equal("MessageAlreadyExists", error.error);
    console.log("sent reject :)");
    assert.equal(2, push_received);
    client.onInterrupted = null;
    client.disable();
}

//start test
subscribe();