package nl.schietkaart.scorer;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Intent;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.print.PrintAttributes;
import android.print.PrintManager;
import android.provider.MediaStore;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.JavascriptInterface;
import android.webkit.JsResult;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.window.OnBackInvokedDispatcher;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/** Toont de web-app (assets/www) in een WebView en koppelt camera, galerij, klembord en delen. */
public class MainActivity extends Activity {
    private static final int REQ_PICK = 1, REQ_CAMERA = 2;
    private static final int BRAND = 0xFF14213D, PAGE = 0xFFF3F4F7;
    private static final String CLOSE_EDITOR_JS = "(function(){var s=document.getElementById('shotSheet');"
            + "if(s&&!s.classList.contains('hidden')){s.classList.add('hidden');return 1;}"
            + "var e=document.getElementById('editor');"
            + "if(e&&!e.classList.contains('hidden')){KS.app.closeEditor();return 1;}return 0;})()";

    private WebView web;
    private WebView printView;   // vasthouden tot het printen klaar is
    private ValueCallback<Uri[]> pendingChooser;
    private File cameraFile;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        cleanCache();
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BRAND);
        web = new WebView(this);
        web.setBackgroundColor(PAGE);
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        edgeToEdge(root);
        configureWebView();
        if (Build.VERSION.SDK_INT >= 33) Api33.registerBack(this);
        web.loadUrl("file:///android_asset/www/index.html");
        checkForUpdate();
    }

    // ------------------------------------------------------------------ updates

    /* Leest assets/update-url.txt (door build.ps1 gezet), haalt version.json op en biedt een nieuwere APK aan.
       version.json: {"versionCode": 26110113, "versionName": "...", "apk": "https://...", "notes": "..."} */
    private void checkForUpdate() {
        final String url = readAsset("update-url.txt");
        if (url == null || !url.startsWith("https://")) return;
        new Thread(() -> {
            try {
                JSONObject v = new JSONObject(httpGet(url));
                long latest = v.getLong("versionCode"), current = currentVersionCode();
                final String apk = v.optString("apk", ""), name = v.optString("versionName", ""), notes = v.optString("notes", "");
                if (latest <= current || !apk.startsWith("https://")) return;
                runOnUiThread(() -> {
                    if (isFinishing()) return;
                    new AlertDialog.Builder(this)
                            .setTitle("Nieuwe versie beschikbaar")
                            .setMessage("Versie " + name + (notes.isEmpty() ? "" : "\n\n" + notes)
                                    + "\n\nNa het downloaden de APK openen om bij te werken.")
                            .setPositiveButton("Downloaden", (d, w) -> {
                                try {
                                    startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(apk)));
                                } catch (ActivityNotFoundException e) {
                                    toast("Geen browser gevonden.");
                                }
                            })
                            .setNegativeButton("Later", null)
                            .show();
                });
            } catch (Exception ignored) {
                // geen internet of geen versiebestand: gewoon doorgaan
            }
        }).start();
    }

    private long currentVersionCode() throws Exception {
        android.content.pm.PackageInfo pi = getPackageManager().getPackageInfo(getPackageName(), 0);
        return Build.VERSION.SDK_INT >= 28 ? pi.getLongVersionCode() : pi.versionCode;
    }

    private String readAsset(String name) {
        try (InputStream in = getAssets().open(name)) {
            return readAll(in).trim();
        } catch (Exception e) {
            return null;
        }
    }

    private static String httpGet(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(6000);
        c.setReadTimeout(6000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("Cache-Control", "no-cache");
        try (InputStream in = c.getInputStream()) {
            return readAll(in);
        } finally {
            c.disconnect();
        }
    }

    private static String readAll(InputStream in) throws Exception {
        ByteArrayOutputStream out = new ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        return out.toString("UTF-8");
    }

    // Inhoud tot achter de systeembalken; marges via insets zodat niets eronder verdwijnt (Android 15+ verplicht dit).
    private void edgeToEdge(View root) {
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
        } else {
            root.setSystemUiVisibility(View.SYSTEM_UI_FLAG_LAYOUT_STABLE | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                    | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION);
        }
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int l, t, r, b;
            if (Build.VERSION.SDK_INT >= 30) {
                Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                Insets ime = insets.getInsets(WindowInsets.Type.ime());
                l = bars.left; t = bars.top; r = bars.right; b = Math.max(bars.bottom, ime.bottom);
            } else {
                l = insets.getSystemWindowInsetLeft(); t = insets.getSystemWindowInsetTop();
                r = insets.getSystemWindowInsetRight(); b = insets.getSystemWindowInsetBottom();
            }
            v.setPadding(l, t, r, b);
            return Build.VERSION.SDK_INT >= 30 ? WindowInsets.CONSUMED : insets.consumeSystemWindowInsets();
        });
    }

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(true);
        s.setAllowContentAccess(true);
        s.setTextZoom(100);
        web.addJavascriptInterface(new Bridge(), "AndroidBridge");
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri u = request.getUrl();
                String scheme = u.getScheme();
                if ("file".equals(scheme) || "blob".equals(scheme) || "data".equals(scheme)) return false;
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException e) {
                    toast("Geen app om deze link te openen.");
                }
                return true;
            }
        });
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingChooser != null) pendingChooser.onReceiveValue(null);
                pendingChooser = callback;
                try {
                    if (params.isCaptureEnabled()) startCamera();
                    else startPicker(params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE);
                } catch (Exception e) {
                    pendingChooser = null;
                    callback.onReceiveValue(null);
                    toast("Kan camera of galerij niet openen: " + e.getMessage());
                }
                return true;
            }

            @Override
            public boolean onJsAlert(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }

            @Override
            public boolean onJsConfirm(WebView view, String url, String message, JsResult result) {
                new AlertDialog.Builder(MainActivity.this).setMessage(message)
                        .setPositiveButton("OK", (d, w) -> result.confirm())
                        .setNegativeButton("Annuleren", (d, w) -> result.cancel())
                        .setOnCancelListener(d -> result.cancel())
                        .show();
                return true;
            }
        });
    }

    private void startPicker(boolean multiple) {
        Intent i;
        if (Build.VERSION.SDK_INT >= 33) {
            i = new Intent(MediaStore.ACTION_PICK_IMAGES);
            if (multiple) i.putExtra(MediaStore.EXTRA_PICK_IMAGES_MAX, MediaStore.getPickImagesMaxLimit());
        } else {
            i = new Intent(Intent.ACTION_GET_CONTENT);
            i.addCategory(Intent.CATEGORY_OPENABLE);
            i.setType("image/*");
            i.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, multiple);
        }
        startActivityForResult(i, REQ_PICK);
    }

    // Camera schrijft de foto via onze FilesProvider in de cache (niet in de galerij).
    private void startCamera() {
        File dir = new File(getCacheDir(), "camera");
        if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("cachemap niet beschikbaar");
        cameraFile = new File(dir, "kaart-" + System.currentTimeMillis() + ".jpg");
        Uri uri = FilesProvider.uriFor(this, "camera", cameraFile.getName());
        Intent i = new Intent(MediaStore.ACTION_IMAGE_CAPTURE);
        i.putExtra(MediaStore.EXTRA_OUTPUT, uri);
        i.setClipData(ClipData.newRawUri("foto", uri));
        i.addFlags(Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(i, REQ_CAMERA);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (pendingChooser == null) return;
        Uri[] result = null;
        if (resultCode == RESULT_OK) {
            if (requestCode == REQ_CAMERA) {
                if (cameraFile != null && cameraFile.length() > 0) {
                    result = new Uri[]{FilesProvider.uriFor(this, "camera", cameraFile.getName())};
                }
            } else if (data != null) {
                ClipData clip = data.getClipData();
                if (clip != null && clip.getItemCount() > 0) {
                    result = new Uri[clip.getItemCount()];
                    for (int k = 0; k < result.length; k++) result[k] = clip.getItemAt(k).getUri();
                } else if (data.getData() != null) {
                    result = new Uri[]{data.getData()};
                }
            }
        }
        pendingChooser.onReceiveValue(result);
        pendingChooser = null;
    }

    // Terug: eerst de editor sluiten; anders de app naar de achtergrond (niet afsluiten, dan blijven de scores bewaard).
    void handleBack() {
        web.evaluateJavascript(CLOSE_EDITOR_JS, v -> {
            if (!"1".equals(v)) moveTaskToBack(true);
        });
    }

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        handleBack();
    }

    // Camerafoto's en gedeelde bestanden van eerdere sessies opruimen.
    private void cleanCache() {
        long cutoff = System.currentTimeMillis() - 24L * 3600 * 1000;
        for (String d : new String[]{"camera", "share"}) {
            File[] files = new File(getCacheDir(), d).listFiles();
            if (files == null) continue;
            for (File f : files) if (f.lastModified() < cutoff) //noinspection ResultOfMethodCallIgnored
                f.delete();
        }
    }

    private void toast(String msg) {
        Toast.makeText(this, msg, Toast.LENGTH_LONG).show();
    }

    @Override
    protected void onPause() {
        // Laatste wijzigingen bewaren voordat de app naar de achtergrond gaat.
        web.evaluateJavascript("window.KS&&KS.app&&KS.app.flushSave&&KS.app.flushSave()", null);
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }

    // ------------------------------------------------------------------ opslag van series (app-map/sessies)

    private File storeDir() {
        File d = new File(getFilesDir(), "sessies");
        if (!d.isDirectory()) //noinspection ResultOfMethodCallIgnored
            d.mkdirs();
        return d;
    }

    private static boolean validKey(String k) {
        return k != null && k.matches("[A-Za-z0-9_-]{1,80}");
    }

    /** Aangeroepen vanuit JavaScript als window.AndroidBridge. */
    public class Bridge {
        /** Schrijft atomair (eerst .tmp, dan hernoemen) zodat een onderbroken save niets kapotmaakt. */
        @JavascriptInterface
        public boolean storeWrite(String key, String text) {
            if (!validKey(key)) return false;
            File dir = storeDir(), tmp = new File(dir, key + ".tmp"), dst = new File(dir, key + ".json");
            try (OutputStream out = new FileOutputStream(tmp)) {
                out.write(text.getBytes(StandardCharsets.UTF_8));
            } catch (Exception e) {
                return false;
            }
            return tmp.renameTo(dst) || (dst.delete() && tmp.renameTo(dst));
        }

        @JavascriptInterface
        public String storeRead(String key) {
            if (!validKey(key)) return null;
            File f = new File(storeDir(), key + ".json");
            if (!f.isFile()) return null;
            try (InputStream in = new java.io.FileInputStream(f)) {
                return readAll(in);
            } catch (Exception e) {
                return null;
            }
        }

        @JavascriptInterface
        public boolean storeDelete(String key) {
            return validKey(key) && new File(storeDir(), key + ".json").delete();
        }

        @JavascriptInterface
        public void copyText(String text) {
            runOnUiThread(() -> {
                ClipboardManager cm = (ClipboardManager) getSystemService(CLIPBOARD_SERVICE);
                if (cm != null) cm.setPrimaryClip(ClipData.newPlainText("Uitslag", text));
                if (Build.VERSION.SDK_INT < 33) toast("Uitslag gekopieerd");
            });
        }

        /** Rapport-HTML in een aparte WebView laden en via het Android-printmenu aanbieden ("Opslaan als PDF"). */
        @JavascriptInterface
        public void printHtml(String html, String name) {
            runOnUiThread(() -> {
                WebView pv = new WebView(MainActivity.this);
                pv.setWebViewClient(new WebViewClient() {
                    private boolean started;

                    @Override
                    public void onPageFinished(WebView view, String url) {
                        if (started) return;
                        started = true;
                        PrintManager pm = (PrintManager) getSystemService(PRINT_SERVICE);
                        if (pm == null) { toast("Printen is niet beschikbaar."); return; }
                        PrintAttributes attrs = new PrintAttributes.Builder()
                                .setMediaSize(PrintAttributes.MediaSize.ISO_A4)
                                .setMinMargins(PrintAttributes.Margins.NO_MARGINS)
                                .build();
                        pm.print(name, view.createPrintDocumentAdapter(name), attrs);
                    }
                });
                pv.loadDataWithBaseURL("file:///android_asset/www/", html, "text/html", "UTF-8", null);
                printView = pv;
            });
        }

        @JavascriptInterface
        public void shareFile(String name, String mime, String content) {
            runOnUiThread(() -> {
                try {
                    String safe = name.replaceAll("[^A-Za-z0-9._-]", "_");
                    File dir = new File(getCacheDir(), "share");
                    if (!dir.isDirectory() && !dir.mkdirs()) throw new IllegalStateException("cachemap niet beschikbaar");
                    try (OutputStream out = new FileOutputStream(new File(dir, safe))) {
                        out.write(content.getBytes(StandardCharsets.UTF_8));
                    }
                    Uri uri = FilesProvider.uriFor(MainActivity.this, "share", safe);
                    Intent send = new Intent(Intent.ACTION_SEND);
                    send.setType(mime);
                    send.putExtra(Intent.EXTRA_STREAM, uri);
                    send.putExtra(Intent.EXTRA_SUBJECT, safe);
                    send.setClipData(ClipData.newRawUri(safe, uri));
                    send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    startActivity(Intent.createChooser(send, "Uitslag delen"));
                } catch (Exception e) {
                    toast("Delen mislukt: " + e.getMessage());
                }
            });
        }
    }

    /** API 33+: terugknop via OnBackInvokedDispatcher (onBackPressed wordt vanaf Android 16 niet meer aangeroepen). */
    private static final class Api33 {
        static void registerBack(MainActivity a) {
            a.getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, a::handleBack);
        }
    }
}
