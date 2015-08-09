package edu.stanford.thingpedia.thingengine;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

public class EngineService extends Service {
    public EngineService() {
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId)
    {
        (new EngineThread(this)).start();
        return START_STICKY;
    }

    @Override
    public IBinder onBind(Intent intent) {
        // TODO: Return the communication channel to the service.
        throw new UnsupportedOperationException("Not yet implemented");
    }
}
