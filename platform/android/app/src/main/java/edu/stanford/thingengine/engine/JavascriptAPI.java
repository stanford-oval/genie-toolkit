package edu.stanford.thingengine.engine;

import android.os.AsyncTask;

import java.util.ArrayList;

import io.jxcore.node.jxcore;

/**
 * Created by gcampagn on 10/26/15.
 */
public abstract class JavascriptAPI {
    private final String name;
    private final ControlChannel control;

    public interface GenericCall {
        Object run(Object... args) throws Exception;
    }

    public JavascriptAPI(String name, ControlChannel control) {
        this.name = name;
        this.control = control;
    }

    private void sendCallback(String callback, String error, Object value) {
        control.sendInvokeCallback(callback, error, value);
    }

    public void invokeAsync(String callback, String error, Object value) {
        sendCallback(name + "_" + callback, error, value);
    }

    public void registerAsync(String callback, final GenericCall call) {
        jxcore.RegisterMethod(name + "_" + callback, new jxcore.JXcoreCallback() {
            @Override
            public void Receiver(final ArrayList<Object> params, final String callbackId) {
                AsyncTask.THREAD_POOL_EXECUTOR.execute(new Runnable() {
                    @Override
                    public void run() {
                        try {
                            Object result = call.run(params.toArray());
                            sendCallback(callbackId, null, result);
                        } catch (Exception e) {
                            sendCallback(callbackId, e.getMessage(), null);
                        }
                    }
                });
            }
        });
    }

    public void registerSync(String callback, final GenericCall call) {
        jxcore.RegisterMethod(name + "_" + callback, new jxcore.JXcoreCallback() {
            @Override
            public void Receiver(ArrayList<Object> params, String callbackId) {
                try {
                    Object result = call.run(params.toArray());
                    jxcore.CallJSMethod(callbackId, new Object[]{null, result});
                } catch (Exception e) {
                    jxcore.CallJSMethod(callbackId, new Object[]{e.getMessage(), null});
                }
            }
        });
    }
}
