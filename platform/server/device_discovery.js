// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Albert Chen <hselin.chen@gmail.com>
//
// See COPYING for details

const lang = require('lang');
const alljoyn = require('alljoyn');

// let alljoyn (or the kernel, really) pick the port number, we don't
// really care and alljoyn will make sure the router knows where to talk
const SESSION_PORT_ANY = 0;

// the interface we're exporting
var busInterfaceName = "edu.stanford.thingengine.DeviceDiscovery";

// this the well-known name in alljoyn and d-bus terminology
var advertisedName = "edu.stanford.thingengine.bus.DeviceDiscovery";

// this is alljoyn specific, no equivalent in d-bus (and I'm not sure how it's used)
var applicationName = "edu.stanford.thingengine";

// this is the object path in d-bus terminology
var busObjectName = "/edu/stanford/thingengine/DiscoverService";

// this is the method/signal name we're using
var discoverMessage = "Hello";

function check(ok) {
    if (ok != 0)
        throw new Error('Alljoyn Call failed with error ' + ok);
}

module.exports = new lang.Class({
    Name: 'DeviceDiscovery',

    _init: function(engine) {
        this._engine = engine;
        this._sessionMap = {};
    },

    _initAllJoynBus: function() {
        console.log('Initiating AllJoyn Bus');

        this._bus = alljoyn.BusAttachment(applicationName);
        this._bus.registerBusListener(this._busListener);

        check(this._bus.start());
    },

    _initAllJoynExportedObjects: function() {
        this._discoveryInterface = alljoyn.InterfaceDescription();
        check(this._bus.createInterface(busInterfaceName, this._discoveryInterface));

        check(this._discoveryInterface.addSignal(discoverMessage, 's', 'msg'));

        this._discoveryObject = alljoyn.BusObject(busObjectName);
        check(this._discoveryObject.addInterface(this._discoveryInterface));

        check(this._bus.registerBusObject(this._discoveryObject));
    },

    _connectToAllJoynBus: function(allJoynState) {
        // we use the regular dbus session bus if one is available
        // this allows easy debugging with d-feet and similar tools
        var dbusAddress = process.env.DBUS_SESSION_BUS_ADDRESS;

        if (dbusAddress)
            check(this._bus.connect(dbusAddress));
        else
            check(this._bus.connect());

        // bind a TCP port for 1-to-1 communication
        // (if we didn't do this, all communication would go through the bus)
        try {
            check(this._bus.bindSessionPort(SESSION_PORT_ANY, this._sessionPortListener));
        } catch(e) {
            // eat the error: it likely means that we're running of regular
            // d-bus instead of alloyn d-bus, and we don't have an alljoyn
            // router that knows about session ports
            // not too bad, stuff will be sessionless
        }

        // ask the bus to own the well-known name
        check(this._bus.requestName(advertisedName));
        try {
            // and start advertising it over the local network
            check(this._bus.advertiseName(advertisedName));
        } catch(e) {
            // eat the error: it likely means that we're running of regular
            // d-bus instead of alloyn d-bus, and we don't have an alljoyn
            // router that knows about session advertisements
        }
    },

    start: function() {
        console.log("Initializing DeviceDiscovery module");

        this._busListener = alljoyn.BusListener(
        function(name) {
            console.log("Found AdvertisedName: " + name);

            // here we would join a session (1-to-1 communication)
            // with the advertised name owner with some predefined
            // well known session port
            // but we don't do that, because we're not using any
            // useful protocol yet
        }.bind(this),
        function(name) {
            console.log("Lost AdvertisedName: " + name);
        },
        function(name) {
            console.log("NameOwnerChanged: " + name);
        }
        );

        this._sessionPortListener = alljoyn.SessionPortListener(
        function(port, joiner){
            console.log('Received incoming session request');
            // accept all session requests for now
            return true;
        },
        function(port, sessionID, joiner){
            console.log('Joined session ' + sessionID);

            this._sessionMap[sessionID] = sessionID;
        }.bind(this)
        );

        this._initAllJoynBus();
        this._initAllJoynExportedObjects();

        /*
        This is the code to connect to a signal on our object, and act on it.
        Because we're the ones owning the object and emitting stuff from it,
        we don't actually have this code. It's for illustration purposes only.

        check(this._bus.registerSignalHandler(this._discoveryObject, function(args, sender) {
            console.log('AllJoyn signal received from ', sender);
            // args is an array of signal arguments (dbus serializable values)
            console.log(args);
        }, this._discoveryInterface, discoverMessage));
        */

        this._connectToAllJoynBus();
    }
});
