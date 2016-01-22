package edu.stanford.thingengine.engine;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.AsyncTask;
import android.os.Bundle;
import android.support.annotation.NonNull;
import android.util.Log;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.HttpAuthHandler;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.WebView;

import org.json.JSONException;
import org.json.JSONObject;
import org.json.JSONTokener;

import java.util.List;


public class WebUIActivity extends Activity {
    public static final String LOG_TAG = "thingengine.UI";

    public static final String ADD_ONLINE_ACCOUNT = "edu.stanford.thingengine.engine.ADD_ONLINE_ACCOUNT";

    private final EngineServiceConnection engine;
    private volatile CloudAuthInfo authInfo;

    public WebUIActivity() {
        engine = new EngineServiceConnection();
    }

    private class WebChromeClient extends android.webkit.WebChromeClient {
        @Override
        public boolean onJsConfirm(WebView view, String url, String message, final JsResult result)
        {
            new AlertDialog.Builder(WebUIActivity.this)
                    .setTitle("Confirm")
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok,
                            new AlertDialog.OnClickListener() {
                                public void onClick(DialogInterface dialog, int which) {
                                    result.confirm();
                                }
                            })
                    .setNegativeButton(android.R.string.cancel,
                            new AlertDialog.OnClickListener() {
                                public void onClick(DialogInterface dialog, int which) {
                                    result.cancel();
                                }
                            })
                    .setCancelable(false)
                    .create()
                    .show();

            return true;
        }

        @Override
        public boolean onJsAlert(WebView view, String url, String message, final JsResult result)
        {
            new AlertDialog.Builder(WebUIActivity.this)
                    .setTitle("Alert")
                    .setMessage(message)
                    .setPositiveButton(android.R.string.ok,
                            new AlertDialog.OnClickListener()
                            {
                                public void onClick(DialogInterface dialog, int which)
                                {
                                    result.confirm();
                                }
                            })
                    .setCancelable(false)
                    .create()
                    .show();

            return true;
        }
    }

    private class WebViewClient extends android.webkit.WebViewClient {
        @Override
        public void onReceivedHttpAuthRequest (WebView view, @NonNull HttpAuthHandler handler, String host, String realm) {
            CloudAuthInfo authInfo = WebUIActivity.this.authInfo;
            if (authInfo == null) {
                handler.cancel();
                return;
            }

            if (!"thingengine.stanford.edu".equals(host)) {
                handler.cancel();
                return;
            }

            handler.proceed(authInfo.getCloudId(), authInfo.getAuthToken());
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            /*
            Uri parsed = Uri.parse(url);
            if (parsed.getAuthority().equals("thingengine.stanford.edu") ||
                    parsed.getAuthority().equals("127.0.0.1:3000"))
                return false;

            Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
            startActivity(intent);
            return true;
            */
            // allow everything so we can run oauth2 properly
            return false;
        }
    }

    private void initAuthInfo() {
        try {
            SharedPreferences prefs = getSharedPreferences("thingengine", Context.MODE_PRIVATE);

            // shared preferences have one extra layer of json that we need to unwrap
            Object obj = new JSONTokener(prefs.getString("cloud-id", "null")).nextValue();
            String cloudId = obj == JSONObject.NULL ? null : (String)obj;
            obj = new JSONTokener(prefs.getString("auth-token", "null")).nextValue();
            String authToken = obj == JSONObject.NULL ? null : (String)obj;
            if (cloudId != null && authToken != null)
                authInfo = new CloudAuthInfo(cloudId, authToken);
        } catch(ClassCastException|JSONException e) {
            Log.e(LOG_TAG, "Unexpected error loading auth info from preferences", e);
        }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_web_ui);

        initAuthInfo();
        AutoStarter.startService(this);

        WebView view = (WebView)findViewById(R.id.webView);
        view.addJavascriptInterface(this, "Android");
        view.getSettings().setJavaScriptEnabled(true);
        //view.loadUrl("https://thingengine.stanford.edu/?auth=app");
        view.setWebChromeClient(new WebChromeClient());
        view.setWebViewClient(new WebViewClient());
        view.loadUrl("http://127.0.0.1:3000");
    }

    private void showConfirmDialog(boolean success) {
        new AlertDialog.Builder(this)
                .setMessage(success ? "Congratulations, you're now all set to use ThingEngine!"
                            : "Sorry, that did not work")
                .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        dialog.dismiss();
                    }
                })
                .setIcon(android.R.drawable.ic_dialog_info)
                .show();
    }

    @JavascriptInterface
    public void setCloudId(String cloudId, String authToken) {
        ControlBinder control = engine.getControl();
        if (control == null)
            return;
        CloudAuthInfo oldInfo = this.authInfo;
        if (oldInfo != null && oldInfo.getCloudId().equals(cloudId) && oldInfo.getAuthToken().equals(authToken))
            return;

        CloudAuthInfo newInfo = new CloudAuthInfo(cloudId, authToken);
        final boolean ok = control.setCloudId(newInfo);
        if (ok)
            authInfo = newInfo;

        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                showConfirmDialog(ok);
            }
        });
    }

    @Override
    public void onResume() {
        super.onResume();
        engine.start(this);
    }

    @Override
    public void onPause() {
        super.onPause();
        engine.stop(this);
    }

    private void doSetServerAddress(final String host, final int port, final String authToken) {
        final ControlBinder control = engine.getControl();
        if (control == null)
            return;
        AsyncTask.THREAD_POOL_EXECUTOR.execute(new Runnable() {
            @Override
            public void run() {
                final boolean ok = control.setServerAddress(host, port, authToken);

                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        showConfirmDialog(ok);
                    }
                });
            }
        });
    }

    private void maybeSetServerAddress(final String host, final int port, final String authToken) {
        new AlertDialog.Builder(this)
                .setMessage("Do you wish to pair with ThingEngine Server at "
                        + host + " on port " + port + "?")
                .setPositiveButton(android.R.string.yes, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        doSetServerAddress(host, port, authToken);
                        dialog.dismiss();
                    }
                })
                .setNegativeButton(android.R.string.no, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        dialog.dismiss();
                    }
                })
                .setIcon(android.R.drawable.ic_dialog_info)
                .show();
    }

    private void doActionView(Uri data) {
        if (!data.getScheme().equals("https") || !data.getHost().equals("thingengine.stanford.edu")) {
            Log.w(LOG_TAG, "Received spurious intent view " + data);
            return;
        }

        try {
            List<String> pathSegments = data.getPathSegments();
            if (pathSegments.size() == 4 && // 'qrcode', host, port, authToken
                "qrcode".equals(pathSegments.get(0))) {
                String host = pathSegments.get(1);
                int port = Integer.parseInt(pathSegments.get(2));
                String authToken = pathSegments.get(3);

                if (authToken.equals("undefined"))
                    authToken = null;
                maybeSetServerAddress(host, port, authToken);
            } else if (pathSegments.size() == 3 && // 'qrcode-cloud', cloud_id, auth_token
                       "qrcode-cloud".equals(pathSegments.get(0))) {
                setCloudId(pathSegments.get(1), pathSegments.get(2));
            } else {
                Log.w(LOG_TAG, "Received spurious intent view " + data);
                return;
            }
        } catch(NumberFormatException e) {
            Log.w(LOG_TAG, "Received spurious intent view " + data);
            return;
        }
    }

    private void doAddOnlineAccount(String kind) {
        if (kind == null || kind.isEmpty())
            return;

        WebView view = (WebView)findViewById(R.id.webView);
        //view.loadUrl("https://thingengine.stanford.edu/devices/oauth2/" + kind);
        view.loadUrl("http://127.0.0.1:3000/devices/oauth2/" + kind);
    }

    @Override
    public void onStart() {
        super.onStart();

        Intent startIntent = getIntent();
        if (startIntent == null)
            return;

        switch(startIntent.getAction()) {
            case Intent.ACTION_VIEW:
                doActionView(startIntent.getData());
                break;
            case Intent.ACTION_MAIN:
                break;
            case ADD_ONLINE_ACCOUNT:
                doAddOnlineAccount(startIntent.getStringExtra("edu.stanford.thingengine.engine.ONLINE_ACCOUNT_KIND"));
                break;
            default:
                Log.w(LOG_TAG, "Received spurious intent " + startIntent.getAction());
        }
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        // Inflate the menu; this adds items to the action bar if it is present.
        getMenuInflater().inflate(R.menu.menu_web_ui, menu);
        return true;
    }

    @Override
    public boolean onOptionsItemSelected(MenuItem item) {
        // Handle action bar item clicks here. The action bar will
        // automatically handle clicks on the Home/Up button, so long
        // as you specify a parent activity in AndroidManifest.xml.
        int id = item.getItemId();

        //noinspection SimplifiableIfStatement
        if (id == R.id.action_settings) {
            return true;
        }

        return super.onOptionsItemSelected(item);
    }
}
