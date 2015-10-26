package edu.stanford.thingengine.engine.omlet;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.Handler;
import android.os.HandlerThread;
import android.os.IBinder;
import android.os.Message;
import android.os.Messenger;
import android.os.RemoteException;
import android.util.Log;

import java.lang.ref.WeakReference;

import edu.stanford.thingengine.engine.ControlChannel;
import edu.stanford.thingengine.engine.EngineService;
import edu.stanford.thingengine.engine.JavascriptAPI;
import mobisocial.osm.IOsmService;

/**
 * Created by gcampagn on 10/26/15.
 */
public class OmletAPI extends JavascriptAPI {
    private final Context context;
    private boolean running;
    private OmletThread thread;
    private IOsmService service;
    private OmletServiceConnection connection;

    private static class OmletThread extends HandlerThread {
        public OmletThread() {
            super("OmletThread");
        }
    }

    private static class OmletHandler extends Handler {
        private WeakReference<OmletAPI> api;

        public OmletHandler(OmletAPI api) {
            this.api = new WeakReference<>(api);
        }

        public void handleMessage(Message message) {
            OmletAPI api = this.api.get();
            if (api == null)
                return;
            api.handleMessage(message);
        }
    }

    private class OmletServiceConnection implements ServiceConnection {
        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            synchronized (OmletAPI.this) {
                OmletAPI.this.service = IOsmService.Stub.asInterface(service);
                OmletAPI.this.notifyAll();
            }
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            synchronized (OmletAPI.this) {
                OmletAPI.this.service = null;
                OmletAPI.this.notifyAll();
            }
        }
    }

    public OmletAPI(Context context, ControlChannel control) {
        super("OmletAPI", control);
        this.context = context;
        running = true;

        registerAsync("createControlFeed", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                return createControlFeed();
            }
        });
    }

    public synchronized void stop() {
        running = false;

        if (thread != null) {
            thread.getLooper().quit();
            try {
                thread.join();
            } catch (InterruptedException e) {
                Log.i(EngineService.LOG_TAG, "Interrupted while terminating Omlet Thread", e);
            }
            thread = null;
        }

        if (connection != null) {
            context.unbindService(connection);
            connection = null;
        }
    }

    private synchronized void handleMessage(Message message) {
        // do something with this message
    }

    private synchronized boolean ensureThread() {
        if (thread != null)
            return true;
        if (!running)
            return false;

        thread = new OmletThread();
        thread.start();
        return true;
    }

    private synchronized boolean ensureServiceConnection() {
        if (!ensureThread())
            return false;
        if (connection != null)
            return true;

        connection = new OmletServiceConnection();
        Intent intent = new Intent("mobisocial.intent.action.BIND_SERVICE");
        intent.setPackage("mobisocial.omlet");
        Handler handler = new OmletHandler(this);
        Messenger messenger = new Messenger(handler);
        intent.putExtra("mobisocial.intent.extra.OBJECT_RECEIVER", messenger);
        context.bindService(intent, connection, Context.BIND_AUTO_CREATE);
        return true;
    }

    private IOsmService waitService() {
        try {
            synchronized (this) {
                if (!ensureServiceConnection())
                    return null;

                while (service == null)
                    wait();

                return service;
            }
        } catch(InterruptedException e) {
            Log.i(EngineService.LOG_TAG, "Interrupted while waiting for Omlet service", e);
            return null;
        }
    }

    private String createControlFeed() throws RemoteException {
        IOsmService service = waitService();
        if (service == null)
            return null;

        return service.createControlFeed().toString();
    }
}
