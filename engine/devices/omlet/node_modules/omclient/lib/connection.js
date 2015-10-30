var proto = require("./ldproto");
var WebSocket = require('ws');
var ourcrypto = require('./crypto');

var IDP_CLUSTER = "idp";
var BASE_BACKOFF = 3 * 1000;
var MAX_BACKOFF = 5 * 60 * 1000;
var KEEPALIVE_MS = 56 * 1000;

function makeWsPath(b, p) {
    if(process.browser) {
        if(document.location.href.indexOf("https") == 0) {
            b = b.replace("http://", "wss://");
            b = b.replace("https://", "wss://");
        } else { 
            b = b.replace("https://", "wss://");
            b = b.replace("http://", "ws://");
        }
    } else {
        b = b.replace("http://", "wss://");
        b = b.replace("https://", "wss://");
    }
    if (b.charAt(b.length - 1) == '/' && p.charAt(0) == '/')
        return b + p.substring(1);
    if (!b.charAt(b.length - 1) == '/' && !p.charAt(0) == '/')
        return b + "/" + p;
    return b + p;
};

function WaitingRequest(req, cb) {
    this.request = req;
    this.callback = cb; // function (error, resp, req)
}
function PendingRequest(wrapped, req, cb) {
    this.wrapped = wrapped;
    this.request = req;
    this.callback = cb; // function (error, resp, req)
}

function PermanentFailure(e) {
    Error.call(this);
    this.error = e;
}
PermanentFailure.prototype = Object.create(Error.prototype);
PermanentFailure.prototype.constructor = PermanentFailure;
PermanentFailure.prototype.permanent = true;
PermanentFailure.prototype.toString = function () {
    return "Permanent Failure: " + this.error;
}

function TemporaryFailure(e) {
    this.error = e;
}
TemporaryFailure.prototype = Object.create(Error.prototype);
TemporaryFailure.prototype.constructor = TemporaryFailure;
TemporaryFailure.prototype.permanent = false;
TemporaryFailure.prototype.toString = function () {
    return "Temporary Failure: " + this.error;
}

function Abort() {
    this.error = "Aborting";
}
Abort.prototype = Object.create(Error.prototype);
Abort.prototype.constructor = Abort;
Abort.prototype.permanent = true;
Abort.prototype.toString = function () {
    return "Aborted: ";
}

function rand(max) {
    return Math.floor(Math.random() * (max));
}

function Connection(cluster, target, configuration, privateKey, apiKey) {
    this._cluster = cluster;
    this._configuration = configuration;
    this.serverTimeDelta = 0;
    this.lastRtt = 0;
    this.keepaliveMs = KEEPALIVE_MS;
    if (cluster == IDP_CLUSTER) {
        this._serverPublicKey = this._configuration.IdpKey;
        this._endpoint = makeWsPath(this._configuration.IdpEndpoints[rand(this._configuration.IdpEndpoints.length)], target);
        this._requestWrapper = 'makeIdpRpc';
        this._wrapperConstructor = proto.LDDeviceToIdpRpcWrapper;
        this._responseConstructor = proto.LDDeviceToIdpResponseContainer;
    } else {
        if (cluster)
            this._setCluster(cluster, target);
        this._requestWrapper = 'makeClusterRpc';
        this._wrapperConstructor = proto.LDDeviceToClusterRpcWrapper;
        this._responseConstructor = proto.LDDeviceToClusterResponseContainer;
    }
    
    if (apiKey) {
    	this._apiKey = new Buffer(apiKey.Id, "hex");
    	this._apiSecret = new Buffer(apiKey.Secret, "hex");
    } else {
    	this._apiKey = null;
    	this._apiSecret = null;
    }
    
    this._privateKey = privateKey;
    this._publicKey = ourcrypto.generatePublicKey(privateKey);
    this._waiting = []; // WaitingRequest array
    this._pending = {}; // reqId:RequestWithCallback dictionary};
}

Connection.prototype.onPush = null; // function(push);
Connection.prototype.onInterrupted = null; //function(cause);
Connection.prototype.onDeviceInvalid = null; //function();
Connection.prototype.connected = false;
Connection.prototype.connectionId = 0;
Connection.prototype.debug = false;

Connection.prototype._setCluster = function(cluster, target) {
    if (!(cluster in this._configuration.ClusterKeys))
        throw "missing cluster info " + cluster;
    this._serverPublicKey = this._configuration.ClusterKeys[cluster];
    this._endpoint = makeWsPath(this._configuration.ClusterEndpoints[cluster][rand(this._configuration.ClusterEndpoints[cluster].length)], target);
}

Connection.prototype._verbose = function(m) {
    if (this.debug)
        console.log(m);
};
Connection.prototype._warn = function(m, o) {
    console.log("warn: " + m);
    if (o) {
        console.log(o);
    }
};

Connection.prototype.enable = function () {
    if (!this._endpoint)
        throw new Error("Must register with IDP!");
    if (this.enabled)
        return;
    this._enabled = true;
    this._connect();
};

Connection.prototype._connect = function() {
    if (this._client) {
        console.warn("Closing existing connection...");
        this._safeCloseConnection();
    }
    this._nextRequestId = 1;
    this._client = new WebSocket(this._endpoint);
    this._client.onopen = this._onopen.bind(this);
    this._client.onmessage = this._onmessage.bind(this);
    this._client.onclose = this._onclose.bind(this);
    this._client.onerror = this._onerror.bind(this);
};

Connection.prototype._safeCloseConnection = function() {
    if (this._client) {
        try {
            this.connected = false;
            this._client.close();
            this._client.onopen = undefined;
            this._client.onmessage = undefined;
            this._client.onclose = undefined;
            this._client.onerror = undefined;
            this._client = undefined;
        } catch (e) {
            console.warn("Error closing existing client", e);
        }
    }
}

Connection.prototype._clearBackoff = function(reason) {
    if (this._backoffTimer)
        clearTimeout(this._backoffTimer);
    this._backoffTimer = undefined;
    this._lastFailure = undefined;
    this._nextReschedule = undefined;
}
Connection.prototype._backoff = function (reason) {
    var interrupted = false;
    if (this._client) {
        this._safeCloseConnection();
        interrupted = true;
    }
    this._sentChallenge = undefined;
    this._authenticated = undefined;
    if (reason.constructor == Abort) {
        this._clearBackoff();
        this._enabled = undefined;
    } else if (reason.constructor == PermanentFailure) {
        if (reason.error == "BadAuthentication" || reason.error == "DeviceNotFound") {
            if (this.onDeviceInvalid)
                this.onDeviceInvalid();
            this.disable();
            return;
        }
    }
    var now = new Date().getTime();
    if (!this._nextReschedule) {
        //first error
        this._lastFailure = now;
        this._nextReschedule = now + BASE_BACKOFF;
        this._backoffTimer = setTimeout(this._retry.bind(this), BASE_BACKOFF);
    } else if (this._backoffTimer) {
        //already waiting
        this._verbose("repeated backoffs in progress, supressing");
    } else {
        var last_timeout = this._nextReschedule - this._lastFailure;
        this._lastFailure = now;
        this._nextReschedule = now + Math.min(last_timeout * 2, MAX_BACKOFF);
        this._backoffTimer = setTimeout(this._retry.bind(this), this._nextReschedule - this._lastFailure);
    }
    this._abortRequests();
    if (interrupted && typeof(this.onInterrupted) == "function") {
        this.onInterrupted(reason);
    }
};
Connection.prototype._retry = function(reason) {
    this._backoffTimer = undefined;
    if(this._enabled)
        this._connect();
}

Connection.prototype.resetConnection = function() {
    this._retry();
}

Connection.prototype.disable = function() {
    if (!this._enabled)
        return;
    this._enabled = undefined;
    if (this._client) {
        this._safeCloseConnection();
    }
    this._clearBackoff(new Abort());
};


Connection.prototype._sendRequest = function(req) {
    var wrapped = req[this._requestWrapper]();
    wrapped.Request.RequestId = this._nextRequestId++;
    var body = JSON.stringify(wrapped.encode());
    this._verbose(body);
    this._client.send(body);
    return wrapped;
};
Connection.prototype._sendResponse = function(wrapped) {
    var body = JSON.stringify(wrapped.encode());
    this._verbose(body);
    this._client.send(body);
};

Connection.prototype._call = function (req, callback) {
    var wrapped = this._sendRequest(req);
    var rcb = new PendingRequest(wrapped, req, callback);
    this._pending[wrapped.Request.RequestId] = rcb;
}

Connection.prototype._enqueue = function(req, callback) {
    if (!this._endpoint)
        this._warn("enqueueing message request before registered");
    var wr = new WaitingRequest(req, callback);
    this._waiting.push(wr);
}

Connection.prototype.call = function(req, callback) {
    if (this._authenticated)
        this._call(req, callback);
    else
        this._enqueue(req, callback);
}

Connection.prototype._sendHello = function() {
    var req = new proto.LDHelloChallengeRequest();
    req.SourceKey = this._publicKey;
    req.ApiKey = this._apiKey;
    req.DestinationChallenge = this._challengeForServer = ourcrypto.createNonce();
    this._call(req, this._ackHello.bind(this));
};

Connection.prototype._ackHello = function (error, resp, req) {
    if (error) {
        if (error.constructor == PermanentFailure && error.error == "DeviceNotFound") {
            this._warn("device no longer valid");
            if (this.onDeviceInvalid)
                this.onDeviceInvalid();
            this.disable();
            return;
        }

        this._backoff(error);
        return;
    }

    var response = resp.DestinationResponse;
    var challenge = resp.SourceChallenge;

    var shared = ourcrypto.computeShared(this._privateKey, this._serverPublicKey);

    var sha = ourcrypto.createSHA256();
    sha.update(new Buffer([1]));
    sha.update(new Buffer(shared));
    sha.update(new Buffer(this._challengeForServer));
    if (sha.digest('base64') != response.toString('base64')) {
        this._warn("server failed challenge");
        this._backoff(new TemporaryFailure("server failed challenge"));
        return;
    }

    sha = ourcrypto.createSHA256();
    sha.update(new Buffer([2]));
    sha.update(new Buffer(shared));
    sha.update(new Buffer(challenge));
    var sourceResponse = new Buffer(sha.digest('base64'), 'base64');

	var appResponse = null;
	if (this._apiSecret) {
	    sha = ourcrypto.createSHA256();
	    sha.update(new Buffer(this._apiSecret));
	    sha.update(new Buffer(challenge));
	    appResponse = new Buffer(sha.digest('base64'), 'base64');
    }
    var req = new proto.LDCompleteChallengeRequest();
    req.SourceResponse = sourceResponse;
    req.AppChallengeResponse = appResponse;
    this._sentChallenge = true;
    this._call(req, this._pumpRequests.bind(this));
};

Connection.prototype.sendPing = function(delay, lastRtt, cb) {
	if(!this.connected) {
		cb(new TemporaryFailure("NotConnected"));
		return;
	}
    var req = new proto.LDPingRequest();
	req.NextPingDelayMs = delay;
	req.LastRtt = lastRtt;
    var start = new Date().getTime();
    this._call(req, this._ackPing.bind(this, start, cb));
};

Connection.prototype._ackPing = function (start, cb, error, resp, req) {
    var end = new Date().getTime();
    if (error) {
        if (typeof cb == 'function')
    		cb(error);
		return;
	}

    this.lastRtt = end - start;
    this.serverTimeDelta = Math.round(resp.UtcMillis - end + this.lastRtt / 2);
    if (typeof cb == 'function')
    	cb(undefined, resp.ObservedIp, resp.UtcMillis);
};

Connection.prototype._keepAlive = function(connId) {
    if (this.keepaliveMs <= 0)
        return;

    if (!this.connected || this.connectionId != connId)
        return;

    this.sendPing(this.keepaliveMs, this.lastRtt, function() {
        setTimeout(this._keepAlive.bind(this, connId), this.keepaliveMs);
    }.bind(this));

}

Connection.prototype._pumpRequests = function (error, resp, req) {
    if (error) {
        this._backoff(error);
        return;
    }
    this._authenticated = true;
    for (var i = 0; i < this._waiting.length; ++i)
        this._call(this._waiting[i].request, this._waiting[i].callback);
    this._waiting = undefined; //no waiting requests while we are running
};

Connection.prototype._abortRequests = function (error) {
    var pending = this._pending;
    this._pending = {};;
    for (var k in this._pending) {
        try {
            pending[k].callback(reason, undefined, pending[k].request);
        } catch (e) {
            this._warn("failure in callback for abort pending" + e, e);
            this._verbose(e.stack);
        }
    }
    var waiting = this._waiting;
    this._waiting = [];
    for (var i = 0; i < this._waiting; ++i) {
        try {
            waiting[i].callback(reason, undefined, waiting[i].request);
        } catch (e) {
            this._warn("failure in callback for abort waiting " + e, e);
            this._verbose(e.stack);
        }
    }
};

Connection.prototype._onerror = function (e) {
    this._warn('error' + e);
	this.connected = false;
    this._verbose(e);
    this._backoff(new TemporaryFailure(e));
};

Connection.prototype._onopen = function () {
    this._warn('connected');
	this.connected = true;
    this.connectionId++;
    this._clearBackoff();

    //this._keepAlive(this.connectionId);
	if(!this._monitoring)
		this._sendHello();

    if (typeof(this.onSessionEstablished) == 'function') {
        this.onSessionEstablished();
    }
};

Connection.prototype._onclose = function (e) {
    this._warn('closed: ' + e.reason + " (" + e.code + ")");
	this.connected = false;
	if(e.code != 1000)
		this._backoff(new TemporaryFailure(e.reason));
};

function firstNotNull(o, d) {
    for (var k in o) {
        var s = o[k];
        if (s === null || s === undefined)
            continue;
        if (typeof (s) == "object") {
            if (d == 1)
                return s;
            var c = firstNotNull(s, d - 1);
            if (c !== null && c !== undefined)
                return c;
        }
    }
    return null;
}

Connection.prototype._extractResponse = function (resp) {
    if (resp.Response.HelloChallenge)
        return resp.Response.HelloChallenge;
    if (resp.Response.Simple)
        return resp.Response.Simple.Value;
    if (resp.Response.Ping)
        return resp.Response.Ping;
    return firstNotNull(resp.Response, 2);
}
Connection.prototype._extractPush = function (resp) {
    return firstNotNull(resp.Request, 2);
}

Connection.prototype._onmessage = function (e) {
    //When isn't this string??
    if (typeof e.data !== 'string')
        return;

    this._verbose("Received: '" + e.data + "'");
    var resp = new this._wrapperConstructor(JSON.parse(e.data));
    if (resp.Response) {
        var rcb = this._pending[resp.Response.RequestId];
        if (!rcb) {
            this._warn("unknown request id " + resp.Response.RequestId);
            this._verbose(resp);
            this._backoff(new Abort());
            return;
        }
        delete this._pending[resp.Response.RequestId];
        if (resp.Response.ErrorCode || resp.Response.ErrorDetail) {
            if (!rcb.callback) {
                this._warn("failure in callback for response " + e);
                this._verbose(rcb.request);
            } else {
                try {
                    if (resp.Response.ErrorCode && resp.Response.ErrorCode != "UnknownError")
                        rcb.callback(new PermanentFailure(resp.Response.ErrorCode), undefined, rcb.request);
                    else
                        rcb.callback(new TemporaryFailure(resp.Response.ErrorCode || resp.Response.ErrorDetail), undefined, rcb.request);
                } catch (e) {
                    this._warn("failure in callback for response " + e);
                    this._verbose(rcb.request);
                    throw e;
                }
            }
            return;
        }

        if (rcb.callback) {
            var extracted = this._extractResponse(resp);
            try {
                rcb.callback(undefined, extracted, rcb.request);
            } catch (e) {
                this._warn("failure in callback for success " + e, e);
                this._verbose(resp);
                this._verbose(extracted);
                throw e;
            }
        }
    } else {
        var extracted = this._extractPush(resp);
        if (!this.onPush) {
            this._warn("unhandled push: " + e.data);
        } else {
            try {
                this.onPush(extracted);
            } catch (e) {
                this._warn("failure in callback for push " + e, e);
                this._verbose(resp);
                this._verbose(extracted);
                throw e;
            }
        }
        var wrapper = new this._wrapperConstructor();
        wrapper.Response = new this._responseConstructor();
        wrapper.Response.RequestId = resp.Request.RequestId;
        this._sendResponse(wrapper);
    }
};


module.exports = {
  IDP_CLUSTER:IDP_CLUSTER,
  Connection:Connection,
  PermanentFailure:PermanentFailure,
  TemporaryFailure:TemporaryFailure
};
Object.freeze(module.exports);
