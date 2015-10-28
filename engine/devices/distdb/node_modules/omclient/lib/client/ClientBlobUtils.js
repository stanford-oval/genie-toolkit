var proto = require("../ldproto");
var crypto = require('crypto');
var http = require('http');
var https = require('https');
var url = require('url');
var async = require('async');

function BlobUtils(client) {
	this._client = client;
}

BlobUtils.prototype.ensureBlobSource = function(hash, source, timestamp, feed, callback) {
    this._client.store.getBlobs(function(blobsDb) {
        blobsDb.getOrCreateObject(hash, function(blob) {
            for (var i = 0; i < blob.sources.length; i++) {
                if (blob.sources[i] == source) {
                    if (callback) {
                        callback.call();
                    }
                    return;
                }
            }

            blob.sources.push(source)
            blobsDb.update(blob, callback);

        }.bind(this));
    }.bind(this));

    return hash;
}

BlobUtils.prototype.hashFromLongdanUrl = function(url) {
    var parser = document.createElement('a');
    parser.href = url;
    if (parser.protocol == "hosted:") {
        var hash = url.split("#").pop();
        // cleansing
        hash = new Buffer(hash, "base64").toString("base64");
        return hash;
    }

    if (parser.protocol == "longdan:") {
        var path = parser.pathname.substring(1);
        var hash = path.split("/").pop();
        // cleansing
        hash = new Buffer(hash, "base64").toString("base64");
        return hash;
    }

    return null;
}

BlobUtils.prototype.uploadBlob = function(data, mime, cb) {
    var req = new proto.LDGetUploadTicketRequest();
    req.Account = this._client.account;
    req.Metadata = new proto.LDBlobMetadata();
    req.Metadata.MimeType = mime;
    req.Metadata.Size = data.length;
    
    var md5 = crypto.createHash('md5');
    md5.update(data);
    req.Metadata.Hash = md5.digest("base64");
    
    this._client.msgCall(req, this._gotUploadTicket.bind(this, data, cb));
}

BlobUtils.prototype._blobUrlCache = {};

BlobUtils.prototype.getDownloadLinkForHash = function(hash, cb) {
    if (hash in this._blobUrlCache) {
        var blob = this._blobUrlCache[hash];
        if (new Date().getTime() > blob.expires) {
            delete this._blobUrlCache[hash];
        } else {
            cb(undefined, blob.url);
            return;
        }
    }

    // Look up the blob as a 'low priority even', in case a blob+hash
    // has been scheduled for writing but is not yet available.
    async.nextTick(function() {
        this._client.store.getBlobs(function(blobsDb) {
            blobsDb.getObjectByKey(hash, function(blob) {
                if (!blob) {
                    cb("Blob not found");
                    return;
                }

                var url, brl;
                for (var i = 0; i < blob.sources.length; i++) {
                    var rec = blob.sources[i];
                    if (rec.startsWith("hosted://") || rec.startsWith("longdan://")) {
                        brl = blob.sources[i];
                        break;
                    } else if (rec.startsWith("http://") || rec.startsWith("https://")) {
                        url = rec;
                    }
                }

                if (brl === undefined && url !== undefined) {
                    cb(undefined, url);
                    return;
                }   

                var req = new proto.LDGetDownloadTicketRequest();
                req.BlobLinkString = brl;
                        
                this._client.msgCall(req, this._gotDownloadTicket.bind(this, function(err, url) {
                    if (url) {
                        var TEN_MINUTES = 1000*60*10;
                        var expires = new Date().getTime() + TEN_MINUTES;
                        this._blobUrlCache[hash] = { url: url, expires: expires };
                    }
                    cb(err, url);
                }.bind(this)));
            }.bind(this));
        }.bind(this));
    }.bind(this));
}

// An optimized version of getDownloadLinkForHash that checks
// to see if the image is in the Browser's cache even if the link is no longer valid.
// If not, attempt to get another blob download ticket from the server.
BlobUtils.prototype.getImageUrlForHash = function(hash, cb) {
    if (document) {
        // TODO: long-term persistence
        if (hash in this._blobUrlCache) {
            var blob = this._blobUrlCache[hash];
            var img = document.createElement('img');
            img.onerror = function(e) {
                this.getDownloadLinkForHash(hash, cb);
            }.bind(this);
            img.onload = function() {
                cb(undefined, blob.url);
            }.bind(this);
            img.src = blob.url;
        } else {
            this.getDownloadLinkForHash(hash, cb);
        }
    } else {
        this.getDownloadLinkForHash(hash, cb);
    }
}


BlobUtils.prototype.getDownloadLinkForBrl = function(blobLinkString, cb) {
    var req = new proto.LDGetDownloadTicketRequest();
    req.BlobLinkString = blobLinkString;
	        
    this._client.msgCall(req, this._gotDownloadTicket.bind(this, cb));
}

BlobUtils.prototype._gotUploadTicket = function (data, cb, e, resp) {
    if (e) {
        cb(e);
        return;
    }
    var ticket = resp.BlobUploadTicket;
    
    if (ticket.AlreadyUploaded) {
        cb(undefined, ticket.BlobLinkString);
        return;
    }
    
    var p = url.parse(ticket.UploadUrl);
    var options = {
        hostname: p.hostname,
        port: p.port,
        protocol: p.protocol,
        path: p.path,
        method: 'PUT',
        headers: ticket.UploadHeaders,
        withCredentials: false,
        responseType: 'arraybuffer'
    };
    if (!options.port) options.port = p.protocol == "https:" ? 443 : 80;
    options.headers['Content-Length'] = data.length;
    
    var invoker = p.protocol == "https:" ? https : http;
    var req = invoker.request(options, this._gotUploadResponse.bind(this, ticket, cb));
    req.on('error', function (e) { cb(e); });
    req.end(data);
}

BlobUtils.prototype._gotUploadResponse = function (uploadTicket, cb, resp) {
    if (resp.statusCode != 200) {
        cb(resp.statusCode);
        return;
    }
    var req = new proto.LDVerifyUploadCompletedRequest();
    req.BlobUploadTicket = uploadTicket;
    this._client.msgCall(req, this._gotBlobLinkString.bind(this, cb));

}

BlobUtils.prototype._gotBlobLinkString = function (cb, e, resp) {
    if (e) {
        cb(e);
        return;
    }
    cb(undefined, resp);
}

BlobUtils.prototype._gotDownloadTicket = function (cb, e, resp) {
    if (e) {
        cb(e);
        return;
    }
	if(resp.BlobDownloadTicket.Headers) {
		this._doDownload(this._gotDownload.bind(this, cb), undefined, resp);
	} else {
		cb(undefined, resp.BlobDownloadTicket.Url);
	}
}

BlobUtils.prototype._gotDownload = function (cb, e, resp) {
    if (e) {
        cb(e);
        return;
    }
	var uri = "data:application/octet-stream;base64," + resp.toString('base64');
    cb(undefined, uri);
}

BlobUtils.prototype.download = function(blobLinkString, cb) {
    var req = new proto.LDGetDownloadTicketRequest();
    req.BlobLinkString = blobLinkString;
	        
    this._client.msgCall(req, this._doDownload.bind(this, cb));
}

BlobUtils.prototype._doDownload = function(cb, e, resp) {
    if (e) {
        cb(e);
        return;
    }

    var p = url.parse(resp.BlobDownloadTicket.Url);
    var options = {
        protocol: p.protocol,
        hostname: p.hostname,
        port: p.port,
        path: p.path,
        headers: resp.BlobDownloadTicket.Headers,
        method: 'GET',
        withCredentials: false,
        responseType: 'arraybuffer'
    };
    
    if (!options.port) options.port = p.protocol == "https:" ? 443 : 80;
    var invoker = p.protocol == "https:" ? https : http;
    var req = invoker.request(options, this._gotDownloadResponse.bind(this, cb));
    req.on('error', function (e) { cb(e); });
    req.end();
}

BlobUtils.prototype.downloadUrl = function(link, cb) {
    var p = url.parse(link);
    var options = {
        protocol: p.protocol,
        hostname: p.hostname,
        port: p.port,
        path: p.path,
        method: 'GET',
        withCredentials: false,
        responseType: 'arraybuffer'
    };

    var invoker = p.protocol == "https:" ? https : http;
    var _responded = false;
    var req = invoker.request(options, function(resp) {
        if (resp.statusCode != 200) {
            if (!_responded) {
                _responded = true;
                cb(resp.statusCode ? resp.statusCode : "BrowserBlocked");
            }
            return;
        } else {
            var bufs = [];
            resp.on('data', function(d) {
                if (d.constructor == Uint8Array)
                    d = new Buffer(d);
                bufs.push(d);
            });
            resp.on('end', function() {
                if (!_responded) {
                    _responded = true;
                    cb(undefined, Buffer.concat(bufs));
                }
            });
        }
    }.bind(this));
    req.on('error', function (e) { 
        if (!_responded) {
            _responded = true;
            cb(e); 
        }
    });
    req.end();
}

BlobUtils.prototype._gotDownloadResponse = function (cb, resp) {
    var _responded = false;
    if (resp.statusCode != 200) {
        if (!_responded) {
            _responded = true;
            cb(resp.statusCode ? resp.statusCode : "BrowserBlocked");
        }
        return;
    }
    var bufs = [];
    resp.on('data', function(d) {
        if (d.constructor == Uint8Array)
            d = new Buffer(d);
        bufs.push(d);
    });
    resp.on('end', function() {
        if (!_responded) {
            _responded = true;
            cb(undefined, Buffer.concat(bufs));
        }
    });
}

BlobUtils.prototype.resizeImage = function(buf, sizes, cb) {
        var uri = "data:image/png;base64," + buf.toString('base64');
        var img = document.createElement('img');
        img.onerror = function(e) { cb("failed"); }
        img.onload = function() {
            var sized = [];
            for(var i = 0; i < sizes.length; ++i) {
                var edge = sizes[i];
                var scale = edge / Math.max(img.width, img.height);
                scale = Math.min(1.0, scale);
                var canvas = document.createElement('canvas'),
                ctx = canvas.getContext('2d');
                canvas.width = scale * img.width;
                canvas.height = scale * img.height;
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                var enc = canvas.toDataURL();
                sized.push({
                    data:new om.Buffer(enc.split(",")[1], 'base64'),
                    width:canvas.width,
                    height:canvas.height
                });
            }
            cb(undefined, sized);
        }
        img.src = uri;
    }

module.exports = BlobUtils;