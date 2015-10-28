var proto = require("../ldproto");
var RawIdentity = require("./model/RawIdentity");

function IdentityUtils(client) {
	this._client = client;
}

IdentityUtils.prototype.createRawIdentity = function(type, value) {
	return RawIdentity.create(type, value);
}

IdentityUtils.prototype.parseRawIdentity = function(identity) {
	return RawIdentity.parse(identity);
}

IdentityUtils.prototype.setUserDisplayName = function(name, cb) {
	var req = new proto.LDSetProfileNameRequest();
	req.Name = name;
	this._client.msgCall(req, function(e, resp, req) {
		if (typeof cb == 'function') {
			cb(e, resp);
		}
	});
}

IdentityUtils.prototype.lookupAccount = function(account, cb) {
	var req = new proto.LDGetOmletContactProfileRequest();
	req.RequestedAccount = account;
	this._client.msgCall(req, function(err, resp, req) {
		if (err) {
			cb(err);
		} else {
			cb(undefined, resp.ContactProfile);
		}
	});
}

IdentityUtils.prototype._addAccountToContacts = function(account, cb) {
	this._client._identity.ensureIdentity({account:account}, cb);
}

IdentityUtils.prototype.getAccountsForIdentifiers = function(accounts, cb) {
	this._client.store.getAccounts(function(accountsDb) {
		this._getAccountsForIdentifiersInternal(accountsDb, accounts, [], [], cb);
	}.bind(this));
}

IdentityUtils.prototype._getAccountsForIdentifiersInternal = function(accountsDb, accounts, matches, misses, cb) {
	if (accounts.length == 0) {
		cb(matches, misses);
	} else {
		var identifier = accounts.shift();
		accountsDb.getObjectByKey(identifier, function(account) {
			if (account) {
				matches.push(account);
			} else {
				misses.push(identifier)
			}
			this._getAccountsForIdentifiersInternal(accountsDb, accounts, matches, misses, cb);
		}.bind(this));
	}
}

IdentityUtils.prototype.getAccountsForIdentityHashes = function(identityHashes, cb) {
	// hot path
	if (identityHashes.length == 0) {
		cb([], []);
		return;
	}

	this._client.store.getIdentityHashes(function(idDb) {
		this._client.store.getAccounts(function(accountsDb) {
			this._getAccountsForIdentityHashesInternal(idDb, accountsDb, identityHashes, [], [], cb);
		}.bind(this));
	}.bind(this));
}

IdentityUtils.prototype._getAccountsForIdentityHashesInternal = function(idDb, accountsDb, hashes, matches, misses, cb) {
	if (hashes.length == 0) {
		cb(matches, misses);
	} else {
		var hash = hashes.shift();
		idDb.getObjectByKey(hash, function(entry) {
			if (entry) {
				accountsDb.getObjectById(entry.accountId, function(account) {
					if (account) {
						matches.push(account.account);
						this._getAccountsForIdentityHashesInternal(idDb, accountsDb, hashes, matches, misses, cb);
					} else {
						console.warn("Found an accountId but no matching account: " + entry.accountId + " / " + hash);
						misses.push(hash);
						this._getAccountsForIdentityHashesInternal(idDb, accountsDb, hashes, matches, misses, cb);
					}
				}.bind(this));
			} else {
				misses.push(hash);
				this._getAccountsForIdentityHashesInternal(idDb, accountsDb, hashes, matches, misses, cb);
			}
		}.bind(this));
	}
}

module.exports = IdentityUtils;