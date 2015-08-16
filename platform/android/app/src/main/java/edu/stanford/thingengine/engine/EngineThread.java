package edu.stanford.thingengine.engine;

import android.content.Context;
import android.content.SharedPreferences;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONTokener;

import java.util.ArrayList;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.Lock;

import io.jxcore.node.jxcore;

/**
 * Created by gcampagn on 8/8/15.
 */
public class EngineThread extends Thread {
    private final Context context;
    private final Lock initLock;
    private final Condition initCondition;
    private boolean controlReady;
    private boolean isLocked;
    private boolean broken;

    public EngineThread(Context context, Lock initLock, Condition initCondition) {
        this.context = context;
        this.initLock = initLock;
        this.initCondition = initCondition;
        controlReady = false;
        broken = false;
        isLocked = false;
    }

    public boolean isControlReady() {
        return controlReady;
    }

    public boolean isBroken() {
        return broken;
    }

    private String readSharedPref(String name) {
        return context.getSharedPreferences("thingengine", Context.MODE_PRIVATE).getString(name, null);
    }

    private void writeSharedPref(String writes) throws JSONException {
        SharedPreferences.Editor editor = context.getSharedPreferences("thingengine", Context.MODE_PRIVATE).edit();
        JSONArray parsedWrites = (JSONArray) new JSONTokener(writes).nextValue();
        for (int i = 0; i < parsedWrites.length(); i++) {
            JSONArray write = parsedWrites.getJSONArray(i);
            String name = write.getString(0);
            String value = write.getString(1);
            editor.putString(name, value);
        }
        editor.apply();
    }

    @Override
    public void run() {
        jxcore.Initialize(context.getApplicationContext());

        try {
            initLock.lock();
            isLocked = true;
            jxcore.RegisterMethod("controlReady", new jxcore.JXcoreCallback() {
                @Override
                public void Receiver(ArrayList<Object> params, String callbackId) {
                    controlReady = true;
                    initCondition.signalAll();
                    initLock.unlock();
                    isLocked = false;
                }
            });
            jxcore.RegisterMethod("readSharedPref", new jxcore.JXcoreCallback() {
                @Override
                public void Receiver(ArrayList<Object> params, String callbackId) {
                    try {
                        String value = readSharedPref((String) params.get(0));
                        jxcore.CallJSMethod(callbackId, new Object[]{null, value});
                    } catch(Exception e) {
                        jxcore.CallJSMethod(callbackId, new Object[]{e.getMessage(), null});
                    }
                }
            });
            jxcore.RegisterMethod("writeSharedPref", new jxcore.JXcoreCallback() {
                @Override
                public void Receiver(ArrayList<Object> params, String callbackId) {
                    try {
                        writeSharedPref((String) params.get(0));
                        jxcore.CallJSMethod(callbackId, new Object[]{null});
                    } catch(Exception e) {
                        jxcore.CallJSMethod(callbackId, new Object[]{e.getMessage()});
                    }
                }
            });
            jxcore.CallJSMethod("runEngine", new Object[]{});
            jxcore.Loop();

            if (!controlReady) {
                Log.e(EngineService.LOG_TAG, "Engine failed to signal control ready!");
                controlReady = true;
                broken = true;
                initCondition.signalAll();
            }
        } finally {
            if (isLocked)
                initLock.unlock();
        }
        jxcore.StopEngine();
    }
}
