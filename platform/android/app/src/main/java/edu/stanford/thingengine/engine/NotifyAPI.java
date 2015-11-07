package edu.stanford.thingengine.engine;

import android.app.Notification;
import android.app.NotificationManager;
import android.content.Context;

/**
 * Created by gcampagn on 11/7/15.
 */
public class NotifyAPI extends JavascriptAPI {
    private final Context context;

    public NotifyAPI(Context context, ControlChannel control) {
        super("Notify", control);

        this.context = context;

        registerSync("showMessage", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                showMessage(args[0].toString(), args[1].toString());
                return null;
            }
        });
    }

    private void showMessage(String title, String msg) {
        Notification notification = new Notification.Builder(context)
                .setSmallIcon(R.mipmap.ic_launcher)
                .setContentTitle(title)
                .setContentText(msg)
                .build();
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        manager.notify(0, notification);
    }
}
