package edu.stanford.thingengine.engine;

import android.content.Context;

import io.jxcore.node.jxcore;

/**
 * Created by gcampagn on 8/8/15.
 */
public class EngineThread extends Thread {
    private final Context context;
    private final NativeSyncFlag stopFlag;

    public EngineThread(Context context, NativeSyncFlag stopFlag) {
        this.context = context;
        this.stopFlag = stopFlag;
    }

    @Override
    public void run() {
        // do something
        jxcore.instance.initialize(context.getApplicationContext());
        jxcore.CallJSMethod("runEngine", new Object[]{stopFlag.getFD()});
        jxcore.instance.loop();
        jxcore.instance.stopEngine();
    }
}
