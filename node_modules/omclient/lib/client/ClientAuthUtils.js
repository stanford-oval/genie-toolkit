var proto = require("../ldproto");

function AuthUtils(client) {
	this._client = client;
}

// Returns a URI to a web page for Omlet OAuth
AuthUtils.prototype.getAuthPage = function(redirectUrl, scopes, cb) {
    if (!scopes) {
      // OmletChat, OmletArcade
      //scopes = ["OmletChat"];
      scopes = ["PublicProfile"];
    }

    var req = new proto.LDGetAppSigninLinkRequest();
    req.RedirectPage = redirectUrl;
    req.Scopes = scopes;

    this._client.idpCall(req, function(e, resp) {
        if (cb != undefined)
            cb(e, resp);
    }.bind(this));
}

AuthUtils.prototype.connectIdentity = function(identity) {
	var req = new proto.LDRegisterWithTokenRequest();
	req.Identity = identity;
	this._client.idpCall(req, function(e, resp) {
	});
}

AuthUtils.prototype.connectEmail = function(email) {
  var identity = new proto.LDIdentity();
  identity.Type = proto.LDIdentityType.Email;
  identity.Principal = email;
  this.connectIdentity(identity);
}

AuthUtils.prototype.connectPhone = function(phone) {
  var identity = new proto.LDIdentity();
  identity.Type = proto.LDIdentityType.Phone;
  identity.Principal = email;
  this.connectIdentity(phone);
}

AuthUtils.prototype.confirmPinForIdentity = function(ldIdentity, pin, callback) {
	var req = new proto.LDConfirmTokenRequest();
	req.Identity = ldIdentity;
	req.Token = pin;
    this._client.idpCall(req, callback);
}

AuthUtils.prototype.connectOAuth = function(serviceType, token) {
  var req = new proto.LDRegisterWithOAuthRequest();
  req.ServiceType = serviceType;
  req.Key = token;
  this._client.idpCall(req, this._onAuthenticationComplete.bind(this));
}

AuthUtils.prototype.confirmAuth = function(code, queryKey){
  var req = new proto.LDConfirmAuthCodeRequest();
  req.AuthCode = code;
  req.QueryKey = queryKey;

  this._client.idpCall(req, this._onAuthenticationComplete.bind(this));
}

AuthUtils.prototype._onAuthenticationComplete = function(e, resp) {
  if(e) {
    console.log('error:' + e);
  } else {
        var details = resp.AccountDetails;
        this._client._saveDetails(details);
        this._client._msg._setCluster(details.Cluster, "/device");
        this._client._idp.onInterrupted = null;
        this._client._idp.disable();
        this._client._msg.enable();
        if (this._client.onSignedUp)
            this._client.onSignedUp();
  }
}

module.exports = AuthUtils;