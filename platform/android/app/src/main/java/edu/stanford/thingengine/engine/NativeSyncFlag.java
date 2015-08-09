package edu.stanford.thingengine.engine;

import java.io.Closeable;
import java.io.IOException;

/**
 * Created by gcampagn on 8/9/15.
 */
public class NativeSyncFlag implements AutoCloseable, Closeable {
    private int fd;

    public native void init() throws IOException;
    public static native void signalFD(int fd) throws IOException;
    public static native void closeFD(int fd) throws IOException;

    static {
        System.loadLibrary("thingengine-native");
    }

    public NativeSyncFlag() throws IOException {
        fd = -1;
        init();
    }

    public int getFD() {
        return fd;
    }

    public void signal() throws IOException {
        signalFD(fd);
    }

    @Override
    public void close() throws IOException {
        closeFD(fd);
        fd = -1;
    }
}
