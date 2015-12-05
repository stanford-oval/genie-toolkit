// License information is available from LICENSE file

package io.jxcore.node;

import android.annotation.SuppressLint;
import android.content.Context;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.util.Log;

import java.util.ArrayList;

import io.jxcore.node.jxcore.JXcoreCallback;

public class JXMobile {
  public static void Initialize(final Context context) {
    jxcore.RegisterMethod("OnError", new JXcoreCallback() {
      @SuppressLint("NewApi")
      @Override
      public void Receiver(ArrayList<Object> params, String callbackId) {
        String message = (String) params.get(0);
        String stack;
        if (params.size() > 1)
          stack = (String) params.get(1);
        else
          stack = "";

        Log.e("jxcore", "Error!: " + message + "\nStack: " + stack);
      }
    });

    jxcore.RegisterMethod("GetDocumentsPath", new JXcoreCallback() {
      @SuppressLint("NewApi")
      @Override
      public void Receiver(ArrayList<Object> params, String callbackId) {
        String path = context.getFilesDir().getAbsolutePath();
        jxcore.CallJSMethod(callbackId, "\"" + path + "\"");
      }
    });

    jxcore.RegisterMethod("GetCachePath", new JXcoreCallback() {
      @Override
      public void Receiver(ArrayList<Object> params, String callbackId) {
        String path = context.getCacheDir().getAbsolutePath();
        jxcore.CallJSMethod(callbackId, "\"" + path + "\"");
      }
    });

    jxcore.RegisterMethod("GetConnectionStatus", new JXcoreCallback() {
      @SuppressLint("NewApi")
      @Override
      public void Receiver(ArrayList<Object> params, String callbackId) {
        ConnectivityManager cm = (ConnectivityManager) context.getSystemService(Context.CONNECTIVITY_SERVICE);

        String info = "{\"NotConnected\":1}";
        NetworkInfo[] netInfo = cm.getAllNetworkInfo();
        for (NetworkInfo ni : netInfo) {
          if (ni.getTypeName().equalsIgnoreCase("WIFI"))
            if (ni.isConnected()) {
              info = "{\"WiFi\":1}";
              break;
            }
          if (ni.getTypeName().equalsIgnoreCase("MOBILE"))
            if (ni.isConnected()) {
              info = "{\"WWAN\":1}";
              break;
            }
        }

        jxcore.CallJSMethod(callbackId, info);
      }
    });

    jxcore.RegisterMethod("Exit", new JXcoreCallback() {
      @Override
      public void Receiver(ArrayList<Object> params, String callbackId) {
        jxcore.QuitLoop();
      }
    });
  }
}