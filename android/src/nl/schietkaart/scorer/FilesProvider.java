package nl.schietkaart.scorer;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.util.List;
import java.util.Locale;

/**
 * Minimale FileProvider (zonder androidx): geeft de camera-app schrijftoegang tot cache/camera en
 * deel-apps leestoegang tot cache/share, via content://nl.schietkaart.scorer.files/&lt;map&gt;/&lt;naam&gt;.
 * Niet geëxporteerd; toegang alleen via tijdelijke rechten in een Intent.
 */
public class FilesProvider extends ContentProvider {

    static Uri uriFor(Context ctx, String dir, String name) {
        return new Uri.Builder().scheme("content").authority(ctx.getPackageName() + ".files")
                .appendPath(dir).appendPath(name).build();
    }

    private File fileFor(Uri uri) throws FileNotFoundException {
        List<String> seg = uri.getPathSegments();
        if (seg.size() != 2) throw new FileNotFoundException(uri.toString());
        String dir = seg.get(0), name = seg.get(1);
        if (!("camera".equals(dir) || "share".equals(dir)) || name.contains("/") || name.startsWith(".")) {
            throw new FileNotFoundException(uri.toString());
        }
        return new File(new File(getContext().getCacheDir(), dir), name);
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        File f = fileFor(uri);
        File parent = f.getParentFile();
        if (parent != null && !parent.isDirectory()) //noinspection ResultOfMethodCallIgnored
            parent.mkdirs();
        return ParcelFileDescriptor.open(f, ParcelFileDescriptor.parseMode(mode));
    }

    @Override
    public String getType(Uri uri) {
        String n = uri.getLastPathSegment();
        if (n == null) return null;
        n = n.toLowerCase(Locale.ROOT);
        if (n.endsWith(".jpg") || n.endsWith(".jpeg")) return "image/jpeg";
        if (n.endsWith(".csv")) return "text/csv";
        if (n.endsWith(".txt")) return "text/plain";
        return "application/octet-stream";
    }

    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] selectionArgs, String sortOrder) {
        File f;
        try {
            f = fileFor(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] cols = projection != null ? projection : new String[]{OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        c.addRow(row);
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException();
    }

    @Override
    public int delete(Uri uri, String selection, String[] selectionArgs) {
        return 0;
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] selectionArgs) {
        return 0;
    }
}
