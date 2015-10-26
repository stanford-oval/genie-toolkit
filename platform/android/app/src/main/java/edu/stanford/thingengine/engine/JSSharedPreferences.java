package edu.stanford.thingengine.engine;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONTokener;

/**
 * Created by gcampagn on 10/26/15.
 */
public class JSSharedPreferences extends JavascriptAPI {
    private final Context context;
    public JSSharedPreferences(Context context, ControlChannel control) {
        super("SharedPreferences", control);

        this.context = context;

        this.registerSync("readSharedPref", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                return readSharedPref((String)args[0]);
            }
        });
        this.registerSync("writeSharedPref", new GenericCall() {
            @Override
            public Object run(Object... args) throws Exception {
                writeSharedPref((String)args[0]);
                return null;
            }
        });
    }

    private String readSharedPref(String name) {
        return context.getSharedPreferences("thingengine", Context.MODE_PRIVATE).getString(name, null);
    }

    private void writeSharedPref(String writes) throws JSONException {
        SharedPreferences.Editor editor = context.getSharedPreferences("thingengine", Context.MODE_PRIVATE).edit();
        JSONArray parsedWrites = (JSONArray) new JSONTokener(writes).nextValue();
        for (int i = 0; i < parsedWrites.length(); i++) {
            JSONArray write = parsedWrites.getJSONArray(i);
            String name = write.getString(0);
            String value = write.getString(1);
            editor.putString(name, value);
        }
        editor.apply();
    }
}
