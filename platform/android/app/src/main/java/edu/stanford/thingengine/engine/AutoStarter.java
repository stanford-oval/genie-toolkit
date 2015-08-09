package edu.stanford.thingengine.engine;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.util.Log;

public class AutoStarter extends BroadcastReceiver {
    public static void startService(Context context) {
        Log.i(EngineService.LOG_TAG, "Auto starting service");

        Intent pushIntent = new Intent(context, EngineService.class);
        context.startService(pushIntent);
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        switch (intent.getAction()) {
            case "android.intent.action.BOOT_COMPLETED":
                startService(context);
                break;
            default:
                break;
        }
    }
}
