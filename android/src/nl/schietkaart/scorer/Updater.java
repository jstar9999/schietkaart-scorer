package nl.schietkaart.scorer;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageInfo;
import android.content.pm.PackageInstaller;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.widget.Toast;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

/**
 * Updates binnen de app, zonder browser of meldingen:
 * - web-app (www.zip): stil downloaden, SHA-256 controleren, bij de volgende start laden. Start een nieuwe versie
 *   niet goed op, dan wordt die afgekeurd en draait weer de vorige.
 * - Android-schil (APK): alleen bij een hogere versiecode. Downloaden, controleren en installeren via PackageInstaller.
 *   De eerste keer vraagt Android één bevestiging; daarna (Android 12+) stil zodra de app naar de achtergrond gaat.
 * Alleen adressen uit de eigen GitHub-repository (afgeleid uit assets/update-url.txt) worden geaccepteerd.
 */
final class Updater {
    static final String ASSET_URL = "file:///android_asset/www/index.html";
    static final String ACTION_INSTALL_STATUS = "nl.schietkaart.scorer.INSTALL_STATUS";
    private static final String P_ACTIVE = "webActive", P_BAD = "webBad", P_OK = "webOk";

    interface Listener {
        void onNativeUpdateReady();

        void onWebUpdateReady();

        void onCheckDone();
    }

    private static final long CHECK_INTERVAL_MS = 5 * 60 * 1000;

    private final Activity act;
    private final SharedPreferences prefs;
    private final Listener listener;
    private String loadedWeb;                // gedownloade web-versie die nu draait (null = meegeleverde)
    private volatile File nativeApk;          // gecontroleerde APK-update, klaar om te installeren
    private volatile String nativeName = "";
    private boolean installing;
    private volatile boolean checking;
    private volatile long lastCheck;
    private volatile String status = "";      // laatste resultaat, zichtbaar onder Instellingen

    Updater(Activity a, Listener l) {
        act = a;
        listener = l;
        prefs = a.getSharedPreferences("updates", Context.MODE_PRIVATE);
    }

    // ------------------------------------------------------------------ welke web-versie laden

    String bundledWebVersion() {
        String v = readAsset("www/web-version.txt");
        return v == null || v.isEmpty() ? "0" : v;
    }

    String loadedWebVersion() { return loadedWeb != null ? loadedWeb : bundledWebVersion(); }

    String pendingWebVersion() {
        String a = prefs.getString(P_ACTIVE, "");
        return a.compareTo(loadedWebVersion()) > 0 ? a : "";
    }

    boolean needsStartCheck() { return loadedWeb != null && !loadedWeb.equals(prefs.getString(P_OK, "")); }

    String nativeUpdateName() { return nativeApk != null ? nativeName : ""; }

    private File webRoot() { return new File(act.getFilesDir(), "www"); }

    /** Nieuwste gedownloade web-versie (als die nieuwer is dan de meegeleverde en niet afgekeurd), anders de assets. */
    String startUrl() {
        String bundled = bundledWebVersion(), active = prefs.getString(P_ACTIVE, ""), bad = prefs.getString(P_BAD, "");
        if (!active.isEmpty() && !active.equals(bad) && active.compareTo(bundled) > 0) {
            File idx = new File(new File(webRoot(), active), "index.html");
            if (idx.isFile()) {
                loadedWeb = active;
                prune(active);
                return Uri.fromFile(idx).toString();
            }
        }
        if (!active.isEmpty()) prefs.edit().remove(P_ACTIVE).apply();
        loadedWeb = null;
        prune(null);
        return ASSET_URL;
    }

    /** De pagina meldde zich gereed: deze web-versie is goed. */
    void confirmLoaded() {
        if (loadedWeb != null) prefs.edit().putString(P_OK, loadedWeb).apply();
    }

    /** De pagina startte niet binnen de tijd: versie afkeuren en terug naar de meegeleverde. */
    String rejectLoaded() {
        if (loadedWeb != null) prefs.edit().putString(P_BAD, loadedWeb).remove(P_ACTIVE).apply();
        loadedWeb = null;
        return ASSET_URL;
    }

    private void prune(String keep) {
        File[] dirs = webRoot().listFiles();
        if (dirs == null) return;
        for (File d : dirs) if (keep == null || !d.getName().equals(keep)) deleteTree(d);
    }

    // ------------------------------------------------------------------ controleren en downloaden

    String status() { return status; }

    /** Controleren mag bij opstarten en bij terugkomen in de app, maar hooguit eens per 5 minuten. */
    boolean checkDue() { return !checking && System.currentTimeMillis() - lastCheck > CHECK_INTERVAL_MS; }

    void check() {
        final String url = readAsset("update-url.txt");
        if (url == null || !url.startsWith("https://") || checking) return;
        int i = url.indexOf("/releases/");
        if (i < 0) return;
        final String prefix = url.substring(0, i + "/releases/".length());
        checking = true;
        lastCheck = System.currentTimeMillis();
        new Thread(() -> {
            String result;
            try {
                JSONObject v = new JSONObject(new String(httpGet(url), StandardCharsets.UTF_8));
                long current = currentVersionCode();
                JSONObject w = v.optJSONObject("web");
                result = w != null ? updateWeb(w, prefix, current) : "geen web-versie in version.json";
                long latest = v.optLong("versionCode", 0);
                String apk = v.optString("apk", "");
                if (latest > current && apk.startsWith(prefix)) {
                    result = downloadNative(apk, v.optString("apkSha256", ""), v.optString("versionName", ""), current);
                }
            } catch (Exception e) {
                result = "fout: " + e.getClass().getSimpleName() + (e.getMessage() == null ? "" : " " + e.getMessage());
            }
            status = new java.text.SimpleDateFormat("HH:mm", java.util.Locale.ROOT).format(new java.util.Date()) + " – " + result;
            checking = false;
            act.runOnUiThread(listener::onCheckDone);
        }, "updates").start();
    }

    private String updateWeb(JSONObject w, String prefix, long nativeCode) throws Exception {
        String ver = w.optString("version", ""), url = w.optString("url", ""), sha = w.optString("sha256", "");
        if (!ver.matches("[0-9A-Za-z._-]{1,40}") || !url.startsWith(prefix) || sha.isEmpty()) return "ongeldige web-versie";
        if (w.optLong("minNative", 0) > nativeCode) return "nieuwe versie " + ver + " vraagt eerst een app-update";
        String newest = loadedWebVersion(), active = prefs.getString(P_ACTIVE, "");
        if (active.compareTo(newest) > 0) newest = active;
        if (ver.equals(prefs.getString(P_BAD, ""))) return "versie " + ver + " overgeslagen (startte niet)";
        if (ver.compareTo(newest) <= 0) return active.compareTo(loadedWebVersion()) > 0 ? "versie " + active + " staat klaar" : "up-to-date";

        File zip = new File(act.getCacheDir(), "web-update.zip");
        download(url, zip);
        if (!sha.equalsIgnoreCase(sha256(zip))) { zip.delete(); return "fout: controle van de download mislukt"; }
        File root = webRoot(), part = new File(root, ver + ".part"), dir = new File(root, ver);
        deleteTree(part);
        unzip(zip, part);
        zip.delete();
        if (!new File(part, "index.html").isFile()) { deleteTree(part); return "fout: download onvolledig"; }
        deleteTree(dir);
        if (!part.renameTo(dir)) { deleteTree(part); return "fout: opslaan mislukt"; }
        prefs.edit().putString(P_ACTIVE, ver).commit();
        act.runOnUiThread(listener::onWebUpdateReady);
        return "versie " + ver + " gedownload";
    }

    /** Is er een gedownloade web-versie die nieuwer is dan wat nu draait? */
    boolean webUpdatePending() { return !pendingWebVersion().isEmpty(); }

    private String downloadNative(String url, String sha, String name, long current) throws Exception {
        if (nativeApk != null && name.equals(nativeName)) return "app-update " + name + " staat klaar";
        File f = new File(act.getCacheDir(), "update.apk");
        download(url, f);
        if (sha.isEmpty() || !sha.equalsIgnoreCase(sha256(f))) { f.delete(); return "fout: controle van de app-update mislukt"; }
        PackageInfo pi = act.getPackageManager().getPackageArchiveInfo(f.getPath(), 0);
        long code = pi == null ? 0 : (Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode);
        if (pi == null || !act.getPackageName().equals(pi.packageName) || code <= current) { f.delete(); return "fout: app-update ongeldig"; }
        nativeName = name;
        nativeApk = f;
        act.runOnUiThread(listener::onNativeUpdateReady);
        return "app-update " + name + " klaar om te installeren";
    }

    // ------------------------------------------------------------------ installeren (Android-schil)

    /** Stil installeren kan als deze app zelf de vorige versie installeerde (Android 12+) en de toestemming heeft. */
    boolean canInstallSilently() {
        if (Build.VERSION.SDK_INT < 31) return false;
        PackageManager pm = act.getPackageManager();
        if (!pm.canRequestPackageInstalls()) return false;
        try {
            return act.getPackageName().equals(pm.getInstallSourceInfo(act.getPackageName()).getInstallingPackageName());
        } catch (Exception e) {
            return false;
        }
    }

    /** @param silentOnly alleen installeren als dat zonder bevestiging kan (bij naar de achtergrond gaan). */
    boolean install(boolean silentOnly) {
        File apk = nativeApk;
        if (apk == null || !apk.isFile() || installing) return false;
        if (silentOnly && !canInstallSilently()) return false;
        PackageManager pm = act.getPackageManager();
        if (!pm.canRequestPackageInstalls()) {
            Toast.makeText(act, "Sta eenmalig \"Apps installeren\" toe voor Schietkaart Scorer en tik daarna opnieuw op Installeren.",
                    Toast.LENGTH_LONG).show();
            try {
                act.startActivity(new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + act.getPackageName())));
            } catch (Exception ignored) {
                // instellingenscherm niet beschikbaar
            }
            return false;
        }
        try {
            PackageInstaller pi = pm.getPackageInstaller();
            PackageInstaller.SessionParams p = new PackageInstaller.SessionParams(PackageInstaller.SessionParams.MODE_FULL_INSTALL);
            p.setAppPackageName(act.getPackageName());
            if (Build.VERSION.SDK_INT >= 31) p.setRequireUserAction(PackageInstaller.SessionParams.USER_ACTION_NOT_REQUIRED);
            int id = pi.createSession(p);
            PackageInstaller.Session s = pi.openSession(id);
            try (InputStream in = new FileInputStream(apk); OutputStream out = s.openWrite("app.apk", 0, apk.length())) {
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                s.fsync(out);
            }
            Intent cb = new Intent(ACTION_INSTALL_STATUS).setPackage(act.getPackageName());
            int flags = PendingIntent.FLAG_UPDATE_CURRENT | (Build.VERSION.SDK_INT >= 31 ? PendingIntent.FLAG_MUTABLE : 0);
            s.commit(PendingIntent.getBroadcast(act, id, cb, flags).getIntentSender());
            s.close();
            installing = true;
            return true;
        } catch (Exception e) {
            Toast.makeText(act, "Installeren mislukt: " + e.getMessage(), Toast.LENGTH_LONG).show();
            return false;
        }
    }

    /** Status van PackageInstaller. Eerste keer: Android vraagt één bevestiging. */
    @SuppressWarnings("deprecation")
    void onInstallStatus(Intent i) {
        installing = false;
        int status = i.getIntExtra(PackageInstaller.EXTRA_STATUS, PackageInstaller.STATUS_FAILURE);
        if (status == PackageInstaller.STATUS_PENDING_USER_ACTION) {
            Intent confirm = Build.VERSION.SDK_INT >= 33 ? i.getParcelableExtra(Intent.EXTRA_INTENT, Intent.class) : i.getParcelableExtra(Intent.EXTRA_INTENT);
            if (confirm != null) {
                confirm.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    act.startActivity(confirm);
                    installing = true;
                } catch (Exception ignored) {
                    // geen bevestigingsscherm
                }
            }
        } else if (status != PackageInstaller.STATUS_SUCCESS) {
            String msg = i.getStringExtra(PackageInstaller.EXTRA_STATUS_MESSAGE);
            if (status != PackageInstaller.STATUS_FAILURE_ABORTED) {
                Toast.makeText(act, "Update niet geïnstalleerd" + (msg == null ? "" : ": " + msg), Toast.LENGTH_LONG).show();
            }
        }
    }

    // ------------------------------------------------------------------ hulpfuncties

    long currentVersionCode() throws Exception {
        PackageInfo pi = act.getPackageManager().getPackageInfo(act.getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
    }

    String nativeVersionName() {
        try {
            return act.getPackageManager().getPackageInfo(act.getPackageName(), 0).versionName;
        } catch (Exception e) {
            return "";
        }
    }

    private String readAsset(String name) {
        try (InputStream in = act.getAssets().open(name)) {
            return new String(readAll(in), StandardCharsets.UTF_8).trim();
        } catch (Exception e) {
            return null;
        }
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(8000);
        c.setReadTimeout(15000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("Cache-Control", "no-cache");
        return c;
    }

    private static byte[] httpGet(String url) throws Exception {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream()) {
            return readAll(in);
        } finally {
            c.disconnect();
        }
    }

    private static void download(String url, File dst) throws Exception {
        HttpURLConnection c = open(url);
        try (InputStream in = c.getInputStream(); OutputStream out = new FileOutputStream(dst)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        } finally {
            c.disconnect();
        }
    }

    private static byte[] readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toByteArray();
    }

    private static String sha256(File f) throws Exception {
        MessageDigest md = MessageDigest.getInstance("SHA-256");
        try (InputStream in = new FileInputStream(f)) {
            byte[] buf = new byte[65536];
            int n;
            while ((n = in.read(buf)) > 0) md.update(buf, 0, n);
        }
        StringBuilder sb = new StringBuilder();
        for (byte b : md.digest()) sb.append(String.format("%02x", b));
        return sb.toString();
    }

    /** Uitpakken met bescherming tegen paden buiten de doelmap. */
    private static void unzip(File zip, File dir) throws Exception {
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("map");
        String base = dir.getCanonicalPath() + File.separator;
        try (ZipInputStream zin = new ZipInputStream(new FileInputStream(zip))) {
            ZipEntry e;
            byte[] buf = new byte[65536];
            while ((e = zin.getNextEntry()) != null) {
                File f = new File(dir, e.getName());
                if (!f.getCanonicalPath().startsWith(base)) throw new SecurityException("ongeldig pad in zip");
                if (e.isDirectory()) { f.mkdirs(); continue; }
                File parent = f.getParentFile();
                if (parent != null && !parent.isDirectory()) parent.mkdirs();
                try (OutputStream out = new FileOutputStream(f)) {
                    int n;
                    while ((n = zin.read(buf)) > 0) out.write(buf, 0, n);
                }
            }
        }
    }

    private static void deleteTree(File f) {
        if (f == null || !f.exists()) return;
        File[] kids = f.listFiles();
        if (kids != null) for (File k : kids) deleteTree(k);
        //noinspection ResultOfMethodCallIgnored
        f.delete();
    }
}
