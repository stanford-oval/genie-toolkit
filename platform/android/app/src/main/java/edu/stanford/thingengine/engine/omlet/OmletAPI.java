package edu.stanford.thingengine.engine.omlet;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.ServiceConnection;
import android.database.ContentObserver;
import android.database.Cursor;
import android.net.Uri;
import android.os.IBinder;
import android.os.RemoteException;
import android.support.annotation.Nullable;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

import edu.stanford.thingengine.engine.ControlChannel;
import edu.stanford.thingengine.engine.EngineService;
import edu.stanford.thingengine.engine.JavascriptAPI;
import mobisocial.osm.IOsmService;

/**
 * Created by gcampagn on 10/26/15.
 */
public class OmletAPI extends JavascriptAPI {
    private static final boolean DEBUG = true;
    private static final AtomicInteger count = new AtomicInteger(0);

    private final Context context;
    private final Map<Long, OpenedFeed> openedFeeds;
    private final Map<String, Cursor> openedCursors;
    private IOsmService service;
    private OmletServiceConnection connection;

    private class OmletContentObserver extends ContentObserver {
        public OmletContentObserver() {
            super(null);
        }

        public void onChange(boolean selfChange, Uri uri) {
            invokeAsync("onChange", null, uri.toString());
        }
    }

    private class OpenedFeed {
        private final long feedId;
        private ContentObserver observer;

        public OpenedFeed(long feedId) {
            this.feedId = feedId;
        }

        public void startWatch() {
            observer = new OmletContentObserver();
            context.getContentResolver().registerContentObserver(getFeedUri(), true, observer);
        }

        public void stopWatch() {
            context.getContentResolver().unregisterContentObserver(observer);
            observer = null;
        }

        private Uri getFeedUri() {
            return Uri.parse("content://mobisocial.osm/feeds/" + feedId);
        }

        private Uri getMembersUri() {
            return Uri.parse("content://mobisocial.osm/members/" + feedId);
        }

        public Cursor getCursor() {
            String[] projection = DEBUG ? new String[] { "Id", "senderId", "text" } : new String[] { "Id", "senderId", "json" };
            String sort = "ServerTimestamp DESC";
            return context.getContentResolver().query(getFeedUri(), projection, null, null, sort);
        }

        public List<Long> getMembers() {
            String[] projection = new String[] { "Id" };
            try (Cursor cursor = context.getContentResolver().query(getMembersUri(), projection, null, null, null)) {
                if (cursor == null)
                    return (List<Long>) Collections.EMPTY_LIST;
                List<Long> list = new ArrayList<>();
                while (!cursor.isAfterLast()) {
                    cursor.moveToNext();
                    list.add(cursor.getLong(0));
                }
                return list;
            }
        }
    }

    private class OmletServiceConnection implements ServiceConnection {
        // These are always called on the main thread

        @Override
        public void onServiceConnected(ComponentName name, IBinder service) {
            setService(IOsmService.Stub.asInterface(service));
        }

        @Override
        public void onServiceDisconnected(ComponentName name) {
            setService(null);
        }
    }

    public OmletAPI(Context context, ControlChannel control) {
        super("OmletAPI", control);
        this.context = context;
        openedCursors = new HashMap<>();
        openedFeeds = new HashMap<>();

        registerAsync("createControlFeed", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                return createControlFeed();
            }
        });
        registerSync("openFeed", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                openFeed(((Number) args[0]).longValue());
                return null;
            }
        });
        registerSync("closeFeed", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                closeFeed(((Number) args[0]).longValue());
                return null;
            }
        });
        registerAsync("getOwnId", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                return getOwnId();
            }
        });
        registerAsync("getFeedCursor", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                return getFeedCursor(((Number) args[0]).longValue());
            }
        });
        registerAsync("getCursorValue", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                return getCursorValue((String) args[0]);
            }
        });
        registerAsync("hasNextCursor", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                return hasNextCursor((String) args[0]);
            }
        });
        registerAsync("nextCursor", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                nextCursor((String) args[0]);
                return null;
            }
        });
        registerAsync("getFeedMembers", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                return getFeedMembers(((Number) args[0]).longValue());
            }
        });
        registerAsync("sendItemOnFeed", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                sendItemOnFeed(((Number) args[0]).longValue(), (String) args[1]);
                return null;
            }
        });
        registerSync("destroyCursor", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                destroyCursor((String) args[0]);
                return null;
            }
        });
        registerSync("startWatchOnFeed", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                startWatchOnFeed(((Number) args[0]).longValue());
                return null;
            }
        });
        registerSync("stopWatchOnFeed", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                stopWatchOnFeed(((Number) args[0]).longValue());
                return null;
            }
        });
    }

    public synchronized void stop() {
        if (connection != null) {
            context.unbindService(connection);
            connection = null;
        }
    }

    private synchronized void setService(IOsmService service) {
        this.service = service;
        notifyAll();
    }

    private synchronized void ensureServiceConnection() {
        if (connection != null)
            return;

        connection = new OmletServiceConnection();
        Intent intent = new Intent("mobisocial.intent.action.BIND_SERVICE");
        intent.setPackage("mobisocial.omlet");
        context.bindService(intent, connection, Context.BIND_AUTO_CREATE);
    }

    @Nullable
    private IOsmService waitService() {
        try {
            ensureServiceConnection();
            synchronized (this) {
                while (service == null)
                    wait();

                return service;
            }
        } catch(InterruptedException e) {
            Log.i(EngineService.LOG_TAG, "Interrupted while waiting for Omlet service", e);
            return null;
        }
    }

    @Nullable
    private String createControlFeed() throws RemoteException {
        IOsmService service = waitService();
        if (service == null)
            return null;

        if (DEBUG) {
            return service.createFeed("ThingEngine Test Feed", null, new long[]{}).toString();
        } else {
            return service.createControlFeed().toString();
        }
    }

    private synchronized void openFeed(long feedId) throws IllegalStateException {
        if (openedFeeds.containsKey(feedId))
            throw new IllegalStateException("Feed is already being watched");

        openedFeeds.put(feedId, new OpenedFeed(feedId));
    }

    private synchronized void closeFeed(long feedId) {
        openedFeeds.remove(feedId);
    }

    @Nullable
    private String getOwnId() {
        String[] projection = new String[] { "id" };
        String selection = "hasApp=true and owned=true";
        synchronized (context) {
            Cursor cursor = context.getContentResolver().
                    query(Uri.parse("content://mobisocial.osm/identities"), projection, selection, null, null);
            if (cursor == null)
                return null;
            if (!cursor.moveToFirst())
                return null;
            return cursor.getString(0);
        }
    }

    private synchronized String getFeedCursor(long feedId) throws IllegalArgumentException {
        OpenedFeed feed = openedFeeds.get(feedId);
        if (feed == null)
            throw new IllegalArgumentException("Invalid feed ID (not opened)");

        String id = "cursor_" + count.getAndAdd(1);
        synchronized (context) {
            Cursor cursor = feed.getCursor();
            if (cursor == null)
                return null;
            openedCursors.put(id, cursor);
        }
        return id;
    }

    private synchronized void destroyCursor(String cursorId) {
        Cursor cursor = openedCursors.remove(cursorId);
        if (cursor == null)
            throw new IllegalArgumentException("Invalid cursor ID");

        synchronized (context) {
            cursor.close();
        }
    }

    private synchronized JSONObject getCursorValue(String cursorId) throws JSONException {
        Cursor cursor = openedCursors.get(cursorId);
        if (cursor == null)
            throw new IllegalArgumentException("Invalid cursor ID");

        synchronized (context) {
            JSONObject o = new JSONObject();
            o.put("sender", cursor.getLong(1));
            o.put("payload", cursor.getString(2));
            return o;
        }
    }

    private synchronized boolean hasNextCursor(String cursorId) {
        Cursor cursor = openedCursors.get(cursorId);
        if (cursor == null)
            throw new IllegalArgumentException("Invalid cursor ID");

        synchronized (context) {
            return cursor.isAfterLast();
        }
    }

    private synchronized void nextCursor(String cursorId) {
        Cursor cursor = openedCursors.get(cursorId);
        if (cursor == null)
            throw new IllegalArgumentException("Invalid cursor ID");

        synchronized (context) {
            cursor.moveToNext();
        }
    }

    private synchronized JSONArray getFeedMembers(long feedId) {
        OpenedFeed feed;
        feed = openedFeeds.get(feedId);
        if (feed == null)
            throw new IllegalArgumentException("Invalid feed ID (not opened)");

        List<Long> members;
        synchronized (context) {
            members = feed.getMembers();
        }
        JSONArray array = new JSONArray();
        for (long member : members) {
            array.put(member);
        }
        return array;
    }

    private synchronized void sendItemOnFeed(long feedId, String payload) throws JSONException, RemoteException {
        JSONObject o = new JSONObject();

        if (DEBUG) {
            o.put("text", payload);
        } else {
            o.put("noun", "generic payload");
            o.put("json", payload);
        }

        IOsmService service = waitService();
        if (service == null)
            return;

        if (DEBUG)
            service.sendObj(Uri.parse("content://mobisocial.osm/feeds/" + feedId), "text", o.toString());
        else
            service.sendObj(Uri.parse("content://mobisocial.osm/feeds/" + feedId), "data", o.toString());
    }

    private synchronized void startWatchOnFeed(long feedId) {
        OpenedFeed feed;
        feed = openedFeeds.get(feedId);
        if (feed == null)
            throw new IllegalArgumentException("Invalid feed ID (not opened)");

        synchronized (context) {
            feed.startWatch();
        }
    }

    private synchronized void stopWatchOnFeed(long feedId) {
        OpenedFeed feed;
        feed = openedFeeds.get(feedId);
        if (feed == null)
            throw new IllegalArgumentException("Invalid feed ID (not opened)");

        synchronized (context) {
            feed.stopWatch();
        }
    }
}
