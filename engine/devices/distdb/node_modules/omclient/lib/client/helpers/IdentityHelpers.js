var proto = require("../../ldproto");
var async = require('async');

function IdentityHelpers(client) {
	this._client = client;
}

IdentityHelpers.prototype.ensureIdentity = function(details, cb) {
	var account = details.account;
	this._client.store.getAccounts(function(accounts) {
   		accounts.getObjectByKey(account, function(err, existing) {
   			if (existing) {
   				if (existing.upToDate) {
					if (existing.profileVersion < details.profileVersion) {
	   					existing.name = details.name;
	   					existing.thumbnail = details.thumbnail;
	   					accounts.update(existing, function(existing) {
	   						   this.updateFeedNames(existing);
	   					}.bind(this));
	   				}
   				} else {
   					this.refreshAccountProfile(account);
   				}
   				
   				if (typeof(cb) == 'function') {
   					async.nextTick(function() {
   						cb(existing);
   					}, 0);
   				}
   			} else {
   				accounts.getOrCreateObject(account, function(identity) {
   					this.refreshAccountProfile(account);

   					if (typeof(cb) == 'function') {
	   					async.nextTick(function() {
	   						cb(identity);
	   					}, 0);
	   				}
   				}.bind(this), details);
   			}
   		}.bind(this));
   }.bind(this));
}

IdentityHelpers.prototype.refreshAccountProfile = function(account) {
	var req = new proto.LDGetOmletContactProfileRequest();
	req.RequestedAccount = account;
	this._client.msgCall(req, function(err, resp, req) {
		if (err) {
			// TODO: retry
			return;
		}
		
		var profile = resp.ContactProfile;
		this._client.store.getAccounts(function(accountsDb) {
			accountsDb.getOrCreateObject(account, function(identity) {
				var newName = identity.name != profile.Name;
				
				if(profile.ProfilePictureLink){
					var hash = this._client.blob.hashFromLongdanUrl(profile.ProfilePictureLink);
	  			this._client.blob.ensureBlobSource(hash, profile.ProfilePictureLink);
	  			identity.thumbnailHash = hash;
				}

				identity.name = profile.Name;
				identity.profileVersion = profile.Version;
				identity.hasAppTime = profile.HasAppTime;
				
				identity.upToDate = true;
				accountsDb.update(identity, function(identity) {
					if (newName) {
						this.updateFeedNames(identity);
					}
				}.bind(this));
			}.bind(this));
		}.bind(this));
	}.bind(this));
}

IdentityHelpers.prototype.updateFeedNames = function(identity) {
	identity.feeds.forEach(function(feedId) {
		this._client._feed.generateFeedName(feedId);
	}.bind(this));
}	

module.exports = IdentityHelpers;