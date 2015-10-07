package edu.stanford.thingengine.engine;

/**
 * Created by gcampagn on 8/16/15.
 */
public class ControlBinder extends IThingEngine.Stub {
    private final ControlChannel channel;

    public ControlBinder(ControlChannel channel) {
        this.channel = channel;
    }

    public int foo(int value) {
        return channel.sendFoo(value);
    }

    public void runDeviceDiscovery() {}

    public boolean setCloudId(CloudAuthInfo authInfo) {
        return channel.sendSetCloudId(authInfo);
    }

    public boolean setServerAddress(String host, int port, String authToken) {
        return channel.sendSetServerAddress(host, port, authToken);
    }
}
