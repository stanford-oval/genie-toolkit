package edu.stanford.thingengine.engine;

import android.app.AlertDialog;
import android.content.DialogInterface;
import android.os.AsyncTask;
import android.os.Bundle;
import android.support.v7.app.AppCompatActivity;
import android.view.Menu;
import android.view.MenuItem;
import android.view.View;

import org.json.JSONException;
import org.json.JSONObject;

import java.util.Date;

public class TestActivity extends AppCompatActivity {

    private final EngineServiceConnection engine;

    public TestActivity() {
        engine = new EngineServiceConnection();
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

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        AutoStarter.startService(this);

        setContentView(R.layout.activity_test);

        findViewById(R.id.button_createFeed).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                createFeedClicked();
            }
        });

        findViewById(R.id.button_test).setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                addRandomWeightClicked();
            }
        });
    }

    private void omletFeedCreated(String feedUri) {
        new AlertDialog.Builder(this)
                .setMessage(feedUri != null ? "Created feed at " + feedUri
                        : "Sorry, feed creation failed")
                .setPositiveButton(android.R.string.ok, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        dialog.dismiss();
                    }
                })
                .setIcon(android.R.drawable.ic_dialog_info)
                .show();
    }

    private void createFeedClicked() {
        final ControlBinder control = engine.getControl();
        if (control == null)
            return;
        AsyncTask.THREAD_POOL_EXECUTOR.execute(new Runnable() {
            @Override
            public void run() {
                final String feed = control.createOmletFeed();

                runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        omletFeedCreated(feed);
                    }
                });
            }
        });
    }

    private void addRandomWeightClicked() {
        final ControlBinder control = engine.getControl();
        if (control == null)
            return;
        AsyncTask.THREAD_POOL_EXECUTOR.execute(new Runnable() {
            @Override
            public void run() {
                try {
                    JSONObject o = new JSONObject();
                    o.put("time", new Date().getTime());
                    o.put("weight", 50 + 10 * Math.random());
                    control.injectTableInsert("thingengine-table-app-WeightCompApp-messaging-group-omlet-a-1tfcul6h5o86l0ave32ivqo8s22tkalnup2s3cr5089aorvqbi6-k-W-vR-hRSIvuYuXMW3Sj8EXfIW42ZDOhRATDWt21p4g4--weightHistory",
                            o);
                } catch(JSONException e) {
                    ;
                }
            }
        });
    }

    @Override
    public boolean onCreateOptionsMenu(Menu menu) {
        // Inflate the menu; this adds items to the action bar if it is present.
        getMenuInflater().inflate(R.menu.menu_test, menu);
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
