package edu.stanford.thingengine.engine;

import android.content.Context;
import android.net.LocalSocket;
import android.net.LocalSocketAddress;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.io.BufferedReader;
import java.io.BufferedWriter;
import java.io.Closeable;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Reader;
import java.io.Writer;
import java.nio.charset.Charset;

/**
 * Created by gcampagn on 8/10/15.
 */
public class ControlChannel implements AutoCloseable, Closeable {
    private final Reader controlReader;
    private final StringBuilder partialMsg;
    private final Writer controlWriter;

    public ControlChannel(Context ctx) throws IOException {
        LocalSocket socket = new LocalSocket();

        socket.connect(new LocalSocketAddress(ctx.getFilesDir() + "/control", LocalSocketAddress.Namespace.FILESYSTEM));
        // we would like to use UTF-16BE because that's what Java uses internally, but node only has UTF16-LE
        // so we use that and pay the byteswap, rather than paying the higher UTF-8 encoding cost
        controlReader = new BufferedReader(new InputStreamReader(socket.getInputStream(), Charset.forName("UTF-16LE")));
        controlWriter = new BufferedWriter(new OutputStreamWriter(socket.getOutputStream(), Charset.forName("UTF-16LE")));
        partialMsg = new StringBuilder();
    }

    public synchronized void close() throws IOException {
        controlReader.close();
        controlWriter.close();
    }

    private void sendCall(String method, Object... arguments) throws IOException {
        try {
            JSONObject call = new JSONObject();
            call.put("method", method);

            JSONArray jsonArgs = new JSONArray();
            for (int i = 0; i < arguments.length; i++) {
                jsonArgs.put(i, arguments[i]);
            }
            call.put("args", jsonArgs);

            controlWriter.write(call.toString());
            controlWriter.flush();
        } catch(JSONException e) {
            Log.e(EngineService.LOG_TAG, "Failed to serialize method call to control channel", e);
            throw new RuntimeException(e);
        }
    }

    private Object expectReply() throws Exception {
        JSONObject value = null;
        try {
            while (value == null) {
                try {
                    char[] buffer = new char[64];
                    int read = controlReader.read(buffer);
                    partialMsg.append(buffer, 0, read);
                    JSONTokener tokener = new JSONTokener(partialMsg.toString());
                    value = (JSONObject) tokener.nextValue();
                    partialMsg.setLength(0);
                } catch (JSONException e) {
                    Log.d(EngineService.LOG_TAG, "Partial message received");
                }
            }

            if (value.has("reply"))
                return value.get("reply");
            else
                throw new Exception(value.getString("error"));
        } catch(JSONException e) {
            Log.e(EngineService.LOG_TAG, "Failed to parse method reply on control channel", e);
            throw new RuntimeException(e);
        }
    }

    public synchronized int sendFoo(int value) throws IOException {
        try {
            sendCall("foo", value);
            return (Integer) expectReply();
        } catch(IOException e) {
            throw e;
        } catch(Exception e) {
            Log.e(EngineService.LOG_TAG, "Unexpected exception in 'foo' command", e);
            throw new RuntimeException(e);
        }
    }

    public synchronized void sendStop() throws IOException {
        sendCall("stop");
    }

    public synchronized boolean sendSetCloudId(String cloudId, String authToken) throws IOException {
        try {
            sendCall("setCloudId", cloudId, authToken);
            return (Boolean)expectReply();
        } catch(IOException e) {
            throw e;
        } catch(Exception e) {
            Log.e(EngineService.LOG_TAG, "Unexpected exception in 'setCloudId' command", e);
            return false;
        }
    }
}
