// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const lang = require('lang');
const Q = require('q');

var asyncCallbacks = {};
var eventCallbacks = {};

module.exports.makeJavaAPI = function makeJavaAPI(klass, asyncMethods, syncMethods) {
    var obj = {
        registerCallback: function(callbackName, callback) {
            eventCallbacks[klass + '_' + callbackName] = callback;
        },

        unregisterCallback: function(callbackName) {
            delete eventCallbacks[klass + '_' + callbackName];
        },
    };
    asyncMethods.forEach(function(method) {
        obj[method] = function() {
            var call = JXMobile(klass + '_' + method);
            var cb = call.callAsyncNative.apply(call, arguments);
            var defer = Q.defer();
            asyncCallbacks[cb] = defer;
            return defer.promise;
        }
    });
    syncMethods.forEach(function(method) {
        obj[method] = function() {
            var call = JXMobile(klass + '_' + method);
            return Q.npost(call, 'callNative', arguments);
        }
    });

    return obj;
}

module.exports.invokeCallback = function(callbackId, error, value) {
    if (callbackId in eventCallbacks)
        return eventCallbacks[callbackId](error, value);

    if (!callbackId in asyncCallbacks) {
        console.log('Invalid callback ID ' + callbackId);
        return;
    }

    if (error)
        asyncCallbacks[callbackId].reject(new Error(error));
    else
        asyncCallbacks[callbackId].resolve(value);
    delete asyncCallbacks[callbackId];
};
