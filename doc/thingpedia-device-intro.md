# Writing Interfaces for ThingPedia

## The basics: Devices, Channels and Events

At the highest level, a ThingPedia interface is just a nodejs
package, whose main entry point is a _device class_.

From a device class, the system will obtain _device instances_,
which are the individual objects that represent things in
the system (we use "device" as a term in the code to mean both
physical devices and web services). A device instance contains
all the descriptors that are needed to identify the thing,
such as account ID or IP/MAC address, and contains any authentication
information.

From each device instance, when needed the system will obtain
_channels_. A channel is an abstraction over a trigger or an
action, which is represented as an open connection to the device.

A channel produces and handles _events_. These are just JS arrays of values
that are processed by the ThingTalk rules. A trigger channel will
produce new events to be handled by the rules, based on the data
obtained by the device. An action channel will consume an event
produced by a rule and turn into in an external action.

Channels can be opened and closed. For triggers, an open channel
is one that generates events, and a closed channel does not.
For actions, you can assume that invocations will only happen on
open channels, so you can release any resource during close.

You should never need to open or instantiate channels yourself.
Instead, you would set up your _channel class_ so that the system
will create and open the channels at the right time.

## The layout of a Device package

The ThingPedia API assumes a precise layout for a device package.

The primary entry point (i.e., the one named as "main" in package.json)
should be a _device class_. You would instantiate the device class
from the API and set it directly to `module.exports`, as in

    const Tp = require('thingpedia');

    module.exports = new Tp.DeviceClass({
        Name: "MyDeviceClass",

        _init: function(engine, state) {
             // constructor
        }

        // other methods of device class
    });

Then, for each trigger or action you want to expose, you would
have a separate JS file for each, named after the trigger or action,
exposing the channel class as `module.exports`. So for example, if
you want to expose action `.frobnicate()`, you would put the following
in a file named `frobnicate.js` at the toplevel of your device package:

    const Tp = require('thingpedia');

    module.exports = new Tp.ChannelClass({
        Name: "FrobnicateChannel",

        _init: function(engine, device) {
             // constructor
        }

        // other methods of channel class
    });

## Representing Devices

A device instance holds several pieces of data.

### _primary kind_ (or just kind)

The name of your nodejs package, and the unique identifier of your
device class that you will use to publish your device to ThingPedia;
you can access it as `this.kind` in your device class.

### _secondary kinds_

Additional types that your device class conforms to. If your device class
supports secondary kind `foo`, then a rule can refer to it as `@(type="foo")`.

The most important secondary kind is `online-account`, which will flag
the device as an account, and will change where it appears in the UI.

Other important secondary kinds are `cloud-only`, `phone-only` or `server-only`,
which will prevent your code from being instantiated outside of the right
ThingEngine installation.

### _state_

An arbitrary serializable JS object with data you will need
to talk to the device - including IP addresses, OAuth tokens, variable
portions of API urls, etc; you can access the state as `this.state` in your
device class.

There is no structure in the state object, with the following exceptions:

- `state.kind` must be the primary kind
- `state.tags` can be an array of user-defined tags
- if your device supports discovery, `state.discoveredBy` must be the tier
  (phone or server) that did the discovery (normally set to `this.engine.ownTier`)

### _unique ID_

A string that uniquely identifies the device instance
in the context of a given ThingEngine; you are supposed to compute it
based on the state and set `this.uniqueId` at the end of your
constructor

A common way to compute an unique ID is to concatenate the kind, a dash,
and then some device specific ID, as in `org.thingpedia.demos.thingtv-AA-BB-CC-DD-EE-FF`
if `AA:BB:CC:DD:EE:FF` is the MAC address of the ThingTV.

### _descriptors_

If your device supports local discovery, the descriptors
are identifiers obtained by the discovery protocol, such as `bluetooth-00-11-22-33-44-55`.

Discovery will be described further in a later section

## A closer look to the Device class

When you create a device class with `new Tp.DeviceClass`, you're actually declaring
a subclass of [`Tp.BaseDevice`](https://github.com/Stanford-IoT-Lab/thingpedia-api/blob/master/lib/base_device.js), the base class of all device classes.

By convention, members starting with a capital letter here are static, and members stating
with lower case are instance methods and variables. `Tp.BaseDevice` has you the following API:

- `this.uniqueId`, `this.state`, `this.kind`: provide access to the respective pieces
of device instance data
- `this.engine`: gives you access to the full Engine API
- `this.stateChanged()`: if you change `this.state`, you must at some point call `this.stateChanged`
to preserve the modification to disk
- `this.updateState(newState)`: conversely, if the state changes outside of you, and you
want to recompute state, you should override `updateState()` to handle the new state; the overriding
method should chain up (with `this.parent(newState)`) as the first statement
- `this.hasKind(kind)`: check if the device has the given kind (primary or secondary); the
default implementation has no secondary kinds, override it if you need it
- `Kinds`: an array of secondary kinds, which provides a quick way to implement `hasKind` if
you don't need dynamic behavior
- `UseOAuth2`: if your device can be instantiated with an OAuth-like flow (user clicks on a button,
is redirected to a login page), this should be set to the handler; despite the name, this is
called also for OAuth 1 or no authentication at all
- `UseDiscovery`, `this.updateFromDiscovery`: discovery operations, described later
- `this.queryInterface(iface)`: request an _extension interface_ for this device instance; extension
interfaces are optional features that your device class supports; override this method if you have
any, otherwise the default implementation will always return `null`.

## The Engine API

`this.engine` on a device gives you access to the
[`Engine`](https://github.com/Stanford-IoT-Lab/thingengine-core/blob/master/lib/engine.js)
object, which is shared among all device instances. The API on the
`Engine` object is less stable than `Tp.BaseDevice`, but it is
nevertheless useful.

- `engine.ownTier`: the currently running tier of ThingEngine, ie `cloud`, `phone` or `server`
- `engine.messaging`: gives you access to the primary messaging interface (i.e., the primary
Omlet account)
- `engine.keywords`: the keyword database that holds the ThingTalk persistent data
- `engine.channels`: the factory class that instantiates channels and deduplicates them
- `engine.devices`: the devices database
- `engine.apps`: the apps database
- `engine.ui`: the UI API, to register callbacks for `@$notify()` and `@$input()` in rules
- `engine.assistant`: the Assistant API, to send and receive messages for Sabrina; this API is cloud-only

## Extension Interfaces and Messaging

## Handling Authentication

## Handling Discovery

## Channel classes

## Stateful Channels

## Writing Triggers

## Device Metadata

## Publishing on ThingPedia

## Generic Devices
