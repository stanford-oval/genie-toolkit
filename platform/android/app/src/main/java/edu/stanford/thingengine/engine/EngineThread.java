package edu.stanford.thingengine.engine;

import android.content.Context;

import io.jxcore.node.jxcore;

/**
 * Created by gcampagn on 8/8/15.
 */
public class EngineThread extends Thread {
    private final Context context;

    public EngineThread(Context context) {
        this.context = context;
    }

    @Override
    public void run() {
        // do something
        jxcore.instance.initialize(context.getApplicationContext());
        jxcore.CallJSMethod("runEngine", new Object[]{});
        jxcore.instance.loop();
    }
}
