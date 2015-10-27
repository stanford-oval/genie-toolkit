package edu.stanford.thingengine.engine;

import android.app.Service;
import android.content.Intent;
import android.os.Handler;
import android.os.IBinder;
import android.util.Log;
import java.io.IOException;
import java.util.concurrent.locks.Condition;
import java.util.concurrent.locks.Lock;
import java.util.concurrent.locks.ReentrantLock;

public class EngineService extends Service {
    public static final String LOG_TAG = "thingengine.Service";

    private ControlChannel control;
    private EngineThread engineThread;
    
    public EngineService() {
    }

    private void fooTransaction() {
        // little bit of debugging
        new Handler().post(new Runnable() {
            @Override
            public void run() {
                int returned = control.sendFoo(42);
                Log.i(LOG_TAG, "Control channel foo returned " + returned);
            }
        });
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (engineThread != null)
            return START_STICKY;

        Log.i(LOG_TAG, "Starting service");
        try {
            startThread();
            control = engineThread.getControlChannel();
            if (control != null)
                fooTransaction();

            Log.i(LOG_TAG, "Started service");
            return START_STICKY;
        } catch(Exception e) {
            Log.e(LOG_TAG, "Exception while creating the nodejs thread", e);
            throw new RuntimeException(e);
        }
    }

    private void startThread() throws InterruptedException {
        Lock initLock = new ReentrantLock();
        Condition initCondition = initLock.newCondition();
        initLock.lock();
        try {
            engineThread = new EngineThread(this, initLock, initCondition);
            engineThread.start();
            while (!engineThread.isControlReady())
                initCondition.await();
        } finally {
            initLock.unlock();
        }

        if (engineThread.isBroken())
            stopSelf();
    }

    @Override
    public void onDestroy() {
        Log.i(LOG_TAG, "Destroying service");
        try {
            if (engineThread != null) {
                control.sendStop();

                try {
                    // give the thread 10 seconds to die
                    engineThread.join(10000);
                } catch (InterruptedException e) {
                    Log.e(LOG_TAG, "InterruptedException while destroying the nodejs thread", e);
                }
                engineThread = null;
                control.close();
            }
        } catch(IOException e) {
            Log.e(LOG_TAG, "IOException while destroying the nodejs thread", e);
        }
        Log.i(LOG_TAG, "Destroyed service");
    }

    @Override
    public IBinder onBind(Intent intent) {
        if (control == null)
            onStartCommand(null, 0, 0);
        if (control == null)
            return null;
        return new ControlBinder(control);
    }
}
