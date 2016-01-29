// See the LICENSE file

const path = require('path');

global.JXMobile = function JXMobile(x) {
  if (!(this instanceof JXMobile)) return new JXMobile(x);

  this.name = x;
}

function callJXcoreNative(name, sync, args) {
    var params = Array.prototype.slice.call(args, 0);

    var cb = "$$jxcore_callback_" + JXMobile.eventId;
    JXMobile.eventId++;
    JXMobile.eventId %= 1e5;

    if (sync) {
        if (params.length && typeof params[params.length - 1] == "function")
            JXMobile.on(cb, new WrapFunction(cb, params[params.length - 1]));
        params.pop();
    }

    var fnc = [name];
    var arr = fnc.concat(params);
    arr.push(cb);

    process.natives.callJXcoreNative.apply(null, arr);

    return cb;
}

function WrapFunction(cb, fnc) {
  this.fnc = fnc;
  this.cb = cb;

  var _this = this;
  this.callback = function () {
    delete JXMobile.events[_this.cb];
    return _this.fnc.apply(null, arguments);
  }
}

JXMobile.events = {};
JXMobile.eventId = 0;
JXMobile.on = function (name, target) {
  JXMobile.events[name] = target;
};

JXMobile.prototype.callNative = function () {
    callJXcoreNative(this.name, true, arguments);
    return this;
};

JXMobile.prototype.callAsyncNative = function () {
    return callJXcoreNative(this.name, false, arguments);
};

var isAndroid = process.platform == "android";

JXMobile.ping = function (name, param) {
  var x;
  if (Array.isArray(param)) {
    x = param;
  } else if (param.str) {
    x = [param.str];
  } else if (param.json) {
    try {
      x = [JSON.parse(param.json)];
    } catch (e) {
      return e;
    }
  } else {
    x = null;
  }

  if (JXMobile.events.hasOwnProperty(name)) {
    var target = JXMobile.events[name];

    if (target instanceof WrapFunction) {
      return target.callback.apply(target, x);
    } else {
      return target.apply(null, x);
    }
  } else {
    console.warn(name, "wasn't registered");
  }
};

process.natives.defineEventCB("eventPing", JXMobile.ping);

JXMobile.prototype.registerToNative = function (target) {
  if (!isAndroid)
    process.natives.defineEventCB(this.name, target);
  else
    JXMobile.events[this.name] = target;
  return this;
};

JXMobile.GetDocumentsPath = function(callback) {
  if (typeof callback != "function") {
    throw new Error("JXMobile.GetDocumentsPath expects a function callback");
  }

  JXMobile('GetDocumentsPath').callNative(function(res){
    callback(null, res);
  });
};

JXMobile.GetCachePath = function(callback) {
  if (typeof callback != "function") {
    throw new Error("JXMobile.GetDocumentsPath expects a function callback");
  }

  JXMobile('GetCachePath').callNative(function(res){
    callback(null, res);
  });
};

JXMobile.GetConnectionStatus = function(callback) {
  if (typeof callback != "function") {
    throw new Error("JXMobile.GetConnectionStatus expects a function callback");
  }

  JXMobile('GetConnectionStatus').callNative(function(res){
    callback(null, res);
  });
};

JXMobile.GetEncoding = function(callback) {
    callback(null, 'utf16le');
};

JXMobile.Exit = function() {
    JXMobile('Exit').callNative(function(res) { });
};

function AndroidSharedPreferences() {
    this._writes = [];

    this._scheduledWrite = false;
}

AndroidSharedPreferences.prototype._flushWrites = function() {
    if (this._writes.length == 0)
        return;

    var writes = this._writes;
    this._writes = [];
    // can't pass complex objects to Java, so go through JSON
    JXMobile('SharedPreferences_writeSharedPref').callNative(JSON.stringify(writes), function(error) {
        if (error)
            console.error('Failed to flush shared preferences to disk');
    });
};

AndroidSharedPreferences.prototype.get = function(name) {
    this._flushWrites();

    var _value;
    var _error;
    JXMobile('SharedPreferences_readSharedPref').callNative(name, function(error, res) {
        if (error)
            _error = error;
        else
            _value = res;
    });
    if (_error !== undefined)
        throw new Error(_error);
    if (_value === null)
        return undefined;
    else
        return JSON.parse(_value);
};

AndroidSharedPreferences.prototype.set = function(name, value) {
    this._writes.push([name, JSON.stringify(value)]);

    if (this._scheduledWrite)
        return value;

    this._scheduledWrite = true;
    setTimeout(function() {
        this._flushWrites();
        this._scheduledWrite = false;
    }.bind(this), 30000);

    return value;
};

JXMobile.GetSharedPreferences = function(callback) {
    callback(null, new AndroidSharedPreferences());
};

console.warn("Platform", process.platform);
console.warn("Process ARCH", process.arch);

// see jxcore.java - jxcore.m
process.setPaths();

if (isAndroid) {
  // bring APK support into 'fs'
  process.registerAssets = function (from) {
    var fs = from;
    if (!fs || !fs.existsSync)
      fs = require('fs');

    var path = require('path');
    var folders = process.natives.assetReadDirSync();
    var root = process.cwd();

    // patch execPath to APK folder
    process.execPath = root;

    try {
      // force create www/jxcore sub folder so we can write into cwd
      if (!fs.existsSync(process.userPath)) {
        fs.mkdir(process.userPath);
        if (!fs.existsSync(root)) {
          fs.mkdir(root);
        }
      }
    } catch (e) {
      console.error("Problem creating assets root at ", root);
      console.error("You may have a problem with writing files");
      console.error("Original error was", e);
    }

    var jxcore_root;

    var prepVirtualDirs = function () {
      var _ = {};
      for (var o in folders) {
        var sub = o.split('/');
        var last = _;
        for (var i in sub) {
          var loc = sub[i];
          if (!last.hasOwnProperty(loc)) last[loc] = {};
          last = last[loc];
        }
        last['!s'] = folders[o];
      }

      folders = {};
      var sp = root.split('/');
      if (sp[0] === '') sp.shift();
      jxcore_root = folders;
      for (var o in sp) {
        if (sp[o] === 'jxcore')
          continue;

        jxcore_root[sp[o]] = {};
        jxcore_root = jxcore_root[sp[o]];
      }

      jxcore_root['jxcore'] = _; // assets/www/jxcore -> /
      jxcore_root = _;
    };

    prepVirtualDirs();

    var findIn = function (what, where) {
      var last = where;
      for (var o in what) {
        var subject = what[o];
        if (!last[subject]) return;

        last = last[subject];
      }

      return last;
    };

    var getLast = function (pathname) {
      while (pathname[0] == '/')
        pathname = pathname.substr(1);

      while (pathname[pathname.length - 1] == '/')
        pathname = pathname.substr(0, pathname.length - 1);

      var dirs = pathname.split('/');

      var res = findIn(dirs, jxcore_root);
      if (!res) res = findIn(dirs, folders);
      return res;
    };

    var stat_archive = {};
    var existssync = function (pathname) {
      var n = pathname.indexOf(root);
      if (n === 0 || n === -1) {
        if (n === 0) {
          pathname = pathname.replace(root, '');
        }

        var last;
        if (pathname !== '') {
          last = getLast(pathname);
          if (!last) return false;
        } else {
          last = jxcore_root;
        }

        var result;
        // cache result and send the same again
        // to keep same ino number for each file
        // a node module may use caching for dev:ino
        // combinations
        if (stat_archive.hasOwnProperty(pathname))
          return stat_archive[pathname];

        if (typeof last['!s'] === 'undefined') {
          result = { // mark as a folder
            size: 340,
            mode: 16877,
            ino: fs.virtualFiles.getNewIno()
          };
        } else {
          result = {
            size: last['!s'],
            mode: 33188,
            ino: fs.virtualFiles.getNewIno()
          };
        }

        stat_archive[pathname] = result;
        return result;
      }
    };

    var readfilesync = function (pathname) {
        if (!existssync(pathname)) {
            //var error = new Error(pathname + " does not exist");
            //error.code = 'ENOENT';
            //throw error;
            return '';
        }

      var n = pathname.indexOf(root);
      if (n === 0) {
        pathname = pathname.replace(root, "");
        pathname = path.join('jxcore/', pathname);
        return process.natives.assetReadSync(pathname);
      }
    };

    var readdirsync = function (pathname) {
      var n = pathname.indexOf(root);
      if (n === 0 || n === -1) {
        var last = getLast(pathname);
        if (!last || typeof last['!s'] !== 'undefined') return null;

        var arr = [];
        for (var o in last) {
          var item = last[o];
          if (item && o != '!s') arr.push(o);
        }
        return arr;
      }

      return null;
    };

    var extension = {
      readFileSync: readfilesync,
      readDirSync: readdirsync,
      existsSync: existssync
    };

    fs.setExtension("jxcore-java", extension);
    var node_module = require('module');

    node_module.addGlobalPath(process.execPath);
    node_module.addGlobalPath(process.userPath);
  };

  process.registerAssets();

  // if a submodule monkey patches 'fs' module, make sure APK support comes with it
  var extendFS = function() {
    process.binding('natives').fs += "(" + process.registerAssets + ")(exports);";
  };

  extendFS();

  // register below definitions for possible future sub threads
  jxcore.tasks.register(process.setPaths);
  jxcore.tasks.register(process.registerAssets);
  jxcore.tasks.register(extendFS);
} else {
  jxcore.tasks.register(process.setPaths);
}

process.on('uncaughtException', function (e) {
    Error.captureStackTrace(e);
    console.error(e.stack);
    JXMobile('OnError').callNative(e.message, JSON.stringify(e.stack));
});

console.log("JXcore Android bridge is ready!");

// now load the main file and let it run!
require(path.join(process.cwd(), 'app.js'));
