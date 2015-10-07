package edu.stanford.thingengine.engine.discovery;

import android.os.Parcel;
import android.os.Parcelable;

import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

/**
 * Created by gcampagn on 10/7/15.
 */
public class Device implements Parcelable {
    private final String kind;
    private final JSONObject json;

    public Device(JSONObject json) throws JSONException {
        this.json = json;
        kind = json.getString("kind");
    }

    public String getKind() {
        return kind;
    }

    public int describeContents() {
        return 0;
    }

    public void writeToParcel(Parcel out, int flags) {
        out.writeString(json.toString());
    }

    public static final Parcelable.Creator<Device> CREATOR = new Parcelable.Creator<Device>() {
        public Device createFromParcel(Parcel in) {
            try {
                return new Device((JSONObject)(new JSONTokener(in.readString())).nextValue());
            } catch(JSONException|ClassCastException e) {
                return null;
            }
        }

        public Device[] newArray(int size) {
            return new Device[size];
        }
    };
}
