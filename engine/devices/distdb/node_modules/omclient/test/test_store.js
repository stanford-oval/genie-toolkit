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
client.enable();

function createiteminfo() {
    var req = new om.proto.LDCreateItemInfoRequest();
    req.ItemType = om.proto.LDStoreItemType.App;
    req.Account = client.account;
    req.ItemId = "appId1";
    client.msgCall(req, oncreateiteminfo);
}

function oncreateiteminfo(error, resp, req) {
    assert.ifError(error);
    console.log("app created");
    listiteminfo();
}

function listiteminfo() {
    var req = new om.proto.LDListItemsForAccountRequest();
    req.ItemType = "App";
    req.Account = client.account;
    client.msgCall(req, onlistiteminfo);
}

function onlistiteminfo(error, resp, req) {
    assert.ifError(error);
    assert.ok(resp.ItemInfoListingContainer);
    assert.equal(1,resp.ItemInfoListingContainer.AppInfoList.Items.length);
    console.log("got 1 app info");
    assert.equal("appId1", resp.ItemInfoListingContainer.AppInfoList.Items[0].ImmutableContainer.AppInfoImmutable.ItemId.GivenId);
    console.log("app id is as expected");
    deleteiteminfo(disable, false);
}

function deleteiteminfo(next, noassert) {
    var req = new om.proto.LDDeleteItemRequest();
    req.ItemType = om.proto.LDStoreItemType.App;
    req.Account = client.account;
    req.ItemId = "appId1";
    client.msgCall(req, ondeleteiteminfo.bind(undefined, next, noassert));
}

function ondeleteiteminfo(next, noassert, error, resp, req) {
    if(!noassert)
        assert.ifError(error);
    console.log("app deleted");
    next();
}

function disable() {
    client.onInterrupted = null;
    client.disable();
}

createiteminfo();