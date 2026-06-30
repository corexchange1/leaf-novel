package lan.leafnovel.reader;

import android.app.Activity;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.util.Base64;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import androidx.activity.result.ActivityResult;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

@CapacitorPlugin(name = "LocalFolder")
public class LocalFolderPlugin extends Plugin {
    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        intent.addFlags(Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        startActivityForResult(call, intent, "folderPicked");
    }

    @ActivityCallback
    private void folderPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            call.reject("Không chọn thư mục.");
            return;
        }

        Uri treeUri = result.getData().getData();
        int flags = result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        getContext().getContentResolver().takePersistableUriPermission(treeUri, flags);

        try {
            JSArray files = new JSArray();
            String rootDocumentId = DocumentsContract.getTreeDocumentId(treeUri);
            String path = readDisplayName(treeUri, rootDocumentId);
            collectFiles(treeUri, rootDocumentId, "", files);

            JSObject payload = new JSObject();
            payload.put("path", path);
            payload.put("files", files);
            call.resolve(payload);
        } catch (Exception error) {
            call.reject("Không đọc được thư mục.", error);
        }
    }

    private void collectFiles(Uri treeUri, String documentId, String parentPath, JSArray files) throws Exception {
        Uri childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, documentId);
        String[] projection = new String[] {
            DocumentsContract.Document.COLUMN_DOCUMENT_ID,
            DocumentsContract.Document.COLUMN_DISPLAY_NAME,
            DocumentsContract.Document.COLUMN_MIME_TYPE
        };

        try (Cursor cursor = getContext().getContentResolver().query(childrenUri, projection, null, null, null)) {
            if (cursor == null) return;
            while (cursor.moveToNext()) {
                String childDocumentId = cursor.getString(0);
                String name = cursor.getString(1);
                String mimeType = cursor.getString(2);
                if (name == null || childDocumentId == null) continue;

                String path = parentPath.isEmpty() ? name : parentPath + "/" + name;
                if (DocumentsContract.Document.MIME_TYPE_DIR.equals(mimeType)) {
                    collectFiles(treeUri, childDocumentId, path, files);
                    continue;
                }

                if (!isSupported(name)) continue;
                Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childDocumentId);

                JSObject file = new JSObject();
                file.put("name", name);
                file.put("path", path);
                if (isImage(name)) {
                    String mime = mimeType != null && mimeType.startsWith("image/") ? mimeType : mimeFromName(name);
                    file.put("mimeType", mime);
                    file.put("dataUrl", "data:" + mime + ";base64," + readBase64(documentUri));
                } else {
                    String content = readText(documentUri).trim();
                    if (content.isEmpty()) continue;
                    file.put("content", content);
                }
                files.put(file);
            }
        }
    }

    private String readDisplayName(Uri treeUri, String documentId) {
        Uri documentUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, documentId);
        String[] projection = new String[] { DocumentsContract.Document.COLUMN_DISPLAY_NAME };
        try (Cursor cursor = getContext().getContentResolver().query(documentUri, projection, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) return cursor.getString(0);
        } catch (Exception ignored) {
        }
        return "Thư mục đã chọn";
    }

    private String readText(Uri uri) throws Exception {
        return new String(readBytes(uri), StandardCharsets.UTF_8);
    }

    private String readBase64(Uri uri) throws Exception {
        return Base64.encodeToString(readBytes(uri), Base64.NO_WRAP);
    }

    private byte[] readBytes(Uri uri) throws Exception {
        try (InputStream input = getContext().getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) return new byte[0];
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) {
                output.write(buffer, 0, read);
            }
            return output.toByteArray();
        }
    }

    private boolean isSupported(String name) {
        String lower = name.toLowerCase();
        return lower.endsWith(".md") || lower.endsWith(".html") || lower.endsWith(".htm") || isImage(name);
    }

    private boolean isImage(String name) {
        String lower = name.toLowerCase();
        return lower.endsWith(".png") || lower.endsWith(".jpg") || lower.endsWith(".jpeg") || lower.endsWith(".webp");
    }

    private String mimeFromName(String name) {
        String lower = name.toLowerCase();
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".webp")) return "image/webp";
        return "image/jpeg";
    }
}
