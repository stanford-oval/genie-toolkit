var om = require('omclient');

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
//    console.log("Beeing push");
    if(push.Message.Id.Type.toString() == "-acceptance"){
         ++push_received;
  //      console.log("Somebody is requesting feedback");
  //      console.log("Feed -> ",push.Message.Feed);
  //      console.log("Account toString() -> ",push.Message.Feed.Account);
  //      console.log("Key -> ",push.Message.Feed.Key);
 
        var req = new om.proto.LDOverwriteMessageRequest();
        req.Feed = push.Message.Feed;
        req.AnyMemberWritable = false;
        req.Body = new om.Buffer(JSON.stringify({text:"你好，欢迎使用蛋宝！\n\n你可以用这个聊天室与蛋宝团队直接沟通，告诉我们你的想法，或询问有关蛋宝的问题。我们会尽快回复。 如有关于蛋宝的基本问题， 您也可以先查看我们的常见问题网页 http://www.omlet.me/help_CN。\n\n谢谢 \n\n蛋宝 (Omlet) 团队 "}));
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
var client = new om.client.Client({instance:"cn"});
client.onInterrupted = subscribe;
client.onSignedUp = subscribe;
client.onPush = onPushSendFeedback; // Send Feedback on each new push of new feed created

var identity = new om.proto.LDIdentity();
identity.Principal = "feedback+cn@omlet.me";
identity.Type = om.proto.LDIdentityType.Email;

var register = new om.proto.LDRegisterWithTokenRequest();
register.Identity = identity;
register.Locale = "en_US";
register.RequestedCluster = "THREE";

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
