package lan.leafnovel.reader;

import android.app.DownloadManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.content.res.Configuration;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
    @PluginMethod
    public void info(PluginCall call) {
        JSObject payload = new JSObject();
        payload.put("deviceFlavor", BuildConfig.DEVICE_FLAVOR);
        payload.put("physicalDevice", getPhysicalDevice());
        payload.put("packageName", getContext().getPackageName());
        payload.put("versionName", BuildConfig.VERSION_NAME);
        call.resolve(payload);
    }

    private String getPhysicalDevice() {
        Configuration configuration = getContext().getResources().getConfiguration();
        return configuration.smallestScreenWidthDp >= 600 ? "tablet" : "phone";
    }

    @PluginMethod
    public void download(PluginCall call) {
        String url = call.getString("url", "");
        String filename = call.getString("filename", "");
        if (url.trim().isEmpty()) {
            call.reject("Thiếu link tải APK.");
            return;
        }
        if (filename.trim().isEmpty()) {
            filename = "leaf-novel-update.apk";
        }

        try {
            DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
            request.setTitle(filename);
            request.setDescription("Đang tải bản cập nhật Leaf Novel");
            request.setMimeType("application/vnd.android.package-archive");
            request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            request.setAllowedOverMetered(true);
            request.setAllowedOverRoaming(true);
            request.addRequestHeader("User-Agent", "LeafNovelAndroid");
            request.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, filename);

            DownloadManager manager = (DownloadManager) getContext().getSystemService(Context.DOWNLOAD_SERVICE);
            long downloadId = manager.enqueue(request);
            registerInstallPrompt(manager, downloadId);

            JSObject payload = new JSObject();
            payload.put("downloadId", downloadId);
            payload.put("filename", filename);
            call.resolve(payload);
        } catch (Exception error) {
            call.reject("Không tải được APK.", error);
        }
    }

    private void registerInstallPrompt(DownloadManager manager, long expectedDownloadId) {
        Context context = getContext().getApplicationContext();
        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context receiverContext, Intent intent) {
                long completedDownloadId = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1);
                if (completedDownloadId != expectedDownloadId) return;

                try {
                    receiverContext.unregisterReceiver(this);
                } catch (Exception ignored) {
                    // Receiver may already be gone if Android delivered a stale event.
                }

                Uri apkUri = manager.getUriForDownloadedFile(expectedDownloadId);
                if (apkUri == null) return;

                Intent installIntent = new Intent(Intent.ACTION_VIEW);
                installIntent.setDataAndType(apkUri, "application/vnd.android.package-archive");
                installIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                installIntent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                context.startActivity(installIntent);
            }
        };

        IntentFilter filter = new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED);
        } else {
            context.registerReceiver(receiver, filter);
        }
    }
}
