var om;
if (typeof window === 'undefined') {
    om = require('../lib/om');
} else {
    om = require('omclient');
}

assert = om.assert;

var TEST_KEYS = new om.proto.LDPublicKeys({
    "ClusterEndpoints": { "ONE": ["http://127.0.0.1:3829"] },
    "ClusterKeys": { "ONE": "80Qd+N2ml/Iahcd5kFfzLdT+3Kel7wS/2AwCybtGblA=" },
    "DefaultCluster": "ONE",
    "IdpEndpoints": ["http://127.0.0.1:4001"],
    "IdpKey": "A2kW+bIHpCz0Xv2t7SVGPDjqXQbHPsBkFNtIhR3ruzk="
});

function abort(cause) {
    console.log("aborting because connection was severed");
    throw cause;
}
function subscribe() {
    console.log("trying to subscribe")
    client.msgCall(new om.proto.LDSubscribeForAccountInboxRequest(), onsubscribe);
}
function onsubscribe(error, resp, req) {
    assert.ifError(error);
    console.log("account works on message server " + client.account);
    //client.disable();
}
function onsentfeedbackmessage(error, resp, req) {
    console.log("sent");
}
function onPushSendFeedback(push) {
    console.log("Beeing push");
    if(push.Message.Id.Type.toString() == "-acceptance"){
         ++push_received;
        console.log("Somebody is requesting feedback");
        console.log("Feed -> ",push.Message.Feed);
        console.log("Account toString() -> ",push.Message.Feed.Account);
        console.log("Key -> ",push.Message.Feed.Key);
 
        var req = new om.proto.LDOverwriteMessageRequest();
        req.Feed = push.Message.Feed;
        req.AnyMemberWritable = false;
        req.Body = new om.Buffer(JSON.stringify({text:"Hi, Welcome! We have created this chat for you to reach out to Omlet team directly, to tell us what you think about Omlet, or ask questions about the app. We love to hear from you so if you have something you would like to ask us or a suggestion on how to improve your Omlet experience, drop us a line and we'll get back to you as soon as we can! Cheers, Team Omlet"}));
        req.Id = new om.proto.LDTypedId();
        req.Id.Type = "text";
        req.Id.Id = new om.createNonce(16);
        req.Version = 0;
        client.msgCall(req,onsentfeedbackmessage);
    }
}


// ##########################################################################################
// #########################                WORKFLOW              ###########################
// ##########################################################################################
var push_received = 0; // push counter
//var client = new om.client.Client({keys:TEST_KEYS,local:true});//{reset:true}); // TEST LOCALLLY
var client = new om.client.Client();
client.onInterrupted = subscribe;
client.onSignedUp = subscribe;
client.onPush = onPushSendFeedback; // Send Feedback on each new push of new feed created

var identity = new om.proto.LDIdentity();
identity.Principal = "feedback@omlet.me";
identity.Type = om.proto.LDIdentityType.Email;

var register = new om.proto.LDRegisterWithTokenRequest();
register.Identity = identity;
register.Locale = "en_US";
register.RequestedCluster = "ONE";

function onregister(error, resp) {
    assert.ifError(error);
}

console.log("enqueued confirm");


console.log("Checking if there's a registered account in the client");
//Check if it's registered
if(client.account!=null){
    console.log("Already Registered: ",client.account);
    subscribe();
}
else{
    console.log("Registering Account -> ", register );
    client.idpCall(register, onregister);
}
console.log("Enabling the client");
client.enable();
//Now send the message
