package lan.leafnovel.reader;

import android.app.DownloadManager;
import android.content.Context;
import android.net.Uri;
import android.os.Environment;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "AppUpdater")
public class AppUpdaterPlugin extends Plugin {
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

            JSObject payload = new JSObject();
            payload.put("downloadId", downloadId);
            payload.put("filename", filename);
            call.resolve(payload);
        } catch (Exception error) {
            call.reject("Không tải được APK.", error);
        }
    }
}
