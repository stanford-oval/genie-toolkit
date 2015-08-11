// License information is available from LICENSE file

package io.jxcore.node;

import android.content.Context;
import android.content.res.AssetManager;
import android.os.Handler;
import android.util.Log;

import java.util.ArrayList;
import java.util.Enumeration;
import java.util.HashMap;
import java.util.Map;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

public class jxcore {

  public enum JXType {
    RT_Int32(1), RT_Double(2), RT_Boolean(3), RT_String(4), RT_Object(5), RT_Buffer(
        6), RT_Undefined(7), RT_Null(8), RT_Error(9), RT_Function(10), RT_Unsupported(11);

    int val;

    private JXType(int n) {
      val = n;
    }

    public static JXType fromInt(int n) {
      switch (n) {
      case 1:
        return RT_Int32;
      case 2:
        return RT_Double;
      case 3:
        return RT_Boolean;
      case 4:
        return RT_String;
      case 5:
        return RT_Object;
      case 6:
        return RT_Buffer;
      case 7:
        return RT_Undefined;
      case 8:
        return RT_Null;
      case 9:
        return RT_Error;
      default:
        return RT_Unsupported;
      }
    }
  }

  static {
    System.loadLibrary("jxcore");
  }

  public native void setNativeContext(final Context context,
      final AssetManager assetManager);

  public native int loopOnce();

  public native int loop();

  public native void quitLoop();

  public native void startEngine();

  public native void prepareEngine(String home, String fileTree);

  public native void stopEngine();

  public native void defineMainFile(String content);

  public native long evalEngine(String script);

  public native int getType(long id);

  public native double getDouble(long id);

  public native String getString(long id);

  public native byte[] getBuffer(long id);

  public native int getInt32(long id);

  public native int getBoolean(long id);

  public native String convertToString(long id);

  public native long callCBString(String event_name, String param, int is_json);

  public native long callCBArray(String event_name, Object[] arr, int size);

  public static String LOGTAG = "JX";
  private static final jxcore instance = new jxcore();

  static Map<String, JXcoreCallback> java_callbacks;
  public static Handler handler = null;

  public static void callback(long is_error) {
    Log.e(LOGTAG, "WTF?");
  }

  public interface JXcoreCallback {
    public void Receiver(ArrayList<Object> params, String callbackId);
  }

  private jxcore()
  {}

  public void initialize(Context context) {
    Log.d(LOGTAG, "jxcore android initializing");
    setNativeContext(context, context.getAssets());

    java_callbacks = new HashMap<>();

    JXMobile.Initialize(context);
    initializePath(context);
    startEngine();
  }

  public static void Initialize(Context context) {
    instance.initialize(context);
  }

  public static void Loop() {
    instance.loop();
  }

  public static void StopEngine() {
    instance.stopEngine();
  }

  public static void QuitLoop() {
    instance.quitLoop();
  }

  public static void javaCall(ArrayList<Object> params) {
    if (params.size() < 2 || params.get(0).getClass() != String.class
        || params.get(params.size() - 1).getClass() != String.class) {
      Log.e(LOGTAG, "JavaCall recevied an unknown call");
      return;
    }

    String receiver = params.remove(0).toString();
    String callId = params.remove(params.size() - 1).toString();

    if (!java_callbacks.containsKey(receiver)) {
      Log.e(LOGTAG, "JavaCall recevied a call for unknown method " + receiver);
      return;
    }

    java_callbacks.get(receiver).Receiver(params, callId);
  }

  public static void RegisterMethod(String name, JXcoreCallback callback) {
    java_callbacks.put(name, callback);
  }

  private static void callJSMethod(String id, Object[] args) {
    long ret = instance.callCBArray(id, args, args.length);
    int tp = instance.getType(ret);
    JXType ret_tp = JXType.fromInt(tp);

    if (ret_tp == JXType.RT_Object || ret_tp == JXType.RT_String
        || ret_tp == JXType.RT_Error) {
      Log.e(LOGTAG, "jxcore.CallJSMethod :" + instance.getString(ret));
    }
  }

  private static void callJSMethod(String id, String args) {
    long ret = instance.callCBString(id, args, 1);
    int tp = instance.getType(ret);
    JXType ret_tp = JXType.fromInt(tp);

    if (ret_tp == JXType.RT_Object || ret_tp == JXType.RT_String
        || ret_tp == JXType.RT_Error) {
      Log.e(LOGTAG, "jxcore.CallJSMethod :" + instance.getString(ret));
    }
  }

  public static boolean CallJSMethod(String id, Object[] args) {
    callJSMethod(id, args);
    return true;
  }

  public static boolean CallJSMethod(String id, String json) {
    callJSMethod(id, json);
    return true;
  }

  private void initializePath(Context context) {
    String home = context.getFilesDir().getAbsolutePath();

    // assets.list is terribly slow, below trick is literally 100 times faster
    StringBuilder assets = new StringBuilder();
    assets.append("{");
    boolean first_entry = true;
    try {
      try(ZipFile zf = new ZipFile(context.getApplicationInfo().sourceDir)) {
        for (Enumeration<? extends ZipEntry> e = zf.entries(); e
            .hasMoreElements();) {
          ZipEntry ze = e.nextElement();
          String name = ze.getName();
          if (name.startsWith("assets/jxcore/")) {
            if (first_entry)
              first_entry = false;
            else
              assets.append(",");
            int size = FileManager.approxFileSize(context.getAssets(), name.substring("assets/".length()));
            assets.append("\"");
            assets.append(name.substring("assets/jxcore/".length()));
            assets.append("\":");
            assets.append(size);
          }
        }
      }
    } catch (Exception e) {
    }
    assets.append("}");

    prepareEngine(home + "/jxcore", assets.toString());

    String mainFile = FileManager.readFile(context.getAssets(), "jxcore_main.js");

    String data = "process.setPaths = function(){ process.cwd = function() { return '" + home
        + "/jxcore';};\n"
        + "process.userPath ='" + context.getFilesDir().getAbsolutePath() + "';\n"
        + "};"
        + mainFile;

    defineMainFile(data);
  }
}