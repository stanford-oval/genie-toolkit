package edu.stanford.thingengine.engine;

import android.os.Binder;

import java.io.IOException;

/**
 * Created by gcampagn on 8/16/15.
 */
public class ControlBinder extends Binder {
    private final ControlChannel channel;

    public ControlBinder(ControlChannel channel) {
        this.channel = channel;
    }

    public boolean setCloudId(String cloudId, String authToken) throws IOException {
        return channel.sendSetCloudId(cloudId, authToken);
    }
}
