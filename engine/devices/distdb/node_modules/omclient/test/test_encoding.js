var om;
if (typeof window === 'undefined') {
    om = require('../lib/om');
} else {
    om = require('omclient');
}

assert = om.assert;

var a = new om.proto.LDAccountDetails();
a.Account = "acc";
a.Cluster = "clu";
a.Identities = [new om.proto.LDIdentity()];
a.Identities[0].Type = "email";
a.Identities[0].Principal = "foo@bar.com";
assert.equal(JSON.stringify(a), JSON.stringify(new om.proto.LDAccountDetails(a.encode())));

var cc = { "ClusterEndpoints": { "ONE": ["http://127.0.0.1:3829"] }, "ClusterKeys": { "ONE": "80Qd+N2ml/Iahcd5kFfzLdT+3Kel7wS/2AwCybtGblA=" }, "DefaultCluster": "ONE", "IdpEndpoints": ["http://127.0.0.1:4001"], "IdpKey": "A2kW+bIHpCz0Xv2t7SVGPDjqXQbHPsBkFNtIhR3ruzk=" };

var ccs = new om.proto.LDPublicKeys(cc);
assert.equal(JSON.stringify(cc), JSON.stringify(ccs.encode()));

var req = new om.proto.LDDeviceToClusterRequestContainer();
req = new om.proto.LDDeviceAddPendingInvitationRequest();
req.Feed = new om.proto.LDFeed();
req.Feed.Account = "someone";
req.Feed.Key = om.createNonce();
req.IdentityHash = new om.proto.LDIdentityHash();
req.IdentityHash.Type = om.proto.LDIdentityType.Email;
req.IdentityHash.Hash = om.createNonce(16);

var wrapped = new om.proto.LDDeviceToClusterRpcWrapper();
wrapped.Request = new om.proto.LDDeviceToClusterRequestContainer();
wrapped.Request.Message = new om.proto.LDDeviceToClusterMessageRequestProtocol();
wrapped.Request.Message.AddPendingInvitation = req;
assert.equal(JSON.stringify(wrapped), JSON.stringify(new om.proto.LDDeviceToClusterRpcWrapper(wrapped.encode())));
assert.equal(JSON.stringify(req.makeClusterRpc()), JSON.stringify(new om.proto.LDDeviceToClusterRpcWrapper(wrapped.encode())));
