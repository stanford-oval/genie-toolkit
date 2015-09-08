package edu.stanford.thingengine.engine;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.net.Uri;
import android.os.AsyncTask;
import android.os.Bundle;
import android.util.Log;
import android.view.Menu;
import android.view.MenuItem;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import java.io.IOException;
import java.util.List;


public class WebUIActivity extends Activity {
    public static final String LOG_TAG = "thingengine.UI";

    private final EngineServiceConnection engine;

    public WebUIActivity() {
        engine = new EngineServiceConnection();
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_web_ui);

        AutoStarter.startService(this);

        WebView view = (WebView)findViewById(R.id.webView);
        view.addJavascriptInterface(this, "Android");
        view.getSettings().setJavaScriptEnabled(true);
        view.loadUrl("https://thingengine.stanford.edu/");
        view.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, String url) {
                if (Uri.parse(url).getAuthority().equals("thingengine.stanford.edu"))
                    return false;

                Intent intent = new Intent(Intent.ACTION_VIEW, Uri.parse(url));
                startActivity(intent);
                return true;
            }
        });
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
        try {
            final boolean ok = control.setCloudId(cloudId, authToken);

            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    showConfirmDialog(ok);
                }
            });
        } catch(IOException e) {
            Log.e(LOG_TAG, "IOException talking to Node.js thread", e);
            runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    showConfirmDialog(false);
                }
            });
        }
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
        AsyncTask.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    final boolean ok = control.setServerAddress(host, port, authToken);

                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            showConfirmDialog(ok);
                        }
                    });
                } catch(IOException e) {
                    Log.e(LOG_TAG, "IOException talking to Node.js thread", e);
                    runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            showConfirmDialog(false);
                        }
                    });
                }
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

        List<String> pathSegments = data.getPathSegments();
        if (pathSegments.size() != 4 || !"qrcode".equals(pathSegments.get(0))) { // 'qrcode', host, port, authToken
            Log.w(LOG_TAG, "Received spurious intent view " + data);
            return;
        }

        try {
            String host = pathSegments.get(1);
            int port = Integer.parseInt(pathSegments.get(2));
            String authToken = pathSegments.get(3);

            maybeSetServerAddress(host, port, authToken);
        } catch(NumberFormatException e) {
            Log.w(LOG_TAG, "Received spurious intent view " + data);
            return;
        }
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
