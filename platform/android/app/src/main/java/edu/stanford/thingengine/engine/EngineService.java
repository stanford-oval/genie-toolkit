package edu.stanford.thingengine.engine;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
import android.util.Log;

import java.io.IOException;

public class EngineService extends Service {
    public static final String LOG_TAG = "thingengine.Service";

    private NativeSyncFlag stopFlag;
    private Thread engineThread;

    public EngineService() {
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId)
    {
        if (engineThread != null)
            return START_STICKY;

        Log.i(LOG_TAG, "Starting service");
        try {
            stopFlag = new NativeSyncFlag();
            engineThread = new EngineThread(this, stopFlag);
            engineThread.start();
            Log.i(LOG_TAG, "Started service");
            return START_STICKY;
        } catch(IOException e) {
            Log.e(LOG_TAG, "IOException while creating the nodejs thread");
            throw new RuntimeException(e);
        }
    }

    @Override
    public void onDestroy()
    {
        Log.i(LOG_TAG, "Destroying service");
        try {
            if (engineThread != null) {
                stopFlag.signal();

                try {
                    engineThread.join();
                } catch (InterruptedException e) {
                    Log.e(LOG_TAG, "InterruptedException while destroying the nodejs thread");
                }
                engineThread = null;
                stopFlag.close();
                stopFlag = null;
            }
        } catch(IOException e) {
            Log.e(LOG_TAG, "IOException while destroying the nodejs thread");
        }
        Log.i(LOG_TAG, "Destroyed service");
    }

    @Override
    public IBinder onBind(Intent intent) {
        // TODO: Return the communication channel to the service.
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
