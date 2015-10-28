function LDJSONLoggable(e) { 
}
LDJSONLoggable.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    return o;
}
function LDRequestContainerBase(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['#'] !== null && e['#'] !== undefined))
        this.RequestId = e['#'];
    else
        this.RequestId = null;
    if(e && (e['@'] !== null && e['@'] !== undefined))
        this.Context = new LDRpcContext(e['@']);
    if(e && (e['*'] !== null && e['*'] !== undefined))
        this.HelloChallenge = new LDHelloChallengeRequest(e['*']);
    if(e && (e['+'] !== null && e['+'] !== undefined))
        this.CompleteChallenge = new LDCompleteChallengeRequest(e['+']);
    if(e && (e['-'] !== null && e['-'] !== undefined))
        this.Ping = new LDPingRequest(e['-']);
}
LDRequestContainerBase.prototype = new LDJSONLoggable();
LDRequestContainerBase.prototype.constructor = LDRequestContainerBase;
LDRequestContainerBase.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.RequestId !== null) o['#'] = this.RequestId;
    if(this.Context !== null) o['@'] = this.Context.encode();
    if(this.HelloChallenge !== null) o['*'] = this.HelloChallenge.encode();
    if(this.CompleteChallenge !== null) o['+'] = this.CompleteChallenge.encode();
    if(this.Ping !== null) o['-'] = this.Ping.encode();
    return o;
}
LDRequestContainerBase.prototype.RequestId = null;
LDRequestContainerBase.prototype.Context = null;
LDRequestContainerBase.prototype.HelloChallenge = null;
LDRequestContainerBase.prototype.CompleteChallenge = null;
LDRequestContainerBase.prototype.Ping = null;
function LDDeviceToIdpRequestContainer(e) { 
    LDRequestContainerBase.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Signup = new LDDeviceToIdpSignupRequestProtocol(e['a']);
    if(e && (e['A'] !== null && e['A'] !== undefined))
        this.Administrative = new LDDeviceToIdpAdministrativeRequestProtocol(e['A']);
}
LDDeviceToIdpRequestContainer.prototype = new LDRequestContainerBase();
LDDeviceToIdpRequestContainer.prototype.constructor = LDDeviceToIdpRequestContainer;
LDDeviceToIdpRequestContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestContainerBase.prototype.encode.call(this, o);
    if(this.Signup !== null) o['a'] = this.Signup.encode();
    if(this.Administrative !== null) o['A'] = this.Administrative.encode();
    return o;
}
LDDeviceToIdpRequestContainer.prototype.Signup = null;
LDDeviceToIdpRequestContainer.prototype.Administrative = null;
function LDResponseContainerBase(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['#'] !== null && e['#'] !== undefined))
        this.RequestId = e['#'];
    else
        this.RequestId = null;
    if(e && (e['!'] !== null && e['!'] !== undefined))
        this.ErrorCode = e['!'];
    else
        this.ErrorCode = null;
    if(e && (e['!!'] !== null && e['!!'] !== undefined))
        this.ErrorDetail = e['!!'];
    else
        this.ErrorDetail = null;
    if(e && (e['*'] !== null && e['*'] !== undefined))
        this.HelloChallenge = new LDHelloChallengeResponse(e['*']);
    if(e && (e['+'] !== null && e['+'] !== undefined))
        this.CompleteChallenge = new LDCompleteChallengeResponse(e['+']);
    if(e && (e['='] !== null && e['='] !== undefined))
        this.Simple = new LDSimpleResponse(e['=']);
    if(e && (e['-'] !== null && e['-'] !== undefined))
        this.Ping = new LDPingResponse(e['-']);
}
LDResponseContainerBase.prototype = new LDJSONLoggable();
LDResponseContainerBase.prototype.constructor = LDResponseContainerBase;
LDResponseContainerBase.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.RequestId !== null) o['#'] = this.RequestId;
    if(this.ErrorCode !== null) o['!'] = this.ErrorCode;
    if(this.ErrorDetail !== null) o['!!'] = this.ErrorDetail;
    if(this.HelloChallenge !== null) o['*'] = this.HelloChallenge.encode();
    if(this.CompleteChallenge !== null) o['+'] = this.CompleteChallenge.encode();
    if(this.Simple !== null) o['='] = this.Simple.encode();
    if(this.Ping !== null) o['-'] = this.Ping.encode();
    return o;
}
LDResponseContainerBase.prototype.RequestId = null;
LDResponseContainerBase.prototype.ErrorCode = null;
LDResponseContainerBase.prototype.ErrorDetail = null;
LDResponseContainerBase.prototype.HelloChallenge = null;
LDResponseContainerBase.prototype.CompleteChallenge = null;
LDResponseContainerBase.prototype.Simple = null;
LDResponseContainerBase.prototype.Ping = null;
function LDDeviceToIdpResponseContainer(e) { 
    LDResponseContainerBase.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Signup = new LDDeviceToIdpSignupResponseProtocol(e['a']);
    if(e && (e['A'] !== null && e['A'] !== undefined))
        this.Administrative = new LDDeviceToIdpAdministrativeResponseProtocol(e['A']);
}
LDDeviceToIdpResponseContainer.prototype = new LDResponseContainerBase();
LDDeviceToIdpResponseContainer.prototype.constructor = LDDeviceToIdpResponseContainer;
LDDeviceToIdpResponseContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseContainerBase.prototype.encode.call(this, o);
    if(this.Signup !== null) o['a'] = this.Signup.encode();
    if(this.Administrative !== null) o['A'] = this.Administrative.encode();
    return o;
}
LDDeviceToIdpResponseContainer.prototype.Signup = null;
LDDeviceToIdpResponseContainer.prototype.Administrative = null;
function LDDeviceToClusterRequestContainer(e) { 
    LDRequestContainerBase.call(this, e);
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Message = new LDDeviceToClusterMessageRequestProtocol(e['m']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Inbox = new LDDeviceToClusterInboxRequestProtocol(e['i']);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.Blob = new LDClusterOrDeviceToClusterBlobRequestProtocol(e['b']);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.Contact = new LDDeviceToClusterContactRequestProtocol(e['c']);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Profile = new LDDeviceToClusterProfileRequestProtocol(e['p']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AddressBook = new LDDeviceToClusterAddressBookRequestProtocol(e['a']);
    if(e && (e['oas'] !== null && e['oas'] !== undefined))
        this.OmletAppStore = new LDDeviceToClusterOmletItemStoreRequestProtocol(e['oas']);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Device = new LDDeviceToClusterDeviceRequestProtocol(e['d']);
    if(e && (e['cs'] !== null && e['cs'] !== undefined))
        this.CloudSync = new LDDeviceToClusterCloudSyncRequestProtocol(e['cs']);
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.GameChallenge = new LDDeviceToClusterGameChallengeRequestProtocol(e['g']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Subscription = new LDDeviceToClusterSubscriptionRequestProtocol(e['s']);
    if(e && (e['h'] !== null && e['h'] !== undefined))
        this.HighScore = new LDDeviceToClusterHighScoreRequestProtocol(e['h']);
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.NearbyItem = new LDDeviceToClusterNearbyItemRequestProtocol(e['n']);
    if(e && (e['M'] !== null && e['M'] !== undefined))
        this.Misc = new LDDeviceToClusterMiscellaneousRequestProtocol(e['M']);
    if(e && (e['o'] !== null && e['o'] !== undefined))
        this.Oob = new LDDeviceToClusterDirectMessagingRequestProtocol(e['o']);
    if(e && (e['w'] !== null && e['w'] !== undefined))
        this.WallPost = new LDDeviceToClusterWallPostRequestProtocol(e['w']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.IdentityToken = new LDDeviceToClusterIdentityTokenRequestProtocol(e['t']);
}
LDDeviceToClusterRequestContainer.prototype = new LDRequestContainerBase();
LDDeviceToClusterRequestContainer.prototype.constructor = LDDeviceToClusterRequestContainer;
LDDeviceToClusterRequestContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestContainerBase.prototype.encode.call(this, o);
    if(this.Message !== null) o['m'] = this.Message.encode();
    if(this.Inbox !== null) o['i'] = this.Inbox.encode();
    if(this.Blob !== null) o['b'] = this.Blob.encode();
    if(this.Contact !== null) o['c'] = this.Contact.encode();
    if(this.Profile !== null) o['p'] = this.Profile.encode();
    if(this.AddressBook !== null) o['a'] = this.AddressBook.encode();
    if(this.OmletAppStore !== null) o['oas'] = this.OmletAppStore.encode();
    if(this.Device !== null) o['d'] = this.Device.encode();
    if(this.CloudSync !== null) o['cs'] = this.CloudSync.encode();
    if(this.GameChallenge !== null) o['g'] = this.GameChallenge.encode();
    if(this.Subscription !== null) o['s'] = this.Subscription.encode();
    if(this.HighScore !== null) o['h'] = this.HighScore.encode();
    if(this.NearbyItem !== null) o['n'] = this.NearbyItem.encode();
    if(this.Misc !== null) o['M'] = this.Misc.encode();
    if(this.Oob !== null) o['o'] = this.Oob.encode();
    if(this.WallPost !== null) o['w'] = this.WallPost.encode();
    if(this.IdentityToken !== null) o['t'] = this.IdentityToken.encode();
    return o;
}
LDDeviceToClusterRequestContainer.prototype.Message = null;
LDDeviceToClusterRequestContainer.prototype.Inbox = null;
LDDeviceToClusterRequestContainer.prototype.Blob = null;
LDDeviceToClusterRequestContainer.prototype.Contact = null;
LDDeviceToClusterRequestContainer.prototype.Profile = null;
LDDeviceToClusterRequestContainer.prototype.AddressBook = null;
LDDeviceToClusterRequestContainer.prototype.OmletAppStore = null;
LDDeviceToClusterRequestContainer.prototype.Device = null;
LDDeviceToClusterRequestContainer.prototype.CloudSync = null;
LDDeviceToClusterRequestContainer.prototype.GameChallenge = null;
LDDeviceToClusterRequestContainer.prototype.Subscription = null;
LDDeviceToClusterRequestContainer.prototype.HighScore = null;
LDDeviceToClusterRequestContainer.prototype.NearbyItem = null;
LDDeviceToClusterRequestContainer.prototype.Misc = null;
LDDeviceToClusterRequestContainer.prototype.Oob = null;
LDDeviceToClusterRequestContainer.prototype.WallPost = null;
LDDeviceToClusterRequestContainer.prototype.IdentityToken = null;
function LDDeviceToClusterResponseContainer(e) { 
    LDResponseContainerBase.call(this, e);
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Message = new LDDeviceToClusterMessageResponseProtocol(e['m']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Inbox = new LDDeviceToClusterInboxResponseProtocol(e['i']);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.Blob = new LDClusterOrDeviceToClusterBlobResponseProtocol(e['b']);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.Contact = new LDDeviceToClusterContactResponseProtocol(e['c']);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Profile = new LDDeviceToClusterProfileResponseProtocol(e['p']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AddressBook = new LDDeviceToClusterAddressBookResponseProtocol(e['a']);
    if(e && (e['oas'] !== null && e['oas'] !== undefined))
        this.OmletAppStore = new LDDeviceToClusterOmletItemStoreResponseProtocol(e['oas']);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Device = new LDDeviceToClusterDeviceResponseProtocol(e['d']);
    if(e && (e['cs'] !== null && e['cs'] !== undefined))
        this.CloudSync = new LDDeviceToClusterCloudSyncResponseProtocol(e['cs']);
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.GameChallenge = new LDDeviceToClusterGameChallengeResponseProtocol(e['g']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Subscription = new LDDeviceToClusterSubscriptionResponseProtocol(e['s']);
    if(e && (e['h'] !== null && e['h'] !== undefined))
        this.HighScore = new LDDeviceToClusterHighScoreResponseProtocol(e['h']);
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.NearbyItem = new LDDeviceToClusterNearbyItemResponseProtocol(e['n']);
    if(e && (e['M'] !== null && e['M'] !== undefined))
        this.Misc = new LDDeviceToClusterMiscellaneousResponseProtocol(e['M']);
    if(e && (e['o'] !== null && e['o'] !== undefined))
        this.Oob = new LDDeviceToClusterDirectMessagingResponseProtocol(e['o']);
    if(e && (e['w'] !== null && e['w'] !== undefined))
        this.WallPost = new LDDeviceToClusterWallPostResponseProtocol(e['w']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.IdentityToken = new LDDeviceToClusterIdentityTokenResponseProtocol(e['t']);
}
LDDeviceToClusterResponseContainer.prototype = new LDResponseContainerBase();
LDDeviceToClusterResponseContainer.prototype.constructor = LDDeviceToClusterResponseContainer;
LDDeviceToClusterResponseContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseContainerBase.prototype.encode.call(this, o);
    if(this.Message !== null) o['m'] = this.Message.encode();
    if(this.Inbox !== null) o['i'] = this.Inbox.encode();
    if(this.Blob !== null) o['b'] = this.Blob.encode();
    if(this.Contact !== null) o['c'] = this.Contact.encode();
    if(this.Profile !== null) o['p'] = this.Profile.encode();
    if(this.AddressBook !== null) o['a'] = this.AddressBook.encode();
    if(this.OmletAppStore !== null) o['oas'] = this.OmletAppStore.encode();
    if(this.Device !== null) o['d'] = this.Device.encode();
    if(this.CloudSync !== null) o['cs'] = this.CloudSync.encode();
    if(this.GameChallenge !== null) o['g'] = this.GameChallenge.encode();
    if(this.Subscription !== null) o['s'] = this.Subscription.encode();
    if(this.HighScore !== null) o['h'] = this.HighScore.encode();
    if(this.NearbyItem !== null) o['n'] = this.NearbyItem.encode();
    if(this.Misc !== null) o['M'] = this.Misc.encode();
    if(this.Oob !== null) o['o'] = this.Oob.encode();
    if(this.WallPost !== null) o['w'] = this.WallPost.encode();
    if(this.IdentityToken !== null) o['t'] = this.IdentityToken.encode();
    return o;
}
LDDeviceToClusterResponseContainer.prototype.Message = null;
LDDeviceToClusterResponseContainer.prototype.Inbox = null;
LDDeviceToClusterResponseContainer.prototype.Blob = null;
LDDeviceToClusterResponseContainer.prototype.Contact = null;
LDDeviceToClusterResponseContainer.prototype.Profile = null;
LDDeviceToClusterResponseContainer.prototype.AddressBook = null;
LDDeviceToClusterResponseContainer.prototype.OmletAppStore = null;
LDDeviceToClusterResponseContainer.prototype.Device = null;
LDDeviceToClusterResponseContainer.prototype.CloudSync = null;
LDDeviceToClusterResponseContainer.prototype.GameChallenge = null;
LDDeviceToClusterResponseContainer.prototype.Subscription = null;
LDDeviceToClusterResponseContainer.prototype.HighScore = null;
LDDeviceToClusterResponseContainer.prototype.NearbyItem = null;
LDDeviceToClusterResponseContainer.prototype.Misc = null;
LDDeviceToClusterResponseContainer.prototype.Oob = null;
LDDeviceToClusterResponseContainer.prototype.WallPost = null;
LDDeviceToClusterResponseContainer.prototype.IdentityToken = null;
function LDPublicKeys(e) { 
    if(e && (e['ClusterEndpoints'] !== null && e['ClusterEndpoints'] !== undefined)) { 
        this.ClusterEndpoints = {};
        var d = e['ClusterEndpoints'];
        for(var k in d) {
            var d2 = d[k];
            this.ClusterEndpoints[k] = [];
            for(var k2 = 0; k2 < d2.length; ++k2) this.ClusterEndpoints[k].push(d2[k2]);
        }
    }
    if(e && (e['ClusterKeys'] !== null && e['ClusterKeys'] !== undefined)) { 
        this.ClusterKeys = {};
        var d = e['ClusterKeys'];
        for(var k in d) this.ClusterKeys[k] = new Buffer(d[k], 'base64');
    }
    if(e && (e['DefaultCluster'] !== null && e['DefaultCluster'] !== undefined))
        this.DefaultCluster = e['DefaultCluster'];
    else
        this.DefaultCluster = null;
    if(e && (e['IdpEndpoints'] !== null && e['IdpEndpoints'] !== undefined)) { 
        this.IdpEndpoints = [];
        var d = e['IdpEndpoints'];
        for(var k = 0; k < d.length; ++k) this.IdpEndpoints.push(d[k]);
    }
    if(e && (e['IdpKey'] !== null && e['IdpKey'] !== undefined))
        this.IdpKey = new Buffer(e['IdpKey'], 'base64');
    if(e && (e['ReadOnlyEndpoints'] !== null && e['ReadOnlyEndpoints'] !== undefined)) { 
        this.ReadOnlyEndpoints = [];
        var d = e['ReadOnlyEndpoints'];
        for(var k = 0; k < d.length; ++k) this.ReadOnlyEndpoints.push(d[k]);
    }
    if(e && (e['ReadOnlyKey'] !== null && e['ReadOnlyKey'] !== undefined))
        this.ReadOnlyKey = new Buffer(e['ReadOnlyKey'], 'base64');
}
LDPublicKeys.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ClusterEndpoints !== null) { 
        o['ClusterEndpoints'] = {};
        var d = this.ClusterEndpoints;
        for(var k in d) {
            var d2 = d[k];
            o['ClusterEndpoints'][k] = [];
            for(var k2 = 0; k2 < d2.length; ++k2) o['ClusterEndpoints'][k].push(d2[k2]);
        }
    } else {
        this.ClusterEndpoints = null;
    }
    if(this.ClusterKeys !== null) { 
        o['ClusterKeys'] = {};
        var d = this.ClusterKeys;
        for(var k in d) o['ClusterKeys'][k] = d[k].toString('base64');
    } else {
        o['ClusterKeys'] = null;
    }
    if(this.DefaultCluster !== null) o['DefaultCluster'] = this.DefaultCluster;
    if(this.IdpEndpoints !== null) { 
        o['IdpEndpoints'] = [];
        var d = this.IdpEndpoints;
        for(var k = 0; k < d.length; ++k) o['IdpEndpoints'].push(d[k]);
    } else {
        o['IdpEndpoints'] = null;
    }
    if(this.IdpKey !== null) o['IdpKey'] = this.IdpKey.toString('base64');
    if(this.ReadOnlyEndpoints !== null) { 
        o['ReadOnlyEndpoints'] = [];
        var d = this.ReadOnlyEndpoints;
        for(var k = 0; k < d.length; ++k) o['ReadOnlyEndpoints'].push(d[k]);
    } else {
        o['ReadOnlyEndpoints'] = null;
    }
    if(this.ReadOnlyKey !== null) o['ReadOnlyKey'] = this.ReadOnlyKey.toString('base64');
    return o;
}
LDPublicKeys.prototype.ClusterEndpoints = null;
LDPublicKeys.prototype.ClusterKeys = null;
LDPublicKeys.prototype.DefaultCluster = null;
LDPublicKeys.prototype.IdpEndpoints = null;
LDPublicKeys.prototype.IdpKey = null;
LDPublicKeys.prototype.ReadOnlyEndpoints = null;
LDPublicKeys.prototype.ReadOnlyKey = null;
function LDSynchronizedMessageBody(e) { 
    LDJSONLoggable.call(this, e);
}
LDSynchronizedMessageBody.prototype = new LDJSONLoggable();
LDSynchronizedMessageBody.prototype.constructor = LDSynchronizedMessageBody;
LDSynchronizedMessageBody.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDAcceptanceChange(e) { 
    LDSynchronizedMessageBody.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Acceptance = e['a'];
    else
        this.Acceptance = null;
}
LDAcceptanceChange.prototype = new LDSynchronizedMessageBody();
LDAcceptanceChange.prototype.constructor = LDAcceptanceChange;
LDAcceptanceChange.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDSynchronizedMessageBody.prototype.encode.call(this, o);
    if(this.Acceptance !== null) o['a'] = this.Acceptance;
    return o;
}
LDAcceptanceChange.prototype.Acceptance = null;
function LDBroadcastSettings(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Pin = e['p'];
    else
        this.Pin = null;
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.Expiration = e['e'];
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Latitude = e['a'];
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.Longitude = e['g'];
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.Radius = e['r'];
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.BroadcasterAccount = e['b'];
    else
        this.BroadcasterAccount = null;
}
LDBroadcastSettings.prototype = new LDJSONLoggable();
LDBroadcastSettings.prototype.constructor = LDBroadcastSettings;
LDBroadcastSettings.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Pin !== null) o['p'] = this.Pin;
    if(this.Expiration !== null) o['e'] = this.Expiration;
    if(this.Latitude !== null) o['a'] = this.Latitude;
    if(this.Longitude !== null) o['g'] = this.Longitude;
    if(this.Radius !== null) o['r'] = this.Radius;
    if(this.BroadcasterAccount !== null) o['b'] = this.BroadcasterAccount;
    return o;
}
LDBroadcastSettings.prototype.Pin = null;
LDBroadcastSettings.prototype.Expiration = null;
LDBroadcastSettings.prototype.Latitude = null;
LDBroadcastSettings.prototype.Longitude = null;
LDBroadcastSettings.prototype.Radius = null;
LDBroadcastSettings.prototype.BroadcasterAccount = null;
function LDAddMeInfo(e) { 
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Profile = new LDContactProfile(e['p']);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.IntentLink = e['l'];
    else
        this.IntentLink = null;
}
LDAddMeInfo.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Profile !== null) o['p'] = this.Profile.encode();
    if(this.IntentLink !== null) o['l'] = this.IntentLink;
    return o;
}
LDAddMeInfo.prototype.Profile = null;
LDAddMeInfo.prototype.IntentLink = null;
function LDJoinFeedInfo(e) { 
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.FeedName = e['n'];
    else
        this.FeedName = null;
    if(e && (e['td'] !== null && e['td'] !== undefined))
        this.FeedThumbnailLink = e['td'];
    else
        this.FeedThumbnailLink = null;
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.IntentLink = e['l'];
    else
        this.IntentLink = null;
}
LDJoinFeedInfo.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.FeedName !== null) o['n'] = this.FeedName;
    if(this.FeedThumbnailLink !== null) o['td'] = this.FeedThumbnailLink;
    if(this.IntentLink !== null) o['l'] = this.IntentLink;
    return o;
}
LDJoinFeedInfo.prototype.FeedName = null;
LDJoinFeedInfo.prototype.FeedThumbnailLink = null;
LDJoinFeedInfo.prototype.IntentLink = null;
function LDFeatureSetting(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.EnabledTime = e['t'];
    else
        this.EnabledTime = null;
}
LDFeatureSetting.prototype = new LDJSONLoggable();
LDFeatureSetting.prototype.constructor = LDFeatureSetting;
LDFeatureSetting.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.EnabledTime !== null) o['t'] = this.EnabledTime;
    return o;
}
LDFeatureSetting.prototype.EnabledTime = null;
function LDDeviceToIdpRpcWrapper(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['q'] !== null && e['q'] !== undefined))
        this.Request = new LDDeviceToIdpRequestContainer(e['q']);
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.Response = new LDDeviceToIdpResponseContainer(e['r']);
}
LDDeviceToIdpRpcWrapper.prototype = new LDJSONLoggable();
LDDeviceToIdpRpcWrapper.prototype.constructor = LDDeviceToIdpRpcWrapper;
LDDeviceToIdpRpcWrapper.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Request !== null) o['q'] = this.Request.encode();
    if(this.Response !== null) o['r'] = this.Response.encode();
    return o;
}
LDDeviceToIdpRpcWrapper.prototype.Request = null;
LDDeviceToIdpRpcWrapper.prototype.Response = null;
function LDDeviceToClusterRpcWrapper(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['q'] !== null && e['q'] !== undefined))
        this.Request = new LDDeviceToClusterRequestContainer(e['q']);
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.Response = new LDDeviceToClusterResponseContainer(e['r']);
}
LDDeviceToClusterRpcWrapper.prototype = new LDJSONLoggable();
LDDeviceToClusterRpcWrapper.prototype.constructor = LDDeviceToClusterRpcWrapper;
LDDeviceToClusterRpcWrapper.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Request !== null) o['q'] = this.Request.encode();
    if(this.Response !== null) o['r'] = this.Response.encode();
    return o;
}
LDDeviceToClusterRpcWrapper.prototype.Request = null;
LDDeviceToClusterRpcWrapper.prototype.Response = null;
function LDRpcContext(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.DeviceId = new Buffer(e['b'], 'base64');
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.RootRequestId = new Buffer(e['r'], 'base64');
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.RequestId = new Buffer(e['i'], 'base64');
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.RequestingAccount = e['a'];
    else
        this.RequestingAccount = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.SourceCluster = e['c'];
    else
        this.SourceCluster = null;
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.ForwardedFromNode = e['f'];
    else
        this.ForwardedFromNode = null;
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.WriteSecure = e['s'];
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.RootIpAddress = e['l'];
    else
        this.RootIpAddress = null;
    if(e && (e['A'] !== null && e['A'] !== undefined))
        this.AppId = new Buffer(e['A'], 'base64');
    if(e && (e['S'] !== null && e['S'] !== undefined)) { 
        this.Scopes = [];
        var d = e['S'];
        for(var k = 0; k < d.length; ++k) this.Scopes.push(d[k]);
    }
}
LDRpcContext.prototype = new LDJSONLoggable();
LDRpcContext.prototype.constructor = LDRpcContext;
LDRpcContext.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.DeviceId !== null) o['b'] = this.DeviceId.toString('base64');
    if(this.RootRequestId !== null) o['r'] = this.RootRequestId.toString('base64');
    if(this.RequestId !== null) o['i'] = this.RequestId.toString('base64');
    if(this.RequestingAccount !== null) o['a'] = this.RequestingAccount;
    if(this.SourceCluster !== null) o['c'] = this.SourceCluster;
    if(this.ForwardedFromNode !== null) o['f'] = this.ForwardedFromNode;
    if(this.WriteSecure !== null) o['s'] = this.WriteSecure;
    if(this.RootIpAddress !== null) o['l'] = this.RootIpAddress;
    if(this.AppId !== null) o['A'] = this.AppId.toString('base64');
    if(this.Scopes !== null) { 
        o['S'] = [];
        var d = this.Scopes;
        for(var k = 0; k < d.length; ++k) o['S'].push(d[k]);
    } else {
        o['Scopes'] = null;
    }
    return o;
}
LDRpcContext.prototype.DeviceId = null;
LDRpcContext.prototype.RootRequestId = null;
LDRpcContext.prototype.RequestId = null;
LDRpcContext.prototype.RequestingAccount = null;
LDRpcContext.prototype.SourceCluster = null;
LDRpcContext.prototype.ForwardedFromNode = null;
LDRpcContext.prototype.WriteSecure = null;
LDRpcContext.prototype.RootIpAddress = null;
LDRpcContext.prototype.AppId = null;
LDRpcContext.prototype.Scopes = null;
function LDHelloChallengeRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.EphmeralKey = new Buffer(e['e'], 'base64');
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.SourceKey = new Buffer(e['k'], 'base64');
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.DestinationChallenge = new Buffer(e['c'], 'base64');
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.ApiKey = new Buffer(e['a'], 'base64');
}
LDHelloChallengeRequest.prototype = new LDJSONLoggable();
LDHelloChallengeRequest.prototype.constructor = LDHelloChallengeRequest;
LDHelloChallengeRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.EphmeralKey !== null) o['e'] = this.EphmeralKey.toString('base64');
    if(this.SourceKey !== null) o['k'] = this.SourceKey.toString('base64');
    if(this.DestinationChallenge !== null) o['c'] = this.DestinationChallenge.toString('base64');
    if(this.ApiKey !== null) o['a'] = this.ApiKey.toString('base64');
    return o;
}
LDHelloChallengeRequest.prototype.EphmeralKey = null;
LDHelloChallengeRequest.prototype.SourceKey = null;
LDHelloChallengeRequest.prototype.DestinationChallenge = null;
LDHelloChallengeRequest.prototype.ApiKey = null;
function LDCompleteChallengeRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.SourceResponse = new Buffer(e['r'], 'base64');
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Type = e['t'];
    else
        this.Type = null;
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Manufacturer = e['m'];
    else
        this.Manufacturer = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Model = e['d'];
    else
        this.Model = null;
    if(e && (e['o'] !== null && e['o'] !== undefined))
        this.OsVersion = e['o'];
    else
        this.OsVersion = null;
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.ClientVersion = e['v'];
    else
        this.ClientVersion = null;
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.Locale = e['l'];
    else
        this.Locale = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.AppChallengeResponse = new Buffer(e['c'], 'base64');
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.System = e['s'];
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.PackageId = e['p'];
    else
        this.PackageId = null;
    if(e && (e['y'] !== null && e['y'] !== undefined))
        this.OmlibVersion = e['y'];
    if(e && (e['z'] !== null && e['z'] !== undefined))
        this.PackageVersion = e['z'];
    else
        this.PackageVersion = null;
    if(e && (e['pr'] !== null && e['pr'] !== undefined))
        this.PushReceivedSinceLastConnection = e['pr'];
}
LDCompleteChallengeRequest.prototype = new LDJSONLoggable();
LDCompleteChallengeRequest.prototype.constructor = LDCompleteChallengeRequest;
LDCompleteChallengeRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.SourceResponse !== null) o['r'] = this.SourceResponse.toString('base64');
    if(this.Type !== null) o['t'] = this.Type;
    if(this.Manufacturer !== null) o['m'] = this.Manufacturer;
    if(this.Model !== null) o['d'] = this.Model;
    if(this.OsVersion !== null) o['o'] = this.OsVersion;
    if(this.ClientVersion !== null) o['v'] = this.ClientVersion;
    if(this.Locale !== null) o['l'] = this.Locale;
    if(this.AppChallengeResponse !== null) o['c'] = this.AppChallengeResponse.toString('base64');
    if(this.System !== null) o['s'] = this.System;
    if(this.PackageId !== null) o['p'] = this.PackageId;
    if(this.OmlibVersion !== null) o['y'] = this.OmlibVersion;
    if(this.PackageVersion !== null) o['z'] = this.PackageVersion;
    if(this.PushReceivedSinceLastConnection !== null) o['pr'] = this.PushReceivedSinceLastConnection;
    return o;
}
LDCompleteChallengeRequest.prototype.SourceResponse = null;
LDCompleteChallengeRequest.prototype.Type = null;
LDCompleteChallengeRequest.prototype.Manufacturer = null;
LDCompleteChallengeRequest.prototype.Model = null;
LDCompleteChallengeRequest.prototype.OsVersion = null;
LDCompleteChallengeRequest.prototype.ClientVersion = null;
LDCompleteChallengeRequest.prototype.Locale = null;
LDCompleteChallengeRequest.prototype.AppChallengeResponse = null;
LDCompleteChallengeRequest.prototype.System = null;
LDCompleteChallengeRequest.prototype.PackageId = null;
LDCompleteChallengeRequest.prototype.OmlibVersion = null;
LDCompleteChallengeRequest.prototype.PackageVersion = null;
LDCompleteChallengeRequest.prototype.PushReceivedSinceLastConnection = null;
function LDPingRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.NextPingDelayMs = e['n'];
    else
        this.NextPingDelayMs = null;
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.LastRtt = e['l'];
}
LDPingRequest.prototype = new LDJSONLoggable();
LDPingRequest.prototype.constructor = LDPingRequest;
LDPingRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.NextPingDelayMs !== null) o['n'] = this.NextPingDelayMs;
    if(this.LastRtt !== null) o['l'] = this.LastRtt;
    return o;
}
LDPingRequest.prototype.NextPingDelayMs = null;
LDPingRequest.prototype.LastRtt = null;
function LDRequestProtocolBase(e) { 
    LDJSONLoggable.call(this, e);
}
LDRequestProtocolBase.prototype = new LDJSONLoggable();
LDRequestProtocolBase.prototype.constructor = LDRequestProtocolBase;
LDRequestProtocolBase.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDDeviceToIdpSignupRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.RegisterWithTokenRequest = new LDRegisterWithTokenRequest(e['r']);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ConfirmTokenRequest = new LDConfirmTokenRequest(e['c']);
    if(e && (e['o'] !== null && e['o'] !== undefined))
        this.RegisterWithOAuthRequest = new LDRegisterWithOAuthRequest(e['o']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.GetLinkedIdentitiesRequest = new LDGetLinkedIdentitiesRequest(e['i']);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.CheckLinkedIdentityRequest = new LDCheckIdentityLinkedRequest(e['l']);
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.UnlinkIdentityRequest = new LDUnlinkIdentityRequest(e['u']);
    if(e && (e['O'] !== null && e['O'] !== undefined))
        this.LinkOmletIdentityRequest = new LDLinkOmletIdentityRequest(e['O']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.GetAppSigninLinkRequest = new LDGetAppSigninLinkRequest(e['s']);
    if(e && (e['C'] !== null && e['C'] !== undefined))
        this.ConfirmAuthCodeRequest = new LDConfirmAuthCodeRequest(e['C']);
    if(e && (e['dp'] !== null && e['dp'] !== undefined))
        this.DeviceRegistrationStateChangedPush = new LDDeviceRegistrationStateChangedPush(e['dp']);
}
LDDeviceToIdpSignupRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToIdpSignupRequestProtocol.prototype.constructor = LDDeviceToIdpSignupRequestProtocol;
LDDeviceToIdpSignupRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.RegisterWithTokenRequest !== null) o['r'] = this.RegisterWithTokenRequest.encode();
    if(this.ConfirmTokenRequest !== null) o['c'] = this.ConfirmTokenRequest.encode();
    if(this.RegisterWithOAuthRequest !== null) o['o'] = this.RegisterWithOAuthRequest.encode();
    if(this.GetLinkedIdentitiesRequest !== null) o['i'] = this.GetLinkedIdentitiesRequest.encode();
    if(this.CheckLinkedIdentityRequest !== null) o['l'] = this.CheckLinkedIdentityRequest.encode();
    if(this.UnlinkIdentityRequest !== null) o['u'] = this.UnlinkIdentityRequest.encode();
    if(this.LinkOmletIdentityRequest !== null) o['O'] = this.LinkOmletIdentityRequest.encode();
    if(this.GetAppSigninLinkRequest !== null) o['s'] = this.GetAppSigninLinkRequest.encode();
    if(this.ConfirmAuthCodeRequest !== null) o['C'] = this.ConfirmAuthCodeRequest.encode();
    if(this.DeviceRegistrationStateChangedPush !== null) o['dp'] = this.DeviceRegistrationStateChangedPush.encode();
    return o;
}
LDDeviceToIdpSignupRequestProtocol.prototype.RegisterWithTokenRequest = null;
LDDeviceToIdpSignupRequestProtocol.prototype.ConfirmTokenRequest = null;
LDDeviceToIdpSignupRequestProtocol.prototype.RegisterWithOAuthRequest = null;
LDDeviceToIdpSignupRequestProtocol.prototype.GetLinkedIdentitiesRequest = null;
LDDeviceToIdpSignupRequestProtocol.prototype.CheckLinkedIdentityRequest = null;
LDDeviceToIdpSignupRequestProtocol.prototype.UnlinkIdentityRequest = null;
LDDeviceToIdpSignupRequestProtocol.prototype.LinkOmletIdentityRequest = null;
LDDeviceToIdpSignupRequestProtocol.prototype.GetAppSigninLinkRequest = null;
LDDeviceToIdpSignupRequestProtocol.prototype.ConfirmAuthCodeRequest = null;
LDDeviceToIdpSignupRequestProtocol.prototype.DeviceRegistrationStateChangedPush = null;
function LDDeviceToIdpAdministrativeRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.UnblockIdentity = new LDUnblockIdentityRequest(e['u']);
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.GetEmailLoginLink = new LDGetEmailLoginLinkRequest(e['e']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.GetDetailsByAccount = new LDGetAccountDetailsByAccountRequest(e['a']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.GetDetailsByIdentity = new LDGetAccountDetailsByIdentityRequest(e['i']);
    if(e && (e['I'] !== null && e['I'] !== undefined))
        this.GetIdentityRecordsRequest = new LDGetIdentityRecordsRequest(e['I']);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.ListFlaggedUsers = new LDListFlaggedUsersRequest(e['f']);
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.ChangeUserName = new LDChangeUserNameRequest(e['n']);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ChangeUserPicture = new LDChangeUserProfilePictureRequest(e['p']);
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.DisableGameChallenge = new LDDisableUserGameChallengeRequest(e['g']);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.LogUserOut = new LDLogUserOutRequest(e['l']);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.GetDeviceRecords = new LDGetDeviceRecordsRequest(e['d']);
}
LDDeviceToIdpAdministrativeRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToIdpAdministrativeRequestProtocol.prototype.constructor = LDDeviceToIdpAdministrativeRequestProtocol;
LDDeviceToIdpAdministrativeRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.UnblockIdentity !== null) o['u'] = this.UnblockIdentity.encode();
    if(this.GetEmailLoginLink !== null) o['e'] = this.GetEmailLoginLink.encode();
    if(this.GetDetailsByAccount !== null) o['a'] = this.GetDetailsByAccount.encode();
    if(this.GetDetailsByIdentity !== null) o['i'] = this.GetDetailsByIdentity.encode();
    if(this.GetIdentityRecordsRequest !== null) o['I'] = this.GetIdentityRecordsRequest.encode();
    if(this.ListFlaggedUsers !== null) o['f'] = this.ListFlaggedUsers.encode();
    if(this.ChangeUserName !== null) o['n'] = this.ChangeUserName.encode();
    if(this.ChangeUserPicture !== null) o['p'] = this.ChangeUserPicture.encode();
    if(this.DisableGameChallenge !== null) o['g'] = this.DisableGameChallenge.encode();
    if(this.LogUserOut !== null) o['l'] = this.LogUserOut.encode();
    if(this.GetDeviceRecords !== null) o['d'] = this.GetDeviceRecords.encode();
    return o;
}
LDDeviceToIdpAdministrativeRequestProtocol.prototype.UnblockIdentity = null;
LDDeviceToIdpAdministrativeRequestProtocol.prototype.GetEmailLoginLink = null;
LDDeviceToIdpAdministrativeRequestProtocol.prototype.GetDetailsByAccount = null;
LDDeviceToIdpAdministrativeRequestProtocol.prototype.GetDetailsByIdentity = null;
LDDeviceToIdpAdministrativeRequestProtocol.prototype.GetIdentityRecordsRequest = null;
LDDeviceToIdpAdministrativeRequestProtocol.prototype.ListFlaggedUsers = null;
LDDeviceToIdpAdministrativeRequestProtocol.prototype.ChangeUserName = null;
LDDeviceToIdpAdministrativeRequestProtocol.prototype.ChangeUserPicture = null;
LDDeviceToIdpAdministrativeRequestProtocol.prototype.DisableGameChallenge = null;
LDDeviceToIdpAdministrativeRequestProtocol.prototype.LogUserOut = null;
LDDeviceToIdpAdministrativeRequestProtocol.prototype.GetDeviceRecords = null;
function LDHelloChallengeResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.SourceChallenge = new Buffer(e['c'], 'base64');
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.DestinationResponse = new Buffer(e['r'], 'base64');
}
LDHelloChallengeResponse.prototype = new LDJSONLoggable();
LDHelloChallengeResponse.prototype.constructor = LDHelloChallengeResponse;
LDHelloChallengeResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.SourceChallenge !== null) o['c'] = this.SourceChallenge.toString('base64');
    if(this.DestinationResponse !== null) o['r'] = this.DestinationResponse.toString('base64');
    return o;
}
LDHelloChallengeResponse.prototype.SourceChallenge = null;
LDHelloChallengeResponse.prototype.DestinationResponse = null;
function LDCompleteChallengeResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.LocationIndicator = e['l'];
    else
        this.LocationIndicator = null;
}
LDCompleteChallengeResponse.prototype = new LDJSONLoggable();
LDCompleteChallengeResponse.prototype.constructor = LDCompleteChallengeResponse;
LDCompleteChallengeResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.LocationIndicator !== null) o['l'] = this.LocationIndicator;
    return o;
}
LDCompleteChallengeResponse.prototype.LocationIndicator = null;
function LDSimpleResponse(e) { 
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.Value = e['v'];
}
LDSimpleResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Value !== null) o['v'] = this.Value;
    return o;
}
LDSimpleResponse.prototype.Value = null;
function LDPingResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.ObservedIp = e['i'];
    else
        this.ObservedIp = null;
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.UtcMillis = e['t'];
    else
        this.UtcMillis = null;
}
LDPingResponse.prototype = new LDJSONLoggable();
LDPingResponse.prototype.constructor = LDPingResponse;
LDPingResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ObservedIp !== null) o['i'] = this.ObservedIp;
    if(this.UtcMillis !== null) o['t'] = this.UtcMillis;
    return o;
}
LDPingResponse.prototype.ObservedIp = null;
LDPingResponse.prototype.UtcMillis = null;
function LDResponseProtocolBase(e) { 
    LDJSONLoggable.call(this, e);
}
LDResponseProtocolBase.prototype = new LDJSONLoggable();
LDResponseProtocolBase.prototype.constructor = LDResponseProtocolBase;
LDResponseProtocolBase.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDDeviceToIdpSignupResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AccountDetailsResponse = new LDAccountDetailsResponse(e['a']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.GetLinkedIdentitiesResponse = new LDGetLinkedIdentitiesResponse(e['i']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.GetAppSigninLinkResponse = new LDGetAppSigninLinkResponse(e['s']);
}
LDDeviceToIdpSignupResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToIdpSignupResponseProtocol.prototype.constructor = LDDeviceToIdpSignupResponseProtocol;
LDDeviceToIdpSignupResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.AccountDetailsResponse !== null) o['a'] = this.AccountDetailsResponse.encode();
    if(this.GetLinkedIdentitiesResponse !== null) o['i'] = this.GetLinkedIdentitiesResponse.encode();
    if(this.GetAppSigninLinkResponse !== null) o['s'] = this.GetAppSigninLinkResponse.encode();
    return o;
}
LDDeviceToIdpSignupResponseProtocol.prototype.AccountDetailsResponse = null;
LDDeviceToIdpSignupResponseProtocol.prototype.GetLinkedIdentitiesResponse = null;
LDDeviceToIdpSignupResponseProtocol.prototype.GetAppSigninLinkResponse = null;
function LDDeviceToIdpAdministrativeResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AccountDetailsResponse = new LDAccountDetailsResponse(e['a']);
    if(e && (e['I'] !== null && e['I'] !== undefined))
        this.GetIdentityRecordsResponse = new LDGetIdentityRecordsResponse(e['I']);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.ListFlaggedUsers = new LDListFlaggedUsersResponse(e['f']);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.GetDeviceRecords = new LDGetDeviceRecordsResponse(e['d']);
}
LDDeviceToIdpAdministrativeResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToIdpAdministrativeResponseProtocol.prototype.constructor = LDDeviceToIdpAdministrativeResponseProtocol;
LDDeviceToIdpAdministrativeResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.AccountDetailsResponse !== null) o['a'] = this.AccountDetailsResponse.encode();
    if(this.GetIdentityRecordsResponse !== null) o['I'] = this.GetIdentityRecordsResponse.encode();
    if(this.ListFlaggedUsers !== null) o['f'] = this.ListFlaggedUsers.encode();
    if(this.GetDeviceRecords !== null) o['d'] = this.GetDeviceRecords.encode();
    return o;
}
LDDeviceToIdpAdministrativeResponseProtocol.prototype.AccountDetailsResponse = null;
LDDeviceToIdpAdministrativeResponseProtocol.prototype.GetIdentityRecordsResponse = null;
LDDeviceToIdpAdministrativeResponseProtocol.prototype.ListFlaggedUsers = null;
LDDeviceToIdpAdministrativeResponseProtocol.prototype.GetDeviceRecords = null;
function LDDeviceToClusterMessageRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.CreateFeed = new LDCreateFeedRequest(e['c']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.GetMessagesSince = new LDGetMessagesSinceRequest(e['s']);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.GetMessagesBefore = new LDGetMessagesBeforeRequest(e['b']);
    if(e && (e['T'] !== null && e['T'] !== undefined))
        this.GetMessagesByType = new LDGetMessagesByTypeRequest(e['T']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.GetMessageById = new LDGetMessageByIdRequest(e['i']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AddMessage = new LDAddMessageRequest(e['a']);
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.UpdateMessage = new LDUpdateMessageRequest(e['u']);
    if(e && (e['o'] !== null && e['o'] !== undefined))
        this.OverwriteMessage = new LDOverwriteMessageRequest(e['o']);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.DeleteMessage = new LDDeleteMessageRequest(e['d']);
    if(e && (e['S'] !== null && e['S'] !== undefined))
        this.SubscribeFeed = new LDSubscribeFeedRequest(e['S']);
    if(e && (e['U'] !== null && e['U'] !== undefined))
        this.UnsubscribeFeed = new LDUnsubscribeFeedRequest(e['U']);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.SubscribeFeedRealtime = new LDSubscribeFeedRealtimeRequest(e['l']);
    if(e && (e['q'] !== null && e['q'] !== undefined))
        this.UnsubscribeFeedRealtime = new LDUnsubscribeFeedRealtimeRequest(e['q']);
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.AddMember = new LDAddMemberRequest(e['g']);
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.RemoveMember = new LDRemoveMemberRequest(e['r']);
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.SetFeedName = new LDSetFeedNameRequest(e['n']);
    if(e && (e['h'] !== null && e['h'] !== undefined))
        this.SetFeedThumbnail = new LDSetFeedThumbnailRequest(e['h']);
    if(e && (e['L'] !== null && e['L'] !== undefined))
        this.SendRealtime = new LDSendRealtimeRequest(e['L']);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.AddPendingInvitation = new LDAddPendingInvitationRequest(e['f']);
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.RemovePendingInvitation = new LDRemovePendingInvitationRequest(e['e']);
    if(e && (e['j'] !== null && e['j'] !== undefined))
        this.GetJoinFeedLink = new LDGetJoinFeedLinkRequest(e['j']);
    if(e && (e['J'] !== null && e['J'] !== undefined))
        this.JoinFeed = new LDJoinFeedRequest(e['J']);
    if(e && (e['B'] !== null && e['B'] !== undefined))
        this.JoinBroadcast = new LDJoinBroadcastRequest(e['B']);
    if(e && (e['x'] !== null && e['x'] !== undefined))
        this.DefaultAccess = new LDSetDefaultAccessRequest(e['x']);
    if(e && (e['gf'] !== null && e['gf'] !== undefined))
        this.GetFeedDetails = new LDGetPublicFeedDetailsRequest(e['gf']);
    if(e && (e['D'] !== null && e['D'] !== undefined))
        this.ApplyDocumentRequest = new LDApplyDocumentTransformRequest(e['D']);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.MessageDeliveryPush = new LDMessageDeliveryPush(e['p']);
    if(e && (e['P'] !== null && e['P'] !== undefined))
        this.RealtimeMessageDeliveryPush = new LDRealtimeMessageDeliveryPush(e['P']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.TerminatedPush = new LDMessageTerminatedPush(e['t']);
}
LDDeviceToClusterMessageRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterMessageRequestProtocol.prototype.constructor = LDDeviceToClusterMessageRequestProtocol;
LDDeviceToClusterMessageRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.CreateFeed !== null) o['c'] = this.CreateFeed.encode();
    if(this.GetMessagesSince !== null) o['s'] = this.GetMessagesSince.encode();
    if(this.GetMessagesBefore !== null) o['b'] = this.GetMessagesBefore.encode();
    if(this.GetMessagesByType !== null) o['T'] = this.GetMessagesByType.encode();
    if(this.GetMessageById !== null) o['i'] = this.GetMessageById.encode();
    if(this.AddMessage !== null) o['a'] = this.AddMessage.encode();
    if(this.UpdateMessage !== null) o['u'] = this.UpdateMessage.encode();
    if(this.OverwriteMessage !== null) o['o'] = this.OverwriteMessage.encode();
    if(this.DeleteMessage !== null) o['d'] = this.DeleteMessage.encode();
    if(this.SubscribeFeed !== null) o['S'] = this.SubscribeFeed.encode();
    if(this.UnsubscribeFeed !== null) o['U'] = this.UnsubscribeFeed.encode();
    if(this.SubscribeFeedRealtime !== null) o['l'] = this.SubscribeFeedRealtime.encode();
    if(this.UnsubscribeFeedRealtime !== null) o['q'] = this.UnsubscribeFeedRealtime.encode();
    if(this.AddMember !== null) o['g'] = this.AddMember.encode();
    if(this.RemoveMember !== null) o['r'] = this.RemoveMember.encode();
    if(this.SetFeedName !== null) o['n'] = this.SetFeedName.encode();
    if(this.SetFeedThumbnail !== null) o['h'] = this.SetFeedThumbnail.encode();
    if(this.SendRealtime !== null) o['L'] = this.SendRealtime.encode();
    if(this.AddPendingInvitation !== null) o['f'] = this.AddPendingInvitation.encode();
    if(this.RemovePendingInvitation !== null) o['e'] = this.RemovePendingInvitation.encode();
    if(this.GetJoinFeedLink !== null) o['j'] = this.GetJoinFeedLink.encode();
    if(this.JoinFeed !== null) o['J'] = this.JoinFeed.encode();
    if(this.JoinBroadcast !== null) o['B'] = this.JoinBroadcast.encode();
    if(this.DefaultAccess !== null) o['x'] = this.DefaultAccess.encode();
    if(this.GetFeedDetails !== null) o['gf'] = this.GetFeedDetails.encode();
    if(this.ApplyDocumentRequest !== null) o['D'] = this.ApplyDocumentRequest.encode();
    if(this.MessageDeliveryPush !== null) o['p'] = this.MessageDeliveryPush.encode();
    if(this.RealtimeMessageDeliveryPush !== null) o['P'] = this.RealtimeMessageDeliveryPush.encode();
    if(this.TerminatedPush !== null) o['t'] = this.TerminatedPush.encode();
    return o;
}
LDDeviceToClusterMessageRequestProtocol.prototype.CreateFeed = null;
LDDeviceToClusterMessageRequestProtocol.prototype.GetMessagesSince = null;
LDDeviceToClusterMessageRequestProtocol.prototype.GetMessagesBefore = null;
LDDeviceToClusterMessageRequestProtocol.prototype.GetMessagesByType = null;
LDDeviceToClusterMessageRequestProtocol.prototype.GetMessageById = null;
LDDeviceToClusterMessageRequestProtocol.prototype.AddMessage = null;
LDDeviceToClusterMessageRequestProtocol.prototype.UpdateMessage = null;
LDDeviceToClusterMessageRequestProtocol.prototype.OverwriteMessage = null;
LDDeviceToClusterMessageRequestProtocol.prototype.DeleteMessage = null;
LDDeviceToClusterMessageRequestProtocol.prototype.SubscribeFeed = null;
LDDeviceToClusterMessageRequestProtocol.prototype.UnsubscribeFeed = null;
LDDeviceToClusterMessageRequestProtocol.prototype.SubscribeFeedRealtime = null;
LDDeviceToClusterMessageRequestProtocol.prototype.UnsubscribeFeedRealtime = null;
LDDeviceToClusterMessageRequestProtocol.prototype.AddMember = null;
LDDeviceToClusterMessageRequestProtocol.prototype.RemoveMember = null;
LDDeviceToClusterMessageRequestProtocol.prototype.SetFeedName = null;
LDDeviceToClusterMessageRequestProtocol.prototype.SetFeedThumbnail = null;
LDDeviceToClusterMessageRequestProtocol.prototype.SendRealtime = null;
LDDeviceToClusterMessageRequestProtocol.prototype.AddPendingInvitation = null;
LDDeviceToClusterMessageRequestProtocol.prototype.RemovePendingInvitation = null;
LDDeviceToClusterMessageRequestProtocol.prototype.GetJoinFeedLink = null;
LDDeviceToClusterMessageRequestProtocol.prototype.JoinFeed = null;
LDDeviceToClusterMessageRequestProtocol.prototype.JoinBroadcast = null;
LDDeviceToClusterMessageRequestProtocol.prototype.DefaultAccess = null;
LDDeviceToClusterMessageRequestProtocol.prototype.GetFeedDetails = null;
LDDeviceToClusterMessageRequestProtocol.prototype.ApplyDocumentRequest = null;
LDDeviceToClusterMessageRequestProtocol.prototype.MessageDeliveryPush = null;
LDDeviceToClusterMessageRequestProtocol.prototype.RealtimeMessageDeliveryPush = null;
LDDeviceToClusterMessageRequestProtocol.prototype.TerminatedPush = null;
function LDDeviceToClusterInboxRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.GetFeedState = new LDGetFeedStateRequest(e['s']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.SetFeedAcceptance = new LDSetFeedAcceptanceRequest(e['a']);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.GetDirtyFeeds = new LDGetDirtyFeedsRequest(e['d']);
    if(e && (e['S'] !== null && e['S'] !== undefined))
        this.SubscribeAccount = new LDSubscribeForAccountInboxRequest(e['S']);
    if(e && (e['U'] !== null && e['U'] !== undefined))
        this.UnsubscribeAccount = new LDUnsubscribeForAccountInboxRequest(e['U']);
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.RegisterPushNotificationKey = new LDRegisterPushNotificationKeyRequest(e['r']);
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.MessagePush = new LDInboxDeliveryMessagePush(e['m']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.TerminatedPush = new LDInboxDeliveryTerminatedPush(e['t']);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.SetAppleBadgeCount = new LDSetAppleBadgeCountRequest(e['b']);
}
LDDeviceToClusterInboxRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterInboxRequestProtocol.prototype.constructor = LDDeviceToClusterInboxRequestProtocol;
LDDeviceToClusterInboxRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.GetFeedState !== null) o['s'] = this.GetFeedState.encode();
    if(this.SetFeedAcceptance !== null) o['a'] = this.SetFeedAcceptance.encode();
    if(this.GetDirtyFeeds !== null) o['d'] = this.GetDirtyFeeds.encode();
    if(this.SubscribeAccount !== null) o['S'] = this.SubscribeAccount.encode();
    if(this.UnsubscribeAccount !== null) o['U'] = this.UnsubscribeAccount.encode();
    if(this.RegisterPushNotificationKey !== null) o['r'] = this.RegisterPushNotificationKey.encode();
    if(this.MessagePush !== null) o['m'] = this.MessagePush.encode();
    if(this.TerminatedPush !== null) o['t'] = this.TerminatedPush.encode();
    if(this.SetAppleBadgeCount !== null) o['b'] = this.SetAppleBadgeCount.encode();
    return o;
}
LDDeviceToClusterInboxRequestProtocol.prototype.GetFeedState = null;
LDDeviceToClusterInboxRequestProtocol.prototype.SetFeedAcceptance = null;
LDDeviceToClusterInboxRequestProtocol.prototype.GetDirtyFeeds = null;
LDDeviceToClusterInboxRequestProtocol.prototype.SubscribeAccount = null;
LDDeviceToClusterInboxRequestProtocol.prototype.UnsubscribeAccount = null;
LDDeviceToClusterInboxRequestProtocol.prototype.RegisterPushNotificationKey = null;
LDDeviceToClusterInboxRequestProtocol.prototype.MessagePush = null;
LDDeviceToClusterInboxRequestProtocol.prototype.TerminatedPush = null;
LDDeviceToClusterInboxRequestProtocol.prototype.SetAppleBadgeCount = null;
function LDClusterOrDeviceToClusterBlobRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['ut'] !== null && e['ut'] !== undefined))
        this.GetUploadTicket = new LDGetUploadTicketRequest(e['ut']);
    if(e && (e['mut'] !== null && e['mut'] !== undefined))
        this.GetMultipartUploadTicket = new LDGetMultipartUploadTicketRequest(e['mut']);
    if(e && (e['vc'] !== null && e['vc'] !== undefined))
        this.VerifyUploadCompleted = new LDVerifyUploadCompletedRequest(e['vc']);
    if(e && (e['dt'] !== null && e['dt'] !== undefined))
        this.GetDownloadTicket = new LDGetDownloadTicketRequest(e['dt']);
    if(e && (e['ve'] !== null && e['ve'] !== undefined))
        this.VerifyExistsAndPermanence = new LDVerifyExistsAndPermanenceRequest(e['ve']);
}
LDClusterOrDeviceToClusterBlobRequestProtocol.prototype = new LDRequestProtocolBase();
LDClusterOrDeviceToClusterBlobRequestProtocol.prototype.constructor = LDClusterOrDeviceToClusterBlobRequestProtocol;
LDClusterOrDeviceToClusterBlobRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.GetUploadTicket !== null) o['ut'] = this.GetUploadTicket.encode();
    if(this.GetMultipartUploadTicket !== null) o['mut'] = this.GetMultipartUploadTicket.encode();
    if(this.VerifyUploadCompleted !== null) o['vc'] = this.VerifyUploadCompleted.encode();
    if(this.GetDownloadTicket !== null) o['dt'] = this.GetDownloadTicket.encode();
    if(this.VerifyExistsAndPermanence !== null) o['ve'] = this.VerifyExistsAndPermanence.encode();
    return o;
}
LDClusterOrDeviceToClusterBlobRequestProtocol.prototype.GetUploadTicket = null;
LDClusterOrDeviceToClusterBlobRequestProtocol.prototype.GetMultipartUploadTicket = null;
LDClusterOrDeviceToClusterBlobRequestProtocol.prototype.VerifyUploadCompleted = null;
LDClusterOrDeviceToClusterBlobRequestProtocol.prototype.GetDownloadTicket = null;
LDClusterOrDeviceToClusterBlobRequestProtocol.prototype.VerifyExistsAndPermanence = null;
function LDDeviceToClusterContactRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['o'] !== null && e['o'] !== undefined))
        this.OverwriteContactsRequest = new LDOverwriteContactRequest(e['o']);
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.RemoveContactRequest = new LDRemoveContactRequest(e['r']);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.BlockContactRequest = new LDBlockContactRequest(e['b']);
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.UnblockContactRequest = new LDUnblockContactRequest(e['u']);
}
LDDeviceToClusterContactRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterContactRequestProtocol.prototype.constructor = LDDeviceToClusterContactRequestProtocol;
LDDeviceToClusterContactRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.OverwriteContactsRequest !== null) o['o'] = this.OverwriteContactsRequest.encode();
    if(this.RemoveContactRequest !== null) o['r'] = this.RemoveContactRequest.encode();
    if(this.BlockContactRequest !== null) o['b'] = this.BlockContactRequest.encode();
    if(this.UnblockContactRequest !== null) o['u'] = this.UnblockContactRequest.encode();
    return o;
}
LDDeviceToClusterContactRequestProtocol.prototype.OverwriteContactsRequest = null;
LDDeviceToClusterContactRequestProtocol.prototype.RemoveContactRequest = null;
LDDeviceToClusterContactRequestProtocol.prototype.BlockContactRequest = null;
LDDeviceToClusterContactRequestProtocol.prototype.UnblockContactRequest = null;
function LDDeviceToClusterProfileRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.GetProfileDetailsRequest = new LDGetProfileDetailsRequest(e['p']);
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.SetNameRequest = new LDSetProfileNameRequest(e['n']);
    if(e && (e['sp'] !== null && e['sp'] !== undefined))
        this.SetProfilePictureRequest = new LDSetProfilePictureRequest(e['sp']);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.GetContactProfileRequest = new LDGetOmletContactProfileRequest(e['c']);
    if(e && (e['aip'] !== null && e['aip'] !== undefined))
        this.AddItemsToProfileRequest = new LDAddItemsToProfileRequest(e['aip']);
    if(e && (e['rip'] !== null && e['rip'] !== undefined))
        this.RemoveItemsFromProfileRequest = new LDRemoveItemsFromProfileRequest(e['rip']);
    if(e && (e['afp'] !== null && e['afp'] !== undefined))
        this.AddFeaturesToProfileRequest = new LDAddFeaturesToProfileRequest(e['afp']);
    if(e && (e['rfp'] !== null && e['rfp'] !== undefined))
        this.RemoveFeaturesFromProfileRequest = new LDRemoveFeaturesFromProfileRequest(e['rfp']);
    if(e && (e['pps'] !== null && e['pps'] !== undefined))
        this.GetProfilePublicStateRequest = new LDGetProfilePublicStateRequest(e['pps']);
    if(e && (e['ppp'] !== null && e['ppp'] !== undefined))
        this.GetProfileDetailsAndPublicStateRequest = new LDGetContactProfileAndPublicStateRequest(e['ppp']);
}
LDDeviceToClusterProfileRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterProfileRequestProtocol.prototype.constructor = LDDeviceToClusterProfileRequestProtocol;
LDDeviceToClusterProfileRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.GetProfileDetailsRequest !== null) o['p'] = this.GetProfileDetailsRequest.encode();
    if(this.SetNameRequest !== null) o['n'] = this.SetNameRequest.encode();
    if(this.SetProfilePictureRequest !== null) o['sp'] = this.SetProfilePictureRequest.encode();
    if(this.GetContactProfileRequest !== null) o['c'] = this.GetContactProfileRequest.encode();
    if(this.AddItemsToProfileRequest !== null) o['aip'] = this.AddItemsToProfileRequest.encode();
    if(this.RemoveItemsFromProfileRequest !== null) o['rip'] = this.RemoveItemsFromProfileRequest.encode();
    if(this.AddFeaturesToProfileRequest !== null) o['afp'] = this.AddFeaturesToProfileRequest.encode();
    if(this.RemoveFeaturesFromProfileRequest !== null) o['rfp'] = this.RemoveFeaturesFromProfileRequest.encode();
    if(this.GetProfilePublicStateRequest !== null) o['pps'] = this.GetProfilePublicStateRequest.encode();
    if(this.GetProfileDetailsAndPublicStateRequest !== null) o['ppp'] = this.GetProfileDetailsAndPublicStateRequest.encode();
    return o;
}
LDDeviceToClusterProfileRequestProtocol.prototype.GetProfileDetailsRequest = null;
LDDeviceToClusterProfileRequestProtocol.prototype.SetNameRequest = null;
LDDeviceToClusterProfileRequestProtocol.prototype.SetProfilePictureRequest = null;
LDDeviceToClusterProfileRequestProtocol.prototype.GetContactProfileRequest = null;
LDDeviceToClusterProfileRequestProtocol.prototype.AddItemsToProfileRequest = null;
LDDeviceToClusterProfileRequestProtocol.prototype.RemoveItemsFromProfileRequest = null;
LDDeviceToClusterProfileRequestProtocol.prototype.AddFeaturesToProfileRequest = null;
LDDeviceToClusterProfileRequestProtocol.prototype.RemoveFeaturesFromProfileRequest = null;
LDDeviceToClusterProfileRequestProtocol.prototype.GetProfilePublicStateRequest = null;
LDDeviceToClusterProfileRequestProtocol.prototype.GetProfileDetailsAndPublicStateRequest = null;
function LDDeviceToClusterAddressBookRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.UploadEntriesRequest = new LDUploadAddressBookEntriesRequest(e['u']);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.GetContactProfileRequest = new LDGetContactProfileRequest(e['c']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.GetAddMeLinkRequest = new LDGetAddMeLinkRequest(e['a']);
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.MutualAddContact = new LDMutualAddContactByTokenRequest(e['m']);
}
LDDeviceToClusterAddressBookRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterAddressBookRequestProtocol.prototype.constructor = LDDeviceToClusterAddressBookRequestProtocol;
LDDeviceToClusterAddressBookRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.UploadEntriesRequest !== null) o['u'] = this.UploadEntriesRequest.encode();
    if(this.GetContactProfileRequest !== null) o['c'] = this.GetContactProfileRequest.encode();
    if(this.GetAddMeLinkRequest !== null) o['a'] = this.GetAddMeLinkRequest.encode();
    if(this.MutualAddContact !== null) o['m'] = this.MutualAddContact.encode();
    return o;
}
LDDeviceToClusterAddressBookRequestProtocol.prototype.UploadEntriesRequest = null;
LDDeviceToClusterAddressBookRequestProtocol.prototype.GetContactProfileRequest = null;
LDDeviceToClusterAddressBookRequestProtocol.prototype.GetAddMeLinkRequest = null;
LDDeviceToClusterAddressBookRequestProtocol.prototype.MutualAddContact = null;
function LDDeviceToClusterOmletItemStoreRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['cr'] !== null && e['cr'] !== undefined))
        this.CreateItemInfoRequest = new LDCreateItemInfoRequest(e['cr']);
    if(e && (e['uu'] !== null && e['uu'] !== undefined))
        this.UserUpdateItemInfoRequest = new LDUserUpdateItemInfoRequest(e['uu']);
    if(e && (e['su'] !== null && e['su'] !== undefined))
        this.SystemUpdateItemInfoRequest = new LDSystemUpdateItemInfoRequest(e['su']);
    if(e && (e['ga'] !== null && e['ga'] !== undefined))
        this.GetItemInfoRequest = new LDGetItemInfoRequest(e['ga']);
    if(e && (e['re'] !== null && e['re'] !== undefined))
        this.ReviewItemRequest = new LDReviewItemRequest(e['re']);
    if(e && (e['pu'] !== null && e['pu'] !== undefined))
        this.PublishItemRequest = new LDPublishItemRequest(e['pu']);
    if(e && (e['un'] !== null && e['un'] !== undefined))
        this.UnpublishItemRequest = new LDUnpublishItemRequest(e['un']);
    if(e && (e['de'] !== null && e['de'] !== undefined))
        this.DeleteItemRequest = new LDDeleteItemRequest(e['de']);
    if(e && (e['lc'] !== null && e['lc'] !== undefined))
        this.ListItemsForAccountRequest = new LDListItemsForAccountRequest(e['lc']);
    if(e && (e['la'] !== null && e['la'] !== undefined))
        this.ListAllItemsRequest = new LDListAllItemsRequest(e['la']);
    if(e && (e['lp'] !== null && e['lp'] !== undefined))
        this.ListPublishedItemsRequest = new LDListPublishedItemsRequest(e['lp']);
    if(e && (e['gg'] !== null && e['gg'] !== undefined))
        this.GenerateGrantForItemRequest = new LDGenerateGrantForItemRequest(e['gg']);
    if(e && (e['gig'] !== null && e['gig'] !== undefined))
        this.GetItemUsingGrantRequest = new LDGetItemUsingGrantRequest(e['gig']);
    if(e && (e['dihg'] !== null && e['dihg'] !== undefined))
        this.DoesItemHaveGrantRequest = new LDDoesItemHaveGrantRequest(e['dihg']);
    if(e && (e['dgfi'] !== null && e['dgfi'] !== undefined))
        this.DeleteGrantForItemRequest = new LDDeleteGrantForItemRequest(e['dgfi']);
    if(e && (e['gk'] !== null && e['gk'] !== undefined))
        this.GenerateApiKeyRequest = new LDGenerateApiKeyRequest(e['gk']);
    if(e && (e['dk'] !== null && e['dk'] !== undefined))
        this.DeactivateApiKeyRequest = new LDDeactivateApiKeyRequest(e['dk']);
    if(e && (e['lk'] !== null && e['lk'] !== undefined))
        this.ListApiKeysRequest = new LDListApiKeysRequest(e['lk']);
}
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.constructor = LDDeviceToClusterOmletItemStoreRequestProtocol;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.CreateItemInfoRequest !== null) o['cr'] = this.CreateItemInfoRequest.encode();
    if(this.UserUpdateItemInfoRequest !== null) o['uu'] = this.UserUpdateItemInfoRequest.encode();
    if(this.SystemUpdateItemInfoRequest !== null) o['su'] = this.SystemUpdateItemInfoRequest.encode();
    if(this.GetItemInfoRequest !== null) o['ga'] = this.GetItemInfoRequest.encode();
    if(this.ReviewItemRequest !== null) o['re'] = this.ReviewItemRequest.encode();
    if(this.PublishItemRequest !== null) o['pu'] = this.PublishItemRequest.encode();
    if(this.UnpublishItemRequest !== null) o['un'] = this.UnpublishItemRequest.encode();
    if(this.DeleteItemRequest !== null) o['de'] = this.DeleteItemRequest.encode();
    if(this.ListItemsForAccountRequest !== null) o['lc'] = this.ListItemsForAccountRequest.encode();
    if(this.ListAllItemsRequest !== null) o['la'] = this.ListAllItemsRequest.encode();
    if(this.ListPublishedItemsRequest !== null) o['lp'] = this.ListPublishedItemsRequest.encode();
    if(this.GenerateGrantForItemRequest !== null) o['gg'] = this.GenerateGrantForItemRequest.encode();
    if(this.GetItemUsingGrantRequest !== null) o['gig'] = this.GetItemUsingGrantRequest.encode();
    if(this.DoesItemHaveGrantRequest !== null) o['dihg'] = this.DoesItemHaveGrantRequest.encode();
    if(this.DeleteGrantForItemRequest !== null) o['dgfi'] = this.DeleteGrantForItemRequest.encode();
    if(this.GenerateApiKeyRequest !== null) o['gk'] = this.GenerateApiKeyRequest.encode();
    if(this.DeactivateApiKeyRequest !== null) o['dk'] = this.DeactivateApiKeyRequest.encode();
    if(this.ListApiKeysRequest !== null) o['lk'] = this.ListApiKeysRequest.encode();
    return o;
}
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.CreateItemInfoRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.UserUpdateItemInfoRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.SystemUpdateItemInfoRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.GetItemInfoRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.ReviewItemRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.PublishItemRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.UnpublishItemRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.DeleteItemRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.ListItemsForAccountRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.ListAllItemsRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.ListPublishedItemsRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.GenerateGrantForItemRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.GetItemUsingGrantRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.DoesItemHaveGrantRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.DeleteGrantForItemRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.GenerateApiKeyRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.DeactivateApiKeyRequest = null;
LDDeviceToClusterOmletItemStoreRequestProtocol.prototype.ListApiKeysRequest = null;
function LDDeviceToClusterDeviceRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.DeleteDeviceRequest = new LDDeleteDeviceRequest(e['d']);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.AddDeviceRequest = new LDAddDeviceRequest(e['c']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.SetDingTimeoutRequest = new LDSetDingTimeoutRequest(e['t']);
}
LDDeviceToClusterDeviceRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterDeviceRequestProtocol.prototype.constructor = LDDeviceToClusterDeviceRequestProtocol;
LDDeviceToClusterDeviceRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.DeleteDeviceRequest !== null) o['d'] = this.DeleteDeviceRequest.encode();
    if(this.AddDeviceRequest !== null) o['c'] = this.AddDeviceRequest.encode();
    if(this.SetDingTimeoutRequest !== null) o['t'] = this.SetDingTimeoutRequest.encode();
    return o;
}
LDDeviceToClusterDeviceRequestProtocol.prototype.DeleteDeviceRequest = null;
LDDeviceToClusterDeviceRequestProtocol.prototype.AddDeviceRequest = null;
LDDeviceToClusterDeviceRequestProtocol.prototype.SetDingTimeoutRequest = null;
function LDDeviceToClusterCloudSyncRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.GetCloudConfigRequest = new LDGetCloudConfigRequest(e['g']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.SetCloudConfigRequest = new LDSetCloudConfigRequest(e['s']);
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.RefreshCloudConfigRequest = new LDRefreshCloudConfigRequest(e['r']);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.DisconnectCloudSyncRequest = new LDDisconnectCloudSyncRequest(e['d']);
}
LDDeviceToClusterCloudSyncRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterCloudSyncRequestProtocol.prototype.constructor = LDDeviceToClusterCloudSyncRequestProtocol;
LDDeviceToClusterCloudSyncRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.GetCloudConfigRequest !== null) o['g'] = this.GetCloudConfigRequest.encode();
    if(this.SetCloudConfigRequest !== null) o['s'] = this.SetCloudConfigRequest.encode();
    if(this.RefreshCloudConfigRequest !== null) o['r'] = this.RefreshCloudConfigRequest.encode();
    if(this.DisconnectCloudSyncRequest !== null) o['d'] = this.DisconnectCloudSyncRequest.encode();
    return o;
}
LDDeviceToClusterCloudSyncRequestProtocol.prototype.GetCloudConfigRequest = null;
LDDeviceToClusterCloudSyncRequestProtocol.prototype.SetCloudConfigRequest = null;
LDDeviceToClusterCloudSyncRequestProtocol.prototype.RefreshCloudConfigRequest = null;
LDDeviceToClusterCloudSyncRequestProtocol.prototype.DisconnectCloudSyncRequest = null;
function LDDeviceToClusterGameChallengeRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['o'] !== null && e['o'] !== undefined))
        this.OptInForAllGamesChallengesRequest = new LDOptInForAllGamesChallengesRequest(e['o']);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.FindGamers = new LDFindGamersRequest(e['f']);
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.UpdateChallengeLocation = new LDUpdateChallengeLocationRequest(e['u']);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.GameChallengeComplete = new LDGameChallengeCompleteRequest(e['d']);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.GameChallenge = new LDExtendChallengeRequest(e['c']);
    if(e && (e['co'] !== null && e['co'] !== undefined))
        this.CheckAccountOptedIn = new LDCheckAccountOptedInRequest(e['co']);
    if(e && (e['ogs'] !== null && e['ogs'] !== undefined))
        this.OptInForGSChallengesRequest = new LDOptInForGSChallengesRequest(e['ogs']);
    if(e && (e['fgs'] !== null && e['fgs'] !== undefined))
        this.FindGamersGSRequest = new LDFindGamersGSRequest(e['fgs']);
}
LDDeviceToClusterGameChallengeRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterGameChallengeRequestProtocol.prototype.constructor = LDDeviceToClusterGameChallengeRequestProtocol;
LDDeviceToClusterGameChallengeRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.OptInForAllGamesChallengesRequest !== null) o['o'] = this.OptInForAllGamesChallengesRequest.encode();
    if(this.FindGamers !== null) o['f'] = this.FindGamers.encode();
    if(this.UpdateChallengeLocation !== null) o['u'] = this.UpdateChallengeLocation.encode();
    if(this.GameChallengeComplete !== null) o['d'] = this.GameChallengeComplete.encode();
    if(this.GameChallenge !== null) o['c'] = this.GameChallenge.encode();
    if(this.CheckAccountOptedIn !== null) o['co'] = this.CheckAccountOptedIn.encode();
    if(this.OptInForGSChallengesRequest !== null) o['ogs'] = this.OptInForGSChallengesRequest.encode();
    if(this.FindGamersGSRequest !== null) o['fgs'] = this.FindGamersGSRequest.encode();
    return o;
}
LDDeviceToClusterGameChallengeRequestProtocol.prototype.OptInForAllGamesChallengesRequest = null;
LDDeviceToClusterGameChallengeRequestProtocol.prototype.FindGamers = null;
LDDeviceToClusterGameChallengeRequestProtocol.prototype.UpdateChallengeLocation = null;
LDDeviceToClusterGameChallengeRequestProtocol.prototype.GameChallengeComplete = null;
LDDeviceToClusterGameChallengeRequestProtocol.prototype.GameChallenge = null;
LDDeviceToClusterGameChallengeRequestProtocol.prototype.CheckAccountOptedIn = null;
LDDeviceToClusterGameChallengeRequestProtocol.prototype.OptInForGSChallengesRequest = null;
LDDeviceToClusterGameChallengeRequestProtocol.prototype.FindGamersGSRequest = null;
function LDDeviceToClusterSubscriptionRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.GetSubscriptionUrl = new LDCreateSubscriptionRequest(e['u']);
}
LDDeviceToClusterSubscriptionRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterSubscriptionRequestProtocol.prototype.constructor = LDDeviceToClusterSubscriptionRequestProtocol;
LDDeviceToClusterSubscriptionRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.GetSubscriptionUrl !== null) o['u'] = this.GetSubscriptionUrl.encode();
    return o;
}
LDDeviceToClusterSubscriptionRequestProtocol.prototype.GetSubscriptionUrl = null;
function LDDeviceToClusterHighScoreRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['hs'] !== null && e['hs'] !== undefined))
        this.GetHighScoreRequest = new LDGetHighScoreRequest(e['hs']);
    if(e && (e['rs'] !== null && e['rs'] !== undefined))
        this.ReportScoreRequest = new LDReportScoreRequest(e['rs']);
    if(e && (e['ts'] !== null && e['ts'] !== undefined))
        this.GetTopScoresRequest = new LDGetTopScoresRequest(e['ts']);
}
LDDeviceToClusterHighScoreRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterHighScoreRequestProtocol.prototype.constructor = LDDeviceToClusterHighScoreRequestProtocol;
LDDeviceToClusterHighScoreRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.GetHighScoreRequest !== null) o['hs'] = this.GetHighScoreRequest.encode();
    if(this.ReportScoreRequest !== null) o['rs'] = this.ReportScoreRequest.encode();
    if(this.GetTopScoresRequest !== null) o['ts'] = this.GetTopScoresRequest.encode();
    return o;
}
LDDeviceToClusterHighScoreRequestProtocol.prototype.GetHighScoreRequest = null;
LDDeviceToClusterHighScoreRequestProtocol.prototype.ReportScoreRequest = null;
LDDeviceToClusterHighScoreRequestProtocol.prototype.GetTopScoresRequest = null;
function LDDeviceToClusterNearbyItemRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.BroadcastItemRequest = new LDBroadcastItemRequest(e['b']);
    if(e && (e['ub'] !== null && e['ub'] !== undefined))
        this.UnbroadcastItemRequest = new LDUnbroadcastItemRequest(e['ub']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.SubscribeForNearbyItemsRequest = new LDSubscribeForNearbyItemsRequest(e['s']);
    if(e && (e['us'] !== null && e['us'] !== undefined))
        this.UnsubscribeForNearbyItemsRequest = new LDUnsubscribeForNearbyItemsRequest(e['us']);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.FetchNearbyItemsRequest = new LDFetchNearbyItemsRequest(e['f']);
    if(e && (e['bp'] !== null && e['bp'] !== undefined))
        this.ItemBroadcastStateChangedPush = new LDItemBroadcastStateChangedPush(e['bp']);
    if(e && (e['st'] !== null && e['st'] !== undefined))
        this.SubscriptionTerminatedPush = new LDSubscriptionTerminatedPush(e['st']);
}
LDDeviceToClusterNearbyItemRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterNearbyItemRequestProtocol.prototype.constructor = LDDeviceToClusterNearbyItemRequestProtocol;
LDDeviceToClusterNearbyItemRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.BroadcastItemRequest !== null) o['b'] = this.BroadcastItemRequest.encode();
    if(this.UnbroadcastItemRequest !== null) o['ub'] = this.UnbroadcastItemRequest.encode();
    if(this.SubscribeForNearbyItemsRequest !== null) o['s'] = this.SubscribeForNearbyItemsRequest.encode();
    if(this.UnsubscribeForNearbyItemsRequest !== null) o['us'] = this.UnsubscribeForNearbyItemsRequest.encode();
    if(this.FetchNearbyItemsRequest !== null) o['f'] = this.FetchNearbyItemsRequest.encode();
    if(this.ItemBroadcastStateChangedPush !== null) o['bp'] = this.ItemBroadcastStateChangedPush.encode();
    if(this.SubscriptionTerminatedPush !== null) o['st'] = this.SubscriptionTerminatedPush.encode();
    return o;
}
LDDeviceToClusterNearbyItemRequestProtocol.prototype.BroadcastItemRequest = null;
LDDeviceToClusterNearbyItemRequestProtocol.prototype.UnbroadcastItemRequest = null;
LDDeviceToClusterNearbyItemRequestProtocol.prototype.SubscribeForNearbyItemsRequest = null;
LDDeviceToClusterNearbyItemRequestProtocol.prototype.UnsubscribeForNearbyItemsRequest = null;
LDDeviceToClusterNearbyItemRequestProtocol.prototype.FetchNearbyItemsRequest = null;
LDDeviceToClusterNearbyItemRequestProtocol.prototype.ItemBroadcastStateChangedPush = null;
LDDeviceToClusterNearbyItemRequestProtocol.prototype.SubscriptionTerminatedPush = null;
function LDDeviceToClusterMiscellaneousRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['wl'] !== null && e['wl'] !== undefined))
        this.UrlToStoryRequest = new LDUrlToStoryRequest(e['wl']);
    if(e && (e['is'] !== null && e['is'] !== undefined))
        this.ImageSearchRequest = new LDImageSearchRequest(e['is']);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.FailureReport = new LDFailureReportRequest(e['f']);
    if(e && (e['F'] !== null && e['F'] !== undefined))
        this.FlagUser = new LDFlagUserRequest(e['F']);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.CreatePlaygroundRequest = new LDCreatePlaygroundRequest(e['p']);
    if(e && (e['gf'] !== null && e['gf'] !== undefined))
        this.GetFeedbackAccount = new LDGetFeedbackAccountRequest(e['gf']);
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.GetExtraVersions = new LDGetExtraVersionsRequest(e['e']);
}
LDDeviceToClusterMiscellaneousRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterMiscellaneousRequestProtocol.prototype.constructor = LDDeviceToClusterMiscellaneousRequestProtocol;
LDDeviceToClusterMiscellaneousRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.UrlToStoryRequest !== null) o['wl'] = this.UrlToStoryRequest.encode();
    if(this.ImageSearchRequest !== null) o['is'] = this.ImageSearchRequest.encode();
    if(this.FailureReport !== null) o['f'] = this.FailureReport.encode();
    if(this.FlagUser !== null) o['F'] = this.FlagUser.encode();
    if(this.CreatePlaygroundRequest !== null) o['p'] = this.CreatePlaygroundRequest.encode();
    if(this.GetFeedbackAccount !== null) o['gf'] = this.GetFeedbackAccount.encode();
    if(this.GetExtraVersions !== null) o['e'] = this.GetExtraVersions.encode();
    return o;
}
LDDeviceToClusterMiscellaneousRequestProtocol.prototype.UrlToStoryRequest = null;
LDDeviceToClusterMiscellaneousRequestProtocol.prototype.ImageSearchRequest = null;
LDDeviceToClusterMiscellaneousRequestProtocol.prototype.FailureReport = null;
LDDeviceToClusterMiscellaneousRequestProtocol.prototype.FlagUser = null;
LDDeviceToClusterMiscellaneousRequestProtocol.prototype.CreatePlaygroundRequest = null;
LDDeviceToClusterMiscellaneousRequestProtocol.prototype.GetFeedbackAccount = null;
LDDeviceToClusterMiscellaneousRequestProtocol.prototype.GetExtraVersions = null;
function LDDeviceToClusterDirectMessagingRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['sf'] !== null && e['sf'] !== undefined))
        this.GetSmsFeedRequest = new LDGetDirectFeedRequest(e['sf']);
    if(e && (e['sm'] !== null && e['sm'] !== undefined))
        this.SendSmsMessageRequest = new LDSendDirectMessageRequest(e['sm']);
    if(e && (e['sp'] !== null && e['sp'] !== undefined))
        this.SetSmsParticipationRequest = new LDSetSmsParticipationRequest(e['sp']);
}
LDDeviceToClusterDirectMessagingRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterDirectMessagingRequestProtocol.prototype.constructor = LDDeviceToClusterDirectMessagingRequestProtocol;
LDDeviceToClusterDirectMessagingRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.GetSmsFeedRequest !== null) o['sf'] = this.GetSmsFeedRequest.encode();
    if(this.SendSmsMessageRequest !== null) o['sm'] = this.SendSmsMessageRequest.encode();
    if(this.SetSmsParticipationRequest !== null) o['sp'] = this.SetSmsParticipationRequest.encode();
    return o;
}
LDDeviceToClusterDirectMessagingRequestProtocol.prototype.GetSmsFeedRequest = null;
LDDeviceToClusterDirectMessagingRequestProtocol.prototype.SendSmsMessageRequest = null;
LDDeviceToClusterDirectMessagingRequestProtocol.prototype.SetSmsParticipationRequest = null;
function LDDeviceToClusterWallPostRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['pv'] !== null && e['pv'] !== undefined))
        this.PostVideo = new LDPostVideoRequest(e['pv']);
    if(e && (e['pm'] !== null && e['pm'] !== undefined))
        this.PostMessage = new LDPostMessageRequest(e['pm']);
    if(e && (e['ps'] !== null && e['ps'] !== undefined))
        this.PostScreenShot = new LDPostScreenShotRequest(e['ps']);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.LikePost = new LDLikePostRequest(e['l']);
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.AddVideoView = new LDAddViewRequest(e['v']);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.FollowUser = new LDFollowUserRequest(e['f']);
    if(e && (e['guw'] !== null && e['guw'] !== undefined))
        this.GetUserWall = new LDGetUserWallRequest(e['guw']);
    if(e && (e['ggw'] !== null && e['ggw'] !== undefined))
        this.GetGameWall = new LDGetGameWallRequest(e['ggw']);
    if(e && (e['gfw'] !== null && e['gfw'] !== undefined))
        this.GetFollowingWall = new LDGetFollowingWallRequest(e['gfw']);
    if(e && (e['gp'] !== null && e['gp'] !== undefined))
        this.GetPost = new LDGetPostRequest(e['gp']);
    if(e && (e['gspt'] !== null && e['gspt'] !== undefined))
        this.GetStandardPostTags = new LDGetStandardPostTagsRequest(e['gspt']);
    if(e && (e['gf'] !== null && e['gf'] !== undefined))
        this.GetFollowers = new LDGetFollowersRequest(e['gf']);
    if(e && (e['gaf'] !== null && e['gaf'] !== undefined))
        this.GetAccountsFollowedRequest = new LDGetAccountsFollowedRequest(e['gaf']);
    if(e && (e['dp'] !== null && e['dp'] !== undefined))
        this.DeletePostRequest = new LDDeletePostRequest(e['dp']);
}
LDDeviceToClusterWallPostRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterWallPostRequestProtocol.prototype.constructor = LDDeviceToClusterWallPostRequestProtocol;
LDDeviceToClusterWallPostRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.PostVideo !== null) o['pv'] = this.PostVideo.encode();
    if(this.PostMessage !== null) o['pm'] = this.PostMessage.encode();
    if(this.PostScreenShot !== null) o['ps'] = this.PostScreenShot.encode();
    if(this.LikePost !== null) o['l'] = this.LikePost.encode();
    if(this.AddVideoView !== null) o['v'] = this.AddVideoView.encode();
    if(this.FollowUser !== null) o['f'] = this.FollowUser.encode();
    if(this.GetUserWall !== null) o['guw'] = this.GetUserWall.encode();
    if(this.GetGameWall !== null) o['ggw'] = this.GetGameWall.encode();
    if(this.GetFollowingWall !== null) o['gfw'] = this.GetFollowingWall.encode();
    if(this.GetPost !== null) o['gp'] = this.GetPost.encode();
    if(this.GetStandardPostTags !== null) o['gspt'] = this.GetStandardPostTags.encode();
    if(this.GetFollowers !== null) o['gf'] = this.GetFollowers.encode();
    if(this.GetAccountsFollowedRequest !== null) o['gaf'] = this.GetAccountsFollowedRequest.encode();
    if(this.DeletePostRequest !== null) o['dp'] = this.DeletePostRequest.encode();
    return o;
}
LDDeviceToClusterWallPostRequestProtocol.prototype.PostVideo = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.PostMessage = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.PostScreenShot = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.LikePost = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.AddVideoView = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.FollowUser = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.GetUserWall = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.GetGameWall = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.GetFollowingWall = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.GetPost = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.GetStandardPostTags = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.GetFollowers = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.GetAccountsFollowedRequest = null;
LDDeviceToClusterWallPostRequestProtocol.prototype.DeletePostRequest = null;
function LDDeviceToClusterIdentityTokenRequestProtocol(e) { 
    LDRequestProtocolBase.call(this, e);
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.GetIdentityTokenRequest = new LDGetIdentityTokenRequest(e['g']);
}
LDDeviceToClusterIdentityTokenRequestProtocol.prototype = new LDRequestProtocolBase();
LDDeviceToClusterIdentityTokenRequestProtocol.prototype.constructor = LDDeviceToClusterIdentityTokenRequestProtocol;
LDDeviceToClusterIdentityTokenRequestProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDRequestProtocolBase.prototype.encode.call(this, o);
    if(this.GetIdentityTokenRequest !== null) o['g'] = this.GetIdentityTokenRequest.encode();
    return o;
}
LDDeviceToClusterIdentityTokenRequestProtocol.prototype.GetIdentityTokenRequest = null;
function LDDeviceToClusterMessageResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.GetMessageResponse = new LDGetMessageResponse(e['m']);
    if(e && (e['M'] !== null && e['M'] !== undefined))
        this.GetMessagesResponse = new LDGetMessagesResponse(e['M']);
    if(e && (e['C'] !== null && e['C'] !== undefined))
        this.GetMessagesWithContinuationResponse = new LDGetMessagesWithContinuationResponse(e['C']);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.GetJoinFeedLinkResponse = new LDGetJoinFeedLinkResponse(e['l']);
    if(e && (e['gf'] !== null && e['gf'] !== undefined))
        this.GetFeedDetails = new LDGetPublicFeedDetailsResponse(e['gf']);
}
LDDeviceToClusterMessageResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterMessageResponseProtocol.prototype.constructor = LDDeviceToClusterMessageResponseProtocol;
LDDeviceToClusterMessageResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.GetMessageResponse !== null) o['m'] = this.GetMessageResponse.encode();
    if(this.GetMessagesResponse !== null) o['M'] = this.GetMessagesResponse.encode();
    if(this.GetMessagesWithContinuationResponse !== null) o['C'] = this.GetMessagesWithContinuationResponse.encode();
    if(this.GetJoinFeedLinkResponse !== null) o['l'] = this.GetJoinFeedLinkResponse.encode();
    if(this.GetFeedDetails !== null) o['gf'] = this.GetFeedDetails.encode();
    return o;
}
LDDeviceToClusterMessageResponseProtocol.prototype.GetMessageResponse = null;
LDDeviceToClusterMessageResponseProtocol.prototype.GetMessagesResponse = null;
LDDeviceToClusterMessageResponseProtocol.prototype.GetMessagesWithContinuationResponse = null;
LDDeviceToClusterMessageResponseProtocol.prototype.GetJoinFeedLinkResponse = null;
LDDeviceToClusterMessageResponseProtocol.prototype.GetFeedDetails = null;
function LDDeviceToClusterInboxResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.DirtyFeeds = new LDDirtyFeedsResponse(e['d']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.FeedState = new LDFeedStateResponse(e['s']);
}
LDDeviceToClusterInboxResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterInboxResponseProtocol.prototype.constructor = LDDeviceToClusterInboxResponseProtocol;
LDDeviceToClusterInboxResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.DirtyFeeds !== null) o['d'] = this.DirtyFeeds.encode();
    if(this.FeedState !== null) o['s'] = this.FeedState.encode();
    return o;
}
LDDeviceToClusterInboxResponseProtocol.prototype.DirtyFeeds = null;
LDDeviceToClusterInboxResponseProtocol.prototype.FeedState = null;
function LDClusterOrDeviceToClusterBlobResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['ut'] !== null && e['ut'] !== undefined))
        this.GetUploadTicketResponse = new LDGetUploadTicketResponse(e['ut']);
    if(e && (e['mut'] !== null && e['mut'] !== undefined))
        this.GetMultipartUploadTicketResponse = new LDGetMultipartUploadTicketResponse(e['mut']);
    if(e && (e['dt'] !== null && e['dt'] !== undefined))
        this.GetDownloadTicketResponse = new LDGetDownloadTicketResponse(e['dt']);
}
LDClusterOrDeviceToClusterBlobResponseProtocol.prototype = new LDResponseProtocolBase();
LDClusterOrDeviceToClusterBlobResponseProtocol.prototype.constructor = LDClusterOrDeviceToClusterBlobResponseProtocol;
LDClusterOrDeviceToClusterBlobResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.GetUploadTicketResponse !== null) o['ut'] = this.GetUploadTicketResponse.encode();
    if(this.GetMultipartUploadTicketResponse !== null) o['mut'] = this.GetMultipartUploadTicketResponse.encode();
    if(this.GetDownloadTicketResponse !== null) o['dt'] = this.GetDownloadTicketResponse.encode();
    return o;
}
LDClusterOrDeviceToClusterBlobResponseProtocol.prototype.GetUploadTicketResponse = null;
LDClusterOrDeviceToClusterBlobResponseProtocol.prototype.GetMultipartUploadTicketResponse = null;
LDClusterOrDeviceToClusterBlobResponseProtocol.prototype.GetDownloadTicketResponse = null;
function LDDeviceToClusterContactResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContactDetailsResponse = new LDGetContactDetailsResponse(e['c']);
}
LDDeviceToClusterContactResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterContactResponseProtocol.prototype.constructor = LDDeviceToClusterContactResponseProtocol;
LDDeviceToClusterContactResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.ContactDetailsResponse !== null) o['c'] = this.ContactDetailsResponse.encode();
    return o;
}
LDDeviceToClusterContactResponseProtocol.prototype.ContactDetailsResponse = null;
function LDDeviceToClusterProfileResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ProfileDetailsResponse = new LDGetProfileDetailsResponse(e['p']);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContactProfileResponse = new LDGetOmletContactProfileResponse(e['c']);
    if(e && (e['pps'] !== null && e['pps'] !== undefined))
        this.GetProfilePublicStateResponse = new LDGetProfilePublicStateResponse(e['pps']);
    if(e && (e['ppp'] !== null && e['ppp'] !== undefined))
        this.GetProfileDetailsAndPublicStateResponse = new LDGetContactProfileAndPublicStateResponse(e['ppp']);
}
LDDeviceToClusterProfileResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterProfileResponseProtocol.prototype.constructor = LDDeviceToClusterProfileResponseProtocol;
LDDeviceToClusterProfileResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.ProfileDetailsResponse !== null) o['p'] = this.ProfileDetailsResponse.encode();
    if(this.ContactProfileResponse !== null) o['c'] = this.ContactProfileResponse.encode();
    if(this.GetProfilePublicStateResponse !== null) o['pps'] = this.GetProfilePublicStateResponse.encode();
    if(this.GetProfileDetailsAndPublicStateResponse !== null) o['ppp'] = this.GetProfileDetailsAndPublicStateResponse.encode();
    return o;
}
LDDeviceToClusterProfileResponseProtocol.prototype.ProfileDetailsResponse = null;
LDDeviceToClusterProfileResponseProtocol.prototype.ContactProfileResponse = null;
LDDeviceToClusterProfileResponseProtocol.prototype.GetProfilePublicStateResponse = null;
LDDeviceToClusterProfileResponseProtocol.prototype.GetProfileDetailsAndPublicStateResponse = null;
function LDDeviceToClusterAddressBookResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContactProfileResponse = new LDGetContactProfileResponse(e['c']);
}
LDDeviceToClusterAddressBookResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterAddressBookResponseProtocol.prototype.constructor = LDDeviceToClusterAddressBookResponseProtocol;
LDDeviceToClusterAddressBookResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.ContactProfileResponse !== null) o['c'] = this.ContactProfileResponse.encode();
    return o;
}
LDDeviceToClusterAddressBookResponseProtocol.prototype.ContactProfileResponse = null;
function LDDeviceToClusterOmletItemStoreResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.GetItemInfoResponse = new LDGetItemInfoResponse(e['g']);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.ListItemsResponse = new LDListItemsResponse(e['l']);
    if(e && (e['gg'] !== null && e['gg'] !== undefined))
        this.GenerateGrantForItemResponse = new LDGenerateGrantForItemResponse(e['gg']);
    if(e && (e['gk'] !== null && e['gk'] !== undefined))
        this.GenerateApiKeyResponse = new LDGenerateApiKeyResponse(e['gk']);
    if(e && (e['lk'] !== null && e['lk'] !== undefined))
        this.ListApiKeysResponse = new LDListApiKeysResponse(e['lk']);
}
LDDeviceToClusterOmletItemStoreResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterOmletItemStoreResponseProtocol.prototype.constructor = LDDeviceToClusterOmletItemStoreResponseProtocol;
LDDeviceToClusterOmletItemStoreResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.GetItemInfoResponse !== null) o['g'] = this.GetItemInfoResponse.encode();
    if(this.ListItemsResponse !== null) o['l'] = this.ListItemsResponse.encode();
    if(this.GenerateGrantForItemResponse !== null) o['gg'] = this.GenerateGrantForItemResponse.encode();
    if(this.GenerateApiKeyResponse !== null) o['gk'] = this.GenerateApiKeyResponse.encode();
    if(this.ListApiKeysResponse !== null) o['lk'] = this.ListApiKeysResponse.encode();
    return o;
}
LDDeviceToClusterOmletItemStoreResponseProtocol.prototype.GetItemInfoResponse = null;
LDDeviceToClusterOmletItemStoreResponseProtocol.prototype.ListItemsResponse = null;
LDDeviceToClusterOmletItemStoreResponseProtocol.prototype.GenerateGrantForItemResponse = null;
LDDeviceToClusterOmletItemStoreResponseProtocol.prototype.GenerateApiKeyResponse = null;
LDDeviceToClusterOmletItemStoreResponseProtocol.prototype.ListApiKeysResponse = null;
function LDDeviceToClusterDeviceResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
}
LDDeviceToClusterDeviceResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterDeviceResponseProtocol.prototype.constructor = LDDeviceToClusterDeviceResponseProtocol;
LDDeviceToClusterDeviceResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    return o;
}
function LDDeviceToClusterCloudSyncResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.GetClientCloudConfigResponse = new LDGetCloudConfigResponse(e['g']);
}
LDDeviceToClusterCloudSyncResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterCloudSyncResponseProtocol.prototype.constructor = LDDeviceToClusterCloudSyncResponseProtocol;
LDDeviceToClusterCloudSyncResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.GetClientCloudConfigResponse !== null) o['g'] = this.GetClientCloudConfigResponse.encode();
    return o;
}
LDDeviceToClusterCloudSyncResponseProtocol.prototype.GetClientCloudConfigResponse = null;
function LDDeviceToClusterGameChallengeResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.FindGamers = new LDFindGamersResponse(e['f']);
}
LDDeviceToClusterGameChallengeResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterGameChallengeResponseProtocol.prototype.constructor = LDDeviceToClusterGameChallengeResponseProtocol;
LDDeviceToClusterGameChallengeResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.FindGamers !== null) o['f'] = this.FindGamers.encode();
    return o;
}
LDDeviceToClusterGameChallengeResponseProtocol.prototype.FindGamers = null;
function LDDeviceToClusterSubscriptionResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.GetSubscriptionUrl = new LDCreateSubscriptionResponse(e['u']);
}
LDDeviceToClusterSubscriptionResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterSubscriptionResponseProtocol.prototype.constructor = LDDeviceToClusterSubscriptionResponseProtocol;
LDDeviceToClusterSubscriptionResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.GetSubscriptionUrl !== null) o['u'] = this.GetSubscriptionUrl.encode();
    return o;
}
LDDeviceToClusterSubscriptionResponseProtocol.prototype.GetSubscriptionUrl = null;
function LDDeviceToClusterHighScoreResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.ScoreResponse = new LDScoreResponse(e['s']);
    if(e && (e['ss'] !== null && e['ss'] !== undefined))
        this.ScoresResponse = new LDScoresResponse(e['ss']);
}
LDDeviceToClusterHighScoreResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterHighScoreResponseProtocol.prototype.constructor = LDDeviceToClusterHighScoreResponseProtocol;
LDDeviceToClusterHighScoreResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.ScoreResponse !== null) o['s'] = this.ScoreResponse.encode();
    if(this.ScoresResponse !== null) o['ss'] = this.ScoresResponse.encode();
    return o;
}
LDDeviceToClusterHighScoreResponseProtocol.prototype.ScoreResponse = null;
LDDeviceToClusterHighScoreResponseProtocol.prototype.ScoresResponse = null;
function LDDeviceToClusterNearbyItemResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.BroadcastItemResponse = new LDBroadcastItemResponse(e['b']);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.FetchNearbyItemsResponse = new LDFetchNearbyItemsResponse(e['f']);
}
LDDeviceToClusterNearbyItemResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterNearbyItemResponseProtocol.prototype.constructor = LDDeviceToClusterNearbyItemResponseProtocol;
LDDeviceToClusterNearbyItemResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.BroadcastItemResponse !== null) o['b'] = this.BroadcastItemResponse.encode();
    if(this.FetchNearbyItemsResponse !== null) o['f'] = this.FetchNearbyItemsResponse.encode();
    return o;
}
LDDeviceToClusterNearbyItemResponseProtocol.prototype.BroadcastItemResponse = null;
LDDeviceToClusterNearbyItemResponseProtocol.prototype.FetchNearbyItemsResponse = null;
function LDDeviceToClusterMiscellaneousResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['wl'] !== null && e['wl'] !== undefined))
        this.UrlToStoryResponse = new LDUrlToStoryResponse(e['wl']);
    if(e && (e['is'] !== null && e['is'] !== undefined))
        this.ImageSearchResponse = new LDImageSearchResponse(e['is']);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.CreatePlaygroundResponse = new LDCreatePlaygroundResponse(e['p']);
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.GetExtraVersions = new LDGetExtraVersionsResponse(e['e']);
}
LDDeviceToClusterMiscellaneousResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterMiscellaneousResponseProtocol.prototype.constructor = LDDeviceToClusterMiscellaneousResponseProtocol;
LDDeviceToClusterMiscellaneousResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.UrlToStoryResponse !== null) o['wl'] = this.UrlToStoryResponse.encode();
    if(this.ImageSearchResponse !== null) o['is'] = this.ImageSearchResponse.encode();
    if(this.CreatePlaygroundResponse !== null) o['p'] = this.CreatePlaygroundResponse.encode();
    if(this.GetExtraVersions !== null) o['e'] = this.GetExtraVersions.encode();
    return o;
}
LDDeviceToClusterMiscellaneousResponseProtocol.prototype.UrlToStoryResponse = null;
LDDeviceToClusterMiscellaneousResponseProtocol.prototype.ImageSearchResponse = null;
LDDeviceToClusterMiscellaneousResponseProtocol.prototype.CreatePlaygroundResponse = null;
LDDeviceToClusterMiscellaneousResponseProtocol.prototype.GetExtraVersions = null;
function LDDeviceToClusterDirectMessagingResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['gs'] !== null && e['gs'] !== undefined))
        this.GetSmsFeedResponse = new LDGetDirectFeedResponse(e['gs']);
    if(e && (e['sm'] !== null && e['sm'] !== undefined))
        this.SendSmsMessageResponse = new LDSendDirectMessageResponse(e['sm']);
}
LDDeviceToClusterDirectMessagingResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterDirectMessagingResponseProtocol.prototype.constructor = LDDeviceToClusterDirectMessagingResponseProtocol;
LDDeviceToClusterDirectMessagingResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.GetSmsFeedResponse !== null) o['gs'] = this.GetSmsFeedResponse.encode();
    if(this.SendSmsMessageResponse !== null) o['sm'] = this.SendSmsMessageResponse.encode();
    return o;
}
LDDeviceToClusterDirectMessagingResponseProtocol.prototype.GetSmsFeedResponse = null;
LDDeviceToClusterDirectMessagingResponseProtocol.prototype.SendSmsMessageResponse = null;
function LDDeviceToClusterWallPostResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['w'] !== null && e['w'] !== undefined))
        this.WallResponse = new LDWallResponse(e['w']);
    if(e && (e['ws'] !== null && e['ws'] !== undefined))
        this.WallsResponse = new LDWallsResponse(e['ws']);
    if(e && (e['gp'] !== null && e['gp'] !== undefined))
        this.GetPostResponse = new LDGetPostResponse(e['gp']);
    if(e && (e['ap'] !== null && e['ap'] !== undefined))
        this.AddPostResponse = new LDAddPostResponse(e['ap']);
    if(e && (e['gaf'] !== null && e['gaf'] !== undefined))
        this.GetAccountsFollowedResponse = new LDGetAccountsFollowedResponse(e['gaf']);
    if(e && (e['gspt'] !== null && e['gspt'] !== undefined))
        this.GetStandardPostTagsResponse = new LDGetStandardPostTagsResponse(e['gspt']);
    if(e && (e['gf'] !== null && e['gf'] !== undefined))
        this.GetFollowersResponse = new LDGetFollowersResponse(e['gf']);
}
LDDeviceToClusterWallPostResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterWallPostResponseProtocol.prototype.constructor = LDDeviceToClusterWallPostResponseProtocol;
LDDeviceToClusterWallPostResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.WallResponse !== null) o['w'] = this.WallResponse.encode();
    if(this.WallsResponse !== null) o['ws'] = this.WallsResponse.encode();
    if(this.GetPostResponse !== null) o['gp'] = this.GetPostResponse.encode();
    if(this.AddPostResponse !== null) o['ap'] = this.AddPostResponse.encode();
    if(this.GetAccountsFollowedResponse !== null) o['gaf'] = this.GetAccountsFollowedResponse.encode();
    if(this.GetStandardPostTagsResponse !== null) o['gspt'] = this.GetStandardPostTagsResponse.encode();
    if(this.GetFollowersResponse !== null) o['gf'] = this.GetFollowersResponse.encode();
    return o;
}
LDDeviceToClusterWallPostResponseProtocol.prototype.WallResponse = null;
LDDeviceToClusterWallPostResponseProtocol.prototype.WallsResponse = null;
LDDeviceToClusterWallPostResponseProtocol.prototype.GetPostResponse = null;
LDDeviceToClusterWallPostResponseProtocol.prototype.AddPostResponse = null;
LDDeviceToClusterWallPostResponseProtocol.prototype.GetAccountsFollowedResponse = null;
LDDeviceToClusterWallPostResponseProtocol.prototype.GetStandardPostTagsResponse = null;
LDDeviceToClusterWallPostResponseProtocol.prototype.GetFollowersResponse = null;
function LDDeviceToClusterIdentityTokenResponseProtocol(e) { 
    LDResponseProtocolBase.call(this, e);
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.GetIdentityTokenResponse = new LDGetIdentityTokenResponse(e['g']);
}
LDDeviceToClusterIdentityTokenResponseProtocol.prototype = new LDResponseProtocolBase();
LDDeviceToClusterIdentityTokenResponseProtocol.prototype.constructor = LDDeviceToClusterIdentityTokenResponseProtocol;
LDDeviceToClusterIdentityTokenResponseProtocol.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDResponseProtocolBase.prototype.encode.call(this, o);
    if(this.GetIdentityTokenResponse !== null) o['g'] = this.GetIdentityTokenResponse.encode();
    return o;
}
LDDeviceToClusterIdentityTokenResponseProtocol.prototype.GetIdentityTokenResponse = null;
function LDURI(e) { 
}
LDURI.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    return o;
}
function LDContactProfile(e) { 
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.Name = e['n'];
    else
        this.Name = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ProfilePictureLink = e['p'];
    else
        this.ProfilePictureLink = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.ProfileDecryptedHash = new Buffer(e['d'], 'base64');
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.Version = e['v'];
    else
        this.Version = null;
    if(e && (e['i'] !== null && e['i'] !== undefined)) { 
        this.Identities = [];
        var d = e['i'];
        for(var k = 0; k < d.length; ++k) this.Identities.push(new LDIdentity(d[k]));
    }
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.HasAppTime = e['t'];
}
LDContactProfile.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Name !== null) o['n'] = this.Name;
    if(this.ProfilePictureLink !== null) o['p'] = this.ProfilePictureLink;
    if(this.ProfileDecryptedHash !== null) o['d'] = this.ProfileDecryptedHash.toString('base64');
    if(this.Version !== null) o['v'] = this.Version;
    if(this.Identities !== null) { 
        o['i'] = [];
        var d = this.Identities;
        for(var k = 0; k < d.length; ++k) o['i'].push(d[k].encode());
    } else {
        o['Identities'] = null;
    }
    if(this.HasAppTime !== null) o['t'] = this.HasAppTime;
    return o;
}
LDContactProfile.prototype.Name = null;
LDContactProfile.prototype.ProfilePictureLink = null;
LDContactProfile.prototype.ProfileDecryptedHash = null;
LDContactProfile.prototype.Version = null;
LDContactProfile.prototype.Identities = null;
LDContactProfile.prototype.HasAppTime = null;
function LDEnum(e) { 
}
LDEnum.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    return o;
}
function LDAccessScope(e) { 
    LDEnum.call(this, e);
}
LDAccessScope.prototype = new LDEnum();
LDAccessScope.prototype.constructor = LDAccessScope;
LDAccessScope.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDEnum.prototype.encode.call(this, o);
    return o;
}
function LDRegisterWithTokenRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Identity = new LDIdentity(e['i']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.Locale = e['l'];
    else
        this.Locale = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.IpAddress = e['p'];
    else
        this.IpAddress = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.RequestedCluster = e['c'];
    else
        this.RequestedCluster = null;
}
LDRegisterWithTokenRequest.prototype = new LDJSONLoggable();
LDRegisterWithTokenRequest.prototype.constructor = LDRegisterWithTokenRequest;
LDRegisterWithTokenRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Identity !== null) o['i'] = this.Identity.encode();
    if(this.Account !== null) o['a'] = this.Account;
    if(this.Locale !== null) o['l'] = this.Locale;
    if(this.IpAddress !== null) o['p'] = this.IpAddress;
    if(this.RequestedCluster !== null) o['c'] = this.RequestedCluster;
    return o;
}
LDRegisterWithTokenRequest.prototype.Identity = null;
LDRegisterWithTokenRequest.prototype.Account = null;
LDRegisterWithTokenRequest.prototype.Locale = null;
LDRegisterWithTokenRequest.prototype.IpAddress = null;
LDRegisterWithTokenRequest.prototype.RequestedCluster = null;
function LDConfirmTokenRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Identity = new LDIdentity(e['i']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Token = e['t'];
    else
        this.Token = null;
}
LDConfirmTokenRequest.prototype = new LDJSONLoggable();
LDConfirmTokenRequest.prototype.constructor = LDConfirmTokenRequest;
LDConfirmTokenRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Identity !== null) o['i'] = this.Identity.encode();
    if(this.Token !== null) o['t'] = this.Token;
    return o;
}
LDConfirmTokenRequest.prototype.Identity = null;
LDConfirmTokenRequest.prototype.Token = null;
function LDRegisterWithOAuthRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.ServiceType = e['s'];
    else
        this.ServiceType = null;
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.Key = e['k'];
    else
        this.Key = null;
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.IpAddress = e['p'];
    else
        this.IpAddress = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.RequestedCluster = e['c'];
    else
        this.RequestedCluster = null;
}
LDRegisterWithOAuthRequest.prototype = new LDJSONLoggable();
LDRegisterWithOAuthRequest.prototype.constructor = LDRegisterWithOAuthRequest;
LDRegisterWithOAuthRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ServiceType !== null) o['s'] = this.ServiceType;
    if(this.Key !== null) o['k'] = this.Key;
    if(this.Account !== null) o['a'] = this.Account;
    if(this.IpAddress !== null) o['p'] = this.IpAddress;
    if(this.RequestedCluster !== null) o['c'] = this.RequestedCluster;
    return o;
}
LDRegisterWithOAuthRequest.prototype.ServiceType = null;
LDRegisterWithOAuthRequest.prototype.Key = null;
LDRegisterWithOAuthRequest.prototype.Account = null;
LDRegisterWithOAuthRequest.prototype.IpAddress = null;
LDRegisterWithOAuthRequest.prototype.RequestedCluster = null;
function LDGetLinkedIdentitiesRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
}
LDGetLinkedIdentitiesRequest.prototype = new LDJSONLoggable();
LDGetLinkedIdentitiesRequest.prototype.constructor = LDGetLinkedIdentitiesRequest;
LDGetLinkedIdentitiesRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Account !== null) o['a'] = this.Account;
    return o;
}
LDGetLinkedIdentitiesRequest.prototype.Account = null;
function LDCheckIdentityLinkedRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.IpAddress = e['p'];
    else
        this.IpAddress = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.RequestedCluster = e['c'];
    else
        this.RequestedCluster = null;
}
LDCheckIdentityLinkedRequest.prototype = new LDJSONLoggable();
LDCheckIdentityLinkedRequest.prototype.constructor = LDCheckIdentityLinkedRequest;
LDCheckIdentityLinkedRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.IpAddress !== null) o['p'] = this.IpAddress;
    if(this.RequestedCluster !== null) o['c'] = this.RequestedCluster;
    return o;
}
LDCheckIdentityLinkedRequest.prototype.IpAddress = null;
LDCheckIdentityLinkedRequest.prototype.RequestedCluster = null;
function LDUnlinkIdentityRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Identity = new LDIdentity(e['i']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
}
LDUnlinkIdentityRequest.prototype = new LDJSONLoggable();
LDUnlinkIdentityRequest.prototype.constructor = LDUnlinkIdentityRequest;
LDUnlinkIdentityRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Identity !== null) o['i'] = this.Identity.encode();
    if(this.Account !== null) o['a'] = this.Account;
    return o;
}
LDUnlinkIdentityRequest.prototype.Identity = null;
LDUnlinkIdentityRequest.prototype.Account = null;
function LDLinkOmletIdentityRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Identity = new LDIdentity(e['i']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
}
LDLinkOmletIdentityRequest.prototype = new LDJSONLoggable();
LDLinkOmletIdentityRequest.prototype.constructor = LDLinkOmletIdentityRequest;
LDLinkOmletIdentityRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Identity !== null) o['i'] = this.Identity.encode();
    if(this.Account !== null) o['a'] = this.Account;
    return o;
}
LDLinkOmletIdentityRequest.prototype.Identity = null;
LDLinkOmletIdentityRequest.prototype.Account = null;
function LDGetAppSigninLinkRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.RedirectPage = e['r'];
    else
        this.RedirectPage = null;
    if(e && (e['S'] !== null && e['S'] !== undefined)) { 
        this.Scopes = [];
        var d = e['S'];
        for(var k = 0; k < d.length; ++k) this.Scopes.push(d[k]);
    }
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.LoginServiceType = e['s'];
    else
        this.LoginServiceType = null;
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.LoginKey = e['k'];
    else
        this.LoginKey = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.IpAddress = e['p'];
    else
        this.IpAddress = null;
}
LDGetAppSigninLinkRequest.prototype = new LDJSONLoggable();
LDGetAppSigninLinkRequest.prototype.constructor = LDGetAppSigninLinkRequest;
LDGetAppSigninLinkRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.RedirectPage !== null) o['r'] = this.RedirectPage;
    if(this.Scopes !== null) { 
        o['S'] = [];
        var d = this.Scopes;
        for(var k = 0; k < d.length; ++k) o['S'].push(d[k]);
    } else {
        o['Scopes'] = null;
    }
    if(this.LoginServiceType !== null) o['s'] = this.LoginServiceType;
    if(this.LoginKey !== null) o['k'] = this.LoginKey;
    if(this.IpAddress !== null) o['p'] = this.IpAddress;
    return o;
}
LDGetAppSigninLinkRequest.prototype.RedirectPage = null;
LDGetAppSigninLinkRequest.prototype.Scopes = null;
LDGetAppSigninLinkRequest.prototype.LoginServiceType = null;
LDGetAppSigninLinkRequest.prototype.LoginKey = null;
LDGetAppSigninLinkRequest.prototype.IpAddress = null;
function LDConfirmAuthCodeRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AuthCode = e['a'];
    else
        this.AuthCode = null;
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.QueryKey = e['k'];
    else
        this.QueryKey = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.IpAddress = e['p'];
    else
        this.IpAddress = null;
}
LDConfirmAuthCodeRequest.prototype = new LDJSONLoggable();
LDConfirmAuthCodeRequest.prototype.constructor = LDConfirmAuthCodeRequest;
LDConfirmAuthCodeRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.AuthCode !== null) o['a'] = this.AuthCode;
    if(this.QueryKey !== null) o['k'] = this.QueryKey;
    if(this.IpAddress !== null) o['p'] = this.IpAddress;
    return o;
}
LDConfirmAuthCodeRequest.prototype.AuthCode = null;
LDConfirmAuthCodeRequest.prototype.QueryKey = null;
LDConfirmAuthCodeRequest.prototype.IpAddress = null;
function LDDeviceRegistrationStateChangedPush(e) { 
    LDJSONLoggable.call(this, e);
}
LDDeviceRegistrationStateChangedPush.prototype = new LDJSONLoggable();
LDDeviceRegistrationStateChangedPush.prototype.constructor = LDDeviceRegistrationStateChangedPush;
LDDeviceRegistrationStateChangedPush.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDUnblockIdentityRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Identity = new LDIdentity(e['i']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AdminAccount = e['a'];
    else
        this.AdminAccount = null;
}
LDUnblockIdentityRequest.prototype = new LDJSONLoggable();
LDUnblockIdentityRequest.prototype.constructor = LDUnblockIdentityRequest;
LDUnblockIdentityRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Identity !== null) o['i'] = this.Identity.encode();
    if(this.AdminAccount !== null) o['a'] = this.AdminAccount;
    return o;
}
LDUnblockIdentityRequest.prototype.Identity = null;
LDUnblockIdentityRequest.prototype.AdminAccount = null;
function LDGetEmailLoginLinkRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Identity = new LDIdentity(e['i']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AdminAccount = e['a'];
    else
        this.AdminAccount = null;
}
LDGetEmailLoginLinkRequest.prototype = new LDJSONLoggable();
LDGetEmailLoginLinkRequest.prototype.constructor = LDGetEmailLoginLinkRequest;
LDGetEmailLoginLinkRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Identity !== null) o['i'] = this.Identity.encode();
    if(this.AdminAccount !== null) o['a'] = this.AdminAccount;
    return o;
}
LDGetEmailLoginLinkRequest.prototype.Identity = null;
LDGetEmailLoginLinkRequest.prototype.AdminAccount = null;
function LDGetAccountDetailsByAccountRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AdminAccount = e['a'];
    else
        this.AdminAccount = null;
    if(e && (e['A'] !== null && e['A'] !== undefined))
        this.AccountToLookup = e['A'];
    else
        this.AccountToLookup = null;
}
LDGetAccountDetailsByAccountRequest.prototype = new LDJSONLoggable();
LDGetAccountDetailsByAccountRequest.prototype.constructor = LDGetAccountDetailsByAccountRequest;
LDGetAccountDetailsByAccountRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.AdminAccount !== null) o['a'] = this.AdminAccount;
    if(this.AccountToLookup !== null) o['A'] = this.AccountToLookup;
    return o;
}
LDGetAccountDetailsByAccountRequest.prototype.AdminAccount = null;
LDGetAccountDetailsByAccountRequest.prototype.AccountToLookup = null;
function LDGetAccountDetailsByIdentityRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Identity = new LDIdentity(e['i']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AdminAccount = e['a'];
    else
        this.AdminAccount = null;
}
LDGetAccountDetailsByIdentityRequest.prototype = new LDJSONLoggable();
LDGetAccountDetailsByIdentityRequest.prototype.constructor = LDGetAccountDetailsByIdentityRequest;
LDGetAccountDetailsByIdentityRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Identity !== null) o['i'] = this.Identity.encode();
    if(this.AdminAccount !== null) o['a'] = this.AdminAccount;
    return o;
}
LDGetAccountDetailsByIdentityRequest.prototype.Identity = null;
LDGetAccountDetailsByIdentityRequest.prototype.AdminAccount = null;
function LDGetIdentityRecordsRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Identity = new LDIdentity(e['i']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AdminAccount = e['a'];
    else
        this.AdminAccount = null;
}
LDGetIdentityRecordsRequest.prototype = new LDJSONLoggable();
LDGetIdentityRecordsRequest.prototype.constructor = LDGetIdentityRecordsRequest;
LDGetIdentityRecordsRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Identity !== null) o['i'] = this.Identity.encode();
    if(this.AdminAccount !== null) o['a'] = this.AdminAccount;
    return o;
}
LDGetIdentityRecordsRequest.prototype.Identity = null;
LDGetIdentityRecordsRequest.prototype.AdminAccount = null;
function LDListFlaggedUsersRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.End = e['e'];
    else
        this.End = null;
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Start = e['s'];
    else
        this.Start = null;
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.ContinuationKey = new Buffer(e['k'], 'base64');
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AdminAccount = e['a'];
    else
        this.AdminAccount = null;
}
LDListFlaggedUsersRequest.prototype = new LDJSONLoggable();
LDListFlaggedUsersRequest.prototype.constructor = LDListFlaggedUsersRequest;
LDListFlaggedUsersRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.End !== null) o['e'] = this.End;
    if(this.Start !== null) o['s'] = this.Start;
    if(this.ContinuationKey !== null) o['k'] = this.ContinuationKey.toString('base64');
    if(this.AdminAccount !== null) o['a'] = this.AdminAccount;
    return o;
}
LDListFlaggedUsersRequest.prototype.End = null;
LDListFlaggedUsersRequest.prototype.Start = null;
LDListFlaggedUsersRequest.prototype.ContinuationKey = null;
LDListFlaggedUsersRequest.prototype.AdminAccount = null;
function LDChangeUserNameRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AdminAccount = e['a'];
    else
        this.AdminAccount = null;
    if(e && (e['A'] !== null && e['A'] !== undefined))
        this.Account = e['A'];
    else
        this.Account = null;
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.Name = e['n'];
    else
        this.Name = null;
}
LDChangeUserNameRequest.prototype = new LDJSONLoggable();
LDChangeUserNameRequest.prototype.constructor = LDChangeUserNameRequest;
LDChangeUserNameRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.AdminAccount !== null) o['a'] = this.AdminAccount;
    if(this.Account !== null) o['A'] = this.Account;
    if(this.Name !== null) o['n'] = this.Name;
    return o;
}
LDChangeUserNameRequest.prototype.AdminAccount = null;
LDChangeUserNameRequest.prototype.Account = null;
LDChangeUserNameRequest.prototype.Name = null;
function LDChangeUserProfilePictureRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AdminAccount = e['a'];
    else
        this.AdminAccount = null;
    if(e && (e['A'] !== null && e['A'] !== undefined))
        this.Account = e['A'];
    else
        this.Account = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.BlobLinkString = e['p'];
    else
        this.BlobLinkString = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.DecryptedHash = new Buffer(e['d'], 'base64');
}
LDChangeUserProfilePictureRequest.prototype = new LDJSONLoggable();
LDChangeUserProfilePictureRequest.prototype.constructor = LDChangeUserProfilePictureRequest;
LDChangeUserProfilePictureRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.AdminAccount !== null) o['a'] = this.AdminAccount;
    if(this.Account !== null) o['A'] = this.Account;
    if(this.BlobLinkString !== null) o['p'] = this.BlobLinkString;
    if(this.DecryptedHash !== null) o['d'] = this.DecryptedHash.toString('base64');
    return o;
}
LDChangeUserProfilePictureRequest.prototype.AdminAccount = null;
LDChangeUserProfilePictureRequest.prototype.Account = null;
LDChangeUserProfilePictureRequest.prototype.BlobLinkString = null;
LDChangeUserProfilePictureRequest.prototype.DecryptedHash = null;
function LDDisableUserGameChallengeRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AdminAccount = e['a'];
    else
        this.AdminAccount = null;
    if(e && (e['A'] !== null && e['A'] !== undefined))
        this.Account = e['A'];
    else
        this.Account = null;
}
LDDisableUserGameChallengeRequest.prototype = new LDJSONLoggable();
LDDisableUserGameChallengeRequest.prototype.constructor = LDDisableUserGameChallengeRequest;
LDDisableUserGameChallengeRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.AdminAccount !== null) o['a'] = this.AdminAccount;
    if(this.Account !== null) o['A'] = this.Account;
    return o;
}
LDDisableUserGameChallengeRequest.prototype.AdminAccount = null;
LDDisableUserGameChallengeRequest.prototype.Account = null;
function LDLogUserOutRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AdminAccount = e['a'];
    else
        this.AdminAccount = null;
    if(e && (e['A'] !== null && e['A'] !== undefined))
        this.Account = e['A'];
    else
        this.Account = null;
}
LDLogUserOutRequest.prototype = new LDJSONLoggable();
LDLogUserOutRequest.prototype.constructor = LDLogUserOutRequest;
LDLogUserOutRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.AdminAccount !== null) o['a'] = this.AdminAccount;
    if(this.Account !== null) o['A'] = this.Account;
    return o;
}
LDLogUserOutRequest.prototype.AdminAccount = null;
LDLogUserOutRequest.prototype.Account = null;
function LDGetDeviceRecordsRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Device = e['i'];
    else
        this.Device = null;
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AdminAccount = e['a'];
    else
        this.AdminAccount = null;
}
LDGetDeviceRecordsRequest.prototype = new LDJSONLoggable();
LDGetDeviceRecordsRequest.prototype.constructor = LDGetDeviceRecordsRequest;
LDGetDeviceRecordsRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Device !== null) o['i'] = this.Device;
    if(this.AdminAccount !== null) o['a'] = this.AdminAccount;
    return o;
}
LDGetDeviceRecordsRequest.prototype.Device = null;
LDGetDeviceRecordsRequest.prototype.AdminAccount = null;
function LDAccountDetailsResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AccountDetails = new LDAccountDetails(e['a']);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.WasLegacy = e['l'];
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.AppId = new Buffer(e['i'], 'base64');
    if(e && (e['S'] !== null && e['S'] !== undefined)) { 
        this.Scopes = [];
        var d = e['S'];
        for(var k = 0; k < d.length; ++k) this.Scopes.push(d[k]);
    }
}
LDAccountDetailsResponse.prototype = new LDJSONLoggable();
LDAccountDetailsResponse.prototype.constructor = LDAccountDetailsResponse;
LDAccountDetailsResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.AccountDetails !== null) o['a'] = this.AccountDetails.encode();
    if(this.WasLegacy !== null) o['l'] = this.WasLegacy;
    if(this.AppId !== null) o['i'] = this.AppId.toString('base64');
    if(this.Scopes !== null) { 
        o['S'] = [];
        var d = this.Scopes;
        for(var k = 0; k < d.length; ++k) o['S'].push(d[k]);
    } else {
        o['Scopes'] = null;
    }
    return o;
}
LDAccountDetailsResponse.prototype.AccountDetails = null;
LDAccountDetailsResponse.prototype.WasLegacy = null;
LDAccountDetailsResponse.prototype.AppId = null;
LDAccountDetailsResponse.prototype.Scopes = null;
function LDGetLinkedIdentitiesResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['I'] !== null && e['I'] !== undefined)) { 
        this.Identities = [];
        var d = e['I'];
        for(var k = 0; k < d.length; ++k) this.Identities.push(new LDIdentity(d[k]));
    }
}
LDGetLinkedIdentitiesResponse.prototype = new LDJSONLoggable();
LDGetLinkedIdentitiesResponse.prototype.constructor = LDGetLinkedIdentitiesResponse;
LDGetLinkedIdentitiesResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Identities !== null) { 
        o['I'] = [];
        var d = this.Identities;
        for(var k = 0; k < d.length; ++k) o['I'].push(d[k].encode());
    } else {
        o['Identities'] = null;
    }
    return o;
}
LDGetLinkedIdentitiesResponse.prototype.Identities = null;
function LDGetAppSigninLinkResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.Link = e['l'];
    else
        this.Link = null;
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Status = e['s'];
    else
        this.Status = null;
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AccountDetailsResponse = new LDAccountDetailsResponse(e['a']);
}
LDGetAppSigninLinkResponse.prototype = new LDJSONLoggable();
LDGetAppSigninLinkResponse.prototype.constructor = LDGetAppSigninLinkResponse;
LDGetAppSigninLinkResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Link !== null) o['l'] = this.Link;
    if(this.Status !== null) o['s'] = this.Status;
    if(this.AccountDetailsResponse !== null) o['a'] = this.AccountDetailsResponse.encode();
    return o;
}
LDGetAppSigninLinkResponse.prototype.Link = null;
LDGetAppSigninLinkResponse.prototype.Status = null;
LDGetAppSigninLinkResponse.prototype.AccountDetailsResponse = null;
function LDGetIdentityRecordsResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['r'] !== null && e['r'] !== undefined)) { 
        this.Records = [];
        var d = e['r'];
        for(var k = 0; k < d.length; ++k) this.Records.push(d[k]);
    }
}
LDGetIdentityRecordsResponse.prototype = new LDJSONLoggable();
LDGetIdentityRecordsResponse.prototype.constructor = LDGetIdentityRecordsResponse;
LDGetIdentityRecordsResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Records !== null) { 
        o['r'] = [];
        var d = this.Records;
        for(var k = 0; k < d.length; ++k) o['r'].push(d[k]);
    } else {
        o['Records'] = null;
    }
    return o;
}
LDGetIdentityRecordsResponse.prototype.Records = null;
function LDListFlaggedUsersResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['d'] !== null && e['d'] !== undefined)) { 
        this.Details = [];
        var d = e['d'];
        for(var k = 0; k < d.length; ++k) this.Details.push(new LDFlaggedDetails(d[k]));
    }
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.ContinuationKey = new Buffer(e['k'], 'base64');
}
LDListFlaggedUsersResponse.prototype = new LDJSONLoggable();
LDListFlaggedUsersResponse.prototype.constructor = LDListFlaggedUsersResponse;
LDListFlaggedUsersResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Details !== null) { 
        o['d'] = [];
        var d = this.Details;
        for(var k = 0; k < d.length; ++k) o['d'].push(d[k].encode());
    } else {
        o['Details'] = null;
    }
    if(this.ContinuationKey !== null) o['k'] = this.ContinuationKey.toString('base64');
    return o;
}
LDListFlaggedUsersResponse.prototype.Details = null;
LDListFlaggedUsersResponse.prototype.ContinuationKey = null;
function LDGetDeviceRecordsResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['r'] !== null && e['r'] !== undefined)) { 
        this.Records = [];
        var d = e['r'];
        for(var k = 0; k < d.length; ++k) this.Records.push(d[k]);
    }
}
LDGetDeviceRecordsResponse.prototype = new LDJSONLoggable();
LDGetDeviceRecordsResponse.prototype.constructor = LDGetDeviceRecordsResponse;
LDGetDeviceRecordsResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Records !== null) { 
        o['r'] = [];
        var d = this.Records;
        for(var k = 0; k < d.length; ++k) o['r'].push(d[k]);
    } else {
        o['Records'] = null;
    }
    return o;
}
LDGetDeviceRecordsResponse.prototype.Records = null;
function LDCreateFeedRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
}
LDCreateFeedRequest.prototype = new LDJSONLoggable();
LDCreateFeedRequest.prototype.constructor = LDCreateFeedRequest;
LDCreateFeedRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    return o;
}
LDCreateFeedRequest.prototype.Feed = null;
function LDGetMessagesSinceRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Timestamp = e['t'];
    else
        this.Timestamp = null;
}
LDGetMessagesSinceRequest.prototype = new LDJSONLoggable();
LDGetMessagesSinceRequest.prototype.constructor = LDGetMessagesSinceRequest;
LDGetMessagesSinceRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Timestamp !== null) o['t'] = this.Timestamp;
    return o;
}
LDGetMessagesSinceRequest.prototype.Feed = null;
LDGetMessagesSinceRequest.prototype.Timestamp = null;
function LDGetMessagesBeforeRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Timestamp = e['t'];
    else
        this.Timestamp = null;
}
LDGetMessagesBeforeRequest.prototype = new LDJSONLoggable();
LDGetMessagesBeforeRequest.prototype.constructor = LDGetMessagesBeforeRequest;
LDGetMessagesBeforeRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Timestamp !== null) o['t'] = this.Timestamp;
    return o;
}
LDGetMessagesBeforeRequest.prototype.Feed = null;
LDGetMessagesBeforeRequest.prototype.Timestamp = null;
function LDGetMessagesByTypeRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Type = e['t'];
    else
        this.Type = null;
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.NextResult = new Buffer(e['n'], 'base64');
}
LDGetMessagesByTypeRequest.prototype = new LDJSONLoggable();
LDGetMessagesByTypeRequest.prototype.constructor = LDGetMessagesByTypeRequest;
LDGetMessagesByTypeRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Type !== null) o['t'] = this.Type;
    if(this.NextResult !== null) o['n'] = this.NextResult.toString('base64');
    return o;
}
LDGetMessagesByTypeRequest.prototype.Feed = null;
LDGetMessagesByTypeRequest.prototype.Type = null;
LDGetMessagesByTypeRequest.prototype.NextResult = null;
function LDGetMessageByIdRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = new LDTypedId(e['i']);
}
LDGetMessageByIdRequest.prototype = new LDJSONLoggable();
LDGetMessageByIdRequest.prototype.constructor = LDGetMessageByIdRequest;
LDGetMessageByIdRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Id !== null) o['i'] = this.Id.encode();
    return o;
}
LDGetMessageByIdRequest.prototype.Feed = null;
LDGetMessageByIdRequest.prototype.Id = null;
function LDAddMessageRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = new LDTypedId(e['i']);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.Body = new Buffer(e['b'], 'base64');
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.Version = e['v'];
    else
        this.Version = null;
    if(e && (e['w'] !== null && e['w'] !== undefined))
        this.AnyMemberWritable = e['w'];
    else
        this.AnyMemberWritable = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.FromDevice = e['d'];
}
LDAddMessageRequest.prototype = new LDJSONLoggable();
LDAddMessageRequest.prototype.constructor = LDAddMessageRequest;
LDAddMessageRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Id !== null) o['i'] = this.Id.encode();
    if(this.Body !== null) o['b'] = this.Body.toString('base64');
    if(this.Version !== null) o['v'] = this.Version;
    if(this.AnyMemberWritable !== null) o['w'] = this.AnyMemberWritable;
    if(this.FromDevice !== null) o['d'] = this.FromDevice;
    return o;
}
LDAddMessageRequest.prototype.Feed = null;
LDAddMessageRequest.prototype.Id = null;
LDAddMessageRequest.prototype.Body = null;
LDAddMessageRequest.prototype.Version = null;
LDAddMessageRequest.prototype.AnyMemberWritable = null;
LDAddMessageRequest.prototype.FromDevice = null;
function LDUpdateMessageRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = new LDTypedId(e['i']);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.Body = new Buffer(e['b'], 'base64');
    if(e && (e['w'] !== null && e['w'] !== undefined))
        this.AnyMemberWritable = e['w'];
    else
        this.AnyMemberWritable = null;
    if(e && (e['o'] !== null && e['o'] !== undefined))
        this.OldVersion = e['o'];
    else
        this.OldVersion = null;
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.NewVersion = e['n'];
    else
        this.NewVersion = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.FromDevice = e['d'];
}
LDUpdateMessageRequest.prototype = new LDJSONLoggable();
LDUpdateMessageRequest.prototype.constructor = LDUpdateMessageRequest;
LDUpdateMessageRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Id !== null) o['i'] = this.Id.encode();
    if(this.Body !== null) o['b'] = this.Body.toString('base64');
    if(this.AnyMemberWritable !== null) o['w'] = this.AnyMemberWritable;
    if(this.OldVersion !== null) o['o'] = this.OldVersion;
    if(this.NewVersion !== null) o['n'] = this.NewVersion;
    if(this.FromDevice !== null) o['d'] = this.FromDevice;
    return o;
}
LDUpdateMessageRequest.prototype.Feed = null;
LDUpdateMessageRequest.prototype.Id = null;
LDUpdateMessageRequest.prototype.Body = null;
LDUpdateMessageRequest.prototype.AnyMemberWritable = null;
LDUpdateMessageRequest.prototype.OldVersion = null;
LDUpdateMessageRequest.prototype.NewVersion = null;
LDUpdateMessageRequest.prototype.FromDevice = null;
function LDOverwriteMessageRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = new LDTypedId(e['i']);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.Body = new Buffer(e['b'], 'base64');
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.Version = e['v'];
    else
        this.Version = null;
    if(e && (e['w'] !== null && e['w'] !== undefined))
        this.AnyMemberWritable = e['w'];
    else
        this.AnyMemberWritable = null;
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Metadata = new Buffer(e['m'], 'base64');
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.FromDevice = e['d'];
}
LDOverwriteMessageRequest.prototype = new LDJSONLoggable();
LDOverwriteMessageRequest.prototype.constructor = LDOverwriteMessageRequest;
LDOverwriteMessageRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Id !== null) o['i'] = this.Id.encode();
    if(this.Body !== null) o['b'] = this.Body.toString('base64');
    if(this.Version !== null) o['v'] = this.Version;
    if(this.AnyMemberWritable !== null) o['w'] = this.AnyMemberWritable;
    if(this.Metadata !== null) o['m'] = this.Metadata.toString('base64');
    if(this.FromDevice !== null) o['d'] = this.FromDevice;
    return o;
}
LDOverwriteMessageRequest.prototype.Feed = null;
LDOverwriteMessageRequest.prototype.Id = null;
LDOverwriteMessageRequest.prototype.Body = null;
LDOverwriteMessageRequest.prototype.Version = null;
LDOverwriteMessageRequest.prototype.AnyMemberWritable = null;
LDOverwriteMessageRequest.prototype.Metadata = null;
LDOverwriteMessageRequest.prototype.FromDevice = null;
function LDDeleteMessageRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = new LDTypedId(e['i']);
}
LDDeleteMessageRequest.prototype = new LDJSONLoggable();
LDDeleteMessageRequest.prototype.constructor = LDDeleteMessageRequest;
LDDeleteMessageRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Id !== null) o['i'] = this.Id.encode();
    return o;
}
LDDeleteMessageRequest.prototype.Feed = null;
LDDeleteMessageRequest.prototype.Id = null;
function LDSubscribeFeedRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
}
LDSubscribeFeedRequest.prototype = new LDJSONLoggable();
LDSubscribeFeedRequest.prototype.constructor = LDSubscribeFeedRequest;
LDSubscribeFeedRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    return o;
}
LDSubscribeFeedRequest.prototype.Feed = null;
function LDUnsubscribeFeedRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
}
LDUnsubscribeFeedRequest.prototype = new LDJSONLoggable();
LDUnsubscribeFeedRequest.prototype.constructor = LDUnsubscribeFeedRequest;
LDUnsubscribeFeedRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    return o;
}
LDUnsubscribeFeedRequest.prototype.Feed = null;
function LDSubscribeFeedRealtimeRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
}
LDSubscribeFeedRealtimeRequest.prototype = new LDJSONLoggable();
LDSubscribeFeedRealtimeRequest.prototype.constructor = LDSubscribeFeedRealtimeRequest;
LDSubscribeFeedRealtimeRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    return o;
}
LDSubscribeFeedRealtimeRequest.prototype.Feed = null;
function LDUnsubscribeFeedRealtimeRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
}
LDUnsubscribeFeedRealtimeRequest.prototype = new LDJSONLoggable();
LDUnsubscribeFeedRealtimeRequest.prototype.constructor = LDUnsubscribeFeedRealtimeRequest;
LDUnsubscribeFeedRealtimeRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    return o;
}
LDUnsubscribeFeedRealtimeRequest.prototype.Feed = null;
function LDAddMemberRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Member = e['m'];
    else
        this.Member = null;
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AppId = new Buffer(e['a'], 'base64');
}
LDAddMemberRequest.prototype = new LDJSONLoggable();
LDAddMemberRequest.prototype.constructor = LDAddMemberRequest;
LDAddMemberRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Member !== null) o['m'] = this.Member;
    if(this.AppId !== null) o['a'] = this.AppId.toString('base64');
    return o;
}
LDAddMemberRequest.prototype.Feed = null;
LDAddMemberRequest.prototype.Member = null;
LDAddMemberRequest.prototype.AppId = null;
function LDRemoveMemberRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Member = e['m'];
    else
        this.Member = null;
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AppId = new Buffer(e['a'], 'base64');
}
LDRemoveMemberRequest.prototype = new LDJSONLoggable();
LDRemoveMemberRequest.prototype.constructor = LDRemoveMemberRequest;
LDRemoveMemberRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Member !== null) o['m'] = this.Member;
    if(this.AppId !== null) o['a'] = this.AppId.toString('base64');
    return o;
}
LDRemoveMemberRequest.prototype.Feed = null;
LDRemoveMemberRequest.prototype.Member = null;
LDRemoveMemberRequest.prototype.AppId = null;
function LDSetFeedNameRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.Name = e['n'];
    else
        this.Name = null;
}
LDSetFeedNameRequest.prototype = new LDJSONLoggable();
LDSetFeedNameRequest.prototype.constructor = LDSetFeedNameRequest;
LDSetFeedNameRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Name !== null) o['n'] = this.Name;
    return o;
}
LDSetFeedNameRequest.prototype.Feed = null;
LDSetFeedNameRequest.prototype.Name = null;
function LDSetFeedThumbnailRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.BlobLinkString = e['p'];
    else
        this.BlobLinkString = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.DecryptedHash = new Buffer(e['d'], 'base64');
}
LDSetFeedThumbnailRequest.prototype = new LDJSONLoggable();
LDSetFeedThumbnailRequest.prototype.constructor = LDSetFeedThumbnailRequest;
LDSetFeedThumbnailRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.BlobLinkString !== null) o['p'] = this.BlobLinkString;
    if(this.DecryptedHash !== null) o['d'] = this.DecryptedHash.toString('base64');
    return o;
}
LDSetFeedThumbnailRequest.prototype.Feed = null;
LDSetFeedThumbnailRequest.prototype.BlobLinkString = null;
LDSetFeedThumbnailRequest.prototype.DecryptedHash = null;
function LDSendRealtimeRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Type = e['t'];
    else
        this.Type = null;
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.Body = new Buffer(e['b'], 'base64');
}
LDSendRealtimeRequest.prototype = new LDJSONLoggable();
LDSendRealtimeRequest.prototype.constructor = LDSendRealtimeRequest;
LDSendRealtimeRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Type !== null) o['t'] = this.Type;
    if(this.Body !== null) o['b'] = this.Body.toString('base64');
    return o;
}
LDSendRealtimeRequest.prototype.Feed = null;
LDSendRealtimeRequest.prototype.Type = null;
LDSendRealtimeRequest.prototype.Body = null;
function LDAddPendingInvitationRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.IdentityHash = new LDIdentityHash(e['i']);
    if(e && (e['I'] !== null && e['I'] !== undefined))
        this.Identity = new LDIdentity(e['I']);
}
LDAddPendingInvitationRequest.prototype = new LDJSONLoggable();
LDAddPendingInvitationRequest.prototype.constructor = LDAddPendingInvitationRequest;
LDAddPendingInvitationRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.IdentityHash !== null) o['i'] = this.IdentityHash.encode();
    if(this.Identity !== null) o['I'] = this.Identity.encode();
    return o;
}
LDAddPendingInvitationRequest.prototype.Feed = null;
LDAddPendingInvitationRequest.prototype.IdentityHash = null;
LDAddPendingInvitationRequest.prototype.Identity = null;
function LDRemovePendingInvitationRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.IdentityHash = new LDIdentityHash(e['i']);
}
LDRemovePendingInvitationRequest.prototype = new LDJSONLoggable();
LDRemovePendingInvitationRequest.prototype.constructor = LDRemovePendingInvitationRequest;
LDRemovePendingInvitationRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.IdentityHash !== null) o['i'] = this.IdentityHash.encode();
    return o;
}
LDRemovePendingInvitationRequest.prototype.Feed = null;
LDRemovePendingInvitationRequest.prototype.IdentityHash = null;
function LDGetJoinFeedLinkRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
}
LDGetJoinFeedLinkRequest.prototype = new LDJSONLoggable();
LDGetJoinFeedLinkRequest.prototype.constructor = LDGetJoinFeedLinkRequest;
LDGetJoinFeedLinkRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    return o;
}
LDGetJoinFeedLinkRequest.prototype.Feed = null;
function LDJoinFeedRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Pin = e['p'];
    else
        this.Pin = null;
}
LDJoinFeedRequest.prototype = new LDJSONLoggable();
LDJoinFeedRequest.prototype.constructor = LDJoinFeedRequest;
LDJoinFeedRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Pin !== null) o['p'] = this.Pin;
    return o;
}
LDJoinFeedRequest.prototype.Feed = null;
LDJoinFeedRequest.prototype.Pin = null;
function LDJoinBroadcastRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Pin = e['p'];
    else
        this.Pin = null;
}
LDJoinBroadcastRequest.prototype = new LDJSONLoggable();
LDJoinBroadcastRequest.prototype.constructor = LDJoinBroadcastRequest;
LDJoinBroadcastRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Pin !== null) o['p'] = this.Pin;
    return o;
}
LDJoinBroadcastRequest.prototype.Feed = null;
LDJoinBroadcastRequest.prototype.Pin = null;
function LDSetDefaultAccessRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.Readable = e['r'];
    if(e && (e['x'] !== null && e['x'] !== undefined))
        this.FixedMembership = e['x'];
}
LDSetDefaultAccessRequest.prototype = new LDJSONLoggable();
LDSetDefaultAccessRequest.prototype.constructor = LDSetDefaultAccessRequest;
LDSetDefaultAccessRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Readable !== null) o['r'] = this.Readable;
    if(this.FixedMembership !== null) o['x'] = this.FixedMembership;
    return o;
}
LDSetDefaultAccessRequest.prototype.Feed = null;
LDSetDefaultAccessRequest.prototype.Readable = null;
LDSetDefaultAccessRequest.prototype.FixedMembership = null;
function LDGetPublicFeedDetailsRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
}
LDGetPublicFeedDetailsRequest.prototype = new LDJSONLoggable();
LDGetPublicFeedDetailsRequest.prototype.constructor = LDGetPublicFeedDetailsRequest;
LDGetPublicFeedDetailsRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    return o;
}
LDGetPublicFeedDetailsRequest.prototype.Feed = null;
function LDApplyDocumentTransformRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = new LDTypedId(e['i']);
    if(e && (e['j'] !== null && e['j'] !== undefined))
        this.Javascript = e['j'];
    else
        this.Javascript = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Parameters = e['p'];
    else
        this.Parameters = null;
}
LDApplyDocumentTransformRequest.prototype = new LDJSONLoggable();
LDApplyDocumentTransformRequest.prototype.constructor = LDApplyDocumentTransformRequest;
LDApplyDocumentTransformRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Id !== null) o['i'] = this.Id.encode();
    if(this.Javascript !== null) o['j'] = this.Javascript;
    if(this.Parameters !== null) o['p'] = this.Parameters;
    return o;
}
LDApplyDocumentTransformRequest.prototype.Feed = null;
LDApplyDocumentTransformRequest.prototype.Id = null;
LDApplyDocumentTransformRequest.prototype.Javascript = null;
LDApplyDocumentTransformRequest.prototype.Parameters = null;
function LDMessageDeliveryPush(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Message = new LDMessage(e['m']);
}
LDMessageDeliveryPush.prototype = new LDJSONLoggable();
LDMessageDeliveryPush.prototype.constructor = LDMessageDeliveryPush;
LDMessageDeliveryPush.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Message !== null) o['m'] = this.Message.encode();
    return o;
}
LDMessageDeliveryPush.prototype.Message = null;
function LDRealtimeMessageDeliveryPush(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Message = new LDRealtimeMessage(e['m']);
}
LDRealtimeMessageDeliveryPush.prototype = new LDJSONLoggable();
LDRealtimeMessageDeliveryPush.prototype.constructor = LDRealtimeMessageDeliveryPush;
LDRealtimeMessageDeliveryPush.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Message !== null) o['m'] = this.Message.encode();
    return o;
}
LDRealtimeMessageDeliveryPush.prototype.Message = null;
function LDMessageTerminatedPush(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
}
LDMessageTerminatedPush.prototype = new LDJSONLoggable();
LDMessageTerminatedPush.prototype.constructor = LDMessageTerminatedPush;
LDMessageTerminatedPush.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    return o;
}
LDMessageTerminatedPush.prototype.Feed = null;
function LDGetFeedStateRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
}
LDGetFeedStateRequest.prototype = new LDJSONLoggable();
LDGetFeedStateRequest.prototype.constructor = LDGetFeedStateRequest;
LDGetFeedStateRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    return o;
}
LDGetFeedStateRequest.prototype.Feed = null;
function LDSetFeedAcceptanceRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Acceptance = e['s'];
    else
        this.Acceptance = null;
}
LDSetFeedAcceptanceRequest.prototype = new LDJSONLoggable();
LDSetFeedAcceptanceRequest.prototype.constructor = LDSetFeedAcceptanceRequest;
LDSetFeedAcceptanceRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Acceptance !== null) o['s'] = this.Acceptance;
    return o;
}
LDSetFeedAcceptanceRequest.prototype.Feed = null;
LDSetFeedAcceptanceRequest.prototype.Acceptance = null;
function LDGetDirtyFeedsRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Since = e['s'];
    else
        this.Since = null;
}
LDGetDirtyFeedsRequest.prototype = new LDJSONLoggable();
LDGetDirtyFeedsRequest.prototype.constructor = LDGetDirtyFeedsRequest;
LDGetDirtyFeedsRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Since !== null) o['s'] = this.Since;
    return o;
}
LDGetDirtyFeedsRequest.prototype.Since = null;
function LDSubscribeForAccountInboxRequest(e) { 
    LDJSONLoggable.call(this, e);
}
LDSubscribeForAccountInboxRequest.prototype = new LDJSONLoggable();
LDSubscribeForAccountInboxRequest.prototype.constructor = LDSubscribeForAccountInboxRequest;
LDSubscribeForAccountInboxRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDUnsubscribeForAccountInboxRequest(e) { 
    LDJSONLoggable.call(this, e);
}
LDUnsubscribeForAccountInboxRequest.prototype = new LDJSONLoggable();
LDUnsubscribeForAccountInboxRequest.prototype.constructor = LDUnsubscribeForAccountInboxRequest;
LDUnsubscribeForAccountInboxRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDRegisterPushNotificationKeyRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.PushKey = new LDPushKey(e['p']);
}
LDRegisterPushNotificationKeyRequest.prototype = new LDJSONLoggable();
LDRegisterPushNotificationKeyRequest.prototype.constructor = LDRegisterPushNotificationKeyRequest;
LDRegisterPushNotificationKeyRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.PushKey !== null) o['p'] = this.PushKey.encode();
    return o;
}
LDRegisterPushNotificationKeyRequest.prototype.PushKey = null;
function LDInboxDeliveryMessagePush(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Message = new LDMessage(e['m']);
}
LDInboxDeliveryMessagePush.prototype = new LDJSONLoggable();
LDInboxDeliveryMessagePush.prototype.constructor = LDInboxDeliveryMessagePush;
LDInboxDeliveryMessagePush.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Message !== null) o['m'] = this.Message.encode();
    return o;
}
LDInboxDeliveryMessagePush.prototype.Message = null;
function LDInboxDeliveryTerminatedPush(e) { 
    LDJSONLoggable.call(this, e);
}
LDInboxDeliveryTerminatedPush.prototype = new LDJSONLoggable();
LDInboxDeliveryTerminatedPush.prototype.constructor = LDInboxDeliveryTerminatedPush;
LDInboxDeliveryTerminatedPush.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDSetAppleBadgeCountRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.BadgeCount = e['b'];
    else
        this.BadgeCount = null;
}
LDSetAppleBadgeCountRequest.prototype = new LDJSONLoggable();
LDSetAppleBadgeCountRequest.prototype.constructor = LDSetAppleBadgeCountRequest;
LDSetAppleBadgeCountRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.BadgeCount !== null) o['b'] = this.BadgeCount;
    return o;
}
LDSetAppleBadgeCountRequest.prototype.BadgeCount = null;
function LDGetUploadTicketRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.Cluster = e['c'];
    else
        this.Cluster = null;
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Metadata = new LDBlobMetadata(e['m']);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.IsPermanent = e['p'];
    else
        this.IsPermanent = null;
    if(e && (e['prt'] !== null && e['prt'] !== undefined))
        this.PermanenceRefTag = new Buffer(e['prt'], 'base64');
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.AlreadyEncrypted = e['e'];
    else
        this.AlreadyEncrypted = null;
}
LDGetUploadTicketRequest.prototype = new LDJSONLoggable();
LDGetUploadTicketRequest.prototype.constructor = LDGetUploadTicketRequest;
LDGetUploadTicketRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Account !== null) o['a'] = this.Account;
    if(this.Cluster !== null) o['c'] = this.Cluster;
    if(this.Metadata !== null) o['m'] = this.Metadata.encode();
    if(this.IsPermanent !== null) o['p'] = this.IsPermanent;
    if(this.PermanenceRefTag !== null) o['prt'] = this.PermanenceRefTag.toString('base64');
    if(this.AlreadyEncrypted !== null) o['e'] = this.AlreadyEncrypted;
    return o;
}
LDGetUploadTicketRequest.prototype.Account = null;
LDGetUploadTicketRequest.prototype.Cluster = null;
LDGetUploadTicketRequest.prototype.Metadata = null;
LDGetUploadTicketRequest.prototype.IsPermanent = null;
LDGetUploadTicketRequest.prototype.PermanenceRefTag = null;
LDGetUploadTicketRequest.prototype.AlreadyEncrypted = null;
function LDGetMultipartUploadTicketRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.Cluster = e['c'];
    else
        this.Cluster = null;
    if(e && (e['wm'] !== null && e['wm'] !== undefined))
        this.WholeMetadata = new LDBlobMetadata(e['wm']);
    if(e && (e['pm'] !== null && e['pm'] !== undefined)) { 
        this.PartMetadataList = [];
        var d = e['pm'];
        for(var k = 0; k < d.length; ++k) this.PartMetadataList.push(new LDBlobMetadata(d[k]));
    }
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.IsPermanent = e['p'];
    else
        this.IsPermanent = null;
    if(e && (e['prt'] !== null && e['prt'] !== undefined))
        this.PermanenceRefTag = new Buffer(e['prt'], 'base64');
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.AlreadyEncrypted = e['e'];
    else
        this.AlreadyEncrypted = null;
}
LDGetMultipartUploadTicketRequest.prototype = new LDJSONLoggable();
LDGetMultipartUploadTicketRequest.prototype.constructor = LDGetMultipartUploadTicketRequest;
LDGetMultipartUploadTicketRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Account !== null) o['a'] = this.Account;
    if(this.Cluster !== null) o['c'] = this.Cluster;
    if(this.WholeMetadata !== null) o['wm'] = this.WholeMetadata.encode();
    if(this.PartMetadataList !== null) { 
        o['pm'] = [];
        var d = this.PartMetadataList;
        for(var k = 0; k < d.length; ++k) o['pm'].push(d[k].encode());
    } else {
        o['PartMetadataList'] = null;
    }
    if(this.IsPermanent !== null) o['p'] = this.IsPermanent;
    if(this.PermanenceRefTag !== null) o['prt'] = this.PermanenceRefTag.toString('base64');
    if(this.AlreadyEncrypted !== null) o['e'] = this.AlreadyEncrypted;
    return o;
}
LDGetMultipartUploadTicketRequest.prototype.Account = null;
LDGetMultipartUploadTicketRequest.prototype.Cluster = null;
LDGetMultipartUploadTicketRequest.prototype.WholeMetadata = null;
LDGetMultipartUploadTicketRequest.prototype.PartMetadataList = null;
LDGetMultipartUploadTicketRequest.prototype.IsPermanent = null;
LDGetMultipartUploadTicketRequest.prototype.PermanenceRefTag = null;
LDGetMultipartUploadTicketRequest.prototype.AlreadyEncrypted = null;
function LDVerifyUploadCompletedRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['ut'] !== null && e['ut'] !== undefined))
        this.BlobUploadTicket = new LDBlobUploadTicket(e['ut']);
}
LDVerifyUploadCompletedRequest.prototype = new LDJSONLoggable();
LDVerifyUploadCompletedRequest.prototype.constructor = LDVerifyUploadCompletedRequest;
LDVerifyUploadCompletedRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.BlobUploadTicket !== null) o['ut'] = this.BlobUploadTicket.encode();
    return o;
}
LDVerifyUploadCompletedRequest.prototype.BlobUploadTicket = null;
function LDGetDownloadTicketRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.BlobLinkString = e['l'];
    else
        this.BlobLinkString = null;
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.AlreadyEncrypted = e['e'];
    else
        this.AlreadyEncrypted = null;
}
LDGetDownloadTicketRequest.prototype = new LDJSONLoggable();
LDGetDownloadTicketRequest.prototype.constructor = LDGetDownloadTicketRequest;
LDGetDownloadTicketRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.BlobLinkString !== null) o['l'] = this.BlobLinkString;
    if(this.AlreadyEncrypted !== null) o['e'] = this.AlreadyEncrypted;
    return o;
}
LDGetDownloadTicketRequest.prototype.BlobLinkString = null;
LDGetDownloadTicketRequest.prototype.AlreadyEncrypted = null;
function LDVerifyExistsAndPermanenceRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.BlobLinkString = e['l'];
    else
        this.BlobLinkString = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.IsPermanent = e['p'];
    else
        this.IsPermanent = null;
    if(e && (e['prt'] !== null && e['prt'] !== undefined))
        this.PermanenceRefTag = new Buffer(e['prt'], 'base64');
}
LDVerifyExistsAndPermanenceRequest.prototype = new LDJSONLoggable();
LDVerifyExistsAndPermanenceRequest.prototype.constructor = LDVerifyExistsAndPermanenceRequest;
LDVerifyExistsAndPermanenceRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.BlobLinkString !== null) o['l'] = this.BlobLinkString;
    if(this.IsPermanent !== null) o['p'] = this.IsPermanent;
    if(this.PermanenceRefTag !== null) o['prt'] = this.PermanenceRefTag.toString('base64');
    return o;
}
LDVerifyExistsAndPermanenceRequest.prototype.BlobLinkString = null;
LDVerifyExistsAndPermanenceRequest.prototype.IsPermanent = null;
LDVerifyExistsAndPermanenceRequest.prototype.PermanenceRefTag = null;
function LDOverwriteContactRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContactAccount = e['c'];
    else
        this.ContactAccount = null;
}
LDOverwriteContactRequest.prototype = new LDJSONLoggable();
LDOverwriteContactRequest.prototype.constructor = LDOverwriteContactRequest;
LDOverwriteContactRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ContactAccount !== null) o['c'] = this.ContactAccount;
    return o;
}
LDOverwriteContactRequest.prototype.ContactAccount = null;
function LDRemoveContactRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContactAccount = e['c'];
    else
        this.ContactAccount = null;
}
LDRemoveContactRequest.prototype = new LDJSONLoggable();
LDRemoveContactRequest.prototype.constructor = LDRemoveContactRequest;
LDRemoveContactRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ContactAccount !== null) o['c'] = this.ContactAccount;
    return o;
}
LDRemoveContactRequest.prototype.ContactAccount = null;
function LDBlockContactRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContactDetails = new LDContactDetails(e['c']);
}
LDBlockContactRequest.prototype = new LDJSONLoggable();
LDBlockContactRequest.prototype.constructor = LDBlockContactRequest;
LDBlockContactRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ContactDetails !== null) o['c'] = this.ContactDetails.encode();
    return o;
}
LDBlockContactRequest.prototype.ContactDetails = null;
function LDUnblockContactRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContactAccount = e['c'];
    else
        this.ContactAccount = null;
}
LDUnblockContactRequest.prototype = new LDJSONLoggable();
LDUnblockContactRequest.prototype.constructor = LDUnblockContactRequest;
LDUnblockContactRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ContactAccount !== null) o['c'] = this.ContactAccount;
    return o;
}
LDUnblockContactRequest.prototype.ContactAccount = null;
function LDGetProfileDetailsRequest(e) { 
    LDJSONLoggable.call(this, e);
}
LDGetProfileDetailsRequest.prototype = new LDJSONLoggable();
LDGetProfileDetailsRequest.prototype.constructor = LDGetProfileDetailsRequest;
LDGetProfileDetailsRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDSetProfileNameRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.Name = e['n'];
    else
        this.Name = null;
}
LDSetProfileNameRequest.prototype = new LDJSONLoggable();
LDSetProfileNameRequest.prototype.constructor = LDSetProfileNameRequest;
LDSetProfileNameRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Name !== null) o['n'] = this.Name;
    return o;
}
LDSetProfileNameRequest.prototype.Name = null;
function LDSetProfilePictureRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.BlobLinkString = e['p'];
    else
        this.BlobLinkString = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.DecryptedHash = new Buffer(e['d'], 'base64');
}
LDSetProfilePictureRequest.prototype = new LDJSONLoggable();
LDSetProfilePictureRequest.prototype.constructor = LDSetProfilePictureRequest;
LDSetProfilePictureRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.BlobLinkString !== null) o['p'] = this.BlobLinkString;
    if(this.DecryptedHash !== null) o['d'] = this.DecryptedHash.toString('base64');
    return o;
}
LDSetProfilePictureRequest.prototype.BlobLinkString = null;
LDSetProfilePictureRequest.prototype.DecryptedHash = null;
function LDGetOmletContactProfileRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.RequestedAccount = e['c'];
    else
        this.RequestedAccount = null;
}
LDGetOmletContactProfileRequest.prototype = new LDJSONLoggable();
LDGetOmletContactProfileRequest.prototype.constructor = LDGetOmletContactProfileRequest;
LDGetOmletContactProfileRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.RequestedAccount !== null) o['c'] = this.RequestedAccount;
    return o;
}
LDGetOmletContactProfileRequest.prototype.RequestedAccount = null;
function LDAddItemsToProfileRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['it'] !== null && e['it'] !== undefined))
        this.ItemType = e['it'];
    else
        this.ItemType = null;
    if(e && (e['i'] !== null && e['i'] !== undefined)) { 
        this.Items = [];
        var d = e['i'];
        for(var k = 0; k < d.length; ++k) this.Items.push(new LDItemId(d[k]));
    }
    if(e && (e['pd'] !== null && e['pd'] !== undefined))
        this.PurchaseData = new LDPurchaseData(e['pd']);
}
LDAddItemsToProfileRequest.prototype = new LDJSONLoggable();
LDAddItemsToProfileRequest.prototype.constructor = LDAddItemsToProfileRequest;
LDAddItemsToProfileRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ItemType !== null) o['it'] = this.ItemType;
    if(this.Items !== null) { 
        o['i'] = [];
        var d = this.Items;
        for(var k = 0; k < d.length; ++k) o['i'].push(d[k].encode());
    } else {
        o['Items'] = null;
    }
    if(this.PurchaseData !== null) o['pd'] = this.PurchaseData.encode();
    return o;
}
LDAddItemsToProfileRequest.prototype.ItemType = null;
LDAddItemsToProfileRequest.prototype.Items = null;
LDAddItemsToProfileRequest.prototype.PurchaseData = null;
function LDRemoveItemsFromProfileRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['it'] !== null && e['it'] !== undefined))
        this.ItemType = e['it'];
    else
        this.ItemType = null;
    if(e && (e['i'] !== null && e['i'] !== undefined)) { 
        this.Items = [];
        var d = e['i'];
        for(var k = 0; k < d.length; ++k) this.Items.push(new LDItemId(d[k]));
    }
}
LDRemoveItemsFromProfileRequest.prototype = new LDJSONLoggable();
LDRemoveItemsFromProfileRequest.prototype.constructor = LDRemoveItemsFromProfileRequest;
LDRemoveItemsFromProfileRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ItemType !== null) o['it'] = this.ItemType;
    if(this.Items !== null) { 
        o['i'] = [];
        var d = this.Items;
        for(var k = 0; k < d.length; ++k) o['i'].push(d[k].encode());
    } else {
        o['Items'] = null;
    }
    return o;
}
LDRemoveItemsFromProfileRequest.prototype.ItemType = null;
LDRemoveItemsFromProfileRequest.prototype.Items = null;
function LDAddFeaturesToProfileRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined)) { 
        this.Features = [];
        var d = e['f'];
        for(var k = 0; k < d.length; ++k) this.Features.push(d[k]);
    }
}
LDAddFeaturesToProfileRequest.prototype = new LDJSONLoggable();
LDAddFeaturesToProfileRequest.prototype.constructor = LDAddFeaturesToProfileRequest;
LDAddFeaturesToProfileRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Features !== null) { 
        o['f'] = [];
        var d = this.Features;
        for(var k = 0; k < d.length; ++k) o['f'].push(d[k]);
    } else {
        o['Features'] = null;
    }
    return o;
}
LDAddFeaturesToProfileRequest.prototype.Features = null;
function LDRemoveFeaturesFromProfileRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined)) { 
        this.Features = [];
        var d = e['f'];
        for(var k = 0; k < d.length; ++k) this.Features.push(d[k]);
    }
}
LDRemoveFeaturesFromProfileRequest.prototype = new LDJSONLoggable();
LDRemoveFeaturesFromProfileRequest.prototype.constructor = LDRemoveFeaturesFromProfileRequest;
LDRemoveFeaturesFromProfileRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Features !== null) { 
        o['f'] = [];
        var d = this.Features;
        for(var k = 0; k < d.length; ++k) o['f'].push(d[k]);
    } else {
        o['Features'] = null;
    }
    return o;
}
LDRemoveFeaturesFromProfileRequest.prototype.Features = null;
function LDGetProfilePublicStateRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.RequestedAccount = e['c'];
    else
        this.RequestedAccount = null;
}
LDGetProfilePublicStateRequest.prototype = new LDJSONLoggable();
LDGetProfilePublicStateRequest.prototype.constructor = LDGetProfilePublicStateRequest;
LDGetProfilePublicStateRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.RequestedAccount !== null) o['c'] = this.RequestedAccount;
    return o;
}
LDGetProfilePublicStateRequest.prototype.RequestedAccount = null;
function LDGetContactProfileAndPublicStateRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.RequestedAccount = e['c'];
    else
        this.RequestedAccount = null;
}
LDGetContactProfileAndPublicStateRequest.prototype = new LDJSONLoggable();
LDGetContactProfileAndPublicStateRequest.prototype.constructor = LDGetContactProfileAndPublicStateRequest;
LDGetContactProfileAndPublicStateRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.RequestedAccount !== null) o['c'] = this.RequestedAccount;
    return o;
}
LDGetContactProfileAndPublicStateRequest.prototype.RequestedAccount = null;
function LDUploadAddressBookEntriesRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined)) { 
        this.IdentityHashes = [];
        var d = e['i'];
        for(var k = 0; k < d.length; ++k) this.IdentityHashes.push(new LDIdentityHash(d[k]));
    }
}
LDUploadAddressBookEntriesRequest.prototype = new LDJSONLoggable();
LDUploadAddressBookEntriesRequest.prototype.constructor = LDUploadAddressBookEntriesRequest;
LDUploadAddressBookEntriesRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.IdentityHashes !== null) { 
        o['i'] = [];
        var d = this.IdentityHashes;
        for(var k = 0; k < d.length; ++k) o['i'].push(d[k].encode());
    } else {
        o['IdentityHashes'] = null;
    }
    return o;
}
LDUploadAddressBookEntriesRequest.prototype.IdentityHashes = null;
function LDGetContactProfileRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.IdentityHash = new LDIdentityHash(e['i']);
}
LDGetContactProfileRequest.prototype = new LDJSONLoggable();
LDGetContactProfileRequest.prototype.constructor = LDGetContactProfileRequest;
LDGetContactProfileRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.IdentityHash !== null) o['i'] = this.IdentityHash.encode();
    return o;
}
LDGetContactProfileRequest.prototype.IdentityHash = null;
function LDGetAddMeLinkRequest(e) { 
    LDJSONLoggable.call(this, e);
}
LDGetAddMeLinkRequest.prototype = new LDJSONLoggable();
LDGetAddMeLinkRequest.prototype.constructor = LDGetAddMeLinkRequest;
LDGetAddMeLinkRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDMutualAddContactByTokenRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Token = e['t'];
    else
        this.Token = null;
}
LDMutualAddContactByTokenRequest.prototype = new LDJSONLoggable();
LDMutualAddContactByTokenRequest.prototype.constructor = LDMutualAddContactByTokenRequest;
LDMutualAddContactByTokenRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Account !== null) o['a'] = this.Account;
    if(this.Token !== null) o['t'] = this.Token;
    return o;
}
LDMutualAddContactByTokenRequest.prototype.Account = null;
LDMutualAddContactByTokenRequest.prototype.Token = null;
function LDCreateItemInfoRequest(e) { 
    if(e && (e['it'] !== null && e['it'] !== undefined))
        this.ItemType = e['it'];
    else
        this.ItemType = null;
    if(e && (e['ac'] !== null && e['ac'] !== undefined))
        this.Account = e['ac'];
    else
        this.Account = null;
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.ItemId = e['id'];
    else
        this.ItemId = null;
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.ItemInfoUserMutableContainer = new LDItemInfoUserMutableContainer(e['u']);
}
LDCreateItemInfoRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemType !== null) o['it'] = this.ItemType;
    if(this.Account !== null) o['ac'] = this.Account;
    if(this.ItemId !== null) o['id'] = this.ItemId;
    if(this.ItemInfoUserMutableContainer !== null) o['u'] = this.ItemInfoUserMutableContainer.encode();
    return o;
}
LDCreateItemInfoRequest.prototype.ItemType = null;
LDCreateItemInfoRequest.prototype.Account = null;
LDCreateItemInfoRequest.prototype.ItemId = null;
LDCreateItemInfoRequest.prototype.ItemInfoUserMutableContainer = null;
function LDUserUpdateItemInfoRequest(e) { 
    if(e && (e['it'] !== null && e['it'] !== undefined))
        this.ItemType = e['it'];
    else
        this.ItemType = null;
    if(e && (e['ac'] !== null && e['ac'] !== undefined))
        this.Account = e['ac'];
    else
        this.Account = null;
    if(e && (e['ai'] !== null && e['ai'] !== undefined))
        this.ItemId = e['ai'];
    else
        this.ItemId = null;
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.ItemInfoUserMutableContainer = new LDItemInfoUserMutableContainer(e['u']);
}
LDUserUpdateItemInfoRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemType !== null) o['it'] = this.ItemType;
    if(this.Account !== null) o['ac'] = this.Account;
    if(this.ItemId !== null) o['ai'] = this.ItemId;
    if(this.ItemInfoUserMutableContainer !== null) o['u'] = this.ItemInfoUserMutableContainer.encode();
    return o;
}
LDUserUpdateItemInfoRequest.prototype.ItemType = null;
LDUserUpdateItemInfoRequest.prototype.Account = null;
LDUserUpdateItemInfoRequest.prototype.ItemId = null;
LDUserUpdateItemInfoRequest.prototype.ItemInfoUserMutableContainer = null;
function LDSystemUpdateItemInfoRequest(e) { 
    if(e && (e['it'] !== null && e['it'] !== undefined))
        this.ItemType = e['it'];
    else
        this.ItemType = null;
    if(e && (e['ac'] !== null && e['ac'] !== undefined))
        this.Account = e['ac'];
    else
        this.Account = null;
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.ItemId = e['id'];
    else
        this.ItemId = null;
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.ItemInfoSystemMutableContainer = new LDItemInfoSystemMutableContainer(e['u']);
}
LDSystemUpdateItemInfoRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemType !== null) o['it'] = this.ItemType;
    if(this.Account !== null) o['ac'] = this.Account;
    if(this.ItemId !== null) o['id'] = this.ItemId;
    if(this.ItemInfoSystemMutableContainer !== null) o['u'] = this.ItemInfoSystemMutableContainer.encode();
    return o;
}
LDSystemUpdateItemInfoRequest.prototype.ItemType = null;
LDSystemUpdateItemInfoRequest.prototype.Account = null;
LDSystemUpdateItemInfoRequest.prototype.ItemId = null;
LDSystemUpdateItemInfoRequest.prototype.ItemInfoSystemMutableContainer = null;
function LDGetItemInfoRequest(e) { 
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.ItemId = new LDItemId(e['id']);
}
LDGetItemInfoRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemId !== null) o['id'] = this.ItemId.encode();
    return o;
}
LDGetItemInfoRequest.prototype.ItemId = null;
function LDReviewItemRequest(e) { 
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.ItemId = new LDItemId(e['i']);
}
LDReviewItemRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemId !== null) o['i'] = this.ItemId.encode();
    return o;
}
LDReviewItemRequest.prototype.ItemId = null;
function LDPublishItemRequest(e) { 
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.ItemId = new LDItemId(e['i']);
}
LDPublishItemRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemId !== null) o['i'] = this.ItemId.encode();
    return o;
}
LDPublishItemRequest.prototype.ItemId = null;
function LDUnpublishItemRequest(e) { 
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.ItemId = new LDItemId(e['i']);
}
LDUnpublishItemRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemId !== null) o['i'] = this.ItemId.encode();
    return o;
}
LDUnpublishItemRequest.prototype.ItemId = null;
function LDDeleteItemRequest(e) { 
    if(e && (e['it'] !== null && e['it'] !== undefined))
        this.ItemType = e['it'];
    else
        this.ItemType = null;
    if(e && (e['ac'] !== null && e['ac'] !== undefined))
        this.Account = e['ac'];
    else
        this.Account = null;
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.ItemId = e['id'];
    else
        this.ItemId = null;
}
LDDeleteItemRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemType !== null) o['it'] = this.ItemType;
    if(this.Account !== null) o['ac'] = this.Account;
    if(this.ItemId !== null) o['id'] = this.ItemId;
    return o;
}
LDDeleteItemRequest.prototype.ItemType = null;
LDDeleteItemRequest.prototype.Account = null;
LDDeleteItemRequest.prototype.ItemId = null;
function LDListItemsForAccountRequest(e) { 
    if(e && (e['it'] !== null && e['it'] !== undefined))
        this.ItemType = e['it'];
    else
        this.ItemType = null;
    if(e && (e['ac'] !== null && e['ac'] !== undefined))
        this.Account = e['ac'];
    else
        this.Account = null;
}
LDListItemsForAccountRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemType !== null) o['it'] = this.ItemType;
    if(this.Account !== null) o['ac'] = this.Account;
    return o;
}
LDListItemsForAccountRequest.prototype.ItemType = null;
LDListItemsForAccountRequest.prototype.Account = null;
function LDListAllItemsRequest(e) { 
    if(e && (e['it'] !== null && e['it'] !== undefined))
        this.ItemType = e['it'];
    else
        this.ItemType = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContinuationKey = new Buffer(e['c'], 'base64');
}
LDListAllItemsRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemType !== null) o['it'] = this.ItemType;
    if(this.ContinuationKey !== null) o['c'] = this.ContinuationKey.toString('base64');
    return o;
}
LDListAllItemsRequest.prototype.ItemType = null;
LDListAllItemsRequest.prototype.ContinuationKey = null;
function LDListPublishedItemsRequest(e) { 
    if(e && (e['it'] !== null && e['it'] !== undefined))
        this.ItemType = e['it'];
    else
        this.ItemType = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContinuationKey = new Buffer(e['c'], 'base64');
    if(e && (e['lm'] !== null && e['lm'] !== undefined))
        this.LastModified = e['lm'];
}
LDListPublishedItemsRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemType !== null) o['it'] = this.ItemType;
    if(this.ContinuationKey !== null) o['c'] = this.ContinuationKey.toString('base64');
    if(this.LastModified !== null) o['lm'] = this.LastModified;
    return o;
}
LDListPublishedItemsRequest.prototype.ItemType = null;
LDListPublishedItemsRequest.prototype.ContinuationKey = null;
LDListPublishedItemsRequest.prototype.LastModified = null;
function LDGenerateGrantForItemRequest(e) { 
    if(e && (e['ii'] !== null && e['ii'] !== undefined))
        this.ItemId = new LDItemId(e['ii']);
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.ExpirationTime = e['e'];
    else
        this.ExpirationTime = null;
}
LDGenerateGrantForItemRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemId !== null) o['ii'] = this.ItemId.encode();
    if(this.ExpirationTime !== null) o['e'] = this.ExpirationTime;
    return o;
}
LDGenerateGrantForItemRequest.prototype.ItemId = null;
LDGenerateGrantForItemRequest.prototype.ExpirationTime = null;
function LDGetItemUsingGrantRequest(e) { 
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.Grant = e['g'];
    else
        this.Grant = null;
}
LDGetItemUsingGrantRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Grant !== null) o['g'] = this.Grant;
    return o;
}
LDGetItemUsingGrantRequest.prototype.Grant = null;
function LDDoesItemHaveGrantRequest(e) { 
    if(e && (e['ii'] !== null && e['ii'] !== undefined))
        this.ItemId = new LDItemId(e['ii']);
}
LDDoesItemHaveGrantRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemId !== null) o['ii'] = this.ItemId.encode();
    return o;
}
LDDoesItemHaveGrantRequest.prototype.ItemId = null;
function LDDeleteGrantForItemRequest(e) { 
    if(e && (e['ii'] !== null && e['ii'] !== undefined))
        this.ItemId = new LDItemId(e['ii']);
}
LDDeleteGrantForItemRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemId !== null) o['ii'] = this.ItemId.encode();
    return o;
}
LDDeleteGrantForItemRequest.prototype.ItemId = null;
function LDGenerateApiKeyRequest(e) { 
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.ItemId = new LDItemId(e['id']);
}
LDGenerateApiKeyRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemId !== null) o['id'] = this.ItemId.encode();
    return o;
}
LDGenerateApiKeyRequest.prototype.ItemId = null;
function LDDeactivateApiKeyRequest(e) { 
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.ClientApiKeyId = new Buffer(e['id'], 'base64');
}
LDDeactivateApiKeyRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ClientApiKeyId !== null) o['id'] = this.ClientApiKeyId.toString('base64');
    return o;
}
LDDeactivateApiKeyRequest.prototype.ClientApiKeyId = null;
function LDListApiKeysRequest(e) { 
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.ItemId = new LDItemId(e['id']);
}
LDListApiKeysRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemId !== null) o['id'] = this.ItemId.encode();
    return o;
}
LDListApiKeysRequest.prototype.ItemId = null;
function LDDeleteDeviceRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.PublicKey = new Buffer(e['k'], 'base64');
}
LDDeleteDeviceRequest.prototype = new LDJSONLoggable();
LDDeleteDeviceRequest.prototype.constructor = LDDeleteDeviceRequest;
LDDeleteDeviceRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.PublicKey !== null) o['k'] = this.PublicKey.toString('base64');
    return o;
}
LDDeleteDeviceRequest.prototype.PublicKey = null;
function LDAddDeviceRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.PublicKey = new Buffer(e['k'], 'base64');
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.Version = e['v'];
    else
        this.Version = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Description = e['d'];
    else
        this.Description = null;
}
LDAddDeviceRequest.prototype = new LDJSONLoggable();
LDAddDeviceRequest.prototype.constructor = LDAddDeviceRequest;
LDAddDeviceRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.PublicKey !== null) o['k'] = this.PublicKey.toString('base64');
    if(this.Version !== null) o['v'] = this.Version;
    if(this.Description !== null) o['d'] = this.Description;
    return o;
}
LDAddDeviceRequest.prototype.PublicKey = null;
LDAddDeviceRequest.prototype.Version = null;
LDAddDeviceRequest.prototype.Description = null;
function LDSetDingTimeoutRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.DingTimeoutMillis = e['t'];
    else
        this.DingTimeoutMillis = null;
}
LDSetDingTimeoutRequest.prototype = new LDJSONLoggable();
LDSetDingTimeoutRequest.prototype.constructor = LDSetDingTimeoutRequest;
LDSetDingTimeoutRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.DingTimeoutMillis !== null) o['t'] = this.DingTimeoutMillis;
    return o;
}
LDSetDingTimeoutRequest.prototype.DingTimeoutMillis = null;
function LDGetCloudConfigRequest(e) { 
    LDJSONLoggable.call(this, e);
}
LDGetCloudConfigRequest.prototype = new LDJSONLoggable();
LDGetCloudConfigRequest.prototype.constructor = LDGetCloudConfigRequest;
LDGetCloudConfigRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDSetCloudConfigRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.Config = new LDCloudConfig(e['c']);
}
LDSetCloudConfigRequest.prototype = new LDJSONLoggable();
LDSetCloudConfigRequest.prototype.constructor = LDSetCloudConfigRequest;
LDSetCloudConfigRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Config !== null) o['c'] = this.Config.encode();
    return o;
}
LDSetCloudConfigRequest.prototype.Config = null;
function LDRefreshCloudConfigRequest(e) { 
    LDJSONLoggable.call(this, e);
}
LDRefreshCloudConfigRequest.prototype = new LDJSONLoggable();
LDRefreshCloudConfigRequest.prototype.constructor = LDRefreshCloudConfigRequest;
LDRefreshCloudConfigRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDDisconnectCloudSyncRequest(e) { 
    LDJSONLoggable.call(this, e);
}
LDDisconnectCloudSyncRequest.prototype = new LDJSONLoggable();
LDDisconnectCloudSyncRequest.prototype.constructor = LDDisconnectCloudSyncRequest;
LDDisconnectCloudSyncRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDOptInForAllGamesChallengesRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['o'] !== null && e['o'] !== undefined))
        this.OptIn = e['o'];
    else
        this.OptIn = null;
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.ServerKicked = e['k'];
    else
        this.ServerKicked = null;
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
}
LDOptInForAllGamesChallengesRequest.prototype = new LDJSONLoggable();
LDOptInForAllGamesChallengesRequest.prototype.constructor = LDOptInForAllGamesChallengesRequest;
LDOptInForAllGamesChallengesRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.OptIn !== null) o['o'] = this.OptIn;
    if(this.ServerKicked !== null) o['k'] = this.ServerKicked;
    if(this.Account !== null) o['a'] = this.Account;
    return o;
}
LDOptInForAllGamesChallengesRequest.prototype.OptIn = null;
LDOptInForAllGamesChallengesRequest.prototype.ServerKicked = null;
LDOptInForAllGamesChallengesRequest.prototype.Account = null;
function LDFindGamersRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.GameId = new LDItemId(e['g']);
    if(e && (e['x'] !== null && e['x'] !== undefined))
        this.Latitude = e['x'];
    else
        this.Latitude = null;
    if(e && (e['y'] !== null && e['y'] !== undefined))
        this.Longitude = e['y'];
    else
        this.Longitude = null;
}
LDFindGamersRequest.prototype = new LDJSONLoggable();
LDFindGamersRequest.prototype.constructor = LDFindGamersRequest;
LDFindGamersRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.GameId !== null) o['g'] = this.GameId.encode();
    if(this.Latitude !== null) o['x'] = this.Latitude;
    if(this.Longitude !== null) o['y'] = this.Longitude;
    return o;
}
LDFindGamersRequest.prototype.GameId = null;
LDFindGamersRequest.prototype.Latitude = null;
LDFindGamersRequest.prototype.Longitude = null;
function LDUpdateChallengeLocationRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['x'] !== null && e['x'] !== undefined))
        this.Latitude = e['x'];
    else
        this.Latitude = null;
    if(e && (e['y'] !== null && e['y'] !== undefined))
        this.Longitude = e['y'];
    else
        this.Longitude = null;
}
LDUpdateChallengeLocationRequest.prototype = new LDJSONLoggable();
LDUpdateChallengeLocationRequest.prototype.constructor = LDUpdateChallengeLocationRequest;
LDUpdateChallengeLocationRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Latitude !== null) o['x'] = this.Latitude;
    if(this.Longitude !== null) o['y'] = this.Longitude;
    return o;
}
LDUpdateChallengeLocationRequest.prototype.Latitude = null;
LDUpdateChallengeLocationRequest.prototype.Longitude = null;
function LDGameChallengeCompleteRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = new LDGameChallengeId(e['i']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Score = e['s'];
    else
        this.Score = null;
    if(e && (e['x'] !== null && e['x'] !== undefined))
        this.ChallengeRejected = e['x'];
    else
        this.ChallengeRejected = null;
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.ChallengeeLocation = new LDGPSLocation(e['l']);
}
LDGameChallengeCompleteRequest.prototype = new LDJSONLoggable();
LDGameChallengeCompleteRequest.prototype.constructor = LDGameChallengeCompleteRequest;
LDGameChallengeCompleteRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Id !== null) o['i'] = this.Id.encode();
    if(this.Score !== null) o['s'] = this.Score;
    if(this.ChallengeRejected !== null) o['x'] = this.ChallengeRejected;
    if(this.ChallengeeLocation !== null) o['l'] = this.ChallengeeLocation.encode();
    return o;
}
LDGameChallengeCompleteRequest.prototype.Id = null;
LDGameChallengeCompleteRequest.prototype.Score = null;
LDGameChallengeCompleteRequest.prototype.ChallengeRejected = null;
LDGameChallengeCompleteRequest.prototype.ChallengeeLocation = null;
function LDExtendChallengeRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = new LDGameChallengeId(e['i']);
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.ReceiverAccount = e['r'];
    else
        this.ReceiverAccount = null;
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.GameId = new LDItemId(e['g']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Score = e['s'];
    else
        this.Score = null;
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.GameState = e['t'];
    else
        this.GameState = null;
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.Location = new LDGPSLocation(e['l']);
}
LDExtendChallengeRequest.prototype = new LDJSONLoggable();
LDExtendChallengeRequest.prototype.constructor = LDExtendChallengeRequest;
LDExtendChallengeRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Id !== null) o['i'] = this.Id.encode();
    if(this.ReceiverAccount !== null) o['r'] = this.ReceiverAccount;
    if(this.GameId !== null) o['g'] = this.GameId.encode();
    if(this.Score !== null) o['s'] = this.Score;
    if(this.GameState !== null) o['t'] = this.GameState;
    if(this.Location !== null) o['l'] = this.Location.encode();
    return o;
}
LDExtendChallengeRequest.prototype.Id = null;
LDExtendChallengeRequest.prototype.ReceiverAccount = null;
LDExtendChallengeRequest.prototype.GameId = null;
LDExtendChallengeRequest.prototype.Score = null;
LDExtendChallengeRequest.prototype.GameState = null;
LDExtendChallengeRequest.prototype.Location = null;
function LDCheckAccountOptedInRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.GameId = new LDItemId(e['g']);
}
LDCheckAccountOptedInRequest.prototype = new LDJSONLoggable();
LDCheckAccountOptedInRequest.prototype.constructor = LDCheckAccountOptedInRequest;
LDCheckAccountOptedInRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Account !== null) o['a'] = this.Account;
    if(this.GameId !== null) o['g'] = this.GameId.encode();
    return o;
}
LDCheckAccountOptedInRequest.prototype.Account = null;
LDCheckAccountOptedInRequest.prototype.GameId = null;
function LDOptInForGSChallengesRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['o'] !== null && e['o'] !== undefined))
        this.OptIn = e['o'];
    else
        this.OptIn = null;
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.ServerKicked = e['k'];
    else
        this.ServerKicked = null;
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.Game = new LDItemId(e['g']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.All = e['l'];
    else
        this.All = null;
}
LDOptInForGSChallengesRequest.prototype = new LDJSONLoggable();
LDOptInForGSChallengesRequest.prototype.constructor = LDOptInForGSChallengesRequest;
LDOptInForGSChallengesRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.OptIn !== null) o['o'] = this.OptIn;
    if(this.ServerKicked !== null) o['k'] = this.ServerKicked;
    if(this.Game !== null) o['g'] = this.Game.encode();
    if(this.Account !== null) o['a'] = this.Account;
    if(this.All !== null) o['l'] = this.All;
    return o;
}
LDOptInForGSChallengesRequest.prototype.OptIn = null;
LDOptInForGSChallengesRequest.prototype.ServerKicked = null;
LDOptInForGSChallengesRequest.prototype.Game = null;
LDOptInForGSChallengesRequest.prototype.Account = null;
LDOptInForGSChallengesRequest.prototype.All = null;
function LDFindGamersGSRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['x'] !== null && e['x'] !== undefined))
        this.Latitude = e['x'];
    else
        this.Latitude = null;
    if(e && (e['y'] !== null && e['y'] !== undefined))
        this.Longitude = e['y'];
    else
        this.Longitude = null;
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.GameId = new LDItemId(e['g']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Tier = e['t'];
    else
        this.Tier = null;
}
LDFindGamersGSRequest.prototype = new LDJSONLoggable();
LDFindGamersGSRequest.prototype.constructor = LDFindGamersGSRequest;
LDFindGamersGSRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Latitude !== null) o['x'] = this.Latitude;
    if(this.Longitude !== null) o['y'] = this.Longitude;
    if(this.GameId !== null) o['g'] = this.GameId.encode();
    if(this.Tier !== null) o['t'] = this.Tier;
    return o;
}
LDFindGamersGSRequest.prototype.Latitude = null;
LDFindGamersGSRequest.prototype.Longitude = null;
LDFindGamersGSRequest.prototype.GameId = null;
LDFindGamersGSRequest.prototype.Tier = null;
function LDCreateSubscriptionRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.Name = e['n'];
    else
        this.Name = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ProfilePictureLinkString = e['p'];
    else
        this.ProfilePictureLinkString = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.ProfileDecryptedHash = new Buffer(e['d'], 'base64');
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Type = e['t'];
    else
        this.Type = null;
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.CanRead = e['r'];
    else
        this.CanRead = null;
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
}
LDCreateSubscriptionRequest.prototype = new LDJSONLoggable();
LDCreateSubscriptionRequest.prototype.constructor = LDCreateSubscriptionRequest;
LDCreateSubscriptionRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Name !== null) o['n'] = this.Name;
    if(this.ProfilePictureLinkString !== null) o['p'] = this.ProfilePictureLinkString;
    if(this.ProfileDecryptedHash !== null) o['d'] = this.ProfileDecryptedHash.toString('base64');
    if(this.Type !== null) o['t'] = this.Type;
    if(this.CanRead !== null) o['r'] = this.CanRead;
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    return o;
}
LDCreateSubscriptionRequest.prototype.Name = null;
LDCreateSubscriptionRequest.prototype.ProfilePictureLinkString = null;
LDCreateSubscriptionRequest.prototype.ProfileDecryptedHash = null;
LDCreateSubscriptionRequest.prototype.Type = null;
LDCreateSubscriptionRequest.prototype.CanRead = null;
LDCreateSubscriptionRequest.prototype.Feed = null;
function LDGetHighScoreRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.GameId = new LDItemId(e['id']);
    if(e && (e['sb'] !== null && e['sb'] !== undefined))
        this.GameScoreboard = e['sb'];
    else
        this.GameScoreboard = null;
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['la'] !== null && e['la'] !== undefined))
        this.Latitude = e['la'];
    if(e && (e['lo'] !== null && e['lo'] !== undefined))
        this.Longitude = e['lo'];
    if(e && (e['sc'] !== null && e['sc'] !== undefined))
        this.SimilarScoresInCity = e['sc'];
    else
        this.SimilarScoresInCity = null;
    if(e && (e['su'] !== null && e['su'] !== undefined))
        this.SimilarScoresInCountry = e['su'];
    else
        this.SimilarScoresInCountry = null;
    if(e && (e['st'] !== null && e['st'] !== undefined))
        this.SimilarScoresInContinent = e['st'];
    else
        this.SimilarScoresInContinent = null;
    if(e && (e['sg'] !== null && e['sg'] !== undefined))
        this.SimilarScoresGlobal = e['sg'];
    else
        this.SimilarScoresGlobal = null;
    if(e && (e['sl'] !== null && e['sl'] !== undefined))
        this.SimilarScoresLocal = e['sl'];
    else
        this.SimilarScoresLocal = null;
}
LDGetHighScoreRequest.prototype = new LDJSONLoggable();
LDGetHighScoreRequest.prototype.constructor = LDGetHighScoreRequest;
LDGetHighScoreRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.GameId !== null) o['id'] = this.GameId.encode();
    if(this.GameScoreboard !== null) o['sb'] = this.GameScoreboard;
    if(this.Account !== null) o['a'] = this.Account;
    if(this.Latitude !== null) o['la'] = this.Latitude;
    if(this.Longitude !== null) o['lo'] = this.Longitude;
    if(this.SimilarScoresInCity !== null) o['sc'] = this.SimilarScoresInCity;
    if(this.SimilarScoresInCountry !== null) o['su'] = this.SimilarScoresInCountry;
    if(this.SimilarScoresInContinent !== null) o['st'] = this.SimilarScoresInContinent;
    if(this.SimilarScoresGlobal !== null) o['sg'] = this.SimilarScoresGlobal;
    if(this.SimilarScoresLocal !== null) o['sl'] = this.SimilarScoresLocal;
    return o;
}
LDGetHighScoreRequest.prototype.GameId = null;
LDGetHighScoreRequest.prototype.GameScoreboard = null;
LDGetHighScoreRequest.prototype.Account = null;
LDGetHighScoreRequest.prototype.Latitude = null;
LDGetHighScoreRequest.prototype.Longitude = null;
LDGetHighScoreRequest.prototype.SimilarScoresInCity = null;
LDGetHighScoreRequest.prototype.SimilarScoresInCountry = null;
LDGetHighScoreRequest.prototype.SimilarScoresInContinent = null;
LDGetHighScoreRequest.prototype.SimilarScoresGlobal = null;
LDGetHighScoreRequest.prototype.SimilarScoresLocal = null;
function LDReportScoreRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.GameId = new LDItemId(e['id']);
    if(e && (e['sb'] !== null && e['sb'] !== undefined))
        this.GameScoreboard = e['sb'];
    else
        this.GameScoreboard = null;
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Score = e['s'];
    if(e && (e['la'] !== null && e['la'] !== undefined))
        this.Latitude = e['la'];
    if(e && (e['lo'] !== null && e['lo'] !== undefined))
        this.Longitude = e['lo'];
    if(e && (e['sc'] !== null && e['sc'] !== undefined))
        this.SimilarScoresInCity = e['sc'];
    else
        this.SimilarScoresInCity = null;
    if(e && (e['su'] !== null && e['su'] !== undefined))
        this.SimilarScoresInCountry = e['su'];
    else
        this.SimilarScoresInCountry = null;
    if(e && (e['st'] !== null && e['st'] !== undefined))
        this.SimilarScoresInContinent = e['st'];
    else
        this.SimilarScoresInContinent = null;
    if(e && (e['sg'] !== null && e['sg'] !== undefined))
        this.SimilarScoresGlobal = e['sg'];
    else
        this.SimilarScoresGlobal = null;
    if(e && (e['sl'] !== null && e['sl'] !== undefined))
        this.SimilarScoresLocal = e['sl'];
    else
        this.SimilarScoresLocal = null;
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
}
LDReportScoreRequest.prototype = new LDJSONLoggable();
LDReportScoreRequest.prototype.constructor = LDReportScoreRequest;
LDReportScoreRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.GameId !== null) o['id'] = this.GameId.encode();
    if(this.GameScoreboard !== null) o['sb'] = this.GameScoreboard;
    if(this.Score !== null) o['s'] = this.Score;
    if(this.Latitude !== null) o['la'] = this.Latitude;
    if(this.Longitude !== null) o['lo'] = this.Longitude;
    if(this.SimilarScoresInCity !== null) o['sc'] = this.SimilarScoresInCity;
    if(this.SimilarScoresInCountry !== null) o['su'] = this.SimilarScoresInCountry;
    if(this.SimilarScoresInContinent !== null) o['st'] = this.SimilarScoresInContinent;
    if(this.SimilarScoresGlobal !== null) o['sg'] = this.SimilarScoresGlobal;
    if(this.SimilarScoresLocal !== null) o['sl'] = this.SimilarScoresLocal;
    if(this.Account !== null) o['a'] = this.Account;
    return o;
}
LDReportScoreRequest.prototype.GameId = null;
LDReportScoreRequest.prototype.GameScoreboard = null;
LDReportScoreRequest.prototype.Score = null;
LDReportScoreRequest.prototype.Latitude = null;
LDReportScoreRequest.prototype.Longitude = null;
LDReportScoreRequest.prototype.SimilarScoresInCity = null;
LDReportScoreRequest.prototype.SimilarScoresInCountry = null;
LDReportScoreRequest.prototype.SimilarScoresInContinent = null;
LDReportScoreRequest.prototype.SimilarScoresGlobal = null;
LDReportScoreRequest.prototype.SimilarScoresLocal = null;
LDReportScoreRequest.prototype.Account = null;
function LDGetTopScoresRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.GameId = new LDItemId(e['id']);
    if(e && (e['sb'] !== null && e['sb'] !== undefined))
        this.GameScoreboard = e['sb'];
    else
        this.GameScoreboard = null;
    if(e && (e['la'] !== null && e['la'] !== undefined))
        this.Latitude = e['la'];
    if(e && (e['lo'] !== null && e['lo'] !== undefined))
        this.Longitude = e['lo'];
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.NumScores = e['n'];
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.LocationType = e['l'];
    else
        this.LocationType = null;
}
LDGetTopScoresRequest.prototype = new LDJSONLoggable();
LDGetTopScoresRequest.prototype.constructor = LDGetTopScoresRequest;
LDGetTopScoresRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.GameId !== null) o['id'] = this.GameId.encode();
    if(this.GameScoreboard !== null) o['sb'] = this.GameScoreboard;
    if(this.Latitude !== null) o['la'] = this.Latitude;
    if(this.Longitude !== null) o['lo'] = this.Longitude;
    if(this.NumScores !== null) o['n'] = this.NumScores;
    if(this.LocationType !== null) o['l'] = this.LocationType;
    return o;
}
LDGetTopScoresRequest.prototype.GameId = null;
LDGetTopScoresRequest.prototype.GameScoreboard = null;
LDGetTopScoresRequest.prototype.Latitude = null;
LDGetTopScoresRequest.prototype.Longitude = null;
LDGetTopScoresRequest.prototype.NumScores = null;
LDGetTopScoresRequest.prototype.LocationType = null;
function LDBroadcastItemRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Item = new LDNearbyItemContainer(e['i']);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Pin = e['p'];
    else
        this.Pin = null;
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.Ttl = e['e'];
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Latitude = e['a'];
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.Longitude = e['g'];
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.Radius = e['r'];
}
LDBroadcastItemRequest.prototype = new LDJSONLoggable();
LDBroadcastItemRequest.prototype.constructor = LDBroadcastItemRequest;
LDBroadcastItemRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Item !== null) o['i'] = this.Item.encode();
    if(this.Pin !== null) o['p'] = this.Pin;
    if(this.Ttl !== null) o['e'] = this.Ttl;
    if(this.Latitude !== null) o['a'] = this.Latitude;
    if(this.Longitude !== null) o['g'] = this.Longitude;
    if(this.Radius !== null) o['r'] = this.Radius;
    return o;
}
LDBroadcastItemRequest.prototype.Item = null;
LDBroadcastItemRequest.prototype.Pin = null;
LDBroadcastItemRequest.prototype.Ttl = null;
LDBroadcastItemRequest.prototype.Latitude = null;
LDBroadcastItemRequest.prototype.Longitude = null;
LDBroadcastItemRequest.prototype.Radius = null;
function LDUnbroadcastItemRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Item = new LDNearbyItemContainer(e['i']);
}
LDUnbroadcastItemRequest.prototype = new LDJSONLoggable();
LDUnbroadcastItemRequest.prototype.constructor = LDUnbroadcastItemRequest;
LDUnbroadcastItemRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Item !== null) o['i'] = this.Item.encode();
    return o;
}
LDUnbroadcastItemRequest.prototype.Item = null;
function LDSubscribeForNearbyItemsRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.ItemType = e['t'];
    else
        this.ItemType = null;
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.Ttl = e['e'];
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Latitude = e['a'];
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.Longitude = e['g'];
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.Radius = e['r'];
}
LDSubscribeForNearbyItemsRequest.prototype = new LDJSONLoggable();
LDSubscribeForNearbyItemsRequest.prototype.constructor = LDSubscribeForNearbyItemsRequest;
LDSubscribeForNearbyItemsRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ItemType !== null) o['t'] = this.ItemType;
    if(this.Ttl !== null) o['e'] = this.Ttl;
    if(this.Latitude !== null) o['a'] = this.Latitude;
    if(this.Longitude !== null) o['g'] = this.Longitude;
    if(this.Radius !== null) o['r'] = this.Radius;
    return o;
}
LDSubscribeForNearbyItemsRequest.prototype.ItemType = null;
LDSubscribeForNearbyItemsRequest.prototype.Ttl = null;
LDSubscribeForNearbyItemsRequest.prototype.Latitude = null;
LDSubscribeForNearbyItemsRequest.prototype.Longitude = null;
LDSubscribeForNearbyItemsRequest.prototype.Radius = null;
function LDUnsubscribeForNearbyItemsRequest(e) { 
    LDJSONLoggable.call(this, e);
}
LDUnsubscribeForNearbyItemsRequest.prototype = new LDJSONLoggable();
LDUnsubscribeForNearbyItemsRequest.prototype.constructor = LDUnsubscribeForNearbyItemsRequest;
LDUnsubscribeForNearbyItemsRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDFetchNearbyItemsRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.ItemType = e['t'];
    else
        this.ItemType = null;
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Latitude = e['a'];
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.Longitude = e['g'];
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.Radius = e['r'];
}
LDFetchNearbyItemsRequest.prototype = new LDJSONLoggable();
LDFetchNearbyItemsRequest.prototype.constructor = LDFetchNearbyItemsRequest;
LDFetchNearbyItemsRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ItemType !== null) o['t'] = this.ItemType;
    if(this.Latitude !== null) o['a'] = this.Latitude;
    if(this.Longitude !== null) o['g'] = this.Longitude;
    if(this.Radius !== null) o['r'] = this.Radius;
    return o;
}
LDFetchNearbyItemsRequest.prototype.ItemType = null;
LDFetchNearbyItemsRequest.prototype.Latitude = null;
LDFetchNearbyItemsRequest.prototype.Longitude = null;
LDFetchNearbyItemsRequest.prototype.Radius = null;
function LDItemBroadcastStateChangedPush(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Item = new LDNearbyItemContainer(e['i']);
}
LDItemBroadcastStateChangedPush.prototype = new LDJSONLoggable();
LDItemBroadcastStateChangedPush.prototype.constructor = LDItemBroadcastStateChangedPush;
LDItemBroadcastStateChangedPush.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Item !== null) o['i'] = this.Item.encode();
    return o;
}
LDItemBroadcastStateChangedPush.prototype.Item = null;
function LDSubscriptionTerminatedPush(e) { 
    LDJSONLoggable.call(this, e);
}
LDSubscriptionTerminatedPush.prototype = new LDJSONLoggable();
LDSubscriptionTerminatedPush.prototype.constructor = LDSubscriptionTerminatedPush;
LDSubscriptionTerminatedPush.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDUrlToStoryRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.Url = e['l'];
    else
        this.Url = null;
}
LDUrlToStoryRequest.prototype = new LDJSONLoggable();
LDUrlToStoryRequest.prototype.constructor = LDUrlToStoryRequest;
LDUrlToStoryRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Url !== null) o['l'] = this.Url;
    return o;
}
LDUrlToStoryRequest.prototype.Url = null;
function LDImageSearchRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Term = e['t'];
    else
        this.Term = null;
}
LDImageSearchRequest.prototype = new LDJSONLoggable();
LDImageSearchRequest.prototype.constructor = LDImageSearchRequest;
LDImageSearchRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Term !== null) o['t'] = this.Term;
    return o;
}
LDImageSearchRequest.prototype.Term = null;
function LDFailureReportRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Failure = e['t'];
    else
        this.Failure = null;
}
LDFailureReportRequest.prototype = new LDJSONLoggable();
LDFailureReportRequest.prototype.constructor = LDFailureReportRequest;
LDFailureReportRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Failure !== null) o['t'] = this.Failure;
    return o;
}
LDFailureReportRequest.prototype.Failure = null;
function LDFlagUserRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.Reason = e['r'];
    else
        this.Reason = null;
}
LDFlagUserRequest.prototype = new LDJSONLoggable();
LDFlagUserRequest.prototype.constructor = LDFlagUserRequest;
LDFlagUserRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Account !== null) o['a'] = this.Account;
    if(this.Reason !== null) o['r'] = this.Reason;
    return o;
}
LDFlagUserRequest.prototype.Account = null;
LDFlagUserRequest.prototype.Reason = null;
function LDCreatePlaygroundRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Type = e['t'];
    else
        this.Type = null;
}
LDCreatePlaygroundRequest.prototype = new LDJSONLoggable();
LDCreatePlaygroundRequest.prototype.constructor = LDCreatePlaygroundRequest;
LDCreatePlaygroundRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Type !== null) o['t'] = this.Type;
    return o;
}
LDCreatePlaygroundRequest.prototype.Type = null;
function LDGetFeedbackAccountRequest(e) { 
    LDJSONLoggable.call(this, e);
}
LDGetFeedbackAccountRequest.prototype = new LDJSONLoggable();
LDGetFeedbackAccountRequest.prototype.constructor = LDGetFeedbackAccountRequest;
LDGetFeedbackAccountRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDGetExtraVersionsRequest(e) { 
    LDJSONLoggable.call(this, e);
}
LDGetExtraVersionsRequest.prototype = new LDJSONLoggable();
LDGetExtraVersionsRequest.prototype.constructor = LDGetExtraVersionsRequest;
LDGetExtraVersionsRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDGetDirectFeedRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Sender = new LDIdentity(e['s']);
    if(e && (e['r'] !== null && e['r'] !== undefined)) { 
        this.Recipients = [];
        var d = e['r'];
        for(var k = 0; k < d.length; ++k) this.Recipients.push(new LDIdentity(d[k]));
    }
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.FeedKind = e['k'];
    else
        this.FeedKind = null;
}
LDGetDirectFeedRequest.prototype = new LDJSONLoggable();
LDGetDirectFeedRequest.prototype.constructor = LDGetDirectFeedRequest;
LDGetDirectFeedRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Sender !== null) o['s'] = this.Sender.encode();
    if(this.Recipients !== null) { 
        o['r'] = [];
        var d = this.Recipients;
        for(var k = 0; k < d.length; ++k) o['r'].push(d[k].encode());
    } else {
        o['Recipients'] = null;
    }
    if(this.FeedKind !== null) o['k'] = this.FeedKind;
    return o;
}
LDGetDirectFeedRequest.prototype.Sender = null;
LDGetDirectFeedRequest.prototype.Recipients = null;
LDGetDirectFeedRequest.prototype.FeedKind = null;
function LDSendDirectMessageRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['_f'] !== null && e['_f'] !== undefined))
        this.Feed = new LDFeed(e['_f']);
    if(e && (e['_a'] !== null && e['_a'] !== undefined)) { 
        this.Accounts = [];
        var d = e['_a'];
        for(var k = 0; k < d.length; ++k) this.Accounts.push(d[k]);
    }
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Sender = new LDIdentity(e['s']);
    if(e && (e['r'] !== null && e['r'] !== undefined)) { 
        this.Recipients = [];
        var d = e['r'];
        for(var k = 0; k < d.length; ++k) this.Recipients.push(new LDIdentity(d[k]));
    }
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.FeedKind = e['k'];
    else
        this.FeedKind = null;
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = new LDTypedId(e['i']);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.Body = new Buffer(e['b'], 'base64');
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.Version = e['v'];
    else
        this.Version = null;
    if(e && (e['w'] !== null && e['w'] !== undefined))
        this.AnyMemberWritable = e['w'];
    else
        this.AnyMemberWritable = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.SmsId = e['d'];
    else
        this.SmsId = null;
}
LDSendDirectMessageRequest.prototype = new LDJSONLoggable();
LDSendDirectMessageRequest.prototype.constructor = LDSendDirectMessageRequest;
LDSendDirectMessageRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['_f'] = this.Feed.encode();
    if(this.Accounts !== null) { 
        o['_a'] = [];
        var d = this.Accounts;
        for(var k = 0; k < d.length; ++k) o['_a'].push(d[k]);
    } else {
        o['Accounts'] = null;
    }
    if(this.Sender !== null) o['s'] = this.Sender.encode();
    if(this.Recipients !== null) { 
        o['r'] = [];
        var d = this.Recipients;
        for(var k = 0; k < d.length; ++k) o['r'].push(d[k].encode());
    } else {
        o['Recipients'] = null;
    }
    if(this.FeedKind !== null) o['k'] = this.FeedKind;
    if(this.Id !== null) o['i'] = this.Id.encode();
    if(this.Body !== null) o['b'] = this.Body.toString('base64');
    if(this.Version !== null) o['v'] = this.Version;
    if(this.AnyMemberWritable !== null) o['w'] = this.AnyMemberWritable;
    if(this.SmsId !== null) o['d'] = this.SmsId;
    return o;
}
LDSendDirectMessageRequest.prototype.Feed = null;
LDSendDirectMessageRequest.prototype.Accounts = null;
LDSendDirectMessageRequest.prototype.Sender = null;
LDSendDirectMessageRequest.prototype.Recipients = null;
LDSendDirectMessageRequest.prototype.FeedKind = null;
LDSendDirectMessageRequest.prototype.Id = null;
LDSendDirectMessageRequest.prototype.Body = null;
LDSendDirectMessageRequest.prototype.Version = null;
LDSendDirectMessageRequest.prototype.AnyMemberWritable = null;
LDSendDirectMessageRequest.prototype.SmsId = null;
function LDSetSmsParticipationRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['o'] !== null && e['o'] !== undefined))
        this.OptOut = e['o'];
    else
        this.OptOut = null;
}
LDSetSmsParticipationRequest.prototype = new LDJSONLoggable();
LDSetSmsParticipationRequest.prototype.constructor = LDSetSmsParticipationRequest;
LDSetSmsParticipationRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.OptOut !== null) o['o'] = this.OptOut;
    return o;
}
LDSetSmsParticipationRequest.prototype.OptOut = null;
function LDPostVideoRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Title = e['t'];
    else
        this.Title = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Description = e['d'];
    else
        this.Description = null;
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.BlobLinkString = e['b'];
    else
        this.BlobLinkString = null;
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.VideoBlobRefTag = new Buffer(e['r'], 'base64');
    if(e && (e['dr'] !== null && e['dr'] !== undefined))
        this.Duration = e['dr'];
    if(e && (e['B'] !== null && e['B'] !== undefined))
        this.ThumbnailBlobLinkString = e['B'];
    else
        this.ThumbnailBlobLinkString = null;
    if(e && (e['H'] !== null && e['H'] !== undefined))
        this.Height = e['H'];
    if(e && (e['W'] !== null && e['W'] !== undefined))
        this.Width = e['W'];
    if(e && (e['pt'] !== null && e['pt'] !== undefined))
        this.PrimaryTag = new LDPostTag(e['pt']);
    if(e && (e['st'] !== null && e['st'] !== undefined)) { 
        this.SecondaryTags = [];
        var d = e['st'];
        for(var k = 0; k < d.length; ++k) this.SecondaryTags.push(new LDPostTag(d[k]));
    }
}
LDPostVideoRequest.prototype = new LDJSONLoggable();
LDPostVideoRequest.prototype.constructor = LDPostVideoRequest;
LDPostVideoRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Title !== null) o['t'] = this.Title;
    if(this.Description !== null) o['d'] = this.Description;
    if(this.BlobLinkString !== null) o['b'] = this.BlobLinkString;
    if(this.VideoBlobRefTag !== null) o['r'] = this.VideoBlobRefTag.toString('base64');
    if(this.Duration !== null) o['dr'] = this.Duration;
    if(this.ThumbnailBlobLinkString !== null) o['B'] = this.ThumbnailBlobLinkString;
    if(this.Height !== null) o['H'] = this.Height;
    if(this.Width !== null) o['W'] = this.Width;
    if(this.PrimaryTag !== null) o['pt'] = this.PrimaryTag.encode();
    if(this.SecondaryTags !== null) { 
        o['st'] = [];
        var d = this.SecondaryTags;
        for(var k = 0; k < d.length; ++k) o['st'].push(d[k].encode());
    } else {
        o['SecondaryTags'] = null;
    }
    return o;
}
LDPostVideoRequest.prototype.Title = null;
LDPostVideoRequest.prototype.Description = null;
LDPostVideoRequest.prototype.BlobLinkString = null;
LDPostVideoRequest.prototype.VideoBlobRefTag = null;
LDPostVideoRequest.prototype.Duration = null;
LDPostVideoRequest.prototype.ThumbnailBlobLinkString = null;
LDPostVideoRequest.prototype.Height = null;
LDPostVideoRequest.prototype.Width = null;
LDPostVideoRequest.prototype.PrimaryTag = null;
LDPostVideoRequest.prototype.SecondaryTags = null;
function LDPostMessageRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Title = e['t'];
    else
        this.Title = null;
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Message = e['m'];
    else
        this.Message = null;
    if(e && (e['pt'] !== null && e['pt'] !== undefined))
        this.PrimaryTag = new LDPostTag(e['pt']);
    if(e && (e['st'] !== null && e['st'] !== undefined)) { 
        this.SecondaryTags = [];
        var d = e['st'];
        for(var k = 0; k < d.length; ++k) this.SecondaryTags.push(new LDPostTag(d[k]));
    }
}
LDPostMessageRequest.prototype = new LDJSONLoggable();
LDPostMessageRequest.prototype.constructor = LDPostMessageRequest;
LDPostMessageRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Title !== null) o['t'] = this.Title;
    if(this.Message !== null) o['m'] = this.Message;
    if(this.PrimaryTag !== null) o['pt'] = this.PrimaryTag.encode();
    if(this.SecondaryTags !== null) { 
        o['st'] = [];
        var d = this.SecondaryTags;
        for(var k = 0; k < d.length; ++k) o['st'].push(d[k].encode());
    } else {
        o['SecondaryTags'] = null;
    }
    return o;
}
LDPostMessageRequest.prototype.Title = null;
LDPostMessageRequest.prototype.Message = null;
LDPostMessageRequest.prototype.PrimaryTag = null;
LDPostMessageRequest.prototype.SecondaryTags = null;
function LDPostScreenShotRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Title = e['t'];
    else
        this.Title = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Description = e['d'];
    else
        this.Description = null;
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.BlobLinkString = e['b'];
    else
        this.BlobLinkString = null;
    if(e && (e['tn'] !== null && e['tn'] !== undefined))
        this.ThumbnailLinkString = e['tn'];
    else
        this.ThumbnailLinkString = null;
    if(e && (e['pt'] !== null && e['pt'] !== undefined))
        this.PrimaryTag = new LDPostTag(e['pt']);
    if(e && (e['st'] !== null && e['st'] !== undefined)) { 
        this.SecondaryTags = [];
        var d = e['st'];
        for(var k = 0; k < d.length; ++k) this.SecondaryTags.push(new LDPostTag(d[k]));
    }
}
LDPostScreenShotRequest.prototype = new LDJSONLoggable();
LDPostScreenShotRequest.prototype.constructor = LDPostScreenShotRequest;
LDPostScreenShotRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Title !== null) o['t'] = this.Title;
    if(this.Description !== null) o['d'] = this.Description;
    if(this.BlobLinkString !== null) o['b'] = this.BlobLinkString;
    if(this.ThumbnailLinkString !== null) o['tn'] = this.ThumbnailLinkString;
    if(this.PrimaryTag !== null) o['pt'] = this.PrimaryTag.encode();
    if(this.SecondaryTags !== null) { 
        o['st'] = [];
        var d = this.SecondaryTags;
        for(var k = 0; k < d.length; ++k) o['st'].push(d[k].encode());
    } else {
        o['SecondaryTags'] = null;
    }
    return o;
}
LDPostScreenShotRequest.prototype.Title = null;
LDPostScreenShotRequest.prototype.Description = null;
LDPostScreenShotRequest.prototype.BlobLinkString = null;
LDPostScreenShotRequest.prototype.ThumbnailLinkString = null;
LDPostScreenShotRequest.prototype.PrimaryTag = null;
LDPostScreenShotRequest.prototype.SecondaryTags = null;
function LDLikePostRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['ud'] !== null && e['ud'] !== undefined))
        this.PostId = new LDPostId(e['ud']);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.Like = e['l'];
    else
        this.Like = null;
}
LDLikePostRequest.prototype = new LDJSONLoggable();
LDLikePostRequest.prototype.constructor = LDLikePostRequest;
LDLikePostRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.PostId !== null) o['ud'] = this.PostId.encode();
    if(this.Like !== null) o['l'] = this.Like;
    return o;
}
LDLikePostRequest.prototype.PostId = null;
LDLikePostRequest.prototype.Like = null;
function LDAddViewRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.PostId = new LDPostId(e['id']);
}
LDAddViewRequest.prototype = new LDJSONLoggable();
LDAddViewRequest.prototype.constructor = LDAddViewRequest;
LDAddViewRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.PostId !== null) o['id'] = this.PostId.encode();
    return o;
}
LDAddViewRequest.prototype.PostId = null;
function LDFollowUserRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AccountToFollow = e['a'];
    else
        this.AccountToFollow = null;
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Follow = e['f'];
    else
        this.Follow = null;
}
LDFollowUserRequest.prototype = new LDJSONLoggable();
LDFollowUserRequest.prototype.constructor = LDFollowUserRequest;
LDFollowUserRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.AccountToFollow !== null) o['a'] = this.AccountToFollow;
    if(this.Follow !== null) o['f'] = this.Follow;
    return o;
}
LDFollowUserRequest.prototype.AccountToFollow = null;
LDFollowUserRequest.prototype.Follow = null;
function LDGetUserWallRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContinuationKey = new Buffer(e['c'], 'base64');
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.PostsToGet = e['n'];
    else
        this.PostsToGet = null;
}
LDGetUserWallRequest.prototype = new LDJSONLoggable();
LDGetUserWallRequest.prototype.constructor = LDGetUserWallRequest;
LDGetUserWallRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Account !== null) o['a'] = this.Account;
    if(this.ContinuationKey !== null) o['c'] = this.ContinuationKey.toString('base64');
    if(this.PostsToGet !== null) o['n'] = this.PostsToGet;
    return o;
}
LDGetUserWallRequest.prototype.Account = null;
LDGetUserWallRequest.prototype.ContinuationKey = null;
LDGetUserWallRequest.prototype.PostsToGet = null;
function LDGetGameWallRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.GameTag = e['g'];
    else
        this.GameTag = null;
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.SecondTag = new LDPostTag(e['t']);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContinuationKey = new Buffer(e['c'], 'base64');
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.PostsToGet = e['n'];
    else
        this.PostsToGet = null;
}
LDGetGameWallRequest.prototype = new LDJSONLoggable();
LDGetGameWallRequest.prototype.constructor = LDGetGameWallRequest;
LDGetGameWallRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.GameTag !== null) o['g'] = this.GameTag;
    if(this.SecondTag !== null) o['t'] = this.SecondTag.encode();
    if(this.ContinuationKey !== null) o['c'] = this.ContinuationKey.toString('base64');
    if(this.PostsToGet !== null) o['n'] = this.PostsToGet;
    return o;
}
LDGetGameWallRequest.prototype.GameTag = null;
LDGetGameWallRequest.prototype.SecondTag = null;
LDGetGameWallRequest.prototype.ContinuationKey = null;
LDGetGameWallRequest.prototype.PostsToGet = null;
function LDGetFollowingWallRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContinuationKey = new Buffer(e['c'], 'base64');
}
LDGetFollowingWallRequest.prototype = new LDJSONLoggable();
LDGetFollowingWallRequest.prototype.constructor = LDGetFollowingWallRequest;
LDGetFollowingWallRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ContinuationKey !== null) o['c'] = this.ContinuationKey.toString('base64');
    return o;
}
LDGetFollowingWallRequest.prototype.ContinuationKey = null;
function LDGetPostRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.PostId = new LDPostId(e['id']);
}
LDGetPostRequest.prototype = new LDJSONLoggable();
LDGetPostRequest.prototype.constructor = LDGetPostRequest;
LDGetPostRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.PostId !== null) o['id'] = this.PostId.encode();
    return o;
}
LDGetPostRequest.prototype.PostId = null;
function LDGetStandardPostTagsRequest(e) { 
    LDJSONLoggable.call(this, e);
}
LDGetStandardPostTagsRequest.prototype = new LDJSONLoggable();
LDGetStandardPostTagsRequest.prototype.constructor = LDGetStandardPostTagsRequest;
LDGetStandardPostTagsRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    return o;
}
function LDGetFollowersRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.NumToGet = e['n'];
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContinuationKey = new Buffer(e['c'], 'base64');
}
LDGetFollowersRequest.prototype = new LDJSONLoggable();
LDGetFollowersRequest.prototype.constructor = LDGetFollowersRequest;
LDGetFollowersRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.NumToGet !== null) o['n'] = this.NumToGet;
    if(this.ContinuationKey !== null) o['c'] = this.ContinuationKey.toString('base64');
    return o;
}
LDGetFollowersRequest.prototype.NumToGet = null;
LDGetFollowersRequest.prototype.ContinuationKey = null;
function LDGetAccountsFollowedRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContinuationKey = new Buffer(e['c'], 'base64');
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.NumToGet = e['n'];
}
LDGetAccountsFollowedRequest.prototype = new LDJSONLoggable();
LDGetAccountsFollowedRequest.prototype.constructor = LDGetAccountsFollowedRequest;
LDGetAccountsFollowedRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Account !== null) o['a'] = this.Account;
    if(this.ContinuationKey !== null) o['c'] = this.ContinuationKey.toString('base64');
    if(this.NumToGet !== null) o['n'] = this.NumToGet;
    return o;
}
LDGetAccountsFollowedRequest.prototype.Account = null;
LDGetAccountsFollowedRequest.prototype.ContinuationKey = null;
LDGetAccountsFollowedRequest.prototype.NumToGet = null;
function LDDeletePostRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.PostId = new LDPostId(e['id']);
}
LDDeletePostRequest.prototype = new LDJSONLoggable();
LDDeletePostRequest.prototype.constructor = LDDeletePostRequest;
LDDeletePostRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.PostId !== null) o['id'] = this.PostId.encode();
    return o;
}
LDDeletePostRequest.prototype.PostId = null;
function LDGetIdentityTokenRequest(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.ScopeString = e['s'];
    else
        this.ScopeString = null;
}
LDGetIdentityTokenRequest.prototype = new LDJSONLoggable();
LDGetIdentityTokenRequest.prototype.constructor = LDGetIdentityTokenRequest;
LDGetIdentityTokenRequest.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ScopeString !== null) o['s'] = this.ScopeString;
    return o;
}
LDGetIdentityTokenRequest.prototype.ScopeString = null;
function LDGetMessageResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Message = new LDMessage(e['m']);
}
LDGetMessageResponse.prototype = new LDJSONLoggable();
LDGetMessageResponse.prototype.constructor = LDGetMessageResponse;
LDGetMessageResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Message !== null) o['m'] = this.Message.encode();
    return o;
}
LDGetMessageResponse.prototype.Message = null;
function LDGetMessagesResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['m'] !== null && e['m'] !== undefined)) { 
        this.Messages = [];
        var d = e['m'];
        for(var k = 0; k < d.length; ++k) this.Messages.push(new LDMessage(d[k]));
    }
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Partial = e['p'];
    else
        this.Partial = null;
}
LDGetMessagesResponse.prototype = new LDJSONLoggable();
LDGetMessagesResponse.prototype.constructor = LDGetMessagesResponse;
LDGetMessagesResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Messages !== null) { 
        o['m'] = [];
        var d = this.Messages;
        for(var k = 0; k < d.length; ++k) o['m'].push(d[k].encode());
    } else {
        o['Messages'] = null;
    }
    if(this.Partial !== null) o['p'] = this.Partial;
    return o;
}
LDGetMessagesResponse.prototype.Messages = null;
LDGetMessagesResponse.prototype.Partial = null;
function LDGetMessagesWithContinuationResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['m'] !== null && e['m'] !== undefined)) { 
        this.Messages = [];
        var d = e['m'];
        for(var k = 0; k < d.length; ++k) this.Messages.push(new LDMessage(d[k]));
    }
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContinuationKey = new Buffer(e['c'], 'base64');
}
LDGetMessagesWithContinuationResponse.prototype = new LDJSONLoggable();
LDGetMessagesWithContinuationResponse.prototype.constructor = LDGetMessagesWithContinuationResponse;
LDGetMessagesWithContinuationResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Messages !== null) { 
        o['m'] = [];
        var d = this.Messages;
        for(var k = 0; k < d.length; ++k) o['m'].push(d[k].encode());
    } else {
        o['Messages'] = null;
    }
    if(this.ContinuationKey !== null) o['c'] = this.ContinuationKey.toString('base64');
    return o;
}
LDGetMessagesWithContinuationResponse.prototype.Messages = null;
LDGetMessagesWithContinuationResponse.prototype.ContinuationKey = null;
function LDGetJoinFeedLinkResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.JoinLink = new LDJoinFeedLink(e['l']);
}
LDGetJoinFeedLinkResponse.prototype = new LDJSONLoggable();
LDGetJoinFeedLinkResponse.prototype.constructor = LDGetJoinFeedLinkResponse;
LDGetJoinFeedLinkResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.JoinLink !== null) o['l'] = this.JoinLink.encode();
    return o;
}
LDGetJoinFeedLinkResponse.prototype.JoinLink = null;
function LDGetPublicFeedDetailsResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.Name = e['n'];
    else
        this.Name = null;
    if(e && (e['td'] !== null && e['td'] !== undefined))
        this.ThumbnailLink = e['td'];
    else
        this.ThumbnailLink = null;
}
LDGetPublicFeedDetailsResponse.prototype = new LDJSONLoggable();
LDGetPublicFeedDetailsResponse.prototype.constructor = LDGetPublicFeedDetailsResponse;
LDGetPublicFeedDetailsResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Name !== null) o['n'] = this.Name;
    if(this.ThumbnailLink !== null) o['td'] = this.ThumbnailLink;
    return o;
}
LDGetPublicFeedDetailsResponse.prototype.Name = null;
LDGetPublicFeedDetailsResponse.prototype.ThumbnailLink = null;
function LDDirtyFeedsResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['d'] !== null && e['d'] !== undefined)) { 
        this.Dirty = [];
        var d = e['d'];
        for(var k = 0; k < d.length; ++k) this.Dirty.push(new LDDirtyFeed(d[k]));
    }
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Partial = e['p'];
    if(e && (e['w'] !== null && e['w'] !== undefined))
        this.Window = e['w'];
    else
        this.Window = null;
}
LDDirtyFeedsResponse.prototype = new LDJSONLoggable();
LDDirtyFeedsResponse.prototype.constructor = LDDirtyFeedsResponse;
LDDirtyFeedsResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Dirty !== null) { 
        o['d'] = [];
        var d = this.Dirty;
        for(var k = 0; k < d.length; ++k) o['d'].push(d[k].encode());
    } else {
        o['Dirty'] = null;
    }
    if(this.Partial !== null) o['p'] = this.Partial;
    if(this.Window !== null) o['w'] = this.Window;
    return o;
}
LDDirtyFeedsResponse.prototype.Dirty = null;
LDDirtyFeedsResponse.prototype.Partial = null;
LDDirtyFeedsResponse.prototype.Window = null;
function LDFeedStateResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.LastWriteTime = e['t'];
    else
        this.LastWriteTime = null;
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AcceptanceState = e['a'];
    else
        this.AcceptanceState = null;
}
LDFeedStateResponse.prototype = new LDJSONLoggable();
LDFeedStateResponse.prototype.constructor = LDFeedStateResponse;
LDFeedStateResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.LastWriteTime !== null) o['t'] = this.LastWriteTime;
    if(this.AcceptanceState !== null) o['a'] = this.AcceptanceState;
    return o;
}
LDFeedStateResponse.prototype.LastWriteTime = null;
LDFeedStateResponse.prototype.AcceptanceState = null;
function LDGetUploadTicketResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['ut'] !== null && e['ut'] !== undefined))
        this.BlobUploadTicket = new LDBlobUploadTicket(e['ut']);
}
LDGetUploadTicketResponse.prototype = new LDJSONLoggable();
LDGetUploadTicketResponse.prototype.constructor = LDGetUploadTicketResponse;
LDGetUploadTicketResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.BlobUploadTicket !== null) o['ut'] = this.BlobUploadTicket.encode();
    return o;
}
LDGetUploadTicketResponse.prototype.BlobUploadTicket = null;
function LDGetMultipartUploadTicketResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['ut'] !== null && e['ut'] !== undefined)) { 
        this.BlobUploadTickets = [];
        var d = e['ut'];
        for(var k = 0; k < d.length; ++k) this.BlobUploadTickets.push(new LDBlobUploadTicket(d[k]));
    }
}
LDGetMultipartUploadTicketResponse.prototype = new LDJSONLoggable();
LDGetMultipartUploadTicketResponse.prototype.constructor = LDGetMultipartUploadTicketResponse;
LDGetMultipartUploadTicketResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.BlobUploadTickets !== null) { 
        o['ut'] = [];
        var d = this.BlobUploadTickets;
        for(var k = 0; k < d.length; ++k) o['ut'].push(d[k].encode());
    } else {
        o['BlobUploadTickets'] = null;
    }
    return o;
}
LDGetMultipartUploadTicketResponse.prototype.BlobUploadTickets = null;
function LDGetDownloadTicketResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['dt'] !== null && e['dt'] !== undefined))
        this.BlobDownloadTicket = new LDBlobDownloadTicket(e['dt']);
}
LDGetDownloadTicketResponse.prototype = new LDJSONLoggable();
LDGetDownloadTicketResponse.prototype.constructor = LDGetDownloadTicketResponse;
LDGetDownloadTicketResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.BlobDownloadTicket !== null) o['dt'] = this.BlobDownloadTicket.encode();
    return o;
}
LDGetDownloadTicketResponse.prototype.BlobDownloadTicket = null;
function LDGetContactDetailsResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContactDetails = new LDContactDetails(e['c']);
}
LDGetContactDetailsResponse.prototype = new LDJSONLoggable();
LDGetContactDetailsResponse.prototype.constructor = LDGetContactDetailsResponse;
LDGetContactDetailsResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ContactDetails !== null) o['c'] = this.ContactDetails.encode();
    return o;
}
LDGetContactDetailsResponse.prototype.ContactDetails = null;
function LDGetProfileDetailsResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ProfileDetails = new LDProfileDetails(e['p']);
}
LDGetProfileDetailsResponse.prototype = new LDJSONLoggable();
LDGetProfileDetailsResponse.prototype.constructor = LDGetProfileDetailsResponse;
LDGetProfileDetailsResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ProfileDetails !== null) o['p'] = this.ProfileDetails.encode();
    return o;
}
LDGetProfileDetailsResponse.prototype.ProfileDetails = null;
function LDGetOmletContactProfileResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ContactProfile = new LDContactProfile(e['p']);
}
LDGetOmletContactProfileResponse.prototype = new LDJSONLoggable();
LDGetOmletContactProfileResponse.prototype.constructor = LDGetOmletContactProfileResponse;
LDGetOmletContactProfileResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ContactProfile !== null) o['p'] = this.ContactProfile.encode();
    return o;
}
LDGetOmletContactProfileResponse.prototype.ContactProfile = null;
function LDGetProfilePublicStateResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ProfilePublicState = new LDProfilePublicState(e['p']);
}
LDGetProfilePublicStateResponse.prototype = new LDJSONLoggable();
LDGetProfilePublicStateResponse.prototype.constructor = LDGetProfilePublicStateResponse;
LDGetProfilePublicStateResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ProfilePublicState !== null) o['p'] = this.ProfilePublicState.encode();
    return o;
}
LDGetProfilePublicStateResponse.prototype.ProfilePublicState = null;
function LDGetContactProfileAndPublicStateResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContactProfile = new LDContactProfile(e['c']);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ProfilePublicState = new LDProfilePublicState(e['p']);
}
LDGetContactProfileAndPublicStateResponse.prototype = new LDJSONLoggable();
LDGetContactProfileAndPublicStateResponse.prototype.constructor = LDGetContactProfileAndPublicStateResponse;
LDGetContactProfileAndPublicStateResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ContactProfile !== null) o['c'] = this.ContactProfile.encode();
    if(this.ProfilePublicState !== null) o['p'] = this.ProfilePublicState.encode();
    return o;
}
LDGetContactProfileAndPublicStateResponse.prototype.ContactProfile = null;
LDGetContactProfileAndPublicStateResponse.prototype.ProfilePublicState = null;
function LDGetContactProfileResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ContactProfile = new LDContactProfile(e['p']);
}
LDGetContactProfileResponse.prototype = new LDJSONLoggable();
LDGetContactProfileResponse.prototype.constructor = LDGetContactProfileResponse;
LDGetContactProfileResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Account !== null) o['a'] = this.Account;
    if(this.ContactProfile !== null) o['p'] = this.ContactProfile.encode();
    return o;
}
LDGetContactProfileResponse.prototype.Account = null;
LDGetContactProfileResponse.prototype.ContactProfile = null;
function LDGetItemInfoResponse(e) { 
    if(e && (e['ii'] !== null && e['ii'] !== undefined))
        this.ItemInfoContainer = new LDItemInfoContainer(e['ii']);
}
LDGetItemInfoResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemInfoContainer !== null) o['ii'] = this.ItemInfoContainer.encode();
    return o;
}
LDGetItemInfoResponse.prototype.ItemInfoContainer = null;
function LDListItemsResponse(e) { 
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.ItemInfoListingContainer = new LDItemInfoListingContainer(e['l']);
}
LDListItemsResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemInfoListingContainer !== null) o['l'] = this.ItemInfoListingContainer.encode();
    return o;
}
LDListItemsResponse.prototype.ItemInfoListingContainer = null;
function LDGenerateGrantForItemResponse(e) { 
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.ShareLink = e['s'];
    else
        this.ShareLink = null;
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.RawKey = new Buffer(e['r'], 'base64');
}
LDGenerateGrantForItemResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ShareLink !== null) o['s'] = this.ShareLink;
    if(this.RawKey !== null) o['r'] = this.RawKey.toString('base64');
    return o;
}
LDGenerateGrantForItemResponse.prototype.ShareLink = null;
LDGenerateGrantForItemResponse.prototype.RawKey = null;
function LDGenerateApiKeyResponse(e) { 
    if(e && (e['ak'] !== null && e['ak'] !== undefined))
        this.ApiKey = new LDApiKey(e['ak']);
}
LDGenerateApiKeyResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ApiKey !== null) o['ak'] = this.ApiKey.encode();
    return o;
}
LDGenerateApiKeyResponse.prototype.ApiKey = null;
function LDListApiKeysResponse(e) { 
    if(e && (e['ak'] !== null && e['ak'] !== undefined)) { 
        this.ApiKeys = [];
        var d = e['ak'];
        for(var k = 0; k < d.length; ++k) this.ApiKeys.push(new LDApiKey(d[k]));
    }
}
LDListApiKeysResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ApiKeys !== null) { 
        o['ak'] = [];
        var d = this.ApiKeys;
        for(var k = 0; k < d.length; ++k) o['ak'].push(d[k].encode());
    } else {
        o['ApiKeys'] = null;
    }
    return o;
}
LDListApiKeysResponse.prototype.ApiKeys = null;
function LDGetCloudConfigResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.Config = new LDCloudConfig(e['c']);
}
LDGetCloudConfigResponse.prototype = new LDJSONLoggable();
LDGetCloudConfigResponse.prototype.constructor = LDGetCloudConfigResponse;
LDGetCloudConfigResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Config !== null) o['c'] = this.Config.encode();
    return o;
}
LDGetCloudConfigResponse.prototype.Config = null;
function LDFindGamersResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined)) { 
        this.Candidates = [];
        var d = e['c'];
        for(var k = 0; k < d.length; ++k) this.Candidates.push(d[k]);
    }
    if(e && (e['lt'] !== null && e['lt'] !== undefined))
        this.LocationType = e['lt'];
    else
        this.LocationType = null;
    if(e && (e['ln'] !== null && e['ln'] !== undefined))
        this.LocationName = e['ln'];
    else
        this.LocationName = null;
}
LDFindGamersResponse.prototype = new LDJSONLoggable();
LDFindGamersResponse.prototype.constructor = LDFindGamersResponse;
LDFindGamersResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Candidates !== null) { 
        o['c'] = [];
        var d = this.Candidates;
        for(var k = 0; k < d.length; ++k) o['c'].push(d[k]);
    } else {
        o['Candidates'] = null;
    }
    if(this.LocationType !== null) o['lt'] = this.LocationType;
    if(this.LocationName !== null) o['ln'] = this.LocationName;
    return o;
}
LDFindGamersResponse.prototype.Candidates = null;
LDFindGamersResponse.prototype.LocationType = null;
LDFindGamersResponse.prototype.LocationName = null;
function LDCreateSubscriptionResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.PublishingUrl = e['u'];
    else
        this.PublishingUrl = null;
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.DevicePrivateKey = new Buffer(e['k'], 'base64');
}
LDCreateSubscriptionResponse.prototype = new LDJSONLoggable();
LDCreateSubscriptionResponse.prototype.constructor = LDCreateSubscriptionResponse;
LDCreateSubscriptionResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.PublishingUrl !== null) o['u'] = this.PublishingUrl;
    if(this.Account !== null) o['a'] = this.Account;
    if(this.DevicePrivateKey !== null) o['k'] = this.DevicePrivateKey.toString('base64');
    return o;
}
LDCreateSubscriptionResponse.prototype.PublishingUrl = null;
LDCreateSubscriptionResponse.prototype.Account = null;
LDCreateSubscriptionResponse.prototype.DevicePrivateKey = null;
function LDScoreResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.City = e['c'];
    else
        this.City = null;
    if(e && (e['cs'] !== null && e['cs'] !== undefined))
        this.CityScore = e['cs'];
    if(e && (e['cr'] !== null && e['cr'] !== undefined))
        this.CityRank = e['cr'];
    if(e && (e['cp'] !== null && e['cp'] !== undefined))
        this.CityPercentile = e['cp'];
    if(e && (e['css'] !== null && e['css'] !== undefined)) { 
        this.CitySimilarScores = [];
        var d = e['css'];
        for(var k = 0; k < d.length; ++k) this.CitySimilarScores.push(new LDScoreBoardEntry(d[k]));
    }
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.Country = e['u'];
    else
        this.Country = null;
    if(e && (e['us'] !== null && e['us'] !== undefined))
        this.CountryScore = e['us'];
    if(e && (e['ur'] !== null && e['ur'] !== undefined))
        this.CountryRank = e['ur'];
    if(e && (e['up'] !== null && e['up'] !== undefined))
        this.CountryPercentile = e['up'];
    if(e && (e['uss'] !== null && e['uss'] !== undefined)) { 
        this.CountrySimilarScores = [];
        var d = e['uss'];
        for(var k = 0; k < d.length; ++k) this.CountrySimilarScores.push(new LDScoreBoardEntry(d[k]));
    }
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Continent = e['t'];
    else
        this.Continent = null;
    if(e && (e['ts'] !== null && e['ts'] !== undefined))
        this.ContinentScore = e['ts'];
    if(e && (e['tr'] !== null && e['tr'] !== undefined))
        this.ContinentRank = e['tr'];
    if(e && (e['tp'] !== null && e['tp'] !== undefined))
        this.ContinentPercentile = e['tp'];
    if(e && (e['tss'] !== null && e['tss'] !== undefined)) { 
        this.ContinentSimilarScores = [];
        var d = e['tss'];
        for(var k = 0; k < d.length; ++k) this.ContinentSimilarScores.push(new LDScoreBoardEntry(d[k]));
    }
    if(e && (e['gs'] !== null && e['gs'] !== undefined))
        this.GlobalScore = e['gs'];
    if(e && (e['gr'] !== null && e['gr'] !== undefined))
        this.GlobalRank = e['gr'];
    if(e && (e['gp'] !== null && e['gp'] !== undefined))
        this.GlobalPercentile = e['gp'];
    if(e && (e['gss'] !== null && e['gss'] !== undefined)) { 
        this.GlobalSimilarScores = [];
        var d = e['gss'];
        for(var k = 0; k < d.length; ++k) this.GlobalSimilarScores.push(new LDScoreBoardEntry(d[k]));
    }
    if(e && (e['ll'] !== null && e['ll'] !== undefined))
        this.LocalLevel = e['ll'];
    else
        this.LocalLevel = null;
    if(e && (e['ln'] !== null && e['ln'] !== undefined))
        this.LocalLocationName = e['ln'];
    else
        this.LocalLocationName = null;
    if(e && (e['ls'] !== null && e['ls'] !== undefined))
        this.LocalScore = e['ls'];
    if(e && (e['lr'] !== null && e['lr'] !== undefined))
        this.LocalRank = e['lr'];
    if(e && (e['lp'] !== null && e['lp'] !== undefined))
        this.LocalPercentile = e['lp'];
    if(e && (e['lss'] !== null && e['lss'] !== undefined)) { 
        this.LocalSimilarScores = [];
        var d = e['lss'];
        for(var k = 0; k < d.length; ++k) this.LocalSimilarScores.push(new LDScoreBoardEntry(d[k]));
    }
    if(e && (e['dbf'] !== null && e['dbf'] !== undefined))
        this.DistanceBestFor = e['dbf'];
}
LDScoreResponse.prototype = new LDJSONLoggable();
LDScoreResponse.prototype.constructor = LDScoreResponse;
LDScoreResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.City !== null) o['c'] = this.City;
    if(this.CityScore !== null) o['cs'] = this.CityScore;
    if(this.CityRank !== null) o['cr'] = this.CityRank;
    if(this.CityPercentile !== null) o['cp'] = this.CityPercentile;
    if(this.CitySimilarScores !== null) { 
        o['css'] = [];
        var d = this.CitySimilarScores;
        for(var k = 0; k < d.length; ++k) o['css'].push(d[k].encode());
    } else {
        o['CitySimilarScores'] = null;
    }
    if(this.Country !== null) o['u'] = this.Country;
    if(this.CountryScore !== null) o['us'] = this.CountryScore;
    if(this.CountryRank !== null) o['ur'] = this.CountryRank;
    if(this.CountryPercentile !== null) o['up'] = this.CountryPercentile;
    if(this.CountrySimilarScores !== null) { 
        o['uss'] = [];
        var d = this.CountrySimilarScores;
        for(var k = 0; k < d.length; ++k) o['uss'].push(d[k].encode());
    } else {
        o['CountrySimilarScores'] = null;
    }
    if(this.Continent !== null) o['t'] = this.Continent;
    if(this.ContinentScore !== null) o['ts'] = this.ContinentScore;
    if(this.ContinentRank !== null) o['tr'] = this.ContinentRank;
    if(this.ContinentPercentile !== null) o['tp'] = this.ContinentPercentile;
    if(this.ContinentSimilarScores !== null) { 
        o['tss'] = [];
        var d = this.ContinentSimilarScores;
        for(var k = 0; k < d.length; ++k) o['tss'].push(d[k].encode());
    } else {
        o['ContinentSimilarScores'] = null;
    }
    if(this.GlobalScore !== null) o['gs'] = this.GlobalScore;
    if(this.GlobalRank !== null) o['gr'] = this.GlobalRank;
    if(this.GlobalPercentile !== null) o['gp'] = this.GlobalPercentile;
    if(this.GlobalSimilarScores !== null) { 
        o['gss'] = [];
        var d = this.GlobalSimilarScores;
        for(var k = 0; k < d.length; ++k) o['gss'].push(d[k].encode());
    } else {
        o['GlobalSimilarScores'] = null;
    }
    if(this.LocalLevel !== null) o['ll'] = this.LocalLevel;
    if(this.LocalLocationName !== null) o['ln'] = this.LocalLocationName;
    if(this.LocalScore !== null) o['ls'] = this.LocalScore;
    if(this.LocalRank !== null) o['lr'] = this.LocalRank;
    if(this.LocalPercentile !== null) o['lp'] = this.LocalPercentile;
    if(this.LocalSimilarScores !== null) { 
        o['lss'] = [];
        var d = this.LocalSimilarScores;
        for(var k = 0; k < d.length; ++k) o['lss'].push(d[k].encode());
    } else {
        o['LocalSimilarScores'] = null;
    }
    if(this.DistanceBestFor !== null) o['dbf'] = this.DistanceBestFor;
    return o;
}
LDScoreResponse.prototype.City = null;
LDScoreResponse.prototype.CityScore = null;
LDScoreResponse.prototype.CityRank = null;
LDScoreResponse.prototype.CityPercentile = null;
LDScoreResponse.prototype.CitySimilarScores = null;
LDScoreResponse.prototype.Country = null;
LDScoreResponse.prototype.CountryScore = null;
LDScoreResponse.prototype.CountryRank = null;
LDScoreResponse.prototype.CountryPercentile = null;
LDScoreResponse.prototype.CountrySimilarScores = null;
LDScoreResponse.prototype.Continent = null;
LDScoreResponse.prototype.ContinentScore = null;
LDScoreResponse.prototype.ContinentRank = null;
LDScoreResponse.prototype.ContinentPercentile = null;
LDScoreResponse.prototype.ContinentSimilarScores = null;
LDScoreResponse.prototype.GlobalScore = null;
LDScoreResponse.prototype.GlobalRank = null;
LDScoreResponse.prototype.GlobalPercentile = null;
LDScoreResponse.prototype.GlobalSimilarScores = null;
LDScoreResponse.prototype.LocalLevel = null;
LDScoreResponse.prototype.LocalLocationName = null;
LDScoreResponse.prototype.LocalScore = null;
LDScoreResponse.prototype.LocalRank = null;
LDScoreResponse.prototype.LocalPercentile = null;
LDScoreResponse.prototype.LocalSimilarScores = null;
LDScoreResponse.prototype.DistanceBestFor = null;
function LDScoresResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['lt'] !== null && e['lt'] !== undefined))
        this.LocationType = e['lt'];
    else
        this.LocationType = null;
    if(e && (e['ln'] !== null && e['ln'] !== undefined))
        this.LocationName = e['ln'];
    else
        this.LocationName = null;
    if(e && (e['s'] !== null && e['s'] !== undefined)) { 
        this.Scores = [];
        var d = e['s'];
        for(var k = 0; k < d.length; ++k) this.Scores.push(new LDScoreBoardEntry(d[k]));
    }
}
LDScoresResponse.prototype = new LDJSONLoggable();
LDScoresResponse.prototype.constructor = LDScoresResponse;
LDScoresResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.LocationType !== null) o['lt'] = this.LocationType;
    if(this.LocationName !== null) o['ln'] = this.LocationName;
    if(this.Scores !== null) { 
        o['s'] = [];
        var d = this.Scores;
        for(var k = 0; k < d.length; ++k) o['s'].push(d[k].encode());
    } else {
        o['Scores'] = null;
    }
    return o;
}
LDScoresResponse.prototype.LocationType = null;
LDScoresResponse.prototype.LocationName = null;
LDScoresResponse.prototype.Scores = null;
function LDBroadcastItemResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Pin = e['p'];
    else
        this.Pin = null;
}
LDBroadcastItemResponse.prototype = new LDJSONLoggable();
LDBroadcastItemResponse.prototype.constructor = LDBroadcastItemResponse;
LDBroadcastItemResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Pin !== null) o['p'] = this.Pin;
    return o;
}
LDBroadcastItemResponse.prototype.Pin = null;
function LDFetchNearbyItemsResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['i'] !== null && e['i'] !== undefined)) { 
        this.Items = [];
        var d = e['i'];
        for(var k = 0; k < d.length; ++k) this.Items.push(new LDNearbyItemContainer(d[k]));
    }
}
LDFetchNearbyItemsResponse.prototype = new LDJSONLoggable();
LDFetchNearbyItemsResponse.prototype.constructor = LDFetchNearbyItemsResponse;
LDFetchNearbyItemsResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Items !== null) { 
        o['i'] = [];
        var d = this.Items;
        for(var k = 0; k < d.length; ++k) o['i'].push(d[k].encode());
    } else {
        o['Items'] = null;
    }
    return o;
}
LDFetchNearbyItemsResponse.prototype.Items = null;
function LDUrlToStoryResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.ResponseType = e['t'];
    else
        this.ResponseType = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.ResponseData = new Buffer(e['d'], 'base64');
}
LDUrlToStoryResponse.prototype = new LDJSONLoggable();
LDUrlToStoryResponse.prototype.constructor = LDUrlToStoryResponse;
LDUrlToStoryResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ResponseType !== null) o['t'] = this.ResponseType;
    if(this.ResponseData !== null) o['d'] = this.ResponseData.toString('base64');
    return o;
}
LDUrlToStoryResponse.prototype.ResponseType = null;
LDUrlToStoryResponse.prototype.ResponseData = null;
function LDImageSearchResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['h'] !== null && e['h'] !== undefined)) { 
        this.Hits = [];
        var d = e['h'];
        for(var k = 0; k < d.length; ++k) this.Hits.push(new LDImageSearchResult(d[k]));
    }
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.ClientSearchVersion = e['v'];
    else
        this.ClientSearchVersion = null;
}
LDImageSearchResponse.prototype = new LDJSONLoggable();
LDImageSearchResponse.prototype.constructor = LDImageSearchResponse;
LDImageSearchResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Hits !== null) { 
        o['h'] = [];
        var d = this.Hits;
        for(var k = 0; k < d.length; ++k) o['h'].push(d[k].encode());
    } else {
        o['Hits'] = null;
    }
    if(this.ClientSearchVersion !== null) o['v'] = this.ClientSearchVersion;
    return o;
}
LDImageSearchResponse.prototype.Hits = null;
LDImageSearchResponse.prototype.ClientSearchVersion = null;
function LDCreatePlaygroundResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['ii'] !== null && e['ii'] !== undefined)) { 
        this.AddedItems = [];
        var d = e['ii'];
        for(var k = 0; k < d.length; ++k) this.AddedItems.push(new LDItemId(d[k]));
    }
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Message = e['m'];
    else
        this.Message = null;
}
LDCreatePlaygroundResponse.prototype = new LDJSONLoggable();
LDCreatePlaygroundResponse.prototype.constructor = LDCreatePlaygroundResponse;
LDCreatePlaygroundResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.AddedItems !== null) { 
        o['ii'] = [];
        var d = this.AddedItems;
        for(var k = 0; k < d.length; ++k) o['ii'].push(d[k].encode());
    } else {
        o['AddedItems'] = null;
    }
    if(this.Message !== null) o['m'] = this.Message;
    return o;
}
LDCreatePlaygroundResponse.prototype.Feed = null;
LDCreatePlaygroundResponse.prototype.AddedItems = null;
LDCreatePlaygroundResponse.prototype.Message = null;
function LDGetExtraVersionsResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['h'] !== null && e['h'] !== undefined)) { 
        this.ExtraVersions = {};
        var d = e['h'];
        for(var k in d) this.ExtraVersions[k] = new LDLong(d[k]);
    }
}
LDGetExtraVersionsResponse.prototype = new LDJSONLoggable();
LDGetExtraVersionsResponse.prototype.constructor = LDGetExtraVersionsResponse;
LDGetExtraVersionsResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ExtraVersions !== null) { 
        o['h'] = {};
        var d = this.ExtraVersions;
        for(var k in d) o['h'][k] = d[k].encode();
    } else {
        o['ExtraVersions'] = null;
    }
    return o;
}
LDGetExtraVersionsResponse.prototype.ExtraVersions = null;
function LDGetDirectFeedResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['u'] !== null && e['u'] !== undefined)) { 
        this.UnmappedIdentities = [];
        var d = e['u'];
        for(var k = 0; k < d.length; ++k) this.UnmappedIdentities.push(new LDIdentity(d[k]));
    }
    if(e && (e['o'] !== null && e['o'] !== undefined)) { 
        this.OptOutIdentities = [];
        var d = e['o'];
        for(var k = 0; k < d.length; ++k) this.OptOutIdentities.push(new LDIdentity(d[k]));
    }
    if(e && (e['a'] !== null && e['a'] !== undefined)) { 
        this.Accounts = [];
        var d = e['a'];
        for(var k = 0; k < d.length; ++k) this.Accounts.push(d[k]);
    }
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
}
LDGetDirectFeedResponse.prototype = new LDJSONLoggable();
LDGetDirectFeedResponse.prototype.constructor = LDGetDirectFeedResponse;
LDGetDirectFeedResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.UnmappedIdentities !== null) { 
        o['u'] = [];
        var d = this.UnmappedIdentities;
        for(var k = 0; k < d.length; ++k) o['u'].push(d[k].encode());
    } else {
        o['UnmappedIdentities'] = null;
    }
    if(this.OptOutIdentities !== null) { 
        o['o'] = [];
        var d = this.OptOutIdentities;
        for(var k = 0; k < d.length; ++k) o['o'].push(d[k].encode());
    } else {
        o['OptOutIdentities'] = null;
    }
    if(this.Accounts !== null) { 
        o['a'] = [];
        var d = this.Accounts;
        for(var k = 0; k < d.length; ++k) o['a'].push(d[k]);
    } else {
        o['Accounts'] = null;
    }
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    return o;
}
LDGetDirectFeedResponse.prototype.UnmappedIdentities = null;
LDGetDirectFeedResponse.prototype.OptOutIdentities = null;
LDGetDirectFeedResponse.prototype.Accounts = null;
LDGetDirectFeedResponse.prototype.Feed = null;
function LDSendDirectMessageResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Timestamp = e['t'];
    else
        this.Timestamp = null;
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Metadata = new Buffer(e['m'], 'base64');
    if(e && (e['u'] !== null && e['u'] !== undefined)) { 
        this.UnmappedIdentities = [];
        var d = e['u'];
        for(var k = 0; k < d.length; ++k) this.UnmappedIdentities.push(new LDIdentity(d[k]));
    }
    if(e && (e['o'] !== null && e['o'] !== undefined)) { 
        this.OptOutIdentities = [];
        var d = e['o'];
        for(var k = 0; k < d.length; ++k) this.OptOutIdentities.push(new LDIdentity(d[k]));
    }
}
LDSendDirectMessageResponse.prototype = new LDJSONLoggable();
LDSendDirectMessageResponse.prototype.constructor = LDSendDirectMessageResponse;
LDSendDirectMessageResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Timestamp !== null) o['t'] = this.Timestamp;
    if(this.Metadata !== null) o['m'] = this.Metadata.toString('base64');
    if(this.UnmappedIdentities !== null) { 
        o['u'] = [];
        var d = this.UnmappedIdentities;
        for(var k = 0; k < d.length; ++k) o['u'].push(d[k].encode());
    } else {
        o['UnmappedIdentities'] = null;
    }
    if(this.OptOutIdentities !== null) { 
        o['o'] = [];
        var d = this.OptOutIdentities;
        for(var k = 0; k < d.length; ++k) o['o'].push(d[k].encode());
    } else {
        o['OptOutIdentities'] = null;
    }
    return o;
}
LDSendDirectMessageResponse.prototype.Feed = null;
LDSendDirectMessageResponse.prototype.Timestamp = null;
LDSendDirectMessageResponse.prototype.Metadata = null;
LDSendDirectMessageResponse.prototype.UnmappedIdentities = null;
LDSendDirectMessageResponse.prototype.OptOutIdentities = null;
function LDWallResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['w'] !== null && e['w'] !== undefined))
        this.Wall = new LDWall(e['w']);
}
LDWallResponse.prototype = new LDJSONLoggable();
LDWallResponse.prototype.constructor = LDWallResponse;
LDWallResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Wall !== null) o['w'] = this.Wall.encode();
    return o;
}
LDWallResponse.prototype.Wall = null;
function LDWallsResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['w'] !== null && e['w'] !== undefined)) { 
        this.Walls = [];
        var d = e['w'];
        for(var k = 0; k < d.length; ++k) this.Walls.push(new LDWall(d[k]));
    }
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContinuationKey = new Buffer(e['c'], 'base64');
}
LDWallsResponse.prototype = new LDJSONLoggable();
LDWallsResponse.prototype.constructor = LDWallsResponse;
LDWallsResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Walls !== null) { 
        o['w'] = [];
        var d = this.Walls;
        for(var k = 0; k < d.length; ++k) o['w'].push(d[k].encode());
    } else {
        o['Walls'] = null;
    }
    if(this.ContinuationKey !== null) o['c'] = this.ContinuationKey.toString('base64');
    return o;
}
LDWallsResponse.prototype.Walls = null;
LDWallsResponse.prototype.ContinuationKey = null;
function LDGetPostResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Post = new LDPostContainer(e['p']);
}
LDGetPostResponse.prototype = new LDJSONLoggable();
LDGetPostResponse.prototype.constructor = LDGetPostResponse;
LDGetPostResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Post !== null) o['p'] = this.Post.encode();
    return o;
}
LDGetPostResponse.prototype.Post = null;
function LDAddPostResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.PostId = new LDPostId(e['id']);
}
LDAddPostResponse.prototype = new LDJSONLoggable();
LDAddPostResponse.prototype.constructor = LDAddPostResponse;
LDAddPostResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.PostId !== null) o['id'] = this.PostId.encode();
    return o;
}
LDAddPostResponse.prototype.PostId = null;
function LDGetAccountsFollowedResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined)) { 
        this.AccountsFollowed = [];
        var d = e['f'];
        for(var k = 0; k < d.length; ++k) this.AccountsFollowed.push(new LDUser(d[k]));
    }
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContinuationKey = new Buffer(e['c'], 'base64');
}
LDGetAccountsFollowedResponse.prototype = new LDJSONLoggable();
LDGetAccountsFollowedResponse.prototype.constructor = LDGetAccountsFollowedResponse;
LDGetAccountsFollowedResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.AccountsFollowed !== null) { 
        o['f'] = [];
        var d = this.AccountsFollowed;
        for(var k = 0; k < d.length; ++k) o['f'].push(d[k].encode());
    } else {
        o['AccountsFollowed'] = null;
    }
    if(this.ContinuationKey !== null) o['c'] = this.ContinuationKey.toString('base64');
    return o;
}
LDGetAccountsFollowedResponse.prototype.AccountsFollowed = null;
LDGetAccountsFollowedResponse.prototype.ContinuationKey = null;
function LDGetStandardPostTagsResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['p'] !== null && e['p'] !== undefined)) { 
        this.PostTags = [];
        var d = e['p'];
        for(var k = 0; k < d.length; ++k) this.PostTags.push(new LDPostTagWithLocalization(d[k]));
    }
}
LDGetStandardPostTagsResponse.prototype = new LDJSONLoggable();
LDGetStandardPostTagsResponse.prototype.constructor = LDGetStandardPostTagsResponse;
LDGetStandardPostTagsResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.PostTags !== null) { 
        o['p'] = [];
        var d = this.PostTags;
        for(var k = 0; k < d.length; ++k) o['p'].push(d[k].encode());
    } else {
        o['PostTags'] = null;
    }
    return o;
}
LDGetStandardPostTagsResponse.prototype.PostTags = null;
function LDGetFollowersResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['f'] !== null && e['f'] !== undefined)) { 
        this.Followers = [];
        var d = e['f'];
        for(var k = 0; k < d.length; ++k) this.Followers.push(new LDUser(d[k]));
    }
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContinuationKey = new Buffer(e['c'], 'base64');
}
LDGetFollowersResponse.prototype = new LDJSONLoggable();
LDGetFollowersResponse.prototype.constructor = LDGetFollowersResponse;
LDGetFollowersResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Followers !== null) { 
        o['f'] = [];
        var d = this.Followers;
        for(var k = 0; k < d.length; ++k) o['f'].push(d[k].encode());
    } else {
        o['Followers'] = null;
    }
    if(this.ContinuationKey !== null) o['c'] = this.ContinuationKey.toString('base64');
    return o;
}
LDGetFollowersResponse.prototype.Followers = null;
LDGetFollowersResponse.prototype.ContinuationKey = null;
function LDGetIdentityTokenResponse(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Token = e['t'];
    else
        this.Token = null;
}
LDGetIdentityTokenResponse.prototype = new LDJSONLoggable();
LDGetIdentityTokenResponse.prototype.constructor = LDGetIdentityTokenResponse;
LDGetIdentityTokenResponse.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Token !== null) o['t'] = this.Token;
    return o;
}
LDGetIdentityTokenResponse.prototype.Token = null;
function LDIdentity(e) { 
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Type = e['t'];
    else
        this.Type = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Principal = e['p'];
    else
        this.Principal = null;
}
LDIdentity.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Type !== null) o['t'] = this.Type;
    if(this.Principal !== null) o['p'] = this.Principal;
    return o;
}
LDIdentity.prototype.Type = null;
LDIdentity.prototype.Principal = null;
function LDAccountDetails(e) { 
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.Cluster = e['c'];
    else
        this.Cluster = null;
    if(e && (e['i'] !== null && e['i'] !== undefined)) { 
        this.Identities = [];
        var d = e['i'];
        for(var k = 0; k < d.length; ++k) this.Identities.push(new LDIdentity(d[k]));
    }
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.MigratedName = e['n'];
    else
        this.MigratedName = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.MigratedPictureLink = e['p'];
    else
        this.MigratedPictureLink = null;
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.MigratedCloudConfig = new LDCloudConfig(e['m']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.CreationTime = e['s'];
    else
        this.CreationTime = null;
}
LDAccountDetails.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Account !== null) o['a'] = this.Account;
    if(this.Cluster !== null) o['c'] = this.Cluster;
    if(this.Identities !== null) { 
        o['i'] = [];
        var d = this.Identities;
        for(var k = 0; k < d.length; ++k) o['i'].push(d[k].encode());
    } else {
        o['Identities'] = null;
    }
    if(this.MigratedName !== null) o['n'] = this.MigratedName;
    if(this.MigratedPictureLink !== null) o['p'] = this.MigratedPictureLink;
    if(this.MigratedCloudConfig !== null) o['m'] = this.MigratedCloudConfig.encode();
    if(this.CreationTime !== null) o['s'] = this.CreationTime;
    return o;
}
LDAccountDetails.prototype.Account = null;
LDAccountDetails.prototype.Cluster = null;
LDAccountDetails.prototype.Identities = null;
LDAccountDetails.prototype.MigratedName = null;
LDAccountDetails.prototype.MigratedPictureLink = null;
LDAccountDetails.prototype.MigratedCloudConfig = null;
LDAccountDetails.prototype.CreationTime = null;
function LDString(e) { 
}
LDString.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    return o;
}
function LDFlaggedDetails(e) { 
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['l'] !== null && e['l'] !== undefined)) { 
        this.Records = [];
        var d = e['l'];
        for(var k = 0; k < d.length; ++k) this.Records.push(new LDFlaggedRecord(d[k]));
    }
}
LDFlaggedDetails.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Account !== null) o['a'] = this.Account;
    if(this.Records !== null) { 
        o['l'] = [];
        var d = this.Records;
        for(var k = 0; k < d.length; ++k) o['l'].push(d[k].encode());
    } else {
        o['Records'] = null;
    }
    return o;
}
LDFlaggedDetails.prototype.Account = null;
LDFlaggedDetails.prototype.Records = null;
function LDFeed(e) { 
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Kind = e['t'];
    else
        this.Kind = null;
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.Key = new Buffer(e['k'], 'base64');
}
LDFeed.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Account !== null) o['a'] = this.Account;
    if(this.Kind !== null) o['t'] = this.Kind;
    if(this.Key !== null) o['k'] = this.Key.toString('base64');
    return o;
}
LDFeed.prototype.Account = null;
LDFeed.prototype.Kind = null;
LDFeed.prototype.Key = null;
function LDTypedId(e) { 
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Type = e['t'];
    else
        this.Type = null;
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = new Buffer(e['i'], 'base64');
}
LDTypedId.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Type !== null) o['t'] = this.Type;
    if(this.Id !== null) o['i'] = this.Id.toString('base64');
    return o;
}
LDTypedId.prototype.Type = null;
LDTypedId.prototype.Id = null;
function LDIdentityHash(e) { 
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Type = e['t'];
    else
        this.Type = null;
    if(e && (e['h'] !== null && e['h'] !== undefined))
        this.Hash = new Buffer(e['h'], 'base64');
}
LDIdentityHash.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Type !== null) o['t'] = this.Type;
    if(this.Hash !== null) o['h'] = this.Hash.toString('base64');
    return o;
}
LDIdentityHash.prototype.Type = null;
LDIdentityHash.prototype.Hash = null;
function LDMessage(e) { 
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = new LDTypedId(e['i']);
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Timestamp = e['t'];
    else
        this.Timestamp = null;
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Owner = e['s'];
    else
        this.Owner = null;
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.Body = new Buffer(e['b'], 'base64');
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.Metadata = new Buffer(e['m'], 'base64');
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.Version = e['v'];
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Deleted = e['d'];
    if(e && (e['di'] !== null && e['di'] !== undefined))
        this.DeviceId = new Buffer(e['di'], 'base64');
}
LDMessage.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Id !== null) o['i'] = this.Id.encode();
    if(this.Timestamp !== null) o['t'] = this.Timestamp;
    if(this.Owner !== null) o['s'] = this.Owner;
    if(this.Body !== null) o['b'] = this.Body.toString('base64');
    if(this.Metadata !== null) o['m'] = this.Metadata.toString('base64');
    if(this.Version !== null) o['v'] = this.Version;
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Deleted !== null) o['d'] = this.Deleted;
    if(this.DeviceId !== null) o['di'] = this.DeviceId.toString('base64');
    return o;
}
LDMessage.prototype.Id = null;
LDMessage.prototype.Timestamp = null;
LDMessage.prototype.Owner = null;
LDMessage.prototype.Body = null;
LDMessage.prototype.Metadata = null;
LDMessage.prototype.Version = null;
LDMessage.prototype.Feed = null;
LDMessage.prototype.Deleted = null;
LDMessage.prototype.DeviceId = null;
function LDRealtimeMessage(e) { 
    if(e && (e['T'] !== null && e['T'] !== undefined))
        this.Type = e['T'];
    else
        this.Type = null;
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Timestamp = e['t'];
    else
        this.Timestamp = null;
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Sender = e['s'];
    else
        this.Sender = null;
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.Body = new Buffer(e['b'], 'base64');
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
}
LDRealtimeMessage.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Type !== null) o['T'] = this.Type;
    if(this.Timestamp !== null) o['t'] = this.Timestamp;
    if(this.Sender !== null) o['s'] = this.Sender;
    if(this.Body !== null) o['b'] = this.Body.toString('base64');
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    return o;
}
LDRealtimeMessage.prototype.Type = null;
LDRealtimeMessage.prototype.Timestamp = null;
LDRealtimeMessage.prototype.Sender = null;
LDRealtimeMessage.prototype.Body = null;
LDRealtimeMessage.prototype.Feed = null;
function LDPushKey(e) { 
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Type = e['t'];
    else
        this.Type = null;
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.Key = e['k'];
    else
        this.Key = null;
}
LDPushKey.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Type !== null) o['t'] = this.Type;
    if(this.Key !== null) o['k'] = this.Key;
    return o;
}
LDPushKey.prototype.Type = null;
LDPushKey.prototype.Key = null;
function LDBlobMetadata(e) { 
    if(e && (e['h'] !== null && e['h'] !== undefined))
        this.Hash = new Buffer(e['h'], 'base64');
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Size = e['s'];
    else
        this.Size = null;
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.MimeType = e['m'];
    else
        this.MimeType = null;
}
LDBlobMetadata.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Hash !== null) o['h'] = this.Hash.toString('base64');
    if(this.Size !== null) o['s'] = this.Size;
    if(this.MimeType !== null) o['m'] = this.MimeType;
    return o;
}
LDBlobMetadata.prototype.Hash = null;
LDBlobMetadata.prototype.Size = null;
LDBlobMetadata.prototype.MimeType = null;
function LDBlobUploadTicket(e) { 
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.UploadUrl = e['u'];
    else
        this.UploadUrl = null;
    if(e && (e['h'] !== null && e['h'] !== undefined)) { 
        this.UploadHeaders = {};
        var d = e['h'];
        for(var k in d) this.UploadHeaders[k] = d[k];
    }
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.Cluster = e['c'];
    else
        this.Cluster = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.IsPermanent = e['p'];
    else
        this.IsPermanent = null;
    if(e && (e['prt'] !== null && e['prt'] !== undefined))
        this.PermanenceRefTag = new Buffer(e['prt'], 'base64');
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.AlreadyUploaded = e['a'];
    else
        this.AlreadyUploaded = null;
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.BlobLinkString = e['l'];
    else
        this.BlobLinkString = null;
}
LDBlobUploadTicket.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.UploadUrl !== null) o['u'] = this.UploadUrl;
    if(this.UploadHeaders !== null) { 
        o['h'] = {};
        var d = this.UploadHeaders;
        for(var k in d) o['h'][k] = d[k];
    } else {
        o['UploadHeaders'] = null;
    }
    if(this.Cluster !== null) o['c'] = this.Cluster;
    if(this.IsPermanent !== null) o['p'] = this.IsPermanent;
    if(this.PermanenceRefTag !== null) o['prt'] = this.PermanenceRefTag.toString('base64');
    if(this.AlreadyUploaded !== null) o['a'] = this.AlreadyUploaded;
    if(this.BlobLinkString !== null) o['l'] = this.BlobLinkString;
    return o;
}
LDBlobUploadTicket.prototype.UploadUrl = null;
LDBlobUploadTicket.prototype.UploadHeaders = null;
LDBlobUploadTicket.prototype.Cluster = null;
LDBlobUploadTicket.prototype.IsPermanent = null;
LDBlobUploadTicket.prototype.PermanenceRefTag = null;
LDBlobUploadTicket.prototype.AlreadyUploaded = null;
LDBlobUploadTicket.prototype.BlobLinkString = null;
function LDContactDetails(e) { 
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.Name = e['n'];
    else
        this.Name = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ProfilePictureLink = e['p'];
    else
        this.ProfilePictureLink = null;
    if(e && (e['D'] !== null && e['D'] !== undefined))
        this.ProfileDecryptedHash = new Buffer(e['D'], 'base64');
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.Version = e['v'];
    else
        this.Version = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Display = e['d'];
    else
        this.Display = null;
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.Blocked = e['b'];
    else
        this.Blocked = null;
    if(e && (e['wc'] !== null && e['wc'] !== undefined))
        this.WasContact = e['wc'];
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.HasAppTime = e['t'];
    if(e && (e['h'] !== null && e['h'] !== undefined)) { 
        this.Hashidentities = [];
        var d = e['h'];
        for(var k = 0; k < d.length; ++k) this.Hashidentities.push(new LDIdentityHash(d[k]));
    }
    if(e && (e['i'] !== null && e['i'] !== undefined)) { 
        this.Identities = [];
        var d = e['i'];
        for(var k = 0; k < d.length; ++k) this.Identities.push(new LDIdentity(d[k]));
    }
}
LDContactDetails.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Account !== null) o['a'] = this.Account;
    if(this.Name !== null) o['n'] = this.Name;
    if(this.ProfilePictureLink !== null) o['p'] = this.ProfilePictureLink;
    if(this.ProfileDecryptedHash !== null) o['D'] = this.ProfileDecryptedHash.toString('base64');
    if(this.Version !== null) o['v'] = this.Version;
    if(this.Display !== null) o['d'] = this.Display;
    if(this.Blocked !== null) o['b'] = this.Blocked;
    if(this.WasContact !== null) o['wc'] = this.WasContact;
    if(this.HasAppTime !== null) o['t'] = this.HasAppTime;
    if(this.Hashidentities !== null) { 
        o['h'] = [];
        var d = this.Hashidentities;
        for(var k = 0; k < d.length; ++k) o['h'].push(d[k].encode());
    } else {
        o['Hashidentities'] = null;
    }
    if(this.Identities !== null) { 
        o['i'] = [];
        var d = this.Identities;
        for(var k = 0; k < d.length; ++k) o['i'].push(d[k].encode());
    } else {
        o['Identities'] = null;
    }
    return o;
}
LDContactDetails.prototype.Account = null;
LDContactDetails.prototype.Name = null;
LDContactDetails.prototype.ProfilePictureLink = null;
LDContactDetails.prototype.ProfileDecryptedHash = null;
LDContactDetails.prototype.Version = null;
LDContactDetails.prototype.Display = null;
LDContactDetails.prototype.Blocked = null;
LDContactDetails.prototype.WasContact = null;
LDContactDetails.prototype.HasAppTime = null;
LDContactDetails.prototype.Hashidentities = null;
LDContactDetails.prototype.Identities = null;
function LDItemId(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['it'] !== null && e['it'] !== undefined))
        this.ItemType = e['it'];
    else
        this.ItemType = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.Creator = e['c'];
    else
        this.Creator = null;
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.GivenId = e['a'];
    else
        this.GivenId = null;
}
LDItemId.prototype = new LDJSONLoggable();
LDItemId.prototype.constructor = LDItemId;
LDItemId.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ItemType !== null) o['it'] = this.ItemType;
    if(this.Creator !== null) o['c'] = this.Creator;
    if(this.GivenId !== null) o['a'] = this.GivenId;
    return o;
}
LDItemId.prototype.ItemType = null;
LDItemId.prototype.Creator = null;
LDItemId.prototype.GivenId = null;
function LDPurchaseData(e) { 
    if(e && (e['rc'] !== null && e['rc'] !== undefined))
        this.ReceiptContainer = new LDReceiptContainer(e['rc']);
    if(e && (e['bic'] !== null && e['bic'] !== undefined))
        this.BillingInfoContainer = new LDBillingInfoContainer(e['bic']);
}
LDPurchaseData.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ReceiptContainer !== null) o['rc'] = this.ReceiptContainer.encode();
    if(this.BillingInfoContainer !== null) o['bic'] = this.BillingInfoContainer.encode();
    return o;
}
LDPurchaseData.prototype.ReceiptContainer = null;
LDPurchaseData.prototype.BillingInfoContainer = null;
function LDFeature(e) { 
    LDEnum.call(this, e);
}
LDFeature.prototype = new LDEnum();
LDFeature.prototype.constructor = LDFeature;
LDFeature.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDEnum.prototype.encode.call(this, o);
    return o;
}
function LDItemInfoUserMutableContainer(e) { 
    if(e && (e['ai'] !== null && e['ai'] !== undefined))
        this.AppInfoUserMutable = new LDAppInfoUserMutable(e['ai']);
    if(e && (e['si'] !== null && e['si'] !== undefined))
        this.StickerPackInfoUserMutable = new LDStickerPackInfoUserMutable(e['si']);
}
LDItemInfoUserMutableContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.AppInfoUserMutable !== null) o['ai'] = this.AppInfoUserMutable.encode();
    if(this.StickerPackInfoUserMutable !== null) o['si'] = this.StickerPackInfoUserMutable.encode();
    return o;
}
LDItemInfoUserMutableContainer.prototype.AppInfoUserMutable = null;
LDItemInfoUserMutableContainer.prototype.StickerPackInfoUserMutable = null;
function LDItemInfoSystemMutableContainer(e) { 
    if(e && (e['ai'] !== null && e['ai'] !== undefined))
        this.AppInfoSystemMutable = new LDAppInfoSystemMutable(e['ai']);
    if(e && (e['ii'] !== null && e['ii'] !== undefined))
        this.StickerPackInfoSystemMutable = new LDStickerPackInfoSystemMutable(e['ii']);
}
LDItemInfoSystemMutableContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.AppInfoSystemMutable !== null) o['ai'] = this.AppInfoSystemMutable.encode();
    if(this.StickerPackInfoSystemMutable !== null) o['ii'] = this.StickerPackInfoSystemMutable.encode();
    return o;
}
LDItemInfoSystemMutableContainer.prototype.AppInfoSystemMutable = null;
LDItemInfoSystemMutableContainer.prototype.StickerPackInfoSystemMutable = null;
function LDCloudConfig(e) { 
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Provider = e['p'];
    else
        this.Provider = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.Certificate = e['c'];
    else
        this.Certificate = null;
    if(e && (e['ct'] !== null && e['ct'] !== undefined))
        this.ConsumerToken = e['ct'];
    else
        this.ConsumerToken = null;
    if(e && (e['cs'] !== null && e['cs'] !== undefined))
        this.ConsumerSecret = e['cs'];
    else
        this.ConsumerSecret = null;
    if(e && (e['at'] !== null && e['at'] !== undefined))
        this.AccessToken = e['at'];
    else
        this.AccessToken = null;
    if(e && (e['as'] !== null && e['as'] !== undefined))
        this.AccessSecret = e['as'];
    else
        this.AccessSecret = null;
    if(e && (e['rt'] !== null && e['rt'] !== undefined))
        this.RefreshToken = e['rt'];
    else
        this.RefreshToken = null;
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.Expiration = e['e'];
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.BlobsFolder = e['f'];
    else
        this.BlobsFolder = null;
}
LDCloudConfig.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Provider !== null) o['p'] = this.Provider;
    if(this.Certificate !== null) o['c'] = this.Certificate;
    if(this.ConsumerToken !== null) o['ct'] = this.ConsumerToken;
    if(this.ConsumerSecret !== null) o['cs'] = this.ConsumerSecret;
    if(this.AccessToken !== null) o['at'] = this.AccessToken;
    if(this.AccessSecret !== null) o['as'] = this.AccessSecret;
    if(this.RefreshToken !== null) o['rt'] = this.RefreshToken;
    if(this.Expiration !== null) o['e'] = this.Expiration;
    if(this.BlobsFolder !== null) o['f'] = this.BlobsFolder;
    return o;
}
LDCloudConfig.prototype.Provider = null;
LDCloudConfig.prototype.Certificate = null;
LDCloudConfig.prototype.ConsumerToken = null;
LDCloudConfig.prototype.ConsumerSecret = null;
LDCloudConfig.prototype.AccessToken = null;
LDCloudConfig.prototype.AccessSecret = null;
LDCloudConfig.prototype.RefreshToken = null;
LDCloudConfig.prototype.Expiration = null;
LDCloudConfig.prototype.BlobsFolder = null;
function LDGameChallengeId(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = new Buffer(e['i'], 'base64');
}
LDGameChallengeId.prototype = new LDJSONLoggable();
LDGameChallengeId.prototype.constructor = LDGameChallengeId;
LDGameChallengeId.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Account !== null) o['a'] = this.Account;
    if(this.Id !== null) o['i'] = this.Id.toString('base64');
    return o;
}
LDGameChallengeId.prototype.Account = null;
LDGameChallengeId.prototype.Id = null;
function LDGPSLocation(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['x'] !== null && e['x'] !== undefined))
        this.Latitude = e['x'];
    else
        this.Latitude = null;
    if(e && (e['y'] !== null && e['y'] !== undefined))
        this.Longitude = e['y'];
    else
        this.Longitude = null;
}
LDGPSLocation.prototype = new LDJSONLoggable();
LDGPSLocation.prototype.constructor = LDGPSLocation;
LDGPSLocation.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Latitude !== null) o['x'] = this.Latitude;
    if(this.Longitude !== null) o['y'] = this.Longitude;
    return o;
}
LDGPSLocation.prototype.Latitude = null;
LDGPSLocation.prototype.Longitude = null;
function LDNearbyItemContainer(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.Broadcasted = e['b'];
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.Expiration = e['e'];
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.ItemType = e['t'];
    else
        this.ItemType = null;
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['fm'] !== null && e['fm'] !== undefined))
        this.FeedMetadata = new LDNearbyItemFeedMetadata(e['fm']);
}
LDNearbyItemContainer.prototype = new LDJSONLoggable();
LDNearbyItemContainer.prototype.constructor = LDNearbyItemContainer;
LDNearbyItemContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Broadcasted !== null) o['b'] = this.Broadcasted;
    if(this.Expiration !== null) o['e'] = this.Expiration;
    if(this.ItemType !== null) o['t'] = this.ItemType;
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.FeedMetadata !== null) o['fm'] = this.FeedMetadata.encode();
    return o;
}
LDNearbyItemContainer.prototype.Broadcasted = null;
LDNearbyItemContainer.prototype.Expiration = null;
LDNearbyItemContainer.prototype.ItemType = null;
LDNearbyItemContainer.prototype.Feed = null;
LDNearbyItemContainer.prototype.FeedMetadata = null;
function LDPostTag(e) { 
    if(e && (e['tt'] !== null && e['tt'] !== undefined))
        this.TagType = e['tt'];
    else
        this.TagType = null;
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Tag = e['t'];
    else
        this.Tag = null;
}
LDPostTag.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.TagType !== null) o['tt'] = this.TagType;
    if(this.Tag !== null) o['t'] = this.Tag;
    return o;
}
LDPostTag.prototype.TagType = null;
LDPostTag.prototype.Tag = null;
function LDPostId(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Poster = e['a'];
    else
        this.Poster = null;
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.PostId = new Buffer(e['id'], 'base64');
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.PostType = e['t'];
    else
        this.PostType = null;
}
LDPostId.prototype = new LDJSONLoggable();
LDPostId.prototype.constructor = LDPostId;
LDPostId.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Poster !== null) o['a'] = this.Poster;
    if(this.PostId !== null) o['id'] = this.PostId.toString('base64');
    if(this.PostType !== null) o['t'] = this.PostType;
    return o;
}
LDPostId.prototype.Poster = null;
LDPostId.prototype.PostId = null;
LDPostId.prototype.PostType = null;
function LDJoinFeedLink(e) { 
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Timestamp = e['t'];
    else
        this.Timestamp = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.Pin = e['p'];
    else
        this.Pin = null;
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.Url = e['l'];
    else
        this.Url = null;
}
LDJoinFeedLink.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Timestamp !== null) o['t'] = this.Timestamp;
    if(this.Pin !== null) o['p'] = this.Pin;
    if(this.Url !== null) o['l'] = this.Url;
    return o;
}
LDJoinFeedLink.prototype.Timestamp = null;
LDJoinFeedLink.prototype.Pin = null;
LDJoinFeedLink.prototype.Url = null;
function LDDirtyFeed(e) { 
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Feed = new LDFeed(e['f']);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Acceptance = e['a'];
    else
        this.Acceptance = null;
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.LastWriteTime = e['t'];
    else
        this.LastWriteTime = null;
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.LastRenderableTime = e['r'];
}
LDDirtyFeed.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Feed !== null) o['f'] = this.Feed.encode();
    if(this.Acceptance !== null) o['a'] = this.Acceptance;
    if(this.LastWriteTime !== null) o['t'] = this.LastWriteTime;
    if(this.LastRenderableTime !== null) o['r'] = this.LastRenderableTime;
    return o;
}
LDDirtyFeed.prototype.Feed = null;
LDDirtyFeed.prototype.Acceptance = null;
LDDirtyFeed.prototype.LastWriteTime = null;
LDDirtyFeed.prototype.LastRenderableTime = null;
function LDBlobDownloadTicket(e) { 
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.Url = e['u'];
    else
        this.Url = null;
    if(e && (e['h'] !== null && e['h'] !== undefined)) { 
        this.Headers = {};
        var d = e['h'];
        for(var k in d) this.Headers[k] = d[k];
    }
}
LDBlobDownloadTicket.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Url !== null) o['u'] = this.Url;
    if(this.Headers !== null) { 
        o['h'] = {};
        var d = this.Headers;
        for(var k in d) o['h'][k] = d[k];
    } else {
        o['Headers'] = null;
    }
    return o;
}
LDBlobDownloadTicket.prototype.Url = null;
LDBlobDownloadTicket.prototype.Headers = null;
function LDProfileDetails(e) { 
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.Name = e['n'];
    else
        this.Name = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ProfilePictureLink = e['p'];
    else
        this.ProfilePictureLink = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.ProfileDecryptedHash = new Buffer(e['d'], 'base64');
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.Version = e['v'];
    else
        this.Version = null;
    if(e && (e['i'] !== null && e['i'] !== undefined)) { 
        this.IdentitySettings = [];
        var d = e['i'];
        for(var k = 0; k < d.length; ++k) this.IdentitySettings.push(new LDProfileIdentitySetting(d[k]));
    }
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.HasAppTime = e['t'];
}
LDProfileDetails.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Name !== null) o['n'] = this.Name;
    if(this.ProfilePictureLink !== null) o['p'] = this.ProfilePictureLink;
    if(this.ProfileDecryptedHash !== null) o['d'] = this.ProfileDecryptedHash.toString('base64');
    if(this.Version !== null) o['v'] = this.Version;
    if(this.IdentitySettings !== null) { 
        o['i'] = [];
        var d = this.IdentitySettings;
        for(var k = 0; k < d.length; ++k) o['i'].push(d[k].encode());
    } else {
        o['IdentitySettings'] = null;
    }
    if(this.HasAppTime !== null) o['t'] = this.HasAppTime;
    return o;
}
LDProfileDetails.prototype.Name = null;
LDProfileDetails.prototype.ProfilePictureLink = null;
LDProfileDetails.prototype.ProfileDecryptedHash = null;
LDProfileDetails.prototype.Version = null;
LDProfileDetails.prototype.IdentitySettings = null;
LDProfileDetails.prototype.HasAppTime = null;
function LDProfilePublicState(e) { 
    if(e && (e['f'] !== null && e['f'] !== undefined)) { 
        this.Features = [];
        var d = e['f'];
        for(var k = 0; k < d.length; ++k) this.Features.push(d[k]);
    }
    if(e && (e['p'] !== null && e['p'] !== undefined)) { 
        this.Settings = {};
        var d = e['p'];
        for(var k in d) this.Settings[k] = new LDFeatureSetting(d[k]);
    }
}
LDProfilePublicState.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Features !== null) { 
        o['f'] = [];
        var d = this.Features;
        for(var k = 0; k < d.length; ++k) o['f'].push(d[k]);
    } else {
        o['Features'] = null;
    }
    if(this.Settings !== null) { 
        o['p'] = {};
        var d = this.Settings;
        for(var k in d) o['p'][k] = d[k].encode();
    } else {
        o['Settings'] = null;
    }
    return o;
}
LDProfilePublicState.prototype.Features = null;
LDProfilePublicState.prototype.Settings = null;
function LDItemInfoContainer(e) { 
    if(e && (e['ai'] !== null && e['ai'] !== undefined))
        this.AppInfo = new LDAppInfo(e['ai']);
    if(e && (e['si'] !== null && e['si'] !== undefined))
        this.StickerPackInfo = new LDStickerPackInfo(e['si']);
}
LDItemInfoContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.AppInfo !== null) o['ai'] = this.AppInfo.encode();
    if(this.StickerPackInfo !== null) o['si'] = this.StickerPackInfo.encode();
    return o;
}
LDItemInfoContainer.prototype.AppInfo = null;
LDItemInfoContainer.prototype.StickerPackInfo = null;
function LDItemInfoListingContainer(e) { 
    if(e && (e['ai'] !== null && e['ai'] !== undefined))
        this.AppInfoList = new LDAppInfoListingWrapper(e['ai']);
    if(e && (e['si'] !== null && e['si'] !== undefined))
        this.StickerPackInfoList = new LDStickerPackInfoListingWrapper(e['si']);
}
LDItemInfoListingContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.AppInfoList !== null) o['ai'] = this.AppInfoList.encode();
    if(this.StickerPackInfoList !== null) o['si'] = this.StickerPackInfoList.encode();
    return o;
}
LDItemInfoListingContainer.prototype.AppInfoList = null;
LDItemInfoListingContainer.prototype.StickerPackInfoList = null;
function LDApiKey(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['k'] !== null && e['k'] !== undefined))
        this.ClientApiKeyId = new Buffer(e['k'], 'base64');
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.ClientApiKeySecret = new Buffer(e['s'], 'base64');
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.CreationTime = e['t'];
    else
        this.CreationTime = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Deactivated = e['d'];
    else
        this.Deactivated = null;
}
LDApiKey.prototype = new LDJSONLoggable();
LDApiKey.prototype.constructor = LDApiKey;
LDApiKey.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.ClientApiKeyId !== null) o['k'] = this.ClientApiKeyId.toString('base64');
    if(this.ClientApiKeySecret !== null) o['s'] = this.ClientApiKeySecret.toString('base64');
    if(this.CreationTime !== null) o['t'] = this.CreationTime;
    if(this.Deactivated !== null) o['d'] = this.Deactivated;
    return o;
}
LDApiKey.prototype.ClientApiKeyId = null;
LDApiKey.prototype.ClientApiKeySecret = null;
LDApiKey.prototype.CreationTime = null;
LDApiKey.prototype.Deactivated = null;
function LDScoreBoardEntry(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.ProfileName = e['n'];
    else
        this.ProfileName = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ProfilePictureLink = e['p'];
    else
        this.ProfilePictureLink = null;
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Score = e['s'];
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.Rank = e['r'];
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.ProfileDecryptedHash = new Buffer(e['d'], 'base64');
}
LDScoreBoardEntry.prototype = new LDJSONLoggable();
LDScoreBoardEntry.prototype.constructor = LDScoreBoardEntry;
LDScoreBoardEntry.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Account !== null) o['a'] = this.Account;
    if(this.ProfileName !== null) o['n'] = this.ProfileName;
    if(this.ProfilePictureLink !== null) o['p'] = this.ProfilePictureLink;
    if(this.Score !== null) o['s'] = this.Score;
    if(this.Rank !== null) o['r'] = this.Rank;
    if(this.ProfileDecryptedHash !== null) o['d'] = this.ProfileDecryptedHash.toString('base64');
    return o;
}
LDScoreBoardEntry.prototype.Account = null;
LDScoreBoardEntry.prototype.ProfileName = null;
LDScoreBoardEntry.prototype.ProfilePictureLink = null;
LDScoreBoardEntry.prototype.Score = null;
LDScoreBoardEntry.prototype.Rank = null;
LDScoreBoardEntry.prototype.ProfileDecryptedHash = null;
function LDImageSearchResult(e) { 
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Title = e['t'];
    else
        this.Title = null;
    if(e && (e['w'] !== null && e['w'] !== undefined))
        this.Width = e['w'];
    else
        this.Width = null;
    if(e && (e['h'] !== null && e['h'] !== undefined))
        this.Height = e['h'];
    else
        this.Height = null;
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.ThumbnailUrl = e['s'];
    else
        this.ThumbnailUrl = null;
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.FullsizeUrl = e['f'];
    else
        this.FullsizeUrl = null;
    if(e && (e['S'] !== null && e['S'] !== undefined))
        this.FileSize = e['S'];
    else
        this.FileSize = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContentType = e['c'];
    else
        this.ContentType = null;
}
LDImageSearchResult.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Title !== null) o['t'] = this.Title;
    if(this.Width !== null) o['w'] = this.Width;
    if(this.Height !== null) o['h'] = this.Height;
    if(this.ThumbnailUrl !== null) o['s'] = this.ThumbnailUrl;
    if(this.FullsizeUrl !== null) o['f'] = this.FullsizeUrl;
    if(this.FileSize !== null) o['S'] = this.FileSize;
    if(this.ContentType !== null) o['c'] = this.ContentType;
    return o;
}
LDImageSearchResult.prototype.Title = null;
LDImageSearchResult.prototype.Width = null;
LDImageSearchResult.prototype.Height = null;
LDImageSearchResult.prototype.ThumbnailUrl = null;
LDImageSearchResult.prototype.FullsizeUrl = null;
LDImageSearchResult.prototype.FileSize = null;
LDImageSearchResult.prototype.ContentType = null;
function LDWall(e) { 
    if(e && (e['p'] !== null && e['p'] !== undefined)) { 
        this.Posts = [];
        var d = e['p'];
        for(var k = 0; k < d.length; ++k) this.Posts.push(new LDPostContainer(d[k]));
    }
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.ContinuationKey = new Buffer(e['c'], 'base64');
}
LDWall.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Posts !== null) { 
        o['p'] = [];
        var d = this.Posts;
        for(var k = 0; k < d.length; ++k) o['p'].push(d[k].encode());
    } else {
        o['Posts'] = null;
    }
    if(this.ContinuationKey !== null) o['c'] = this.ContinuationKey.toString('base64');
    return o;
}
LDWall.prototype.Posts = null;
LDWall.prototype.ContinuationKey = null;
function LDPostContainer(e) { 
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.VideoPost = new LDVideoPost(e['v']);
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.MessagePost = new LDMessagePost(e['m']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.ScreenShotPost = new LDScreenShotPost(e['s']);
}
LDPostContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.VideoPost !== null) o['v'] = this.VideoPost.encode();
    if(this.MessagePost !== null) o['m'] = this.MessagePost.encode();
    if(this.ScreenShotPost !== null) o['s'] = this.ScreenShotPost.encode();
    return o;
}
LDPostContainer.prototype.VideoPost = null;
LDPostContainer.prototype.MessagePost = null;
LDPostContainer.prototype.ScreenShotPost = null;
function LDUser(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['a'] !== null && e['a'] !== undefined))
        this.Account = e['a'];
    else
        this.Account = null;
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.DisplayName = e['n'];
    else
        this.DisplayName = null;
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.ProfilePictureLink = e['p'];
    else
        this.ProfilePictureLink = null;
}
LDUser.prototype = new LDJSONLoggable();
LDUser.prototype.constructor = LDUser;
LDUser.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.Account !== null) o['a'] = this.Account;
    if(this.DisplayName !== null) o['n'] = this.DisplayName;
    if(this.ProfilePictureLink !== null) o['p'] = this.ProfilePictureLink;
    return o;
}
LDUser.prototype.Account = null;
LDUser.prototype.DisplayName = null;
LDUser.prototype.ProfilePictureLink = null;
function LDPostTagWithLocalization(e) { 
    if(e && (e['pt'] !== null && e['pt'] !== undefined))
        this.PostTag = new LDPostTag(e['pt']);
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.Localization = e['l'];
    else
        this.Localization = null;
}
LDPostTagWithLocalization.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.PostTag !== null) o['pt'] = this.PostTag.encode();
    if(this.Localization !== null) o['l'] = this.Localization;
    return o;
}
LDPostTagWithLocalization.prototype.PostTag = null;
LDPostTagWithLocalization.prototype.Localization = null;
function LDFlaggedRecord(e) { 
    if(e && (e['w'] !== null && e['w'] !== undefined))
        this.Flagger = e['w'];
    else
        this.Flagger = null;
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.Reason = e['r'];
    else
        this.Reason = null;
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Timestamp = e['t'];
    else
        this.Timestamp = null;
}
LDFlaggedRecord.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Flagger !== null) o['w'] = this.Flagger;
    if(this.Reason !== null) o['r'] = this.Reason;
    if(this.Timestamp !== null) o['t'] = this.Timestamp;
    return o;
}
LDFlaggedRecord.prototype.Flagger = null;
LDFlaggedRecord.prototype.Reason = null;
LDFlaggedRecord.prototype.Timestamp = null;
function LDReceiptContainer(e) { 
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.MockReceipt = new LDMockReceipt(e['m']);
}
LDReceiptContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.MockReceipt !== null) o['m'] = this.MockReceipt.encode();
    return o;
}
LDReceiptContainer.prototype.MockReceipt = null;
function LDBillingInfoContainer(e) { 
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.MockBillingInfo = new LDMockBillingInfo(e['m']);
}
LDBillingInfoContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.MockBillingInfo !== null) o['m'] = this.MockBillingInfo.encode();
    return o;
}
LDBillingInfoContainer.prototype.MockBillingInfo = null;
function LDItemInfoUserMutable(e) { 
}
LDItemInfoUserMutable.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    return o;
}
function LDAppInfoUserMutable(e) { 
    LDItemInfoUserMutable.call(this, e);
    if(e && (e['ae'] !== null && e['ae'] !== undefined))
        this.AndroidEnabled = e['ae'];
    if(e && (e['adr'] !== null && e['adr'] !== undefined))
        this.AndroidDrawer = e['adr'];
    if(e && (e['aed'] !== null && e['aed'] !== undefined))
        this.AndroidEditor = e['aed'];
    if(e && (e['aga'] !== null && e['aga'] !== undefined))
        this.AndroidGame = e['aga'];
    if(e && (e['ie'] !== null && e['ie'] !== undefined))
        this.IOSEnabled = e['ie'];
    if(e && (e['idr'] !== null && e['idr'] !== undefined))
        this.IOSDrawer = e['idr'];
    else
        this.IOSDrawer = null;
    if(e && (e['ied'] !== null && e['ied'] !== undefined))
        this.IOSEditor = e['ied'];
    else
        this.IOSEditor = null;
    if(e && (e['iga'] !== null && e['iga'] !== undefined))
        this.IOSGame = e['iga'];
    else
        this.IOSGame = null;
    if(e && (e['we'] !== null && e['we'] !== undefined))
        this.WebEnabled = e['we'];
    if(e && (e['wdr'] !== null && e['wdr'] !== undefined))
        this.WebDrawer = e['wdr'];
    else
        this.WebDrawer = null;
    if(e && (e['wed'] !== null && e['wed'] !== undefined))
        this.WebEditor = e['wed'];
    else
        this.WebEditor = null;
    if(e && (e['wga'] !== null && e['wga'] !== undefined))
        this.WebGame = e['wga'];
    else
        this.WebGame = null;
    if(e && (e['sui'] !== null && e['sui'] !== undefined))
        this.IOSStoreUrl = e['sui'];
    else
        this.IOSStoreUrl = null;
    if(e && (e['sua'] !== null && e['sua'] !== undefined))
        this.AndroidStoreUrl = e['sua'];
    else
        this.AndroidStoreUrl = null;
    if(e && (e['suw'] !== null && e['suw'] !== undefined))
        this.WebUrl = e['suw'];
    else
        this.WebUrl = null;
    if(e && (e['icb'] !== null && e['icb'] !== undefined))
        this.IOSCallback = e['icb'];
    else
        this.IOSCallback = null;
    if(e && (e['apn'] !== null && e['apn'] !== undefined))
        this.AndroidPackageName = e['apn'];
    else
        this.AndroidPackageName = null;
    if(e && (e['ibls'] !== null && e['ibls'] !== undefined))
        this.IconBlobLinkString = e['ibls'];
    else
        this.IconBlobLinkString = null;
    if(e && (e['idh'] !== null && e['idh'] !== undefined))
        this.IconDecryptedHash = new Buffer(e['idh'], 'base64');
    if(e && (e['ssl'] !== null && e['ssl'] !== undefined)) { 
        this.ScreenShotsList = [];
        var d = e['ssl'];
        for(var k = 0; k < d.length; ++k) this.ScreenShotsList.push(new LDAppScreenshot(d[k]));
    }
    if(e && (e['asl'] !== null && e['asl'] !== undefined)) { 
        this.AppStoresList = [];
        var d = e['asl'];
        for(var k = 0; k < d.length; ++k) this.AppStoresList.push(new LDAppStore(d[k]));
    }
    if(e && (e['lc'] !== null && e['lc'] !== undefined))
        this.Languages = e['lc'];
    else
        this.Languages = null;
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.Name = e['n'];
    else
        this.Name = null;
    if(e && (e['nt'] !== null && e['nt'] !== undefined))
        this.NameTranslations = e['nt'];
    else
        this.NameTranslations = null;
    if(e && (e['ru'] !== null && e['ru'] !== undefined))
        this.RedirectUris = e['ru'];
    else
        this.RedirectUris = null;
    if(e && (e['vpru'] !== null && e['vpru'] !== undefined))
        this.VideoPostReportUri = e['vpru'];
    else
        this.VideoPostReportUri = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Description = e['d'];
    else
        this.Description = null;
    if(e && (e['dt'] !== null && e['dt'] !== undefined))
        this.DescriptionTranslations = e['dt'];
    else
        this.DescriptionTranslations = null;
}
LDAppInfoUserMutable.prototype = new LDItemInfoUserMutable();
LDAppInfoUserMutable.prototype.constructor = LDAppInfoUserMutable;
LDAppInfoUserMutable.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDItemInfoUserMutable.prototype.encode.call(this, o);
    if(this.AndroidEnabled !== null) o['ae'] = this.AndroidEnabled;
    if(this.AndroidDrawer !== null) o['adr'] = this.AndroidDrawer;
    if(this.AndroidEditor !== null) o['aed'] = this.AndroidEditor;
    if(this.AndroidGame !== null) o['aga'] = this.AndroidGame;
    if(this.IOSEnabled !== null) o['ie'] = this.IOSEnabled;
    if(this.IOSDrawer !== null) o['idr'] = this.IOSDrawer;
    if(this.IOSEditor !== null) o['ied'] = this.IOSEditor;
    if(this.IOSGame !== null) o['iga'] = this.IOSGame;
    if(this.WebEnabled !== null) o['we'] = this.WebEnabled;
    if(this.WebDrawer !== null) o['wdr'] = this.WebDrawer;
    if(this.WebEditor !== null) o['wed'] = this.WebEditor;
    if(this.WebGame !== null) o['wga'] = this.WebGame;
    if(this.IOSStoreUrl !== null) o['sui'] = this.IOSStoreUrl;
    if(this.AndroidStoreUrl !== null) o['sua'] = this.AndroidStoreUrl;
    if(this.WebUrl !== null) o['suw'] = this.WebUrl;
    if(this.IOSCallback !== null) o['icb'] = this.IOSCallback;
    if(this.AndroidPackageName !== null) o['apn'] = this.AndroidPackageName;
    if(this.IconBlobLinkString !== null) o['ibls'] = this.IconBlobLinkString;
    if(this.IconDecryptedHash !== null) o['idh'] = this.IconDecryptedHash.toString('base64');
    if(this.ScreenShotsList !== null) { 
        o['ssl'] = [];
        var d = this.ScreenShotsList;
        for(var k = 0; k < d.length; ++k) o['ssl'].push(d[k].encode());
    } else {
        o['ScreenShotsList'] = null;
    }
    if(this.AppStoresList !== null) { 
        o['asl'] = [];
        var d = this.AppStoresList;
        for(var k = 0; k < d.length; ++k) o['asl'].push(d[k].encode());
    } else {
        o['AppStoresList'] = null;
    }
    if(this.Languages !== null) o['lc'] = this.Languages;
    if(this.Name !== null) o['n'] = this.Name;
    if(this.NameTranslations !== null) o['nt'] = this.NameTranslations;
    if(this.RedirectUris !== null) o['ru'] = this.RedirectUris;
    if(this.VideoPostReportUri !== null) o['vpru'] = this.VideoPostReportUri;
    if(this.Description !== null) o['d'] = this.Description;
    if(this.DescriptionTranslations !== null) o['dt'] = this.DescriptionTranslations;
    return o;
}
LDAppInfoUserMutable.prototype.AndroidEnabled = null;
LDAppInfoUserMutable.prototype.AndroidDrawer = null;
LDAppInfoUserMutable.prototype.AndroidEditor = null;
LDAppInfoUserMutable.prototype.AndroidGame = null;
LDAppInfoUserMutable.prototype.IOSEnabled = null;
LDAppInfoUserMutable.prototype.IOSDrawer = null;
LDAppInfoUserMutable.prototype.IOSEditor = null;
LDAppInfoUserMutable.prototype.IOSGame = null;
LDAppInfoUserMutable.prototype.WebEnabled = null;
LDAppInfoUserMutable.prototype.WebDrawer = null;
LDAppInfoUserMutable.prototype.WebEditor = null;
LDAppInfoUserMutable.prototype.WebGame = null;
LDAppInfoUserMutable.prototype.IOSStoreUrl = null;
LDAppInfoUserMutable.prototype.AndroidStoreUrl = null;
LDAppInfoUserMutable.prototype.WebUrl = null;
LDAppInfoUserMutable.prototype.IOSCallback = null;
LDAppInfoUserMutable.prototype.AndroidPackageName = null;
LDAppInfoUserMutable.prototype.IconBlobLinkString = null;
LDAppInfoUserMutable.prototype.IconDecryptedHash = null;
LDAppInfoUserMutable.prototype.ScreenShotsList = null;
LDAppInfoUserMutable.prototype.AppStoresList = null;
LDAppInfoUserMutable.prototype.Languages = null;
LDAppInfoUserMutable.prototype.Name = null;
LDAppInfoUserMutable.prototype.NameTranslations = null;
LDAppInfoUserMutable.prototype.RedirectUris = null;
LDAppInfoUserMutable.prototype.VideoPostReportUri = null;
LDAppInfoUserMutable.prototype.Description = null;
LDAppInfoUserMutable.prototype.DescriptionTranslations = null;
function LDStickerPackInfoUserMutable(e) { 
    LDItemInfoUserMutable.call(this, e);
    if(e && (e['lc'] !== null && e['lc'] !== undefined))
        this.Languages = e['lc'];
    else
        this.Languages = null;
    if(e && (e['tg'] !== null && e['tg'] !== undefined)) { 
        this.Tags = [];
        var d = e['tg'];
        for(var k = 0; k < d.length; ++k) this.Tags.push(d[k]);
    }
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.Name = e['n'];
    else
        this.Name = null;
    if(e && (e['nt'] !== null && e['nt'] !== undefined)) { 
        this.NameTranslations = {};
        var d = e['nt'];
        for(var k in d) this.NameTranslations[k] = d[k];
    }
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Description = e['d'];
    else
        this.Description = null;
    if(e && (e['dt'] !== null && e['dt'] !== undefined)) { 
        this.DescriptionTranslations = {};
        var d = e['dt'];
        for(var k in d) this.DescriptionTranslations[k] = d[k];
    }
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.PortraitPreviewPackLink = e['p'];
    else
        this.PortraitPreviewPackLink = null;
    if(e && (e['pl'] !== null && e['pl'] !== undefined))
        this.LandscapePreviewPackLink = e['pl'];
    else
        this.LandscapePreviewPackLink = null;
    if(e && (e['pdh'] !== null && e['pdh'] !== undefined))
        this.PortraitEncryptedPreviewHash = new Buffer(e['pdh'], 'base64');
    if(e && (e['pdhl'] !== null && e['pdhl'] !== undefined))
        this.LandscapeEncryptedPreviewHash = new Buffer(e['pdhl'], 'base64');
    if(e && (e['s'] !== null && e['s'] !== undefined)) { 
        this.Stickers = [];
        var d = e['s'];
        for(var k = 0; k < d.length; ++k) this.Stickers.push(new LDSticker(d[k]));
    }
    if(e && (e['op'] !== null && e['op'] !== undefined))
        this.OriginalPublisher = e['op'];
    else
        this.OriginalPublisher = null;
}
LDStickerPackInfoUserMutable.prototype = new LDItemInfoUserMutable();
LDStickerPackInfoUserMutable.prototype.constructor = LDStickerPackInfoUserMutable;
LDStickerPackInfoUserMutable.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDItemInfoUserMutable.prototype.encode.call(this, o);
    if(this.Languages !== null) o['lc'] = this.Languages;
    if(this.Tags !== null) { 
        o['tg'] = [];
        var d = this.Tags;
        for(var k = 0; k < d.length; ++k) o['tg'].push(d[k]);
    } else {
        o['Tags'] = null;
    }
    if(this.Name !== null) o['n'] = this.Name;
    if(this.NameTranslations !== null) { 
        o['nt'] = {};
        var d = this.NameTranslations;
        for(var k in d) o['nt'][k] = d[k];
    } else {
        o['NameTranslations'] = null;
    }
    if(this.Description !== null) o['d'] = this.Description;
    if(this.DescriptionTranslations !== null) { 
        o['dt'] = {};
        var d = this.DescriptionTranslations;
        for(var k in d) o['dt'][k] = d[k];
    } else {
        o['DescriptionTranslations'] = null;
    }
    if(this.PortraitPreviewPackLink !== null) o['p'] = this.PortraitPreviewPackLink;
    if(this.LandscapePreviewPackLink !== null) o['pl'] = this.LandscapePreviewPackLink;
    if(this.PortraitEncryptedPreviewHash !== null) o['pdh'] = this.PortraitEncryptedPreviewHash.toString('base64');
    if(this.LandscapeEncryptedPreviewHash !== null) o['pdhl'] = this.LandscapeEncryptedPreviewHash.toString('base64');
    if(this.Stickers !== null) { 
        o['s'] = [];
        var d = this.Stickers;
        for(var k = 0; k < d.length; ++k) o['s'].push(d[k].encode());
    } else {
        o['Stickers'] = null;
    }
    if(this.OriginalPublisher !== null) o['op'] = this.OriginalPublisher;
    return o;
}
LDStickerPackInfoUserMutable.prototype.Languages = null;
LDStickerPackInfoUserMutable.prototype.Tags = null;
LDStickerPackInfoUserMutable.prototype.Name = null;
LDStickerPackInfoUserMutable.prototype.NameTranslations = null;
LDStickerPackInfoUserMutable.prototype.Description = null;
LDStickerPackInfoUserMutable.prototype.DescriptionTranslations = null;
LDStickerPackInfoUserMutable.prototype.PortraitPreviewPackLink = null;
LDStickerPackInfoUserMutable.prototype.LandscapePreviewPackLink = null;
LDStickerPackInfoUserMutable.prototype.PortraitEncryptedPreviewHash = null;
LDStickerPackInfoUserMutable.prototype.LandscapeEncryptedPreviewHash = null;
LDStickerPackInfoUserMutable.prototype.Stickers = null;
LDStickerPackInfoUserMutable.prototype.OriginalPublisher = null;
function LDItemInfoSystemMutable(e) { 
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.PublishedState = e['p'];
    else
        this.PublishedState = null;
    if(e && (e['ep'] !== null && e['ep'] !== undefined))
        this.WasEverPublished = e['ep'];
    if(e && (e['$'] !== null && e['$'] !== undefined))
        this.Price = new LDPrice(e['$']);
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.CreationTimestamp = e['c'];
    if(e && (e['m'] !== null && e['m'] !== undefined))
        this.LastModifiedTimestamp = e['m'];
}
LDItemInfoSystemMutable.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.PublishedState !== null) o['p'] = this.PublishedState;
    if(this.WasEverPublished !== null) o['ep'] = this.WasEverPublished;
    if(this.Price !== null) o['$'] = this.Price.encode();
    if(this.CreationTimestamp !== null) o['c'] = this.CreationTimestamp;
    if(this.LastModifiedTimestamp !== null) o['m'] = this.LastModifiedTimestamp;
    return o;
}
LDItemInfoSystemMutable.prototype.PublishedState = null;
LDItemInfoSystemMutable.prototype.WasEverPublished = null;
LDItemInfoSystemMutable.prototype.Price = null;
LDItemInfoSystemMutable.prototype.CreationTimestamp = null;
LDItemInfoSystemMutable.prototype.LastModifiedTimestamp = null;
function LDAppInfoSystemMutable(e) { 
    LDItemInfoSystemMutable.call(this, e);
}
LDAppInfoSystemMutable.prototype = new LDItemInfoSystemMutable();
LDAppInfoSystemMutable.prototype.constructor = LDAppInfoSystemMutable;
LDAppInfoSystemMutable.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDItemInfoSystemMutable.prototype.encode.call(this, o);
    return o;
}
function LDStickerPackInfoSystemMutable(e) { 
    LDItemInfoSystemMutable.call(this, e);
}
LDStickerPackInfoSystemMutable.prototype = new LDItemInfoSystemMutable();
LDStickerPackInfoSystemMutable.prototype.constructor = LDStickerPackInfoSystemMutable;
LDStickerPackInfoSystemMutable.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDItemInfoSystemMutable.prototype.encode.call(this, o);
    return o;
}
function LDNearbyItemFeedMetadata(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.FeedName = e['n'];
    else
        this.FeedName = null;
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.ThumbnailLink = e['t'];
    else
        this.ThumbnailLink = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.ThumbnailDecryptedHash = new Buffer(e['d'], 'base64');
    if(e && (e['p'] !== null && e['p'] !== undefined))
        this.RequiresPin = e['p'];
    else
        this.RequiresPin = null;
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.Latitude = e['l'];
    else
        this.Latitude = null;
    if(e && (e['g'] !== null && e['g'] !== undefined))
        this.Longitude = e['g'];
    else
        this.Longitude = null;
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.BroadcasterAccount = e['b'];
    else
        this.BroadcasterAccount = null;
}
LDNearbyItemFeedMetadata.prototype = new LDJSONLoggable();
LDNearbyItemFeedMetadata.prototype.constructor = LDNearbyItemFeedMetadata;
LDNearbyItemFeedMetadata.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.FeedName !== null) o['n'] = this.FeedName;
    if(this.ThumbnailLink !== null) o['t'] = this.ThumbnailLink;
    if(this.ThumbnailDecryptedHash !== null) o['d'] = this.ThumbnailDecryptedHash.toString('base64');
    if(this.RequiresPin !== null) o['p'] = this.RequiresPin;
    if(this.Latitude !== null) o['l'] = this.Latitude;
    if(this.Longitude !== null) o['g'] = this.Longitude;
    if(this.BroadcasterAccount !== null) o['b'] = this.BroadcasterAccount;
    return o;
}
LDNearbyItemFeedMetadata.prototype.FeedName = null;
LDNearbyItemFeedMetadata.prototype.ThumbnailLink = null;
LDNearbyItemFeedMetadata.prototype.ThumbnailDecryptedHash = null;
LDNearbyItemFeedMetadata.prototype.RequiresPin = null;
LDNearbyItemFeedMetadata.prototype.Latitude = null;
LDNearbyItemFeedMetadata.prototype.Longitude = null;
LDNearbyItemFeedMetadata.prototype.BroadcasterAccount = null;
function LDProfileIdentitySetting(e) { 
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Identity = new LDIdentity(e['i']);
}
LDProfileIdentitySetting.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Identity !== null) o['i'] = this.Identity.encode();
    return o;
}
LDProfileIdentitySetting.prototype.Identity = null;
function LDItemInfo(e) { 
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.ImmutableContainer = new LDItemInfoImmutableContainer(e['i']);
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.SystemMutableContainer = new LDItemInfoSystemMutableContainer(e['s']);
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.UserMutableContainer = new LDItemInfoUserMutableContainer(e['u']);
}
LDItemInfo.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ImmutableContainer !== null) o['i'] = this.ImmutableContainer.encode();
    if(this.SystemMutableContainer !== null) o['s'] = this.SystemMutableContainer.encode();
    if(this.UserMutableContainer !== null) o['u'] = this.UserMutableContainer.encode();
    return o;
}
LDItemInfo.prototype.ImmutableContainer = null;
LDItemInfo.prototype.SystemMutableContainer = null;
LDItemInfo.prototype.UserMutableContainer = null;
function LDAppInfo(e) { 
    LDItemInfo.call(this, e);
}
LDAppInfo.prototype = new LDItemInfo();
LDAppInfo.prototype.constructor = LDAppInfo;
LDAppInfo.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDItemInfo.prototype.encode.call(this, o);
    return o;
}
function LDStickerPackInfo(e) { 
    LDItemInfo.call(this, e);
}
LDStickerPackInfo.prototype = new LDItemInfo();
LDStickerPackInfo.prototype.constructor = LDStickerPackInfo;
LDStickerPackInfo.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDItemInfo.prototype.encode.call(this, o);
    return o;
}
function LDAppInfoListingWrapper(e) { 
    if(e && (e['i'] !== null && e['i'] !== undefined)) { 
        this.Items = [];
        var d = e['i'];
        for(var k = 0; k < d.length; ++k) this.Items.push(new LDAppInfo(d[k]));
    }
    if(e && (e['nt'] !== null && e['nt'] !== undefined))
        this.NextToken = new Buffer(e['nt'], 'base64');
}
LDAppInfoListingWrapper.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Items !== null) { 
        o['i'] = [];
        var d = this.Items;
        for(var k = 0; k < d.length; ++k) o['i'].push(d[k].encode());
    } else {
        o['Items'] = null;
    }
    if(this.NextToken !== null) o['nt'] = this.NextToken.toString('base64');
    return o;
}
LDAppInfoListingWrapper.prototype.Items = null;
LDAppInfoListingWrapper.prototype.NextToken = null;
function LDStickerPackInfoListingWrapper(e) { 
    if(e && (e['i'] !== null && e['i'] !== undefined)) { 
        this.Items = [];
        var d = e['i'];
        for(var k = 0; k < d.length; ++k) this.Items.push(new LDStickerPackInfo(d[k]));
    }
    if(e && (e['nt'] !== null && e['nt'] !== undefined))
        this.NextToken = new Buffer(e['nt'], 'base64');
}
LDStickerPackInfoListingWrapper.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Items !== null) { 
        o['i'] = [];
        var d = this.Items;
        for(var k = 0; k < d.length; ++k) o['i'].push(d[k].encode());
    } else {
        o['Items'] = null;
    }
    if(this.NextToken !== null) o['nt'] = this.NextToken.toString('base64');
    return o;
}
LDStickerPackInfoListingWrapper.prototype.Items = null;
LDStickerPackInfoListingWrapper.prototype.NextToken = null;
function LDPost(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.PostId = new LDPostId(e['id']);
    if(e && (e['ct'] !== null && e['ct'] !== undefined))
        this.CreationDate = e['ct'];
    else
        this.CreationDate = null;
    if(e && (e['t'] !== null && e['t'] !== undefined))
        this.Title = e['t'];
    else
        this.Title = null;
    if(e && (e['v'] !== null && e['v'] !== undefined))
        this.Views = e['v'];
    else
        this.Views = null;
    if(e && (e['l'] !== null && e['l'] !== undefined))
        this.Likes = e['l'];
    else
        this.Likes = null;
    if(e && (e['c'] !== null && e['c'] !== undefined)) { 
        this.Comments = [];
        var d = e['c'];
        for(var k = 0; k < d.length; ++k) this.Comments.push(new LDComment(d[k]));
    }
    if(e && (e['s'] !== null && e['s'] !== undefined))
        this.Score = e['s'];
    if(e && (e['g'] !== null && e['g'] !== undefined)) { 
        this.PostTags = [];
        var d = e['g'];
        for(var k = 0; k < d.length; ++k) this.PostTags.push(new LDPostTag(d[k]));
    }
    if(e && (e['un'] !== null && e['un'] !== undefined))
        this.PosterName = e['un'];
    else
        this.PosterName = null;
    if(e && (e['up'] !== null && e['up'] !== undefined))
        this.PosterProfilePictureLink = e['up'];
    else
        this.PosterProfilePictureLink = null;
    if(e && (e['oi'] !== null && e['oi'] !== undefined))
        this.OmletId = new LDIdentity(e['oi']);
    if(e && (e['yl'] !== null && e['yl'] !== undefined))
        this.YouLiked = e['yl'];
}
LDPost.prototype = new LDJSONLoggable();
LDPost.prototype.constructor = LDPost;
LDPost.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.PostId !== null) o['id'] = this.PostId.encode();
    if(this.CreationDate !== null) o['ct'] = this.CreationDate;
    if(this.Title !== null) o['t'] = this.Title;
    if(this.Views !== null) o['v'] = this.Views;
    if(this.Likes !== null) o['l'] = this.Likes;
    if(this.Comments !== null) { 
        o['c'] = [];
        var d = this.Comments;
        for(var k = 0; k < d.length; ++k) o['c'].push(d[k].encode());
    } else {
        o['Comments'] = null;
    }
    if(this.Score !== null) o['s'] = this.Score;
    if(this.PostTags !== null) { 
        o['g'] = [];
        var d = this.PostTags;
        for(var k = 0; k < d.length; ++k) o['g'].push(d[k].encode());
    } else {
        o['PostTags'] = null;
    }
    if(this.PosterName !== null) o['un'] = this.PosterName;
    if(this.PosterProfilePictureLink !== null) o['up'] = this.PosterProfilePictureLink;
    if(this.OmletId !== null) o['oi'] = this.OmletId.encode();
    if(this.YouLiked !== null) o['yl'] = this.YouLiked;
    return o;
}
LDPost.prototype.PostId = null;
LDPost.prototype.CreationDate = null;
LDPost.prototype.Title = null;
LDPost.prototype.Views = null;
LDPost.prototype.Likes = null;
LDPost.prototype.Comments = null;
LDPost.prototype.Score = null;
LDPost.prototype.PostTags = null;
LDPost.prototype.PosterName = null;
LDPost.prototype.PosterProfilePictureLink = null;
LDPost.prototype.OmletId = null;
LDPost.prototype.YouLiked = null;
function LDVideoPost(e) { 
    LDPost.call(this, e);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Description = e['d'];
    else
        this.Description = null;
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.BlobLinkString = e['b'];
    else
        this.BlobLinkString = null;
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.VideoBlobRefTag = new Buffer(e['r'], 'base64');
    if(e && (e['B'] !== null && e['B'] !== undefined))
        this.ThumbnailBlobLinkString = e['B'];
    else
        this.ThumbnailBlobLinkString = null;
    if(e && (e['h'] !== null && e['h'] !== undefined))
        this.HlsUrl = e['h'];
    else
        this.HlsUrl = null;
    if(e && (e['u'] !== null && e['u'] !== undefined))
        this.LinkUrl = e['u'];
    else
        this.LinkUrl = null;
    if(e && (e['m'] !== null && e['m'] !== undefined)) { 
        this.M3u8s = [];
        var d = e['m'];
        for(var k = 0; k < d.length; ++k) this.M3u8s.push(new LDM3U8Info(d[k]));
    }
    if(e && (e['H'] !== null && e['H'] !== undefined))
        this.Height = e['H'];
    if(e && (e['W'] !== null && e['W'] !== undefined))
        this.Width = e['W'];
}
LDVideoPost.prototype = new LDPost();
LDVideoPost.prototype.constructor = LDVideoPost;
LDVideoPost.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDPost.prototype.encode.call(this, o);
    if(this.Description !== null) o['d'] = this.Description;
    if(this.BlobLinkString !== null) o['b'] = this.BlobLinkString;
    if(this.VideoBlobRefTag !== null) o['r'] = this.VideoBlobRefTag.toString('base64');
    if(this.ThumbnailBlobLinkString !== null) o['B'] = this.ThumbnailBlobLinkString;
    if(this.HlsUrl !== null) o['h'] = this.HlsUrl;
    if(this.LinkUrl !== null) o['u'] = this.LinkUrl;
    if(this.M3u8s !== null) { 
        o['m'] = [];
        var d = this.M3u8s;
        for(var k = 0; k < d.length; ++k) o['m'].push(d[k].encode());
    } else {
        o['M3u8s'] = null;
    }
    if(this.Height !== null) o['H'] = this.Height;
    if(this.Width !== null) o['W'] = this.Width;
    return o;
}
LDVideoPost.prototype.Description = null;
LDVideoPost.prototype.BlobLinkString = null;
LDVideoPost.prototype.VideoBlobRefTag = null;
LDVideoPost.prototype.ThumbnailBlobLinkString = null;
LDVideoPost.prototype.HlsUrl = null;
LDVideoPost.prototype.LinkUrl = null;
LDVideoPost.prototype.M3u8s = null;
LDVideoPost.prototype.Height = null;
LDVideoPost.prototype.Width = null;
function LDMessagePost(e) { 
    LDPost.call(this, e);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Message = e['d'];
    else
        this.Message = null;
}
LDMessagePost.prototype = new LDPost();
LDMessagePost.prototype.constructor = LDMessagePost;
LDMessagePost.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDPost.prototype.encode.call(this, o);
    if(this.Message !== null) o['d'] = this.Message;
    return o;
}
LDMessagePost.prototype.Message = null;
function LDScreenShotPost(e) { 
    LDPost.call(this, e);
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Description = e['d'];
    else
        this.Description = null;
    if(e && (e['b'] !== null && e['b'] !== undefined))
        this.BlobLinkString = e['b'];
    else
        this.BlobLinkString = null;
    if(e && (e['tn'] !== null && e['tn'] !== undefined))
        this.ThumbnailLinkString = e['tn'];
    else
        this.ThumbnailLinkString = null;
}
LDScreenShotPost.prototype = new LDPost();
LDScreenShotPost.prototype.constructor = LDScreenShotPost;
LDScreenShotPost.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDPost.prototype.encode.call(this, o);
    if(this.Description !== null) o['d'] = this.Description;
    if(this.BlobLinkString !== null) o['b'] = this.BlobLinkString;
    if(this.ThumbnailLinkString !== null) o['tn'] = this.ThumbnailLinkString;
    return o;
}
LDScreenShotPost.prototype.Description = null;
LDScreenShotPost.prototype.BlobLinkString = null;
LDScreenShotPost.prototype.ThumbnailLinkString = null;
function LDMockReceipt(e) { 
    if(e && (e['j'] !== null && e['j'] !== undefined))
        this.Junk = new Buffer(e['j'], 'base64');
}
LDMockReceipt.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Junk !== null) o['j'] = this.Junk.toString('base64');
    return o;
}
LDMockReceipt.prototype.Junk = null;
function LDMockBillingInfo(e) { 
    if(e && (e['j'] !== null && e['j'] !== undefined))
        this.Junk = new Buffer(e['j'], 'base64');
}
LDMockBillingInfo.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Junk !== null) o['j'] = this.Junk.toString('base64');
    return o;
}
LDMockBillingInfo.prototype.Junk = null;
function LDAppScreenshot(e) { 
    if(e && (e['tb'] !== null && e['tb'] !== undefined))
        this.ThumbnailBlobLinkString = e['tb'];
    else
        this.ThumbnailBlobLinkString = null;
    if(e && (e['tdh'] !== null && e['tdh'] !== undefined))
        this.ThumbnailDecryptedHash = new Buffer(e['tdh'], 'base64');
    if(e && (e['fb'] !== null && e['fb'] !== undefined))
        this.FullsizeBlobLinkString = e['fb'];
    else
        this.FullsizeBlobLinkString = null;
    if(e && (e['fdh'] !== null && e['fdh'] !== undefined))
        this.FullsizeDecryptedHash = new Buffer(e['fdh'], 'base64');
}
LDAppScreenshot.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ThumbnailBlobLinkString !== null) o['tb'] = this.ThumbnailBlobLinkString;
    if(this.ThumbnailDecryptedHash !== null) o['tdh'] = this.ThumbnailDecryptedHash.toString('base64');
    if(this.FullsizeBlobLinkString !== null) o['fb'] = this.FullsizeBlobLinkString;
    if(this.FullsizeDecryptedHash !== null) o['fdh'] = this.FullsizeDecryptedHash.toString('base64');
    return o;
}
LDAppScreenshot.prototype.ThumbnailBlobLinkString = null;
LDAppScreenshot.prototype.ThumbnailDecryptedHash = null;
LDAppScreenshot.prototype.FullsizeBlobLinkString = null;
LDAppScreenshot.prototype.FullsizeDecryptedHash = null;
function LDAppStore(e) { 
    if(e && (e['e'] !== null && e['e'] !== undefined))
        this.PackageName = e['e'];
    else
        this.PackageName = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Url = e['d'];
    else
        this.Url = null;
}
LDAppStore.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.PackageName !== null) o['e'] = this.PackageName;
    if(this.Url !== null) o['d'] = this.Url;
    return o;
}
LDAppStore.prototype.PackageName = null;
LDAppStore.prototype.Url = null;
function LDSticker(e) { 
    if(e && (e['i'] !== null && e['i'] !== undefined))
        this.Id = e['i'];
    else
        this.Id = null;
    if(e && (e['w'] !== null && e['w'] !== undefined))
        this.Width = e['w'];
    else
        this.Width = null;
    if(e && (e['h'] !== null && e['h'] !== undefined))
        this.Height = e['h'];
    else
        this.Height = null;
    if(e && (e['tb'] !== null && e['tb'] !== undefined))
        this.ThumbnailBlobLinkString = e['tb'];
    else
        this.ThumbnailBlobLinkString = null;
    if(e && (e['tdh'] !== null && e['tdh'] !== undefined))
        this.ThumbnailDecryptedHash = new Buffer(e['tdh'], 'base64');
    if(e && (e['fb'] !== null && e['fb'] !== undefined))
        this.FullsizeBlobLinkString = e['fb'];
    else
        this.FullsizeBlobLinkString = null;
    if(e && (e['fdh'] !== null && e['fdh'] !== undefined))
        this.FullsizeDecryptedHash = new Buffer(e['fdh'], 'base64');
    if(e && (e['n'] !== null && e['n'] !== undefined))
        this.Name = e['n'];
    else
        this.Name = null;
    if(e && (e['d'] !== null && e['d'] !== undefined))
        this.Description = e['d'];
    else
        this.Description = null;
    if(e && (e['t'] !== null && e['t'] !== undefined)) { 
        this.Tags = [];
        var d = e['t'];
        for(var k = 0; k < d.length; ++k) this.Tags.push(d[k]);
    }
}
LDSticker.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Id !== null) o['i'] = this.Id;
    if(this.Width !== null) o['w'] = this.Width;
    if(this.Height !== null) o['h'] = this.Height;
    if(this.ThumbnailBlobLinkString !== null) o['tb'] = this.ThumbnailBlobLinkString;
    if(this.ThumbnailDecryptedHash !== null) o['tdh'] = this.ThumbnailDecryptedHash.toString('base64');
    if(this.FullsizeBlobLinkString !== null) o['fb'] = this.FullsizeBlobLinkString;
    if(this.FullsizeDecryptedHash !== null) o['fdh'] = this.FullsizeDecryptedHash.toString('base64');
    if(this.Name !== null) o['n'] = this.Name;
    if(this.Description !== null) o['d'] = this.Description;
    if(this.Tags !== null) { 
        o['t'] = [];
        var d = this.Tags;
        for(var k = 0; k < d.length; ++k) o['t'].push(d[k]);
    } else {
        o['Tags'] = null;
    }
    return o;
}
LDSticker.prototype.Id = null;
LDSticker.prototype.Width = null;
LDSticker.prototype.Height = null;
LDSticker.prototype.ThumbnailBlobLinkString = null;
LDSticker.prototype.ThumbnailDecryptedHash = null;
LDSticker.prototype.FullsizeBlobLinkString = null;
LDSticker.prototype.FullsizeDecryptedHash = null;
LDSticker.prototype.Name = null;
LDSticker.prototype.Description = null;
LDSticker.prototype.Tags = null;
function LDPrice(e) { 
    if(e && (e['f'] !== null && e['f'] !== undefined))
        this.Free = e['f'];
    else
        this.Free = null;
    if(e && (e['usd'] !== null && e['usd'] !== undefined))
        this.Usd = e['usd'];
    else
        this.Usd = null;
}
LDPrice.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Free !== null) o['f'] = this.Free;
    if(this.Usd !== null) o['usd'] = this.Usd;
    return o;
}
LDPrice.prototype.Free = null;
LDPrice.prototype.Usd = null;
function LDItemInfoImmutableContainer(e) { 
    if(e && (e['ai'] !== null && e['ai'] !== undefined))
        this.AppInfoImmutable = new LDAppInfoImmutable(e['ai']);
    if(e && (e['si'] !== null && e['si'] !== undefined))
        this.StickerPackInfoImmutable = new LDStickerPackInfoImmutable(e['si']);
}
LDItemInfoImmutableContainer.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.AppInfoImmutable !== null) o['ai'] = this.AppInfoImmutable.encode();
    if(this.StickerPackInfoImmutable !== null) o['si'] = this.StickerPackInfoImmutable.encode();
    return o;
}
LDItemInfoImmutableContainer.prototype.AppInfoImmutable = null;
LDItemInfoImmutableContainer.prototype.StickerPackInfoImmutable = null;
function LDComment(e) { 
    if(e && (e['ct'] !== null && e['ct'] !== undefined))
        this.Commenter = e['ct'];
    else
        this.Commenter = null;
    if(e && (e['c'] !== null && e['c'] !== undefined))
        this.Comment = new Buffer(e['c'], 'base64');
}
LDComment.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.Commenter !== null) o['ct'] = this.Commenter;
    if(this.Comment !== null) o['c'] = this.Comment.toString('base64');
    return o;
}
LDComment.prototype.Commenter = null;
LDComment.prototype.Comment = null;
function LDM3U8Info(e) { 
    LDJSONLoggable.call(this, e);
    if(e && (e['r'] !== null && e['r'] !== undefined))
        this.BitRate = e['r'];
    else
        this.BitRate = null;
    if(e && (e['h'] !== null && e['h'] !== undefined)) { 
        this.Headers = [];
        var d = e['h'];
        for(var k = 0; k < d.length; ++k) this.Headers.push(d[k]);
    }
    if(e && (e['t'] !== null && e['t'] !== undefined)) { 
        this.Duration = [];
        var d = e['t'];
        for(var k = 0; k < d.length; ++k) this.Duration.push(d[k]);
    }
    if(e && (e['b'] !== null && e['b'] !== undefined)) { 
        this.File = [];
        var d = e['b'];
        for(var k = 0; k < d.length; ++k) this.File.push(d[k]);
    }
}
LDM3U8Info.prototype = new LDJSONLoggable();
LDM3U8Info.prototype.constructor = LDM3U8Info;
LDM3U8Info.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDJSONLoggable.prototype.encode.call(this, o);
    if(this.BitRate !== null) o['r'] = this.BitRate;
    if(this.Headers !== null) { 
        o['h'] = [];
        var d = this.Headers;
        for(var k = 0; k < d.length; ++k) o['h'].push(d[k]);
    } else {
        o['Headers'] = null;
    }
    if(this.Duration !== null) { 
        o['t'] = [];
        var d = this.Duration;
        for(var k = 0; k < d.length; ++k) o['t'].push(d[k]);
    } else {
        o['Duration'] = null;
    }
    if(this.File !== null) { 
        o['b'] = [];
        var d = this.File;
        for(var k = 0; k < d.length; ++k) o['b'].push(d[k]);
    } else {
        o['File'] = null;
    }
    return o;
}
LDM3U8Info.prototype.BitRate = null;
LDM3U8Info.prototype.Headers = null;
LDM3U8Info.prototype.Duration = null;
LDM3U8Info.prototype.File = null;
function LDItemInfoImmutable(e) { 
    if(e && (e['id'] !== null && e['id'] !== undefined))
        this.ItemId = new LDItemId(e['id']);
}
LDItemInfoImmutable.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    if(this.ItemId !== null) o['id'] = this.ItemId.encode();
    return o;
}
LDItemInfoImmutable.prototype.ItemId = null;
function LDAppInfoImmutable(e) { 
    LDItemInfoImmutable.call(this, e);
}
LDAppInfoImmutable.prototype = new LDItemInfoImmutable();
LDAppInfoImmutable.prototype.constructor = LDAppInfoImmutable;
LDAppInfoImmutable.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDItemInfoImmutable.prototype.encode.call(this, o);
    return o;
}
function LDStickerPackInfoImmutable(e) { 
    LDItemInfoImmutable.call(this, e);
}
LDStickerPackInfoImmutable.prototype = new LDItemInfoImmutable();
LDStickerPackInfoImmutable.prototype.constructor = LDStickerPackInfoImmutable;
LDStickerPackInfoImmutable.prototype.encode = function (o) { 
    if(o === undefined) o = {};
    LDItemInfoImmutable.prototype.encode.call(this, o);
    return o;
}
LDUnlinkIdentityRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpSignupRequestProtocol();
    t.UnlinkIdentityRequest = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Signup = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDRegisterWithTokenRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpSignupRequestProtocol();
    t.RegisterWithTokenRequest = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Signup = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDLogUserOutRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpAdministrativeRequestProtocol();
    t.LogUserOut = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Administrative = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSubscribeFeedRealtimeRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.SubscribeFeedRealtime = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetLinkedIdentitiesRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpSignupRequestProtocol();
    t.GetLinkedIdentitiesRequest = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Signup = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDCreatePlaygroundRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMiscellaneousRequestProtocol();
    t.CreatePlaygroundRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Misc = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDRemoveFeaturesFromProfileRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterProfileRequestProtocol();
    t.RemoveFeaturesFromProfileRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Profile = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDDeletePostRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.DeletePostRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDFlagUserRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMiscellaneousRequestProtocol();
    t.FlagUser = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Misc = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetPostRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.GetPost = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDCreateItemInfoRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.CreateItemInfoRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetIdentityTokenRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterIdentityTokenRequestProtocol();
    t.GetIdentityTokenRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.IdentityToken = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSetSmsParticipationRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterDirectMessagingRequestProtocol();
    t.SetSmsParticipationRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Oob = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDHelloChallengeRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterRequestContainer();
    t.HelloChallenge = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDHelloChallengeRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpRequestContainer();
    t.HelloChallenge = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDCompleteChallengeRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpRequestContainer();
    t.CompleteChallenge = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDCompleteChallengeRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterRequestContainer();
    t.CompleteChallenge = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDBlockContactRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterContactRequestProtocol();
    t.BlockContactRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Contact = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDRemovePendingInvitationRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.RemovePendingInvitation = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDListItemsForAccountRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.ListItemsForAccountRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSetFeedThumbnailRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.SetFeedThumbnail = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDCreateSubscriptionRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterSubscriptionRequestProtocol();
    t.GetSubscriptionUrl = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Subscription = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDFindGamersRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterGameChallengeRequestProtocol();
    t.FindGamers = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.GameChallenge = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetDeviceRecordsRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpAdministrativeRequestProtocol();
    t.GetDeviceRecords = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Administrative = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetMessageByIdRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.GetMessageById = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetFeedbackAccountRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMiscellaneousRequestProtocol();
    t.GetFeedbackAccount = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Misc = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetMessagesBeforeRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.GetMessagesBefore = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSendDirectMessageRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterDirectMessagingRequestProtocol();
    t.SendSmsMessageRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Oob = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSetAppleBadgeCountRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterInboxRequestProtocol();
    t.SetAppleBadgeCount = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Inbox = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDOptInForGSChallengesRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterGameChallengeRequestProtocol();
    t.OptInForGSChallengesRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.GameChallenge = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDFetchNearbyItemsRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterNearbyItemRequestProtocol();
    t.FetchNearbyItemsRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.NearbyItem = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetMessagesSinceRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.GetMessagesSince = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetContactProfileRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterAddressBookRequestProtocol();
    t.GetContactProfileRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.AddressBook = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetFollowingWallRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.GetFollowingWall = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetFeedStateRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterInboxRequestProtocol();
    t.GetFeedState = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Inbox = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDRemoveItemsFromProfileRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterProfileRequestProtocol();
    t.RemoveItemsFromProfileRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Profile = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSetFeedAcceptanceRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterInboxRequestProtocol();
    t.SetFeedAcceptance = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Inbox = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDChangeUserNameRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpAdministrativeRequestProtocol();
    t.ChangeUserName = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Administrative = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetDirectFeedRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterDirectMessagingRequestProtocol();
    t.GetSmsFeedRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Oob = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetEmailLoginLinkRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpAdministrativeRequestProtocol();
    t.GetEmailLoginLink = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Administrative = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDAddPendingInvitationRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.AddPendingInvitation = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetPublicFeedDetailsRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.GetFeedDetails = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSetFeedNameRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.SetFeedName = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetMultipartUploadTicketRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDClusterOrDeviceToClusterBlobRequestProtocol();
    t.GetMultipartUploadTicket = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Blob = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGameChallengeCompleteRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterGameChallengeRequestProtocol();
    t.GameChallengeComplete = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.GameChallenge = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDCheckAccountOptedInRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterGameChallengeRequestProtocol();
    t.CheckAccountOptedIn = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.GameChallenge = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetHighScoreRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterHighScoreRequestProtocol();
    t.GetHighScoreRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.HighScore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetAddMeLinkRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterAddressBookRequestProtocol();
    t.GetAddMeLinkRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.AddressBook = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDListAllItemsRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.ListAllItemsRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDListPublishedItemsRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.ListPublishedItemsRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDRegisterPushNotificationKeyRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterInboxRequestProtocol();
    t.RegisterPushNotificationKey = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Inbox = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetAccountsFollowedRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.GetAccountsFollowedRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUnsubscribeFeedRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.UnsubscribeFeed = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDReportScoreRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterHighScoreRequestProtocol();
    t.ReportScoreRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.HighScore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUploadAddressBookEntriesRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterAddressBookRequestProtocol();
    t.UploadEntriesRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.AddressBook = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGenerateApiKeyRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.GenerateApiKeyRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDConfirmAuthCodeRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpSignupRequestProtocol();
    t.ConfirmAuthCodeRequest = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Signup = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetUserWallRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.GetUserWall = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDDeactivateApiKeyRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.DeactivateApiKeyRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUnsubscribeForNearbyItemsRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterNearbyItemRequestProtocol();
    t.UnsubscribeForNearbyItemsRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.NearbyItem = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetStandardPostTagsRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.GetStandardPostTags = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetDirtyFeedsRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterInboxRequestProtocol();
    t.GetDirtyFeeds = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Inbox = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDCheckIdentityLinkedRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpSignupRequestProtocol();
    t.CheckLinkedIdentityRequest = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Signup = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDPublishItemRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.PublishItemRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDAddDeviceRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterDeviceRequestProtocol();
    t.AddDeviceRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Device = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGenerateGrantForItemRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.GenerateGrantForItemRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetExtraVersionsRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMiscellaneousRequestProtocol();
    t.GetExtraVersions = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Misc = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetIdentityRecordsRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpAdministrativeRequestProtocol();
    t.GetIdentityRecordsRequest = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Administrative = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSetDefaultAccessRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.DefaultAccess = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetJoinFeedLinkRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.GetJoinFeedLink = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDConfirmTokenRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpSignupRequestProtocol();
    t.ConfirmTokenRequest = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Signup = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDLikePostRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.LikePost = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUnsubscribeFeedRealtimeRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.UnsubscribeFeedRealtime = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetProfileDetailsRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterProfileRequestProtocol();
    t.GetProfileDetailsRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Profile = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDAddFeaturesToProfileRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterProfileRequestProtocol();
    t.AddFeaturesToProfileRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Profile = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUrlToStoryRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMiscellaneousRequestProtocol();
    t.UrlToStoryRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Misc = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDReviewItemRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.ReviewItemRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDJoinFeedRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.JoinFeed = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDOverwriteContactRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterContactRequestProtocol();
    t.OverwriteContactsRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Contact = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSubscribeForAccountInboxRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterInboxRequestProtocol();
    t.SubscribeAccount = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Inbox = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDAddViewRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.AddVideoView = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDPingRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpRequestContainer();
    t.Ping = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDPingRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterRequestContainer();
    t.Ping = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUnblockContactRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterContactRequestProtocol();
    t.UnblockContactRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Contact = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetItemUsingGrantRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.GetItemUsingGrantRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetAppSigninLinkRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpSignupRequestProtocol();
    t.GetAppSigninLinkRequest = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Signup = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetFollowersRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.GetFollowers = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDListApiKeysRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.ListApiKeysRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetProfilePublicStateRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterProfileRequestProtocol();
    t.GetProfilePublicStateRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Profile = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUserUpdateItemInfoRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.UserUpdateItemInfoRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDPostVideoRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.PostVideo = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDFailureReportRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMiscellaneousRequestProtocol();
    t.FailureReport = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Misc = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSetProfileNameRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterProfileRequestProtocol();
    t.SetNameRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Profile = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDChangeUserProfilePictureRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpAdministrativeRequestProtocol();
    t.ChangeUserPicture = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Administrative = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetContactProfileAndPublicStateRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterProfileRequestProtocol();
    t.GetProfileDetailsAndPublicStateRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Profile = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUpdateMessageRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.UpdateMessage = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSubscribeFeedRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.SubscribeFeed = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDRegisterWithOAuthRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpSignupRequestProtocol();
    t.RegisterWithOAuthRequest = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Signup = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDRemoveMemberRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.RemoveMember = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDFollowUserRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.FollowUser = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSystemUpdateItemInfoRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.SystemUpdateItemInfoRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetOmletContactProfileRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterProfileRequestProtocol();
    t.GetContactProfileRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Profile = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDOptInForAllGamesChallengesRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterGameChallengeRequestProtocol();
    t.OptInForAllGamesChallengesRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.GameChallenge = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSetDingTimeoutRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterDeviceRequestProtocol();
    t.SetDingTimeoutRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Device = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUnbroadcastItemRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterNearbyItemRequestProtocol();
    t.UnbroadcastItemRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.NearbyItem = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetGameWallRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.GetGameWall = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetDownloadTicketRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDClusterOrDeviceToClusterBlobRequestProtocol();
    t.GetDownloadTicket = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Blob = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDRemoveContactRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterContactRequestProtocol();
    t.RemoveContactRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Contact = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDDeleteItemRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.DeleteItemRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDDisableUserGameChallengeRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpAdministrativeRequestProtocol();
    t.DisableGameChallenge = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Administrative = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDRefreshCloudConfigRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterCloudSyncRequestProtocol();
    t.RefreshCloudConfigRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.CloudSync = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDDisconnectCloudSyncRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterCloudSyncRequestProtocol();
    t.DisconnectCloudSyncRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.CloudSync = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDDeleteGrantForItemRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.DeleteGrantForItemRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDPostScreenShotRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.PostScreenShot = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDCreateFeedRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.CreateFeed = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDDeleteMessageRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.DeleteMessage = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSetCloudConfigRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterCloudSyncRequestProtocol();
    t.SetCloudConfigRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.CloudSync = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetAccountDetailsByIdentityRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpAdministrativeRequestProtocol();
    t.GetDetailsByIdentity = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Administrative = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetTopScoresRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterHighScoreRequestProtocol();
    t.GetTopScoresRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.HighScore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDFindGamersGSRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterGameChallengeRequestProtocol();
    t.FindGamersGSRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.GameChallenge = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSetProfilePictureRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterProfileRequestProtocol();
    t.SetProfilePictureRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Profile = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDDoesItemHaveGrantRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.DoesItemHaveGrantRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDPostMessageRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterWallPostRequestProtocol();
    t.PostMessage = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.WallPost = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDAddMemberRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.AddMember = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDBroadcastItemRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterNearbyItemRequestProtocol();
    t.BroadcastItemRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.NearbyItem = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDDeleteDeviceRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterDeviceRequestProtocol();
    t.DeleteDeviceRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Device = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDOverwriteMessageRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.OverwriteMessage = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUnpublishItemRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.UnpublishItemRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetAccountDetailsByAccountRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpAdministrativeRequestProtocol();
    t.GetDetailsByAccount = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Administrative = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDApplyDocumentTransformRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.ApplyDocumentRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDJoinBroadcastRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.JoinBroadcast = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSubscribeForNearbyItemsRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterNearbyItemRequestProtocol();
    t.SubscribeForNearbyItemsRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.NearbyItem = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDListFlaggedUsersRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpAdministrativeRequestProtocol();
    t.ListFlaggedUsers = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Administrative = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDVerifyExistsAndPermanenceRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDClusterOrDeviceToClusterBlobRequestProtocol();
    t.VerifyExistsAndPermanence = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Blob = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetUploadTicketRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDClusterOrDeviceToClusterBlobRequestProtocol();
    t.GetUploadTicket = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Blob = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetMessagesByTypeRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.GetMessagesByType = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDImageSearchRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMiscellaneousRequestProtocol();
    t.ImageSearchRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Misc = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetItemInfoRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterOmletItemStoreRequestProtocol();
    t.GetItemInfoRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.OmletAppStore = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUnblockIdentityRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpAdministrativeRequestProtocol();
    t.UnblockIdentity = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Administrative = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDGetCloudConfigRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterCloudSyncRequestProtocol();
    t.GetCloudConfigRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.CloudSync = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDLinkOmletIdentityRequest.prototype.makeIdpRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToIdpSignupRequestProtocol();
    t.LinkOmletIdentityRequest = o;
    o = t;
    t = new LDDeviceToIdpRequestContainer();
    t.Signup = o;
    o = t;
    t = new LDDeviceToIdpRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDSendRealtimeRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.SendRealtime = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDAddItemsToProfileRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterProfileRequestProtocol();
    t.AddItemsToProfileRequest = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Profile = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDVerifyUploadCompletedRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDClusterOrDeviceToClusterBlobRequestProtocol();
    t.VerifyUploadCompleted = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Blob = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUnsubscribeForAccountInboxRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterInboxRequestProtocol();
    t.UnsubscribeAccount = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Inbox = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDUpdateChallengeLocationRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterGameChallengeRequestProtocol();
    t.UpdateChallengeLocation = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.GameChallenge = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDMutualAddContactByTokenRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterAddressBookRequestProtocol();
    t.MutualAddContact = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.AddressBook = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDAddMessageRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterMessageRequestProtocol();
    t.AddMessage = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.Message = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
LDExtendChallengeRequest.prototype.makeClusterRpc = function (o) {
    var o = this, t = null;
    t = new LDDeviceToClusterGameChallengeRequestProtocol();
    t.GameChallenge = o;
    o = t;
    t = new LDDeviceToClusterRequestContainer();
    t.GameChallenge = o;
    o = t;
    t = new LDDeviceToClusterRpcWrapper();
    t.Request = o;
    o = t;
    return o;
}
var LDApiCode = {}
LDApiCode.InvalidFeedId = "InvalidFeedId";
LDApiCode.FeedDoesNotHaveProperties = "FeedDoesNotHaveProperties";
LDApiCode.DeviceMustBeRegistered = "DeviceMustBeRegistered";
LDApiCode.MustSpecifyValidIdentity = "MustSpecifyValidIdentity";
LDApiCode.OwnerCannotLosePrivilege = "OwnerCannotLosePrivilege";
LDApiCode.BadAuthentication = "BadAuthentication";
LDApiCode.InvalidToken = "InvalidToken";
LDApiCode.InvalidIdentityType = "InvalidIdentityType";
LDApiCode.UnexpectedFieldsInObjData = "UnexpectedFieldsInObjData";
LDApiCode.UnknownError = "UnknownError";
LDApiCode.MissingFieldsInRequest = "MissingFieldsInRequest";
LDApiCode.RedirectURIMismatch = "RedirectURIMismatch";
LDApiCode.IdentityNotLinkedToDevice = "IdentityNotLinkedToDevice";
LDApiCode.BadFeedState = "BadFeedState";
LDApiCode.DocumentChangeRejected = "DocumentChangeRejected";
LDApiCode.BadDocumentKeyFormat = "BadDocumentKeyFormat";
LDApiCode.ScriptTimeoutException = "ScriptTimeoutException";
LDApiCode.MessageAlreadyExists = "MessageAlreadyExists";
LDApiCode.MessageDoesNotExist = "MessageDoesNotExist";
LDApiCode.MessageVersionMismatch = "MessageVersionMismatch";
LDApiCode.MessageNotWritable = "MessageNotWritable";
LDApiCode.MustRespondToChallenge = "MustRespondToChallenge";
LDApiCode.MustHello = "MustHello";
LDApiCode.BadPushResponseId = "BadPushResponseId";
LDApiCode.BadRequestId = "BadRequestId";
LDApiCode.UnknownRequestType = "UnknownRequestType";
LDApiCode.UnknownSourceCluster = "UnknownSourceCluster";
LDApiCode.ChallengeTooSmall = "ChallengeTooSmall";
LDApiCode.AccountMismatch = "AccountMismatch";
LDApiCode.BadPushRequestId = "BadPushRequestId";
LDApiCode.BadResponseId = "BadResponseId";
LDApiCode.AccountNotMappedToCluster = "AccountNotMappedToCluster";
LDApiCode.ImplementationFailure = "ImplementationFailure";
LDApiCode.UnknownResponseType = "UnknownResponseType";
LDApiCode.UnknownPushType = "UnknownPushType";
LDApiCode.OperationNotAllowedCrossCluster = "OperationNotAllowedCrossCluster";
LDApiCode.OperationOnlyAllowedCrossCluster = "OperationOnlyAllowedCrossCluster";
LDApiCode.OperationNotAllowedByClient = "OperationNotAllowedByClient";
LDApiCode.WrongClusterSource = "WrongClusterSource";
LDApiCode.OperationNotAllowedCrossNode = "OperationNotAllowedCrossNode";
LDApiCode.DeviceAlreadyAssociated = "DeviceAlreadyAssociated";
LDApiCode.TokenAuthBlocked = "TokenAuthBlocked";
LDApiCode.DeviceNotFound = "DeviceNotFound";
LDApiCode.AccountNotFound = "AccountNotFound";
LDApiCode.TokenCannotBeDelivered = "TokenCannotBeDelivered";
LDApiCode.InvalidIdpCaller = "InvalidIdpCaller";
LDApiCode.InvalidDeliveryInterest = "InvalidDeliveryInterest";
LDApiCode.IdentityMismatch = "IdentityMismatch";
LDApiCode.UnknownServiceType = "UnknownServiceType";
LDApiCode.IdentityNotFound = "IdentityNotFound";
LDApiCode.AlreadySubscribed = "AlreadySubscribed";
LDApiCode.NotSubscribed = "NotSubscribed";
LDApiCode.NoStateForFeed = "NoStateForFeed";
LDApiCode.MemberNotFound = "MemberNotFound";
LDApiCode.UserAlreadyHasOmletId = "UserAlreadyHasOmletId";
LDApiCode.OmletIdHasBeenTaken = "OmletIdHasBeenTaken";
LDApiCode.SizeLimitExceeded = "SizeLimitExceeded";
LDApiCode.InvalidLocalBatchWrite = "InvalidLocalBatchWrite";
LDApiCode.InvalidMessageTransform = "InvalidMessageTransform";
LDApiCode.MessageTooLarge = "MessageTooLarge";
LDApiCode.InvalidBlobLink = "InvalidBlobLink";
LDApiCode.BlobSizeTooLarge = "BlobSizeTooLarge";
LDApiCode.Blob_BlobIsPermanent = "Blob_BlobIsPermanent";
LDApiCode.Blob_BlobMayNotHaveRefTags = "Blob_BlobMayNotHaveRefTags";
LDApiCode.Blob_BlobMustHaveRefTags = "Blob_BlobMustHaveRefTags";
LDApiCode.OmletAppStore_AppInfoAlreadyExists = "OmletAppStore_AppInfoAlreadyExists";
LDApiCode.OmletItemStore_ItemInfoNotFound = "OmletItemStore_ItemInfoNotFound";
LDApiCode.OmletItemStore_ItemInfoAlreadyExists = "OmletItemStore_ItemInfoAlreadyExists";
LDApiCode.OmletItemStore_InvalidGrantException = "OmletItemStore_InvalidGrantException";
LDApiCode.Profile_ItemAlreadyDeleted = "Profile_ItemAlreadyDeleted";
LDApiCode.Profile_ItemNotOwned = "Profile_ItemNotOwned";
LDApiCode.BadRequest = "BadRequest";
LDApiCode.Unauthorized = "Unauthorized";
LDApiCode.FailedToGenerateLink = "FailedToGenerateLink";
LDApiCode.EncryptionRequired = "EncryptionRequired";
LDApiCode.CorruptRequest = "CorruptRequest";
LDApiCode.OperationNotAllowedToIdp = "OperationNotAllowedToIdp";
LDApiCode.OperationNotAllowByLegacy = "OperationNotAllowByLegacy";
LDApiCode.MissingGameChallenge = "MissingGameChallenge";
LDApiCode.GameChallengeAlreadyComplete = "GameChallengeAlreadyComplete";
LDApiCode.OperationNotAllowedToLegacy = "OperationNotAllowedToLegacy";
LDApiCode.MigrationTimingIssue = "MigrationTimingIssue";
LDApiCode.IdentityAlreadyExists = "IdentityAlreadyExists";
LDApiCode.BadSubscriptionContext = "BadSubscriptionContext";
LDApiCode.InvalidWebhookUrl = "InvalidWebhookUrl";
LDApiCode.BadOAuthToken = "BadOAuthToken";
LDApiCode.CannotUnlinkAllIdentities = "CannotUnlinkAllIdentities";
LDApiCode.CannotUnlinkAnOmletID = "CannotUnlinkAnOmletID";
LDApiCode.LegacyAccountFound = "LegacyAccountFound";
LDApiCode.AccountAlreadyExists = "AccountAlreadyExists";
LDApiCode.LegacyMigrationToWrongCluster = "LegacyMigrationToWrongCluster";
LDApiCode.OperationNotAllowedToNonDefault = "OperationNotAllowedToNonDefault";
LDApiCode.OperationNotApplicableToSelf = "OperationNotApplicableToSelf";
LDApiCode.InvalidPingInterval = "InvalidPingInterval";
LDApiCode.OperationNotAllowedByIdp = "OperationNotAllowedByIdp";
LDApiCode.FailedToDeliverToken = "FailedToDeliverToken";
LDApiCode.UnsupportedEncoding = "UnsupportedEncoding";
LDApiCode.InvalidUrl = "InvalidUrl";
LDApiCode.CorruptMessageBody = "CorruptMessageBody";
LDApiCode.UnknownCluster = "UnknownCluster";
LDApiCode.CloudTokenWillNeverWork = "CloudTokenWillNeverWork";
LDApiCode.CloudTokenTemporarilyFailed = "CloudTokenTemporarilyFailed";
LDApiCode.PushServiceNotSupportedInChina = "PushServiceNotSupportedInChina";
LDApiCode.CloudProviderNotSupportedInChina = "CloudProviderNotSupportedInChina";
LDApiCode.GameChallengeService_UserNotOptedIn = "GameChallengeService_UserNotOptedIn";
LDApiCode.GameChallengeService_MaxOptIns = "GameChallengeService_MaxOptIns";
LDApiCode.GameChallengeService_ChallengeExpired = "GameChallengeService_ChallengeExpired";
LDApiCode.GameChallengeService_ChallengeNotYetExpired = "GameChallengeService_ChallengeNotYetExpired";
LDApiCode.PingTimeout = "PingTimeout";
LDApiCode.ClientPingTimeout = "ClientPingTimeout";
LDApiCode.EmailBounced = "EmailBounced";
LDApiCode.OmletItemStore_MaxApiKeysExceeded = "OmletItemStore_MaxApiKeysExceeded";
LDApiCode.OmletItemStore_OperationNotAllowedToType = "OmletItemStore_OperationNotAllowedToType";
LDApiCode.InvalidApiKey = "InvalidApiKey";
LDApiCode.DeviceMappedToWrongApp = "DeviceMappedToWrongApp";
LDApiCode.TokenService_InvalidToken = "TokenService_InvalidToken";
LDApiCode.TokenService_ExpiredToken = "TokenService_ExpiredToken";
LDApiCode.InvalidContentType = "InvalidContentType";
LDApiCode.ShareLinkNotExistsOrExpired = "ShareLinkNotExistsOrExpired";
LDApiCode.NoVideoStreamFound = "NoVideoStreamFound";
LDApiCode.InvalidVideoCodecFound = "InvalidVideoCodecFound";
LDApiCode.WallPostNotFound = "WallPostNotFound";
LDApiCode.WallPost_AlreadyPosted = "WallPost_AlreadyPosted";
LDApiCode.OmletIdNotFound = "OmletIdNotFound";
LDApiCode.OmletIdAuthMismatch = "OmletIdAuthMismatch";
LDApiCode.OmletIDExist = "OmletIDExist";
LDApiCode.IdentityExist = "IdentityExist";
LDApiCode.AuthCodeMismatch = "AuthCodeMismatch";
LDApiCode.FeedNotAuthorizedForApp = "FeedNotAuthorizedForApp";
var LDAcceptanceState = {}
LDAcceptanceState.No = "No";
LDAcceptanceState.Yes = "Yes";
LDAcceptanceState.Push = "Push";
LDAcceptanceState.Removed = "Removed";
LDAcceptanceState.Restricted = "Restricted";
LDAcceptanceState.RestrictedPush = "RestrictedPush";
LDAcceptanceState.Blocked = "Blocked";
var LDStatus = {}
LDStatus.LINK = "LINK";
LDStatus.SIGNED_IN = "SIGNED_IN";
var LDStoreItemType = {}
LDStoreItemType.App = "App";
LDStoreItemType.StickerPack = "StickerPack";
var LDTier = {}
LDTier.BRONZE = "BRONZE";
LDTier.SILVER = "SILVER";
LDTier.GOLD = "GOLD";
LDTier.DIAMOND = "DIAMOND";
var LDLocationType = {}
LDLocationType.CITY = "CITY";
LDLocationType.COUNTRY = "COUNTRY";
LDLocationType.CONTINENT = "CONTINENT";
LDLocationType.GLOBAL = "GLOBAL";
LDLocationType.LOCAL = "LOCAL";
var LDTaggedItemType = {}
LDTaggedItemType.Feed = 0;
var LDIdentityType = {}
LDIdentityType.Unknown = "unknown";
LDIdentityType.Email = "email";
LDIdentityType.Facebook = "fb";
LDIdentityType.Phone = "phone";
LDIdentityType.Subscription = "sub";
LDIdentityType.OmletId = "omlet";
LDIdentityType.Huawei = "huawei";
LDIdentityType.Htc = "htc";
LDIdentityType.Account = "account";
LDIdentityType.Baidu = "baidu";
var LDPushType = {}
LDPushType.GCM = "GCM";
LDPushType.APNS = "APNS";
LDPushType.Baidu = "Baidu";
LDPushType.Amazon = "Amazon";
LDPushType.WPNS = "WPNS";
var LDProvider = {}
LDProvider.Dropbox = "Dropbox";
LDProvider.Box = "Box";
LDProvider.BaiduPCS = "BaiduPCS";
LDProvider.OneDrive = "OneDrive";
LDProvider.GoogleDrive = "GoogleDrive";
LDProvider.OmStore = "OmStore";
LDProvider.Dummy = "Dummy";
var LDPostTagType = {}
LDPostTagType.Game = "Game";
LDPostTagType.String = "String";
var LDPostType = {}
LDPostType.Video = "Video";
LDPostType.Message = "Message";
LDPostType.ScreenShot = "ScreenShot";
var LDPublishedState = {}
LDPublishedState.NotPublished = "NotPublished";
LDPublishedState.Published = "Published";
LDPublishedState.InReview = "InReview";
LDPublishedState.Deleted = "Deleted";
module.exports = {
    LDJSONLoggable:LDJSONLoggable,
    LDRequestContainerBase:LDRequestContainerBase,
    LDDeviceToIdpRequestContainer:LDDeviceToIdpRequestContainer,
    LDResponseContainerBase:LDResponseContainerBase,
    LDDeviceToIdpResponseContainer:LDDeviceToIdpResponseContainer,
    LDDeviceToClusterRequestContainer:LDDeviceToClusterRequestContainer,
    LDDeviceToClusterResponseContainer:LDDeviceToClusterResponseContainer,
    LDPublicKeys:LDPublicKeys,
    LDSynchronizedMessageBody:LDSynchronizedMessageBody,
    LDAcceptanceChange:LDAcceptanceChange,
    LDBroadcastSettings:LDBroadcastSettings,
    LDAddMeInfo:LDAddMeInfo,
    LDJoinFeedInfo:LDJoinFeedInfo,
    LDFeatureSetting:LDFeatureSetting,
    LDDeviceToIdpRpcWrapper:LDDeviceToIdpRpcWrapper,
    LDDeviceToClusterRpcWrapper:LDDeviceToClusterRpcWrapper,
    LDRpcContext:LDRpcContext,
    LDHelloChallengeRequest:LDHelloChallengeRequest,
    LDCompleteChallengeRequest:LDCompleteChallengeRequest,
    LDPingRequest:LDPingRequest,
    LDRequestProtocolBase:LDRequestProtocolBase,
    LDDeviceToIdpSignupRequestProtocol:LDDeviceToIdpSignupRequestProtocol,
    LDDeviceToIdpAdministrativeRequestProtocol:LDDeviceToIdpAdministrativeRequestProtocol,
    LDHelloChallengeResponse:LDHelloChallengeResponse,
    LDCompleteChallengeResponse:LDCompleteChallengeResponse,
    LDSimpleResponse:LDSimpleResponse,
    LDPingResponse:LDPingResponse,
    LDResponseProtocolBase:LDResponseProtocolBase,
    LDDeviceToIdpSignupResponseProtocol:LDDeviceToIdpSignupResponseProtocol,
    LDDeviceToIdpAdministrativeResponseProtocol:LDDeviceToIdpAdministrativeResponseProtocol,
    LDDeviceToClusterMessageRequestProtocol:LDDeviceToClusterMessageRequestProtocol,
    LDDeviceToClusterInboxRequestProtocol:LDDeviceToClusterInboxRequestProtocol,
    LDClusterOrDeviceToClusterBlobRequestProtocol:LDClusterOrDeviceToClusterBlobRequestProtocol,
    LDDeviceToClusterContactRequestProtocol:LDDeviceToClusterContactRequestProtocol,
    LDDeviceToClusterProfileRequestProtocol:LDDeviceToClusterProfileRequestProtocol,
    LDDeviceToClusterAddressBookRequestProtocol:LDDeviceToClusterAddressBookRequestProtocol,
    LDDeviceToClusterOmletItemStoreRequestProtocol:LDDeviceToClusterOmletItemStoreRequestProtocol,
    LDDeviceToClusterDeviceRequestProtocol:LDDeviceToClusterDeviceRequestProtocol,
    LDDeviceToClusterCloudSyncRequestProtocol:LDDeviceToClusterCloudSyncRequestProtocol,
    LDDeviceToClusterGameChallengeRequestProtocol:LDDeviceToClusterGameChallengeRequestProtocol,
    LDDeviceToClusterSubscriptionRequestProtocol:LDDeviceToClusterSubscriptionRequestProtocol,
    LDDeviceToClusterHighScoreRequestProtocol:LDDeviceToClusterHighScoreRequestProtocol,
    LDDeviceToClusterNearbyItemRequestProtocol:LDDeviceToClusterNearbyItemRequestProtocol,
    LDDeviceToClusterMiscellaneousRequestProtocol:LDDeviceToClusterMiscellaneousRequestProtocol,
    LDDeviceToClusterDirectMessagingRequestProtocol:LDDeviceToClusterDirectMessagingRequestProtocol,
    LDDeviceToClusterWallPostRequestProtocol:LDDeviceToClusterWallPostRequestProtocol,
    LDDeviceToClusterIdentityTokenRequestProtocol:LDDeviceToClusterIdentityTokenRequestProtocol,
    LDDeviceToClusterMessageResponseProtocol:LDDeviceToClusterMessageResponseProtocol,
    LDDeviceToClusterInboxResponseProtocol:LDDeviceToClusterInboxResponseProtocol,
    LDClusterOrDeviceToClusterBlobResponseProtocol:LDClusterOrDeviceToClusterBlobResponseProtocol,
    LDDeviceToClusterContactResponseProtocol:LDDeviceToClusterContactResponseProtocol,
    LDDeviceToClusterProfileResponseProtocol:LDDeviceToClusterProfileResponseProtocol,
    LDDeviceToClusterAddressBookResponseProtocol:LDDeviceToClusterAddressBookResponseProtocol,
    LDDeviceToClusterOmletItemStoreResponseProtocol:LDDeviceToClusterOmletItemStoreResponseProtocol,
    LDDeviceToClusterDeviceResponseProtocol:LDDeviceToClusterDeviceResponseProtocol,
    LDDeviceToClusterCloudSyncResponseProtocol:LDDeviceToClusterCloudSyncResponseProtocol,
    LDDeviceToClusterGameChallengeResponseProtocol:LDDeviceToClusterGameChallengeResponseProtocol,
    LDDeviceToClusterSubscriptionResponseProtocol:LDDeviceToClusterSubscriptionResponseProtocol,
    LDDeviceToClusterHighScoreResponseProtocol:LDDeviceToClusterHighScoreResponseProtocol,
    LDDeviceToClusterNearbyItemResponseProtocol:LDDeviceToClusterNearbyItemResponseProtocol,
    LDDeviceToClusterMiscellaneousResponseProtocol:LDDeviceToClusterMiscellaneousResponseProtocol,
    LDDeviceToClusterDirectMessagingResponseProtocol:LDDeviceToClusterDirectMessagingResponseProtocol,
    LDDeviceToClusterWallPostResponseProtocol:LDDeviceToClusterWallPostResponseProtocol,
    LDDeviceToClusterIdentityTokenResponseProtocol:LDDeviceToClusterIdentityTokenResponseProtocol,
    LDURI:LDURI,
    LDContactProfile:LDContactProfile,
    LDEnum:LDEnum,
    LDAccessScope:LDAccessScope,
    LDRegisterWithTokenRequest:LDRegisterWithTokenRequest,
    LDConfirmTokenRequest:LDConfirmTokenRequest,
    LDRegisterWithOAuthRequest:LDRegisterWithOAuthRequest,
    LDGetLinkedIdentitiesRequest:LDGetLinkedIdentitiesRequest,
    LDCheckIdentityLinkedRequest:LDCheckIdentityLinkedRequest,
    LDUnlinkIdentityRequest:LDUnlinkIdentityRequest,
    LDLinkOmletIdentityRequest:LDLinkOmletIdentityRequest,
    LDGetAppSigninLinkRequest:LDGetAppSigninLinkRequest,
    LDConfirmAuthCodeRequest:LDConfirmAuthCodeRequest,
    LDDeviceRegistrationStateChangedPush:LDDeviceRegistrationStateChangedPush,
    LDUnblockIdentityRequest:LDUnblockIdentityRequest,
    LDGetEmailLoginLinkRequest:LDGetEmailLoginLinkRequest,
    LDGetAccountDetailsByAccountRequest:LDGetAccountDetailsByAccountRequest,
    LDGetAccountDetailsByIdentityRequest:LDGetAccountDetailsByIdentityRequest,
    LDGetIdentityRecordsRequest:LDGetIdentityRecordsRequest,
    LDListFlaggedUsersRequest:LDListFlaggedUsersRequest,
    LDChangeUserNameRequest:LDChangeUserNameRequest,
    LDChangeUserProfilePictureRequest:LDChangeUserProfilePictureRequest,
    LDDisableUserGameChallengeRequest:LDDisableUserGameChallengeRequest,
    LDLogUserOutRequest:LDLogUserOutRequest,
    LDGetDeviceRecordsRequest:LDGetDeviceRecordsRequest,
    LDAccountDetailsResponse:LDAccountDetailsResponse,
    LDGetLinkedIdentitiesResponse:LDGetLinkedIdentitiesResponse,
    LDGetAppSigninLinkResponse:LDGetAppSigninLinkResponse,
    LDGetIdentityRecordsResponse:LDGetIdentityRecordsResponse,
    LDListFlaggedUsersResponse:LDListFlaggedUsersResponse,
    LDGetDeviceRecordsResponse:LDGetDeviceRecordsResponse,
    LDCreateFeedRequest:LDCreateFeedRequest,
    LDGetMessagesSinceRequest:LDGetMessagesSinceRequest,
    LDGetMessagesBeforeRequest:LDGetMessagesBeforeRequest,
    LDGetMessagesByTypeRequest:LDGetMessagesByTypeRequest,
    LDGetMessageByIdRequest:LDGetMessageByIdRequest,
    LDAddMessageRequest:LDAddMessageRequest,
    LDUpdateMessageRequest:LDUpdateMessageRequest,
    LDOverwriteMessageRequest:LDOverwriteMessageRequest,
    LDDeleteMessageRequest:LDDeleteMessageRequest,
    LDSubscribeFeedRequest:LDSubscribeFeedRequest,
    LDUnsubscribeFeedRequest:LDUnsubscribeFeedRequest,
    LDSubscribeFeedRealtimeRequest:LDSubscribeFeedRealtimeRequest,
    LDUnsubscribeFeedRealtimeRequest:LDUnsubscribeFeedRealtimeRequest,
    LDAddMemberRequest:LDAddMemberRequest,
    LDRemoveMemberRequest:LDRemoveMemberRequest,
    LDSetFeedNameRequest:LDSetFeedNameRequest,
    LDSetFeedThumbnailRequest:LDSetFeedThumbnailRequest,
    LDSendRealtimeRequest:LDSendRealtimeRequest,
    LDAddPendingInvitationRequest:LDAddPendingInvitationRequest,
    LDRemovePendingInvitationRequest:LDRemovePendingInvitationRequest,
    LDGetJoinFeedLinkRequest:LDGetJoinFeedLinkRequest,
    LDJoinFeedRequest:LDJoinFeedRequest,
    LDJoinBroadcastRequest:LDJoinBroadcastRequest,
    LDSetDefaultAccessRequest:LDSetDefaultAccessRequest,
    LDGetPublicFeedDetailsRequest:LDGetPublicFeedDetailsRequest,
    LDApplyDocumentTransformRequest:LDApplyDocumentTransformRequest,
    LDMessageDeliveryPush:LDMessageDeliveryPush,
    LDRealtimeMessageDeliveryPush:LDRealtimeMessageDeliveryPush,
    LDMessageTerminatedPush:LDMessageTerminatedPush,
    LDGetFeedStateRequest:LDGetFeedStateRequest,
    LDSetFeedAcceptanceRequest:LDSetFeedAcceptanceRequest,
    LDGetDirtyFeedsRequest:LDGetDirtyFeedsRequest,
    LDSubscribeForAccountInboxRequest:LDSubscribeForAccountInboxRequest,
    LDUnsubscribeForAccountInboxRequest:LDUnsubscribeForAccountInboxRequest,
    LDRegisterPushNotificationKeyRequest:LDRegisterPushNotificationKeyRequest,
    LDInboxDeliveryMessagePush:LDInboxDeliveryMessagePush,
    LDInboxDeliveryTerminatedPush:LDInboxDeliveryTerminatedPush,
    LDSetAppleBadgeCountRequest:LDSetAppleBadgeCountRequest,
    LDGetUploadTicketRequest:LDGetUploadTicketRequest,
    LDGetMultipartUploadTicketRequest:LDGetMultipartUploadTicketRequest,
    LDVerifyUploadCompletedRequest:LDVerifyUploadCompletedRequest,
    LDGetDownloadTicketRequest:LDGetDownloadTicketRequest,
    LDVerifyExistsAndPermanenceRequest:LDVerifyExistsAndPermanenceRequest,
    LDOverwriteContactRequest:LDOverwriteContactRequest,
    LDRemoveContactRequest:LDRemoveContactRequest,
    LDBlockContactRequest:LDBlockContactRequest,
    LDUnblockContactRequest:LDUnblockContactRequest,
    LDGetProfileDetailsRequest:LDGetProfileDetailsRequest,
    LDSetProfileNameRequest:LDSetProfileNameRequest,
    LDSetProfilePictureRequest:LDSetProfilePictureRequest,
    LDGetOmletContactProfileRequest:LDGetOmletContactProfileRequest,
    LDAddItemsToProfileRequest:LDAddItemsToProfileRequest,
    LDRemoveItemsFromProfileRequest:LDRemoveItemsFromProfileRequest,
    LDAddFeaturesToProfileRequest:LDAddFeaturesToProfileRequest,
    LDRemoveFeaturesFromProfileRequest:LDRemoveFeaturesFromProfileRequest,
    LDGetProfilePublicStateRequest:LDGetProfilePublicStateRequest,
    LDGetContactProfileAndPublicStateRequest:LDGetContactProfileAndPublicStateRequest,
    LDUploadAddressBookEntriesRequest:LDUploadAddressBookEntriesRequest,
    LDGetContactProfileRequest:LDGetContactProfileRequest,
    LDGetAddMeLinkRequest:LDGetAddMeLinkRequest,
    LDMutualAddContactByTokenRequest:LDMutualAddContactByTokenRequest,
    LDCreateItemInfoRequest:LDCreateItemInfoRequest,
    LDUserUpdateItemInfoRequest:LDUserUpdateItemInfoRequest,
    LDSystemUpdateItemInfoRequest:LDSystemUpdateItemInfoRequest,
    LDGetItemInfoRequest:LDGetItemInfoRequest,
    LDReviewItemRequest:LDReviewItemRequest,
    LDPublishItemRequest:LDPublishItemRequest,
    LDUnpublishItemRequest:LDUnpublishItemRequest,
    LDDeleteItemRequest:LDDeleteItemRequest,
    LDListItemsForAccountRequest:LDListItemsForAccountRequest,
    LDListAllItemsRequest:LDListAllItemsRequest,
    LDListPublishedItemsRequest:LDListPublishedItemsRequest,
    LDGenerateGrantForItemRequest:LDGenerateGrantForItemRequest,
    LDGetItemUsingGrantRequest:LDGetItemUsingGrantRequest,
    LDDoesItemHaveGrantRequest:LDDoesItemHaveGrantRequest,
    LDDeleteGrantForItemRequest:LDDeleteGrantForItemRequest,
    LDGenerateApiKeyRequest:LDGenerateApiKeyRequest,
    LDDeactivateApiKeyRequest:LDDeactivateApiKeyRequest,
    LDListApiKeysRequest:LDListApiKeysRequest,
    LDDeleteDeviceRequest:LDDeleteDeviceRequest,
    LDAddDeviceRequest:LDAddDeviceRequest,
    LDSetDingTimeoutRequest:LDSetDingTimeoutRequest,
    LDGetCloudConfigRequest:LDGetCloudConfigRequest,
    LDSetCloudConfigRequest:LDSetCloudConfigRequest,
    LDRefreshCloudConfigRequest:LDRefreshCloudConfigRequest,
    LDDisconnectCloudSyncRequest:LDDisconnectCloudSyncRequest,
    LDOptInForAllGamesChallengesRequest:LDOptInForAllGamesChallengesRequest,
    LDFindGamersRequest:LDFindGamersRequest,
    LDUpdateChallengeLocationRequest:LDUpdateChallengeLocationRequest,
    LDGameChallengeCompleteRequest:LDGameChallengeCompleteRequest,
    LDExtendChallengeRequest:LDExtendChallengeRequest,
    LDCheckAccountOptedInRequest:LDCheckAccountOptedInRequest,
    LDOptInForGSChallengesRequest:LDOptInForGSChallengesRequest,
    LDFindGamersGSRequest:LDFindGamersGSRequest,
    LDCreateSubscriptionRequest:LDCreateSubscriptionRequest,
    LDGetHighScoreRequest:LDGetHighScoreRequest,
    LDReportScoreRequest:LDReportScoreRequest,
    LDGetTopScoresRequest:LDGetTopScoresRequest,
    LDBroadcastItemRequest:LDBroadcastItemRequest,
    LDUnbroadcastItemRequest:LDUnbroadcastItemRequest,
    LDSubscribeForNearbyItemsRequest:LDSubscribeForNearbyItemsRequest,
    LDUnsubscribeForNearbyItemsRequest:LDUnsubscribeForNearbyItemsRequest,
    LDFetchNearbyItemsRequest:LDFetchNearbyItemsRequest,
    LDItemBroadcastStateChangedPush:LDItemBroadcastStateChangedPush,
    LDSubscriptionTerminatedPush:LDSubscriptionTerminatedPush,
    LDUrlToStoryRequest:LDUrlToStoryRequest,
    LDImageSearchRequest:LDImageSearchRequest,
    LDFailureReportRequest:LDFailureReportRequest,
    LDFlagUserRequest:LDFlagUserRequest,
    LDCreatePlaygroundRequest:LDCreatePlaygroundRequest,
    LDGetFeedbackAccountRequest:LDGetFeedbackAccountRequest,
    LDGetExtraVersionsRequest:LDGetExtraVersionsRequest,
    LDGetDirectFeedRequest:LDGetDirectFeedRequest,
    LDSendDirectMessageRequest:LDSendDirectMessageRequest,
    LDSetSmsParticipationRequest:LDSetSmsParticipationRequest,
    LDPostVideoRequest:LDPostVideoRequest,
    LDPostMessageRequest:LDPostMessageRequest,
    LDPostScreenShotRequest:LDPostScreenShotRequest,
    LDLikePostRequest:LDLikePostRequest,
    LDAddViewRequest:LDAddViewRequest,
    LDFollowUserRequest:LDFollowUserRequest,
    LDGetUserWallRequest:LDGetUserWallRequest,
    LDGetGameWallRequest:LDGetGameWallRequest,
    LDGetFollowingWallRequest:LDGetFollowingWallRequest,
    LDGetPostRequest:LDGetPostRequest,
    LDGetStandardPostTagsRequest:LDGetStandardPostTagsRequest,
    LDGetFollowersRequest:LDGetFollowersRequest,
    LDGetAccountsFollowedRequest:LDGetAccountsFollowedRequest,
    LDDeletePostRequest:LDDeletePostRequest,
    LDGetIdentityTokenRequest:LDGetIdentityTokenRequest,
    LDGetMessageResponse:LDGetMessageResponse,
    LDGetMessagesResponse:LDGetMessagesResponse,
    LDGetMessagesWithContinuationResponse:LDGetMessagesWithContinuationResponse,
    LDGetJoinFeedLinkResponse:LDGetJoinFeedLinkResponse,
    LDGetPublicFeedDetailsResponse:LDGetPublicFeedDetailsResponse,
    LDDirtyFeedsResponse:LDDirtyFeedsResponse,
    LDFeedStateResponse:LDFeedStateResponse,
    LDGetUploadTicketResponse:LDGetUploadTicketResponse,
    LDGetMultipartUploadTicketResponse:LDGetMultipartUploadTicketResponse,
    LDGetDownloadTicketResponse:LDGetDownloadTicketResponse,
    LDGetContactDetailsResponse:LDGetContactDetailsResponse,
    LDGetProfileDetailsResponse:LDGetProfileDetailsResponse,
    LDGetOmletContactProfileResponse:LDGetOmletContactProfileResponse,
    LDGetProfilePublicStateResponse:LDGetProfilePublicStateResponse,
    LDGetContactProfileAndPublicStateResponse:LDGetContactProfileAndPublicStateResponse,
    LDGetContactProfileResponse:LDGetContactProfileResponse,
    LDGetItemInfoResponse:LDGetItemInfoResponse,
    LDListItemsResponse:LDListItemsResponse,
    LDGenerateGrantForItemResponse:LDGenerateGrantForItemResponse,
    LDGenerateApiKeyResponse:LDGenerateApiKeyResponse,
    LDListApiKeysResponse:LDListApiKeysResponse,
    LDGetCloudConfigResponse:LDGetCloudConfigResponse,
    LDFindGamersResponse:LDFindGamersResponse,
    LDCreateSubscriptionResponse:LDCreateSubscriptionResponse,
    LDScoreResponse:LDScoreResponse,
    LDScoresResponse:LDScoresResponse,
    LDBroadcastItemResponse:LDBroadcastItemResponse,
    LDFetchNearbyItemsResponse:LDFetchNearbyItemsResponse,
    LDUrlToStoryResponse:LDUrlToStoryResponse,
    LDImageSearchResponse:LDImageSearchResponse,
    LDCreatePlaygroundResponse:LDCreatePlaygroundResponse,
    LDGetExtraVersionsResponse:LDGetExtraVersionsResponse,
    LDGetDirectFeedResponse:LDGetDirectFeedResponse,
    LDSendDirectMessageResponse:LDSendDirectMessageResponse,
    LDWallResponse:LDWallResponse,
    LDWallsResponse:LDWallsResponse,
    LDGetPostResponse:LDGetPostResponse,
    LDAddPostResponse:LDAddPostResponse,
    LDGetAccountsFollowedResponse:LDGetAccountsFollowedResponse,
    LDGetStandardPostTagsResponse:LDGetStandardPostTagsResponse,
    LDGetFollowersResponse:LDGetFollowersResponse,
    LDGetIdentityTokenResponse:LDGetIdentityTokenResponse,
    LDIdentity:LDIdentity,
    LDAccountDetails:LDAccountDetails,
    LDString:LDString,
    LDFlaggedDetails:LDFlaggedDetails,
    LDFeed:LDFeed,
    LDTypedId:LDTypedId,
    LDIdentityHash:LDIdentityHash,
    LDMessage:LDMessage,
    LDRealtimeMessage:LDRealtimeMessage,
    LDPushKey:LDPushKey,
    LDBlobMetadata:LDBlobMetadata,
    LDBlobUploadTicket:LDBlobUploadTicket,
    LDContactDetails:LDContactDetails,
    LDItemId:LDItemId,
    LDPurchaseData:LDPurchaseData,
    LDFeature:LDFeature,
    LDItemInfoUserMutableContainer:LDItemInfoUserMutableContainer,
    LDItemInfoSystemMutableContainer:LDItemInfoSystemMutableContainer,
    LDCloudConfig:LDCloudConfig,
    LDGameChallengeId:LDGameChallengeId,
    LDGPSLocation:LDGPSLocation,
    LDNearbyItemContainer:LDNearbyItemContainer,
    LDPostTag:LDPostTag,
    LDPostId:LDPostId,
    LDJoinFeedLink:LDJoinFeedLink,
    LDDirtyFeed:LDDirtyFeed,
    LDBlobDownloadTicket:LDBlobDownloadTicket,
    LDProfileDetails:LDProfileDetails,
    LDProfilePublicState:LDProfilePublicState,
    LDItemInfoContainer:LDItemInfoContainer,
    LDItemInfoListingContainer:LDItemInfoListingContainer,
    LDApiKey:LDApiKey,
    LDScoreBoardEntry:LDScoreBoardEntry,
    LDImageSearchResult:LDImageSearchResult,
    LDWall:LDWall,
    LDPostContainer:LDPostContainer,
    LDUser:LDUser,
    LDPostTagWithLocalization:LDPostTagWithLocalization,
    LDFlaggedRecord:LDFlaggedRecord,
    LDReceiptContainer:LDReceiptContainer,
    LDBillingInfoContainer:LDBillingInfoContainer,
    LDItemInfoUserMutable:LDItemInfoUserMutable,
    LDAppInfoUserMutable:LDAppInfoUserMutable,
    LDStickerPackInfoUserMutable:LDStickerPackInfoUserMutable,
    LDItemInfoSystemMutable:LDItemInfoSystemMutable,
    LDAppInfoSystemMutable:LDAppInfoSystemMutable,
    LDStickerPackInfoSystemMutable:LDStickerPackInfoSystemMutable,
    LDNearbyItemFeedMetadata:LDNearbyItemFeedMetadata,
    LDProfileIdentitySetting:LDProfileIdentitySetting,
    LDItemInfo:LDItemInfo,
    LDAppInfo:LDAppInfo,
    LDStickerPackInfo:LDStickerPackInfo,
    LDAppInfoListingWrapper:LDAppInfoListingWrapper,
    LDStickerPackInfoListingWrapper:LDStickerPackInfoListingWrapper,
    LDPost:LDPost,
    LDVideoPost:LDVideoPost,
    LDMessagePost:LDMessagePost,
    LDScreenShotPost:LDScreenShotPost,
    LDMockReceipt:LDMockReceipt,
    LDMockBillingInfo:LDMockBillingInfo,
    LDAppScreenshot:LDAppScreenshot,
    LDAppStore:LDAppStore,
    LDSticker:LDSticker,
    LDPrice:LDPrice,
    LDItemInfoImmutableContainer:LDItemInfoImmutableContainer,
    LDComment:LDComment,
    LDM3U8Info:LDM3U8Info,
    LDItemInfoImmutable:LDItemInfoImmutable,
    LDAppInfoImmutable:LDAppInfoImmutable,
    LDStickerPackInfoImmutable:LDStickerPackInfoImmutable,
    LDApiCode:LDApiCode,
    LDAcceptanceState:LDAcceptanceState,
    LDStatus:LDStatus,
    LDStoreItemType:LDStoreItemType,
    LDTier:LDTier,
    LDLocationType:LDLocationType,
    LDTaggedItemType:LDTaggedItemType,
    LDIdentityType:LDIdentityType,
    LDPushType:LDPushType,
    LDProvider:LDProvider,
    LDPostTagType:LDPostTagType,
    LDPostType:LDPostType,
    LDPublishedState:LDPublishedState
};
Object.freeze(module.exports);
