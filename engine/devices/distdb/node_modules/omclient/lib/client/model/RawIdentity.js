var proto = require("../../ldproto");
var ourcrypto = require("../../crypto");

function RawIdentity() {
}

RawIdentity.prototype._type = undefined;
RawIdentity.prototype.principal = undefined;

RawIdentity.parse = function(rawIdentity) {
	var pos = rawIdentity.indexOf(':');
	if (pos == -1)
		return undefined;

	var r = new RawIdentity();
	r.type = rawIdentity.substring(0, pos);
	r.principal = rawIdentity.substring(pos + 1);
	return r;
}

RawIdentity.create = function(type, value) {
	var r = new RawIdentity();
	r.type = type;
	r.principal = value;
	r._normalize();
	return r;
}

RawIdentity.prototype._normalize = function() {
	if (this.type == RawIdentity.TYPE_PHONE) {
		this.principal = RawIdentity.normalizePhone(this.principal);
	} else if (this.type == RawIdentity.TYPE_EMAIL) {
		this.principal = RawIdentity.normalizeEmail(this.principal);
	}
}

RawIdentity.normalizeEmail = function(email) {
	return email.toLowerCase();
}

RawIdentity.normalizePhone = function(phone) {
	// TODO: GLHF
    return phone;
}

RawIdentity.prototype.asLdIdentity = function() {
	var id = new proto.LDIdentity();
	id.Type = this.type;
	id.Principal = this.principal;
	return id;
}

RawIdentity.prototype.getEncodedHashedIdentity = function() {
	var alg = ourcrypto.createMD5();
	alg.update(this.principal);
	var idHash = new proto.LDIdentityHash();
	idHash.Type = this.type;
	idHash.Hash = alg.digest('base64');
	return JSON.stringify(idHash.encode());
}

RawIdentity.prototype.toString = function() {
	return JSON.stringify(this.asLdIdentity().encode());
}

RawIdentity.TYPE_PHONE = "phone";
RawIdentity.TYPE_EMAIL = "email";
RawIdentity.TYPE_LONGDAN = "ld";

module.exports = RawIdentity;