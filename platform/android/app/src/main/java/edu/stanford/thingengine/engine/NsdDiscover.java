package edu.stanford.thingengine.engine;

/**
 * Created by aashna on 20/10/15.
 */

import android.content.Context;
import android.net.nsd.NsdManager;
import android.net.nsd.NsdServiceInfo;
import android.util.Log;
import java.net.InetAddress;

public class NsdDiscover {

    private static NsdDiscover mInstance;
    private static final String NSD_SERVICE_NAME = "ThingEngine-TV";
    private static final String NSD_SERVICE_TYPE = "_http._tcp.";
    private int mPort;
    private InetAddress mHost;
    private static Context mContext;
    private NsdManager mNsdManager;
    private android.net.nsd.NsdManager.DiscoveryListener mDiscoveryListener;
    private android.net.nsd.NsdManager.ResolveListener mResolveListener;
    public static final String LOG_TAG = "NSD.Service";

    public NsdDiscover(Context context) {
        mContext = context;
    }

    public static NsdDiscover getInstance(Context context) {
        if (mInstance == null) {
            mInstance = new NsdDiscover(context);
        } else {
            mContext = context;
        }
        return mInstance;
    }

    private void initializeResolveListener() {
        mResolveListener = new NsdManager.ResolveListener() {
            @Override
            public void onResolveFailed(NsdServiceInfo serviceInfo, int errorCode) {
                Log.d("NSDService test","Resolve failed");
            }

            @Override
            public void onServiceResolved(NsdServiceInfo serviceInfo) {
                NsdServiceInfo info = serviceInfo;
                Log.d("NSDService test","Resolve failed");
                mHost = info.getHost();
                mPort = info.getPort();
                Log.d("NSDService test","Service resolved :" + mHost + ":" + mPort);
            }
        };
    }

    public void initializeDiscoveryListener() {

        // Instantiate a new DiscoveryListener
        mDiscoveryListener = new NsdManager.DiscoveryListener() {

            //  Called as soon as service discovery begins.
            @Override
            public void onDiscoveryStarted(String regType) {
                Log.d(LOG_TAG, "Service discovery started");
            }

            @Override
            public void onServiceFound(NsdServiceInfo service) {
                // Service found
                Log.d(LOG_TAG, "Service discovery success" + service);

                if (service.getServiceName().contains(NSD_SERVICE_NAME)){
                    mNsdManager.resolveService(service, mResolveListener);
                    Log.d(LOG_TAG, "onServiceResolved(" + service + ")");
                    Log.d(LOG_TAG, "name == " + service.getServiceName());
                    Log.d(LOG_TAG, "type == " + service.getServiceType());
                    Log.d(LOG_TAG, "host == " + service.getHost());
                    Log.d(LOG_TAG, "port == " + service.getPort());
                }
            }


            @Override
            public void onServiceLost(NsdServiceInfo service) {
                // When the network service is no longer available.
                // Internal bookkeeping code goes here.
                Log.e(LOG_TAG, "service lost" + service);
            }

            @Override
            public void onDiscoveryStopped(String serviceType) {
                Log.i(LOG_TAG, "Discovery stopped: " + serviceType);
            }

            @Override
            public void onStartDiscoveryFailed(String serviceType, int errorCode) {
                Log.e(LOG_TAG, "Discovery failed: Error code:" + errorCode);
                mNsdManager.stopServiceDiscovery(this);
            }

            @Override
            public void onStopDiscoveryFailed(String serviceType, int errorCode) {
                Log.e(LOG_TAG, "Discovery failed: Error code:" + errorCode);
                mNsdManager.stopServiceDiscovery(this);
            }
        };
    }
    public void startListening() {
        initializeResolveListener();
        initializeDiscoveryListener();
        mNsdManager = (NsdManager) mContext.getSystemService(Context.NSD_SERVICE);
        mNsdManager.discoverServices(NSD_SERVICE_TYPE, NsdManager.PROTOCOL_DNS_SD, mDiscoveryListener);
    }

    public void stopListening() {
        mNsdManager.stopServiceDiscovery(mDiscoveryListener);
    }

}
