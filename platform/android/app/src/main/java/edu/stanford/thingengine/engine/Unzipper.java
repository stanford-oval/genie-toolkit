package edu.stanford.thingengine.engine;

import java.io.BufferedOutputStream;
import java.io.EOFException;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.Enumeration;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;

/**
 * Created by gcampagn on 12/1/15.
 */
public class Unzipper {
    private static void splice(InputStream input, OutputStream output) throws IOException {
        try {
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) > 0)
                output.write(buffer, 0, read);
        } catch(EOFException e) {
        } finally {
            output.flush();
        }
    }

    public static void unzip(String zipFile, String targetFolder) throws IOException {
        try (ZipFile zip = new ZipFile(zipFile)) {
            Enumeration<? extends ZipEntry> entries = zip.entries();

            while (entries.hasMoreElements()) {
                ZipEntry entry = entries.nextElement();

                if (entry.isDirectory()) {
                    File dir = new File(targetFolder, entry.getName());
                    if (dir.exists())
                        continue;
                    if (!dir.mkdirs())
                        throw new IOException("mkdir failed");
                } else {
                    File target = new File(targetFolder, entry.getName());
                    try (OutputStream output = new BufferedOutputStream(new FileOutputStream(target))) {
                        try (InputStream input = zip.getInputStream(entry)) {
                            splice(input, output);
                        }
                    }
                }
            }
        }
    }
}
