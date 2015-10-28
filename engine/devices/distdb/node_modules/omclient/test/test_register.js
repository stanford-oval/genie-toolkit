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

var client = new om.client.Client({reset:true});
client.onInterrupted = abort;

function subscribe() {
    client.msgCall(new om.proto.LDSubscribeForAccountInboxRequest(), onsubscribe);
}
function onsubscribe(error, resp, req) {
    assert.ifError(error);
    console.log("account works on message server " + client.account);
    client.disable();
}
client.onSignedUp = subscribe;

var identity = new om.proto.LDIdentity();
identity.Principal = "tj+cn@mobisocial.us";
identity.Type = om.proto.LDIdentityType.Email;

var register = new om.proto.LDRegisterWithTokenRequest();
register.Identity = identity;
register.Locale = "en_US";
register.RequestedCluster = "TWO";

function onregister(error, resp) {
    assert.ifError(error);
}
console.log("enqueued confirm");
client.idpCall(register, onregister);
client.enable();

