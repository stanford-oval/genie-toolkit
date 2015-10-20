package edu.stanford.thingengine.engine;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.os.IBinder;

import edu.stanford.thingengine.engine.NsdDiscover;

/**
 * Created by gcampagn on 8/16/15.
 */

public class EngineServiceConnection implements ServiceConnection {
    private volatile ControlBinder binder;
    private NsdDiscover mDiscover;

    public ControlBinder getControl() {
        return binder;
    }

    @Override
    public void onServiceConnected(ComponentName name, IBinder service) {
        binder = (ControlBinder)service;
    }

    @Override
    public void onServiceDisconnected(ComponentName name) {
        binder = null;
    }

    public void start(Context ctx) {
        mDiscover = new NsdDiscover(ctx);
        mDiscover.startListening();
        Intent intent = new Intent(ctx, EngineService.class);
        ctx.bindService(intent, this, Context.BIND_AUTO_CREATE | Context.BIND_ADJUST_WITH_ACTIVITY);
    }

    public void stop(Context ctx) {
        ctx.unbindService(this);
        mDiscover.stopListening();
    }
}
