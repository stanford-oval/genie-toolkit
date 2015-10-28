var proto = require("../ldproto");
var async = require("async");

function OmEvent(client) {
	this._client = client;
}

OmEvent.prototype.FEEDS = "feeds";
OmEvent.prototype.ACCOUNTS = "accounts";
OmEvent.prototype.DB_LOADED = "dbloaded";

OmEvent.prototype._events = {};
OmEvent.prototype._eventKey = 0;
OmEvent.prototype._pendingEvents = {};
OmEvent.prototype._pushReceivers = {};

OmEvent.prototype.register = function(label, fn) {
  if (!(label in this._events)) {
     this._events[label] = {};
  }

  var key = "" + (++(this._eventKey));
  this._events[label][key] = fn;
  var me = this;

  return function() {
    delete this._events[label][key];
  }.bind(this);
}

OmEvent.prototype._notify = function(label) {
  this._pendingEvents[label] = true;
  async.nextTick(this._releaseNotifications.bind(this));
}

OmEvent.prototype._releaseNotifications = function() {
  var pending = this._pendingEvents;
  this._pendingEvents = {};
  for (var label in pending) {
    var listeners = this._events[label];
    if (listeners !== undefined) {
      for (var f in listeners) {
        try {
          listeners[f](label);
        } catch (e) {
          console.error("failed to deliver event, removing callback", e);
          delete listeners[f];
        }
      }
    }
  }
}

OmEvent.prototype.registerMessagePushReceiver = function(fn) {
  var key = "" + (++(this._eventKey));
  this._pushReceivers[key] = fn;
  var me = this;

  return function() {
    delete this._pushReceivers[key];
  }.bind(this);
}

OmEvent.prototype._notifyMessagePushed = function(msg) {
  for (var i in this._pushReceivers) {
    try {
      this._pushReceivers[i](msg);
    } catch (e) {
      console.error("failed to deliver push event, removing callback", e);
      delete this._pushReceivers[i];
    }
  }
}

module.exports = OmEvent;