// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Albert Chen <hselin.chen@gmail.com>
//
// See COPYING for details

const lang = require('lang');
const alljoyn = require('alljoyn');

var portNumber = 2727;
var busInterfaceName = "edu.stanford.thingengine.bus.discover"
var advertisedName = "edu.stanford.thingengine.bus.discover"; //"edu.stanford.thingengine.bus.chat";
var busName = "discover";
var busObjectName = "/discoverService"
var discoverMessage = "Hello"


module.exports = new lang.Class({
    Name: 'DeviceDiscovery',

    _init: function(engine) {
        //console.log("DeviceDiscovery - init " + engine);
        this._engine = engine;
        this._allJoynState = {};
        this._allJoynState.sessionMap = {};
        this._discoverObject = alljoyn.BusObject(busObjectName);
    },

    _initAllJoynBus: function(allJoynState) {
        console.log('Initiaing AllJoyn Bus', alljoyn);

        console.log("CreateInterface "+allJoynState.bus.createInterface(busInterfaceName, allJoynState.interface));
        console.log("AddSignal "+allJoynState.interface.addSignal(discoverMessage, "s",  "msg"));
        allJoynState.bus.registerBusListener(allJoynState.busListener);

        console.log("Start "+allJoynState.bus.start());
    },

    _connectToAllJoynBus: function(allJoynState) {
        // we use the regular dbus session bus if one is available
        // this allows easy debugging with d-feet and similar tools
        var dbusAddress = process.env.DBUS_SESSION_BUS_ADDRESS;

        if (dbusAddress)
            console.log("Connect"+allJoynState.bus.connect(dbusAddress));
        else
            console.log("Connect"+allJoynState.bus.connect());

        if (allJoynState.host) {
            console.log("RequestName "+allJoynState.bus.requestName(advertisedName));
            console.log("BindSessionPort "+allJoynState.bus.bindSessionPort(portNumber, allJoynState.sessionPortListener));
            console.log("AdvertiseName "+allJoynState.bus.advertiseName(advertisedName));
        }
        else
        {
            console.log("FindAdvertisedName "+allJoynState.bus.findAdvertisedName(advertisedName));
        }
    },

    _initAllJoynClient: function (allJoynState, discoverObject, deviceDB) {
        allJoynState.host = false;
        allJoynState.bus = alljoyn.BusAttachment(busName);
        allJoynState.interface = alljoyn.InterfaceDescription();
        allJoynState.busListener = alljoyn.BusListener(
        function(name){
            console.log("FoundAdvertisedName", name);
            var sessionID = allJoynState.bus.joinSession(name, portNumber, 0);
            allJoynState.sessionMap[sessionID] = sessionID;
            console.log("!!!!!!!!!!!!!!!!!!!!!!!! JoinSession "+ sessionID);
            setTimeout(function(){
                console.log("trying to send in session " + sessionID);
                discoverObject.signal(null, sessionID, allJoynState.interface, discoverMessage, "Hello from client!");
            }, 1);
        },
        function(name){
            console.log("LostAdvertisedName", name);
        },
        function(name){
            console.log("NameOwnerChanged", name);
        }
        );

        allJoynState.sessionPortListener = alljoyn.SessionPortListener(
            function(port, joiner){
                console.log("AcceptSessionJoiner", port, joiner);
                return true;
            },
            function(port, sessionID, joiner){
                console.log("SessionJoined", port, sessionID, joiner);
            }
        );

        this._initAllJoynBus(allJoynState);

        console.log("discoverObject.AddInterface "+discoverObject.addInterface(allJoynState.interface));
        console.log("RegisterSignalHandler "+allJoynState.bus.registerSignalHandler(discoverObject, function(msg, info){
            console.log("Signal received: ", msg, info);
            console.log(msg["0"]);
            var deviceID = info.sender;

            if(!deviceDB.hasDevice(deviceID)) {
                var newDevice = {};
                newDevice.uniqueId = deviceID;
                newDevice.serialize = function() {
                    var serializedObject = {};
                    serializedObject.id = deviceID;
                    serializedObject.member_name = info.member_name;
                    serializedObject.object_path = info.object_path;
                    serializedObject.signature = info.signature;
                    return serializedObject;
                };
                deviceDB.addDevice(newDevice);
            }

        }, allJoynState.interface, discoverMessage));

        console.log("RegisterBusObject "+allJoynState.bus.registerBusObject(discoverObject));

        this._connectToAllJoynBus(allJoynState);

        // Added Chat to example
        var stdin = process.stdin;

        // without this, we would only get streams once enter is pressed
        stdin.setRawMode( true );

        // resume stdin in the parent process (node app won't quit all by itself
        // unless an error or process.exit() happens)
        stdin.resume();

        // i don't want binary, do you?
        stdin.setEncoding( 'utf8' );

        // on any data into stdin
        stdin.on( 'data', function( key ){
            // ctrl-c ( end of text )
            if ( key === '\u0003' ) {
                process.exit();
            }
            // write the key to stdout all normal like
            process.stdout.write( key + '\n' );
            // chatObject.signal(null, sessionID, inter, 'hello' );
            console.log("allJoynState.interface " + allJoynState.interface);

            for(var sessionID in allJoynState.sessionMap){
                console.log("sessionID " + allJoynState.sessionMap[sessionID]);
                discoverObject.signal(null, allJoynState.sessionMap[sessionID], allJoynState.interface, discoverMessage, key);
            }
        });
    },

    _initAllJoynHost: function (allJoynState, discoverObject, deviceDB) {
        allJoynState.host = true;
        allJoynState.bus = alljoyn.BusAttachment(busName);
        allJoynState.interface = alljoyn.InterfaceDescription();
        allJoynState.busListener = alljoyn.BusListener(
        function(name){
            console.log("FoundAdvertisedName", name);
            var sessionID = allJoynState.bus.joinSession(name, portNumber, 0);
            allJoynState.sessionMap[sessionID] = sessionID;
            console.log("!!!!!!!!!!!!!!!!!!!!!! JoinSession "+ sessionID);
        },
        function(name){
            console.log("LostAdvertisedName", name);
        },
        function(name){
            console.log("NameOwnerChanged", name);
        }
        );

        allJoynState.sessionPortListener = alljoyn.SessionPortListener(
        function(port, joiner){
            console.log("##################### AcceptSessionJoiner", port, joiner);
            return port == portNumber;
        },
        function(port, sessionID, joiner){
            console.log("@@@@@@@@@@@@@@@@@@@@@@@ SessionJoined", port, sessionID, joiner);
            allJoynState.sessionMap[sessionID] = sessionID;
            setTimeout(function(){
                discoverObject.signal(null, sessionID, allJoynState.interface, discoverMessage, "Hello from host!");
            }, 1000);
        }
        );

        this._initAllJoynBus(allJoynState);

        console.log("discoverObject.AddInterface "+discoverObject.addInterface(allJoynState.interface));
        console.log("RegisterSignalHandler "+allJoynState.bus.registerSignalHandler(discoverObject, function(msg, info){
            console.log("Signal received: ", msg, info);
            console.log(msg["0"]);
        }, allJoynState.interface, discoverMessage));

        console.log("RegisterBusObject "+allJoynState.bus.registerBusObject(discoverObject));

        this._connectToAllJoynBus(allJoynState);

        // Added Chat to example
        var stdin = process.stdin;

        // without this, we would only get streams once enter is pressed
        stdin.setRawMode( true );

        // resume stdin in the parent process (node app won't quit all by itself
        // unless an error or process.exit() happens)
        stdin.resume();

        // i don't want binary, do you?
        stdin.setEncoding( 'utf8' );

        // on any data into stdin
        stdin.on( 'data', function( key ){
            // ctrl-c ( end of text )
            if ( key === '\u0003' ) {
                process.exit();
            }
            // write the key to stdout all normal like
            process.stdout.write( key + '\n' );
            // chatObject.signal(null, sessionID, inter, 'hello' );

            console.log("allJoynState.interface " + allJoynState.interface);

            for(var sessionID in allJoynState.sessionMap){
                console.log("sessionID " + allJoynState.sessionMap[sessionID]);
                discoverObject.signal(null, allJoynState.sessionMap[sessionID], allJoynState.interface, discoverMessage, key);
            }
        });
    },

    start: function(){
        console.log("DeviceDiscovery - run " + this._engine);
        this._initAllJoynClient(this._allJoynState, this._discoverObject, this._engine.devices);
    }
});
