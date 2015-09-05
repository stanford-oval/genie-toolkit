// -*- mode: js; indent-tabs-mode: nil; js-basic-offset: 4 -*-
//
// This file is part of ThingEngine
//
// Copyright 2015 Giovanni Campagna <gcampagn@cs.stanford.edu>
//
// See COPYING for details

const Q = require('q');

const Engine = require('./engine');
const Frontend = require('./frontend');

var alljoyn = require('alljoyn');

function main() {
    global.platform = require('./platform');

    var test = process.argv.indexOf('--test') >= 0;
    platform.init(test).then(function() {
        var engine = new Engine();
        var frontend = new Frontend();
        platform._setFrontend(frontend);
        frontend.setEngine(engine);

        var earlyStop = false;
        var engineRunning = false;
        function handleSignal() {
            if (engineRunning)
                engine.stop();
            else
                earlyStop = true;
        }
        //process.on('SIGINT', handleSignal);
        //process.on('SIGTERM', handleSignal);

        return Q.all([engine.open(), frontend.open()]).then(function() {
            frontend.engineLoaded();
            engineRunning = true;
            if (earlyStop)
                return;
            return engine.run().finally(function() {
                return Q.all([engine.close(), frontend.close()]);
            });
        });
    }).then(function () {
        console.log('Cleaning up');
        platform.exit();
    }).done();
}

var portNumber = 27;
var advertisedName = "edu.stanford.thingengine.bus.discover"; //"edu.stanford.thingengine.bus.chat";
var busName = "discover";
var busObjectName = "/discoverService"
var discoverMessage = "Hello"


function initAllJoynBus(allJoynState) {
    console.log('initiaing AllJoyn Bus', alljoyn);
    
    console.log("CreateInterface "+allJoynState.bus.createInterface(advertisedName, allJoynState.interface));
    console.log("AddSignal "+allJoynState.interface.addSignal(discoverMessage, "s",  "msg"));
    allJoynState.bus.registerBusListener(allJoynState.busListener);

    console.log("Start "+allJoynState.bus.start());
}

function connectToAllJoynBus(allJoynState)
{
    console.log("Connect"+allJoynState.bus.connect());
    console.log("FindAdvertisedName "+allJoynState.bus.findAdvertisedName(advertisedName));
}

function initAllJoynClient() {
    var allJoynState = new Object;
    var sessionId = 0;
    var discoverObject = alljoyn.BusObject(busObjectName);

    allJoynState.bus = alljoyn.BusAttachment(busName);
    allJoynState.interface = alljoyn.InterfaceDescription();
    allJoynState.busListener = alljoyn.BusListener(
      function(name){
        console.log("FoundAdvertisedName", name);
        sessionId = allJoynState.bus.joinSession(name, portNumber, 0);
        console.log("JoinSession "+ sessionId);
        setTimeout(function(){
          discoverObject.signal(null, sessionId, allJoynState.interface, discoverMessage, "Hello, I am the client!");
        }, 1000);
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
      function(port, sessionId, joiner){
        console.log("SessionJoined", port, sessionId, joiner);
      }
    );

    initAllJoynBus(allJoynState);
    
    console.log("discoverObject.AddInterface "+discoverObject.addInterface(allJoynState.interface));
    console.log("RegisterSignalHandler "+allJoynState.bus.registerSignalHandler(discoverObject, function(msg, info){
      console.log("Signal received: ", msg, info);
      console.log(msg["0"]);
    }, allJoynState.interface, discoverMessage));

    console.log("RegisterBusObject "+allJoynState.bus.registerBusObject(discoverObject));
  
    connectToAllJoynBus(allJoynState);

    /*
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
      // chatObject.signal(null, sessionId, inter, 'hello' );
      discoverObject.signal(null, sessionId, allJoynState.interface, discoverMessage, key);
    });
    */
}


function initAllJoynHost() {
 
}

initAllJoynClient();
main();
