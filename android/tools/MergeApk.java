import java.io.FileOutputStream;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.util.Enumeration;
import java.util.zip.ZipEntry;
import java.util.zip.ZipFile;
import java.util.zip.ZipOutputStream;

/**
 * Voegt classes.dex toe aan de door aapt2 gemaakte APK. Bestaande items worden met dezelfde
 * compressiemethode overgenomen (resources.arsc moet ongecomprimeerd blijven).
 * aapt2 op Windows zet backslashes in asset-paden; die worden hier naar '/' omgezet.
 * Gebruik: java MergeApk.java basis.apk classes.dex uit.apk
 */
public class MergeApk {
    public static void main(String[] args) throws Exception {
        try (ZipFile in = new ZipFile(args[0]); ZipOutputStream out = new ZipOutputStream(new FileOutputStream(args[2]))) {
            Enumeration<? extends ZipEntry> entries = in.entries();
            while (entries.hasMoreElements()) {
                ZipEntry e = entries.nextElement();
                ZipEntry n = new ZipEntry(e.getName().replace('\\', '/'));
                n.setMethod(e.getMethod());
                if (e.getMethod() == ZipEntry.STORED) {
                    n.setSize(e.getSize());
                    n.setCompressedSize(e.getSize());
                    n.setCrc(e.getCrc());
                }
                out.putNextEntry(n);
                try (InputStream is = in.getInputStream(e)) {
                    is.transferTo(out);
                }
                out.closeEntry();
            }
            ZipEntry dex = new ZipEntry("classes.dex");
            dex.setMethod(ZipEntry.DEFLATED);
            out.putNextEntry(dex);
            Files.copy(Paths.get(args[1]), out);
            out.closeEntry();
        }
    }
}
