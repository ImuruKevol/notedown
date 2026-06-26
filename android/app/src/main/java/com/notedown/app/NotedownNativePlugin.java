package com.notedown.app;

import android.Manifest;
import android.app.Activity;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.ClipData;
import android.content.ActivityNotFoundException;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Canvas;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.OpenableColumns;
import android.view.View;
import android.view.ViewGroup;
import android.widget.FrameLayout;
import android.widget.Toast;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import androidx.activity.result.ActivityResult;
import androidx.core.content.FileProvider;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.HashSet;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

@CapacitorPlugin(
    name = "NotedownNative",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class NotedownNativePlugin extends Plugin {
    private static final String APP_PREFERENCES = "notedown-app-preferences";
    private static final String METADATA_FILE = "metadata.json";
    private static final String SYNC_STATE_FILE = ".notedown-sync.json";
    private static final String PDF_CACHE_DIR = "pending-pdf";
    private static final String NOTIFICATION_PERMISSION_ALIAS = "notifications";
    private static final String PDF_NOTIFICATION_CHANNEL_ID = "pdf_exports";
    private static final String IMPORTED_WORKSPACE_ID = "_imported";
    private static final String UNFILED_WORKSPACE_ID = "unfiled";

    @PluginMethod
    public void preferences(PluginCall call) {
        JSObject result = new JSObject();
        result.put("keepInBackgroundOnClose", preferences().getBoolean("keepInBackgroundOnClose", true));
        call.resolve(result);
    }

    @PluginMethod
    public void setPreferences(PluginCall call) {
        Boolean keepInBackground = call.getBoolean("keepInBackgroundOnClose", true);
        preferences()
            .edit()
            .putBoolean("keepInBackgroundOnClose", keepInBackground == null || keepInBackground)
            .apply();
        preferences(call);
    }

    @PluginMethod
    public void showWindow(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", true);
        call.resolve(result);
    }

    @PluginMethod
    public void defaultPath(PluginCall call) {
        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("storagePath", defaultStoragePath());
        call.resolve(result);
    }

    @PluginMethod
    public void chooseDirectory(PluginCall call) {
        defaultPath(call);
    }

    @PluginMethod
    public void info(PluginCall call) {
        runFileTask(call, () -> {
            File storage = storageRoot(call.getString("storagePath"));
            ensureDirectory(storage);
            JSONObject metadata = readMetadata(storage);
            List<String> shallowMarkdown = listMarkdownFiles(storage, 1, storage);
            List<String> allMarkdown = listMarkdownFiles(storage, 20, storage);

            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("storagePath", storage.getAbsolutePath());
            result.put("metadataPath", new File(storage, METADATA_FILE).getAbsolutePath());
            result.put("metadataExists", metadata != null);
            result.put("notes", metadata == null ? 0 : metadata.optJSONArray("notes") == null ? 0 : metadata.optJSONArray("notes").length());
            result.put("workspaces", metadata == null ? 0 : metadata.optJSONArray("workspaces") == null ? 0 : metadata.optJSONArray("workspaces").length());
            result.put("shallowMarkdownCount", shallowMarkdown.size());
            result.put("deepMarkdownCount", deepMarkdownCount(allMarkdown));
            return result;
        });
    }

    @PluginMethod
    public void initialize(PluginCall call) {
        runFileTask(call, () -> generateMetadata(
            storageRoot(call.getString("storagePath")),
            Boolean.TRUE.equals(call.getBoolean("importDeepMarkdown", false))
        ));
    }

    @PluginMethod
    public void loadNotes(PluginCall call) {
        runFileTask(call, () -> {
            File storage = storageRoot(call.getString("storagePath"));
            JSONObject metadata = ensureMetadata(storage);
            JSONArray metadataNotes = metadata.optJSONArray("notes");
            JSONArray notes = new JSONArray();

            if (metadataNotes != null) {
                for (int i = 0; i < metadataNotes.length(); i++) {
                    JSONObject note = metadataNotes.optJSONObject(i);
                    if (note == null) continue;
                    JSONObject next = cloneObject(note);
                    String relativePath = normalizeRelativePath(note.optString("relativePath", ""));
                    next.put("body", readText(resolveStorageFile(storage, relativePath), ""));
                    next.put("folder", note.optString("workspace", note.optString("folder", UNFILED_WORKSPACE_ID)));
                    notes.put(next);
                }
            }

            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("storagePath", storage.getAbsolutePath());
            result.put("notes", notes);
            result.put("metadata", metadata);
            return result;
        });
    }

    @PluginMethod
    public void saveNotes(PluginCall call) {
        runFileTask(call, () -> {
            File storage = storageRoot(call.getString("storagePath"));
            ensureDirectory(storage);
            JSONObject previousMetadata = readMetadata(storage);
            JSONArray notes = call.getData().optJSONArray("notes");
            if (notes == null) notes = new JSONArray();

            Map<String, JSONObject> workspaces = new LinkedHashMap<>();
            workspaces.put(UNFILED_WORKSPACE_ID, workspacePayload(UNFILED_WORKSPACE_ID, "미지정 워크스페이스"));
            JSONArray metadataNotes = new JSONArray();
            List<String> writtenRelativePaths = new ArrayList<>();
            List<String> writtenAttachmentPaths = new ArrayList<>();

            for (int i = 0; i < notes.length(); i++) {
                JSONObject note = notes.optJSONObject(i);
                if (note == null) continue;
                String workspaceId = noteWorkspaceId(note);
                String workspaceName = noteWorkspaceName(note, workspaceId);
                String fileName = noteFileName(note);
                String relativePath = relativePathForNote(note);
                File target = resolveStorageFile(storage, relativePath);
                ensureDirectory(target.getParentFile());
                writeBytes(target, note.optString("body", "").getBytes(StandardCharsets.UTF_8));
                writtenRelativePaths.add(relativePath);

                workspaces.put(workspaceId, workspacePayload(workspaceId, workspaceName));
                JSONArray attachments = noteAttachmentsForMetadata(note, relativePath);
                for (int attachmentIndex = 0; attachmentIndex < attachments.length(); attachmentIndex++) {
                    JSONObject attachment = attachments.optJSONObject(attachmentIndex);
                    if (attachment != null) writtenAttachmentPaths.add(attachment.optString("relativePath", ""));
                }

                long now = System.currentTimeMillis();
                JSONObject metadataNote = new JSONObject();
                metadataNote.put("id", note.optString("id", noteIdFromRelativePath(relativePath)));
                metadataNote.put("icon", note.optString("icon", "N"));
                metadataNote.put("title", note.optString("title", titleFromMarkdown(note.optString("body", ""), fileName)));
                metadataNote.put("tags", note.optJSONArray("tags") == null ? new JSONArray() : note.optJSONArray("tags"));
                metadataNote.put("status", note.optString("status", "active"));
                metadataNote.put("workspace", workspaceId);
                metadataNote.put("workspaceName", workspaceName);
                metadataNote.put("folder", workspaceId);
                metadataNote.put("fileName", fileName);
                metadataNote.put("relativePath", relativePath);
                metadataNote.put("attachments", attachments);
                metadataNote.put("createdAt", note.optString("createdAt", labelForDate(note.optLong("createdAtMs", now))));
                metadataNote.put("createdAtMs", note.optLong("createdAtMs", now));
                metadataNote.put("updatedAt", note.optString("updatedAt", labelForDate(now)));
                metadataNote.put("updatedAtMs", note.optLong("updatedAtMs", now));
                metadataNotes.put(metadataNote);
            }

            JSONObject metadata = new JSONObject();
            metadata.put("version", 1);
            metadata.put("generatedAt", isoNow());
            metadata.put("workspaces", new JSONArray(workspaces.values()));
            metadata.put("notes", metadataNotes);
            writeMetadata(storage, metadata);
            removeMetadataOrphans(storage, previousMetadata, writtenRelativePaths, writtenAttachmentPaths);

            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("storagePath", storage.getAbsolutePath());
            result.put("notes", metadataNotes.length());
            result.put("workspaces", workspaces.size());
            return result;
        });
    }

    @PluginMethod
    public void saveAttachment(PluginCall call) {
        runFileTask(call, () -> {
            File storage = storageRoot(call.getString("storagePath"));
            JSONObject metadata = ensureMetadata(storage);
            JSONObject payloadNote = call.getObject("note");
            String noteRelativePath = normalizeRelativePath(call.getString("noteRelativePath", ""));
            if (noteRelativePath.isEmpty() && payloadNote != null) noteRelativePath = relativePathForNote(payloadNote);
            if (noteRelativePath.isEmpty()) throw new IllegalArgumentException("첨부할 노트를 찾지 못했습니다.");

            JSONObject note = findMetadataNote(metadata, noteRelativePath);
            if (note == null && payloadNote != null) {
                note = notePayload(payloadNote, noteRelativePath);
                upsertMetadataNote(metadata, note);
            }
            if (note == null) throw new IllegalArgumentException("첨부할 노트를 찾지 못했습니다.");

            String fileName = safeAttachmentFileName(call.getString("fileName", "attachment"));
            String content = call.getString("content", "");
            String encoding = call.getString("contentEncoding", "base64");
            byte[] bytes = "base64".equals(encoding)
                ? Base64.getDecoder().decode(content)
                : content.getBytes(StandardCharsets.UTF_8);
            JSONObject attachment = saveAttachmentBytes(
                storage,
                metadata,
                note,
                noteRelativePath,
                fileName,
                call.getString("mimeType", JSONObject.NULL.toString()),
                bytes,
                call.getString("relativePath"),
                call.getString("id", "")
            );

            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("storagePath", storage.getAbsolutePath());
            result.put("noteRelativePath", noteRelativePath);
            result.put("attachment", attachment);
            return result;
        });
    }

    @PluginMethod
    public void chooseAttachments(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType("image".equals(call.getString("mode", "file")) ? "image/*" : "*/*");
        intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        startActivityForResult(call, intent, "chooseAttachmentsResult");
    }

    @PluginMethod
    public void openAttachment(PluginCall call) {
        runFileTask(call, () -> {
            File storage = storageRoot(call.getString("storagePath"));
            String relativePath = normalizeRelativePath(call.getString("relativePath", ""));
            File target = resolveStorageFile(storage, relativePath);
            if (!target.exists()) throw new IllegalArgumentException("첨부 파일을 찾지 못했습니다.");

            Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", target);
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setDataAndType(uri, mimeTypeForFileName(target.getName()));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            try {
                getActivity().startActivity(intent);
            } catch (ActivityNotFoundException error) {
                throw new IllegalArgumentException("첨부 파일을 열 앱을 찾지 못했습니다.");
            }

            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("relativePath", relativePath);
            return result;
        });
    }

    @PluginMethod
    public void readFile(PluginCall call) {
        runFileTask(call, () -> {
            File storage = storageRoot(call.getString("storagePath"));
            String relativePath = normalizeRelativePath(call.getString("relativePath", ""));
            File target = resolveStorageFile(storage, relativePath);
            boolean exists = target.exists();
            byte[] bytes = exists ? readBytes(target) : new byte[0];
            JSObject result = new JSObject();
            result.put("ok", exists);
            result.put("relativePath", relativePath);
            result.put("content", new String(bytes, StandardCharsets.UTF_8));
            result.put("contentBase64", Base64.getEncoder().encodeToString(bytes));
            result.put("contentEncoding", "base64");
            result.put("contentHash", exists ? sha256(bytes) : JSONObject.NULL);
            result.put("updatedAtMs", exists ? target.lastModified() : JSONObject.NULL);
            result.put("size", bytes.length);
            result.put("mimeType", mimeTypeForFileName(target.getName()));
            result.put("localExists", exists);
            return result;
        });
    }

    @PluginMethod
    public void writeFile(PluginCall call) {
        runFileTask(call, () -> {
            File storage = storageRoot(call.getString("storagePath"));
            String relativePath = normalizeRelativePath(call.getString("relativePath", ""));
            if (relativePath.isEmpty()) throw new IllegalArgumentException("파일 경로가 비어 있습니다.");
            File target = resolveStorageFile(storage, relativePath);
            String encoding = call.getString("contentEncoding", "utf8");
            String content = call.getString("content", "");
            byte[] bytes = "base64".equals(encoding)
                ? Base64.getDecoder().decode(content)
                : content.getBytes(StandardCharsets.UTF_8);
            writeBytes(target, bytes);

            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("relativePath", relativePath);
            result.put("contentHash", sha256(bytes));
            result.put("updatedAtMs", target.lastModified());
            result.put("size", bytes.length);
            return result;
        });
    }

    @PluginMethod
    public void deleteFile(PluginCall call) {
        runFileTask(call, () -> {
            File storage = storageRoot(call.getString("storagePath"));
            String relativePath = normalizeRelativePath(call.getString("relativePath", ""));
            deleteStoragePath(storage, relativePath);
            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("relativePath", relativePath);
            return result;
        });
    }

    @PluginMethod
    public void readSyncState(PluginCall call) {
        runFileTask(call, () -> {
            File storage = storageRoot(call.getString("storagePath"));
            JSONObject state = readSyncStateObject(storage);
            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("state", state);
            return result;
        });
    }

    @PluginMethod
    public void writeSyncState(PluginCall call) {
        runFileTask(call, () -> {
            File storage = storageRoot(call.getString("storagePath"));
            JSONObject state = call.getObject("state");
            if (state == null) state = defaultSyncState();
            writeText(new File(storage, SYNC_STATE_FILE), state.toString(2) + "\n");
            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("state", state);
            return result;
        });
    }

    @PluginMethod
    public void ensurePdfNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            resolveNotificationPermission(call);
            return;
        }

        PermissionState state = getPermissionState(NOTIFICATION_PERMISSION_ALIAS);
        if (state == PermissionState.GRANTED || state == PermissionState.DENIED) {
            resolveNotificationPermission(call);
            return;
        }

        requestPermissionForAlias(NOTIFICATION_PERMISSION_ALIAS, call, "pdfNotificationPermissionCallback");
    }

    @PermissionCallback
    private void pdfNotificationPermissionCallback(PluginCall call) {
        resolveNotificationPermission(call);
    }

    private void resolveNotificationPermission(PluginCall call) {
        JSObject response = new JSObject();
        response.put("ok", true);
        response.put("granted", hasNotificationPermission());
        call.resolve(response);
    }

    @PluginMethod
    public void preparePdf(PluginCall call) {
        String html = call.getString("html", "");
        try {
            String token = System.currentTimeMillis() + "-" + sha256(html.getBytes(StandardCharsets.UTF_8)).substring(0, 16);
            cleanupExpiredPdfCacheFiles();
            getActivity().runOnUiThread(() -> renderHtmlToPreparedPdf(call, token, html));
        } catch (Exception error) {
            call.resolve(pdfError(error.getMessage() == null ? "PDF 문서를 준비하지 못했습니다." : error.getMessage()));
        }
    }

    @PluginMethod
    public void savePdf(PluginCall call) {
        boolean zipExport = "zip-with-attachments".equals(call.getString("exportMode", ""));
        String title = safeExportFileName(call.getString("title", "제목 없음"), zipExport ? "zip" : "pdf");
        Intent intent = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        intent.setType(zipExport ? "application/zip" : "application/pdf");
        intent.putExtra(Intent.EXTRA_TITLE, title);
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        startActivityForResult(call, intent, "savePdfResult");
    }

    @ActivityCallback
    private void chooseDirectoryResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            JSObject canceled = new JSObject();
            canceled.put("ok", false);
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }

        Uri uri = result.getData().getData();
        int flags = result.getData().getFlags() & (Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, flags);
        } catch (Exception ignored) {
        }

        preferences().edit().putString("lastDirectoryUri", uri.toString()).apply();
        JSObject response = new JSObject();
        response.put("ok", true);
        response.put("storagePath", defaultStoragePath());
        response.put("directoryUri", uri.toString());
        response.put("androidDefault", true);
        response.put("message", "Android scoped storage policy 때문에 현재 노트 파일은 앱 전용 저장소에 보관됩니다.");
        call.resolve(response);
    }

    @ActivityCallback
    private void chooseAttachmentsResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null) {
            JSObject canceled = new JSObject();
            canceled.put("ok", false);
            canceled.put("canceled", true);
            canceled.put("attachments", new JSONArray());
            call.resolve(canceled);
            return;
        }

        execute(() -> {
            try {
                File storage = storageRoot(call.getString("storagePath"));
                JSONObject metadata = ensureMetadata(storage);
                JSONObject payloadNote = call.getObject("note");
                String noteRelativePath = normalizeRelativePath(call.getString("noteRelativePath", ""));
                if (noteRelativePath.isEmpty() && payloadNote != null) noteRelativePath = relativePathForNote(payloadNote);
                if (noteRelativePath.isEmpty()) throw new IllegalArgumentException("첨부할 노트를 찾지 못했습니다.");

                JSONObject note = findMetadataNote(metadata, noteRelativePath);
                if (note == null && payloadNote != null) {
                    note = notePayload(payloadNote, noteRelativePath);
                    upsertMetadataNote(metadata, note);
                }
                if (note == null) throw new IllegalArgumentException("첨부할 노트를 찾지 못했습니다.");

                List<Uri> uris = selectedUris(result.getData());
                JSONArray attachments = new JSONArray();
                int skipped = 0;
                String mode = call.getString("mode", "file");
                for (Uri uri : uris) {
                    String fileName = safeAttachmentFileName(displayNameForUri(uri));
                    String mimeType = mimeTypeForUri(uri, fileName);
                    if ("image".equals(mode) && !isImageMimeOrName(mimeType, fileName)) {
                        skipped++;
                        continue;
                    }

                    byte[] bytes = readUriBytes(uri);
                    JSONObject attachment = saveAttachmentBytes(storage, metadata, note, noteRelativePath, fileName, mimeType, bytes, null, "");
                    attachments.put(attachment);
                }

                JSObject response = new JSObject();
                response.put("ok", attachments.length() > 0);
                response.put("storagePath", storage.getAbsolutePath());
                response.put("attachments", attachments);
                response.put("attachment", attachments.length() > 0 ? attachments.getJSONObject(0) : JSONObject.NULL);
                response.put("skipped", skipped);
                if (attachments.length() == 0) {
                    response.put("error", "image".equals(mode) ? "선택한 이미지가 없습니다." : "저장한 첨부 파일이 없습니다.");
                }
                call.resolve(response);
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "첨부 파일을 선택하지 못했습니다." : error.getMessage(), error);
            }
        });
    }

    @ActivityCallback
    private void savePdfResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        if (result.getResultCode() != Activity.RESULT_OK || result.getData() == null || result.getData().getData() == null) {
            deletePreparedPdfForCall(call);
            JSObject canceled = new JSObject();
            canceled.put("ok", false);
            canceled.put("canceled", true);
            call.resolve(canceled);
            return;
        }

        Uri uri = result.getData().getData();
        String title = call.getString("title", "제목 없음");
        String token = call.getString("token", "");
        boolean zipExport = "zip-with-attachments".equals(call.getString("exportMode", ""));
        if (token != null && !token.trim().isEmpty()) {
            execute(() -> {
                File preparedFile = null;
                try {
                    preparedFile = resolvePdfCacheFile(token);
                    byte[] bytes = readBytes(preparedFile);
                    int pages = call.getInt("pages", 1);
                    byte[] exportBytes = zipExport ? createPdfZipBytes(call, title, bytes) : bytes;
                    JSObject response = writeExportBytesToUri(uri, title, exportBytes, Math.max(1, pages), zipExport);
                    call.resolve(response);
                } catch (Exception error) {
                    call.resolve(pdfError(error.getMessage() == null ? (zipExport ? "ZIP 저장에 실패했습니다." : "PDF 저장에 실패했습니다.") : error.getMessage()));
                } finally {
                    deleteQuietly(preparedFile);
                }
            });
            return;
        }

        String html = call.getString("html", "");
        File preparedFile = null;
        try {
            if (token != null && !token.trim().isEmpty()) {
                preparedFile = resolvePdfCacheFile(token);
                html = readText(preparedFile, "");
            }
        } catch (Exception error) {
            call.resolve(pdfError(error.getMessage() == null ? "PDF 문서를 준비하지 못했습니다." : error.getMessage()));
            return;
        }

        File finalPreparedFile = preparedFile;
        String finalHtml = html;
        getActivity().runOnUiThread(() -> renderHtmlToPdf(call, uri, title, finalHtml, finalPreparedFile));
    }

    private void deletePreparedPdfForCall(PluginCall call) {
        try {
            String token = call.getString("token", "");
            if (token != null && !token.trim().isEmpty()) deleteQuietly(resolvePdfCacheFile(token));
        } catch (Exception ignored) {
        }
    }

    private SharedPreferences preferences() {
        return getContext().getSharedPreferences(APP_PREFERENCES, Context.MODE_PRIVATE);
    }

    private void runFileTask(PluginCall call, FileTask task) {
        execute(() -> {
            try {
                call.resolve(task.run());
            } catch (Exception error) {
                call.reject(error.getMessage() == null ? "Android 저장소 작업에 실패했습니다." : error.getMessage(), error);
            }
        });
    }

    private JSONObject saveAttachmentBytes(
        File storage,
        JSONObject metadata,
        JSONObject note,
        String noteRelativePath,
        String fileName,
        String mimeType,
        byte[] bytes,
        String requestedRelativePath,
        String requestedId
    ) throws Exception {
        String baseRelativePath = normalizeRelativePath(requestedRelativePath);
        if (baseRelativePath.isEmpty()) {
            baseRelativePath = normalizeRelativePath(noteAttachmentDirectory(noteRelativePath, note) + "/" + fileName);
        }
        String relativePath = requestedRelativePath == null
            ? uniqueAttachmentRelativePath(storage, baseRelativePath)
            : baseRelativePath;
        File target = resolveStorageFile(storage, relativePath);
        writeBytes(target, bytes);

        long now = System.currentTimeMillis();
        JSONObject attachment = normalizeAttachmentMetadata(new JSONObject()
            .put("id", requestedId == null ? "" : requestedId)
            .put("fileName", fileName)
            .put("relativePath", relativePath)
            .put("noteRelativePath", noteRelativePath)
            .put("mimeType", mimeType == null ? JSONObject.NULL.toString() : mimeType)
            .put("size", bytes.length)
            .put("contentHash", sha256(bytes))
            .put("updatedAtMs", now), noteRelativePath);

        upsertMetadataAttachment(metadata, noteRelativePath, attachment);
        metadata.put("generatedAt", isoNow());
        writeMetadata(storage, metadata);
        return attachment;
    }

    private JSONObject readSyncStateObject(File storage) {
        File state = new File(storage, SYNC_STATE_FILE);
        if (!state.exists()) return defaultSyncState();
        try {
            return new JSONObject(readText(state, ""));
        } catch (Exception error) {
            return defaultSyncState();
        }
    }

    private JSONObject defaultSyncState() {
        try {
            JSONObject result = new JSONObject();
            result.put("serverRevision", 0);
            result.put("metadataRevision", 0);
            result.put("metadataHash", JSONObject.NULL);
            result.put("files", new JSONObject());
            result.put("attachments", new JSONObject());
            return result;
        } catch (JSONException error) {
            return new JSONObject();
        }
    }

    private List<Uri> selectedUris(Intent data) {
        List<Uri> uris = new ArrayList<>();
        ClipData clipData = data.getClipData();
        if (clipData != null) {
            for (int i = 0; i < clipData.getItemCount(); i++) {
                Uri uri = clipData.getItemAt(i).getUri();
                if (uri != null) uris.add(uri);
            }
        } else if (data.getData() != null) {
            uris.add(data.getData());
        }
        return uris;
    }

    private String displayNameForUri(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        Cursor cursor = null;
        try {
            cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME }, null, null, null);
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0) {
                    String value = cursor.getString(index);
                    if (value != null && !value.trim().isEmpty()) return value;
                }
            }
        } catch (Exception ignored) {
        } finally {
            if (cursor != null) cursor.close();
        }

        String fallback = uri.getLastPathSegment();
        return fallback == null || fallback.trim().isEmpty() ? "attachment" : fallback;
    }

    private String mimeTypeForUri(Uri uri, String fileName) {
        String mimeType = getContext().getContentResolver().getType(uri);
        if (mimeType != null && !mimeType.trim().isEmpty()) return mimeType;
        return mimeTypeForFileName(fileName);
    }

    private byte[] readUriBytes(Uri uri) throws IOException {
        InputStream input = getContext().getContentResolver().openInputStream(uri);
        if (input == null) throw new IOException("첨부 파일을 읽지 못했습니다.");
        try {
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
            return output.toByteArray();
        } finally {
            input.close();
        }
    }

    private boolean isImageMimeOrName(String mimeType, String fileName) {
        if (mimeType != null && mimeType.toLowerCase(Locale.ROOT).startsWith("image/")) return true;
        return mimeTypeForFileName(fileName).startsWith("image/");
    }

    private String safeExportFileName(String name, String extension) {
        String raw = name == null || name.trim().isEmpty() ? "note" : name.trim();
        raw = raw.replaceAll("(?i)\\.[a-z0-9]{1,8}$", "").replaceAll("[/:\\\\?%*\"<>|]+", "_").replaceAll("\\s+", " ").trim();
        if (raw.isEmpty()) raw = "note";
        if (raw.length() > 120) raw = raw.substring(0, 120);
        return raw + "." + extension;
    }

    private void renderHtmlToPreparedPdf(PluginCall call, String token, String html) {
        Activity activity = getActivity();
        WebView webView = new WebView(activity != null ? activity : getContext());
        webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        webView.getSettings().setJavaScriptEnabled(false);
        webView.getSettings().setLoadWithOverviewMode(false);
        webView.getSettings().setUseWideViewPort(false);
        float density = Math.max(1f, getContext().getResources().getDisplayMetrics().density);
        FrameLayout container = attachPdfWebViewContainer(
            activity,
            webView,
            Math.round(595 * density),
            Math.round(842 * density)
        );
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                view.postDelayed(() -> writePreparedPdf(call, token, webView, container), 500);
            }
        });
        webView.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
    }

    private void renderHtmlToPdf(PluginCall call, Uri uri, String title, String html, File preparedFile) {
        Activity activity = getActivity();
        WebView webView = new WebView(activity != null ? activity : getContext());
        webView.setLayerType(View.LAYER_TYPE_SOFTWARE, null);
        webView.getSettings().setJavaScriptEnabled(false);
        webView.getSettings().setLoadWithOverviewMode(false);
        webView.getSettings().setUseWideViewPort(false);
        float density = Math.max(1f, getContext().getResources().getDisplayMetrics().density);
        FrameLayout container = attachPdfWebViewContainer(
            activity,
            webView,
            Math.round(595 * density),
            Math.round(842 * density)
        );
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onPageFinished(WebView view, String url) {
                view.postDelayed(() -> writePdfDocument(call, uri, title, webView, container, preparedFile), 500);
            }
        });
        webView.loadDataWithBaseURL("https://localhost/", html, "text/html", "UTF-8", null);
    }

    private FrameLayout attachPdfWebViewContainer(Activity activity, WebView webView, int width, int height) {
        if (activity == null) return null;
        ViewGroup root = activity.findViewById(android.R.id.content);
        if (root == null) return null;
        FrameLayout container = new FrameLayout(activity);
        container.setVisibility(View.INVISIBLE);
        root.addView(container, new ViewGroup.LayoutParams(width, height));
        container.addView(webView, new FrameLayout.LayoutParams(width, height));
        return container;
    }

    private void writePreparedPdf(PluginCall call, String token, WebView webView, FrameLayout container) {
        try {
            PdfRenderResult renderResult = createPdfBytes(webView);
            File target = resolvePdfCacheFile(token);
            writeBytes(target, renderResult.bytes);

            JSObject response = new JSObject();
            response.put("ok", true);
            response.put("token", token);
            response.put("bytes", renderResult.bytes.length);
            response.put("pages", renderResult.pages);
            call.resolve(response);
        } catch (Exception error) {
            call.resolve(pdfError(error.getMessage() == null ? "PDF 문서를 준비하지 못했습니다." : error.getMessage()));
        } finally {
            cleanupPdfWebView(webView, container);
        }
    }

    private void writePdfDocument(PluginCall call, Uri uri, String title, WebView webView, FrameLayout container, File preparedFile) {
        try {
            PdfRenderResult renderResult = createPdfBytes(webView);
            JSObject response = writePdfBytesToUri(uri, title, renderResult.bytes, renderResult.pages);
            call.resolve(response);
        } catch (Exception error) {
            call.resolve(pdfError(error.getMessage() == null ? "PDF 저장에 실패했습니다." : error.getMessage()));
        } finally {
            cleanupPdfWebView(webView, container);
            deleteQuietly(preparedFile);
        }
    }

    private PdfRenderResult createPdfBytes(WebView webView) throws Exception {
        PdfDocument document = new PdfDocument();
        try {
            int pageWidth = 595;
            int pageHeight = 842;
            float density = Math.max(1f, getContext().getResources().getDisplayMetrics().density);
            int pageWidthPx = Math.round(pageWidth * density);
            int pageHeightPx = Math.round(pageHeight * density);
            int widthSpec = View.MeasureSpec.makeMeasureSpec(pageWidthPx, View.MeasureSpec.EXACTLY);
            int heightSpec = View.MeasureSpec.makeMeasureSpec(0, View.MeasureSpec.UNSPECIFIED);
            webView.measure(widthSpec, heightSpec);
            int measuredHeight = Math.max(0, webView.getMeasuredHeight());
            int scaledContentHeight = Math.round(Math.max(0, webView.getContentHeight()) * Math.max(1f, webView.getScale()) * density);
            int contentHeight = Math.max(pageHeightPx, Math.max(measuredHeight, scaledContentHeight));
            webView.layout(0, 0, pageWidthPx, contentHeight);

            int pageNumber = 1;
            for (int top = 0; top < contentHeight; top += pageHeightPx) {
                PdfDocument.PageInfo pageInfo = new PdfDocument.PageInfo.Builder(pageWidth, pageHeight, pageNumber).create();
                PdfDocument.Page page = document.startPage(pageInfo);
                Canvas canvas = page.getCanvas();
                canvas.scale(1f / density, 1f / density);
                canvas.translate(0, -top);
                webView.draw(canvas);
                document.finishPage(page);
                pageNumber++;
            }

            ByteArrayOutputStream pdfBytes = new ByteArrayOutputStream();
            document.writeTo(pdfBytes);
            byte[] bytes = pdfBytes.toByteArray();
            if (bytes.length == 0) throw new IOException("PDF 문서가 비어 있습니다.");
            return new PdfRenderResult(bytes, pageNumber - 1);
        } finally {
            document.close();
        }
    }

    private byte[] createPdfZipBytes(PluginCall call, String title, byte[] pdfBytes) throws Exception {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        ZipOutputStream zip = new ZipOutputStream(output);
        Set<String> usedNames = new HashSet<>();
        try {
            putZipEntry(zip, uniqueZipEntryName(usedNames, safeExportFileName(title, "pdf")), pdfBytes, System.currentTimeMillis());

            File storage = storageRoot(call.getString("storagePath"));
            JSONArray attachments = callJsonArray(call, "attachments");
            for (int i = 0; i < attachments.length(); i++) {
                JSONObject attachment = attachments.optJSONObject(i);
                if (attachment == null) continue;
                String relativePath;
                try {
                    relativePath = normalizeRelativePath(attachment.optString("relativePath", ""));
                } catch (Exception ignored) {
                    continue;
                }
                File file = resolveStorageFile(storage, relativePath);
                if (!file.exists() || !file.isFile()) continue;
                String entryName = uniqueZipEntryName(usedNames, "attachments/" + zipEntryName(relativePath, attachment.optString("fileName", "attachment")));
                putZipEntry(zip, entryName, readBytes(file), attachment.optLong("updatedAtMs", System.currentTimeMillis()));
            }
        } finally {
            zip.close();
        }
        return output.toByteArray();
    }

    private JSONArray callJsonArray(PluginCall call, String key) {
        try {
            Object value = call.getData().opt(key);
            if (value instanceof JSONArray) return (JSONArray) value;
        } catch (Exception ignored) {
        }
        return new JSONArray();
    }

    private void putZipEntry(ZipOutputStream zip, String name, byte[] bytes, long updatedAtMs) throws IOException {
        ZipEntry entry = new ZipEntry(zipEntryName(name, "file"));
        entry.setTime(updatedAtMs > 0 ? updatedAtMs : System.currentTimeMillis());
        zip.putNextEntry(entry);
        zip.write(bytes);
        zip.closeEntry();
    }

    private String zipEntryName(String value, String fallback) {
        String raw = value == null || value.trim().isEmpty() ? fallback : value.trim();
        String[] parts = raw.replace('\\', '/').replaceAll("^/+", "").split("/");
        List<String> safeParts = new ArrayList<>();
        for (String part : parts) {
            if (part == null || part.isEmpty() || ".".equals(part) || "..".equals(part)) continue;
            safeParts.add(part);
        }
        return safeParts.isEmpty() ? fallback : String.join("/", safeParts);
    }

    private String uniqueZipEntryName(Set<String> usedNames, String name) {
        String normalized = zipEntryName(name, "file");
        if (!usedNames.contains(normalized)) {
            usedNames.add(normalized);
            return normalized;
        }

        int dot = normalized.lastIndexOf('.');
        int slash = normalized.lastIndexOf('/');
        String base = dot > slash ? normalized.substring(0, dot) : normalized;
        String ext = dot > slash ? normalized.substring(dot) : "";
        int suffix = 2;
        String candidate;
        do {
            candidate = base + "-" + suffix + ext;
            suffix++;
        } while (usedNames.contains(candidate));
        usedNames.add(candidate);
        return candidate;
    }

    private JSObject writePdfBytesToUri(Uri uri, String title, byte[] bytes, int pages) throws IOException {
        return writeExportBytesToUri(uri, title, bytes, pages, false);
    }

    private JSObject writeExportBytesToUri(Uri uri, String title, byte[] bytes, int pages, boolean zipExport) throws IOException {
        OutputStream output = null;
        try {
            output = getContext().getContentResolver().openOutputStream(uri, "w");
            if (output == null) throw new IOException(zipExport ? "ZIP 저장 위치를 열지 못했습니다." : "PDF 저장 위치를 열지 못했습니다.");
            output.write(bytes);
            output.flush();

            JSObject response = new JSObject();
            response.put("ok", true);
            response.put("uri", uri.toString());
            response.put("bytes", bytes.length);
            response.put("pages", pages);
            response.put("exportMode", zipExport ? "zip-with-attachments" : "markdown-images");
            response.put("notificationShown", zipExport ? false : showPdfSavedNotification(uri, title, bytes.length, pages));
            return response;
        } finally {
            try {
                if (output != null) output.close();
            } catch (Exception ignored) {
            }
        }
    }

    private void cleanupPdfWebView(WebView webView, FrameLayout container) {
        try {
            if (container != null) {
                ViewGroup parent = (ViewGroup) container.getParent();
                if (parent != null) parent.removeView(container);
            }
        } catch (Exception ignored) {
        }
        try {
            webView.destroy();
        } catch (Exception ignored) {
        }
    }

    private boolean showPdfSavedNotification(Uri uri, String title, int bytes, int pages) {
        Context context = getContext();
        if (!hasNotificationPermission()) {
            showPdfSavedToast(title);
            return false;
        }

        try {
            ensurePdfNotificationChannel(context);
            Intent openIntent = new Intent(Intent.ACTION_VIEW);
            openIntent.setDataAndType(uri, "application/pdf");
            openIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_GRANT_READ_URI_PERMISSION);

            int notificationId = Math.abs((uri.toString() + System.currentTimeMillis()).hashCode());
            PendingIntent pendingIntent = PendingIntent.getActivity(
                context,
                notificationId,
                openIntent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
            );

            String safeTitle = title == null || title.trim().isEmpty() ? "PDF" : title.trim();
            String detail = pages > 1
                ? pages + "페이지 PDF 저장 완료"
                : "PDF 저장 완료";
            Notification.Builder builder = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O
                ? new Notification.Builder(context, PDF_NOTIFICATION_CHANNEL_ID)
                : new Notification.Builder(context);
            Notification notification = builder
                .setSmallIcon(R.drawable.ic_notification_pdf)
                .setContentTitle("PDF 다운로드 완료")
                .setContentText(safeTitle)
                .setSubText(formatFileSize(bytes))
                .setStyle(new Notification.BigTextStyle().bigText(safeTitle + "\n" + detail))
                .setContentIntent(pendingIntent)
                .setAutoCancel(true)
                .setCategory(Notification.CATEGORY_STATUS)
                .setVisibility(Notification.VISIBILITY_PUBLIC)
                .setPriority(Notification.PRIORITY_DEFAULT)
                .build();

            NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
            if (manager == null) {
                showPdfSavedToast(title);
                return false;
            }
            manager.notify(notificationId, notification);
            return true;
        } catch (Exception error) {
            showPdfSavedToast(title);
            return false;
        }
    }

    private void ensurePdfNotificationChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(PDF_NOTIFICATION_CHANNEL_ID) != null) return;
        NotificationChannel channel = new NotificationChannel(
            PDF_NOTIFICATION_CHANNEL_ID,
            "PDF exports",
            NotificationManager.IMPORTANCE_DEFAULT
        );
        channel.setDescription("PDF 저장 완료 알림");
        manager.createNotificationChannel(channel);
    }

    private boolean hasNotificationPermission() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU
            || getContext().checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
    }

    private void showPdfSavedToast(String title) {
        Activity activity = getActivity();
        Runnable show = () -> Toast.makeText(
            getContext(),
            (title == null || title.trim().isEmpty() ? "PDF" : title.trim()) + " 저장 완료",
            Toast.LENGTH_LONG
        ).show();
        if (activity != null) activity.runOnUiThread(show);
        else show.run();
    }

    private String formatFileSize(int bytes) {
        if (bytes < 1024) return bytes + " B";
        double kb = bytes / 1024d;
        if (kb < 1024) return String.format(Locale.US, "%.1f KB", kb);
        double mb = kb / 1024d;
        if (mb < 1024) return String.format(Locale.US, "%.1f MB", mb);
        return String.format(Locale.US, "%.1f GB", mb / 1024d);
    }

    private JSObject pdfError(String message) {
        JSObject response = new JSObject();
        response.put("ok", false);
        response.put("error", message);
        return response;
    }

    private String defaultStoragePath() {
        File documents = getContext().getExternalFilesDir(Environment.DIRECTORY_DOCUMENTS);
        if (documents == null) documents = getContext().getFilesDir();
        return new File(documents, "Notedown Notes").getAbsolutePath();
    }

    private File storageRoot(String storagePath) throws IOException {
        File root = new File(defaultStoragePath()).getCanonicalFile();
        ensureDirectory(root);
        return root;
    }

    private File pdfCacheDir() throws IOException {
        File root = new File(getContext().getCacheDir(), PDF_CACHE_DIR).getCanonicalFile();
        ensureDirectory(root);
        return root;
    }

    private File resolvePdfCacheFile(String token) throws IOException {
        String value = token == null ? "" : token.trim();
        if (value.isEmpty() || !value.matches("[A-Za-z0-9._-]+")) {
            throw new IOException("PDF 문서 토큰이 올바르지 않습니다.");
        }

        File root = pdfCacheDir();
        File target = new File(root, value + ".pdf").getCanonicalFile();
        String rootPath = root.getPath() + File.separator;
        if (!target.getPath().startsWith(rootPath)) throw new IOException("PDF 문서 경로가 올바르지 않습니다.");
        return target;
    }

    private void cleanupExpiredPdfCacheFiles() {
        try {
            File[] files = pdfCacheDir().listFiles();
            if (files == null) return;
            long cutoff = System.currentTimeMillis() - 24L * 60L * 60L * 1000L;
            for (File file : files) {
                if (file.isFile() && file.lastModified() < cutoff) deleteQuietly(file);
            }
        } catch (Exception ignored) {
        }
    }

    private void deleteQuietly(File file) {
        try {
            if (file != null && file.exists()) file.delete();
        } catch (Exception ignored) {
        }
    }

    private void ensureDirectory(File dir) throws IOException {
        if (dir != null && !dir.exists() && !dir.mkdirs()) {
            throw new IOException("디렉토리를 만들지 못했습니다: " + dir.getAbsolutePath());
        }
    }

    private File resolveStorageFile(File storage, String relativePath) throws IOException {
        String safeRelativePath = normalizeRelativePath(relativePath);
        File root = storage.getCanonicalFile();
        File target = new File(root, safeRelativePath).getCanonicalFile();
        if (!target.getPath().equals(root.getPath()) && !target.getPath().startsWith(root.getPath() + File.separator)) {
            throw new IOException("저장소 밖의 파일은 사용할 수 없습니다.");
        }
        return target;
    }

    private JSONObject ensureMetadata(File storage) throws Exception {
        JSONObject metadata = readMetadata(storage);
        if (metadata != null) return metadata;
        JSObject generated = generateMetadata(storage, false);
        return generated.getJSObject("metadata");
    }

    private JSONObject readMetadata(File storage) {
        File metadata = new File(storage, METADATA_FILE);
        if (!metadata.exists()) return null;
        try {
            return new JSONObject(readText(metadata, ""));
        } catch (Exception error) {
            return null;
        }
    }

    private void writeMetadata(File storage, JSONObject metadata) throws IOException, JSONException {
        ensureDirectory(storage);
        writeText(new File(storage, METADATA_FILE), metadata.toString(2) + "\n");
    }

    private JSObject generateMetadata(File storage, boolean importDeepMarkdown) throws Exception {
        ensureDirectory(storage);
        JSONArray workspaces = new JSONArray();
        JSONArray notes = new JSONArray();
        List<String> knownRelativePaths = new ArrayList<>();
        int rootMarkdownCount = 0;
        int copiedDeepCount = 0;

        workspaces.put(workspacePayload(UNFILED_WORKSPACE_ID, "미지정 워크스페이스"));
        File[] entries = storage.listFiles();
        if (entries != null) {
            for (File entry : entries) {
                if (entry.getName().startsWith(".") || METADATA_FILE.equals(entry.getName())) continue;
                if (entry.isFile() && entry.getName().toLowerCase(Locale.ROOT).endsWith(".md")) {
                    String relativePath = entry.getName();
                    notes.put(makeMetadataNote(relativePath, UNFILED_WORKSPACE_ID, "미지정 워크스페이스", readText(entry, ""), entry));
                    knownRelativePaths.add(relativePath);
                    rootMarkdownCount++;
                    continue;
                }
                if (!entry.isDirectory()) continue;
                String workspaceId = safeWorkspaceId(entry.getName());
                workspaces.put(workspacePayload(workspaceId, entry.getName()));
                File[] files = entry.listFiles();
                if (files == null) continue;
                for (File file : files) {
                    if (!file.isFile() || !file.getName().toLowerCase(Locale.ROOT).endsWith(".md")) continue;
                    String relativePath = normalizeRelativePath(entry.getName() + "/" + file.getName());
                    notes.put(makeMetadataNote(relativePath, workspaceId, entry.getName(), readText(file, ""), file));
                    knownRelativePaths.add(relativePath);
                }
            }
        }

        List<String> allMarkdownFiles = listMarkdownFiles(storage, 20, storage);
        List<String> nestedFiles = new ArrayList<>();
        for (String relativePath : allMarkdownFiles) {
            if (knownRelativePaths.contains(relativePath)) continue;
            if (relativePath.split("/").length > 2) nestedFiles.add(relativePath);
        }

        if (importDeepMarkdown) {
            File importDir = resolveStorageFile(storage, IMPORTED_WORKSPACE_ID);
            ensureDirectory(importDir);
            workspaces.put(workspacePayload(IMPORTED_WORKSPACE_ID, "가져온 문서"));
            for (String relativePath : nestedFiles) {
                File source = resolveStorageFile(storage, relativePath);
                String targetName = safeFileName(relativePath.replace("/", "_"));
                File target = new File(importDir, targetName);
                int suffix = 2;
                while (target.exists()) {
                    String stem = targetName.replaceAll("(?i)\\.md$", "");
                    target = new File(importDir, safeFileName(stem + "_" + suffix));
                    suffix++;
                }
                writeBytes(target, readBytes(source));
                String targetRelativePath = normalizeRelativePath(IMPORTED_WORKSPACE_ID + "/" + target.getName());
                notes.put(makeMetadataNote(targetRelativePath, IMPORTED_WORKSPACE_ID, "가져온 문서", readText(target, ""), target));
                copiedDeepCount++;
            }
        }

        JSONObject metadata = new JSONObject();
        metadata.put("version", 1);
        metadata.put("generatedAt", isoNow());
        metadata.put("workspaces", workspaces);
        metadata.put("notes", notes);
        writeMetadata(storage, metadata);

        JSObject result = new JSObject();
        result.put("ok", true);
        result.put("storagePath", storage.getAbsolutePath());
        result.put("metadataPath", new File(storage, METADATA_FILE).getAbsolutePath());
        result.put("notes", notes.length());
        result.put("workspaces", workspaces.length());
        result.put("rootMarkdownCount", rootMarkdownCount);
        result.put("deepMarkdownCount", nestedFiles.size());
        result.put("copiedDeepCount", copiedDeepCount);
        result.put("metadata", metadata);
        return result;
    }

    private List<String> listMarkdownFiles(File dir, int depth, File root) {
        List<String> files = new ArrayList<>();
        File[] entries = dir.listFiles();
        if (entries == null) return files;
        for (File entry : entries) {
            if (entry.getName().startsWith(".") || METADATA_FILE.equals(entry.getName())) continue;
            if (entry.isDirectory()) {
                if (depth > 0) files.addAll(listMarkdownFiles(entry, depth - 1, root));
            } else if (entry.isFile() && entry.getName().toLowerCase(Locale.ROOT).endsWith(".md")) {
                files.add(normalizeRelativePath(root.toURI().relativize(entry.toURI()).getPath()));
            }
        }
        return files;
    }

    private int deepMarkdownCount(List<String> files) {
        int count = 0;
        for (String file : files) {
            if (file.split("/").length > 2) count++;
        }
        return count;
    }

    private JSONObject makeMetadataNote(String relativePath, String workspaceId, String workspaceName, String body, File file) throws Exception {
        String fileName = new File(relativePath).getName();
        long updatedAtMs = file.lastModified() > 0 ? file.lastModified() : System.currentTimeMillis();
        long createdAtMs = updatedAtMs;
        JSONObject note = new JSONObject();
        note.put("id", noteIdFromRelativePath(relativePath));
        note.put("icon", "N");
        note.put("title", titleFromMarkdown(body, fileName));
        note.put("tags", new JSONArray());
        note.put("status", "active");
        note.put("workspace", workspaceId);
        note.put("workspaceName", workspaceName);
        note.put("folder", workspaceId);
        note.put("fileName", fileName);
        note.put("relativePath", normalizeRelativePath(relativePath));
        note.put("createdAt", labelForDate(createdAtMs));
        note.put("createdAtMs", createdAtMs);
        note.put("updatedAt", labelForDate(updatedAtMs));
        note.put("updatedAtMs", updatedAtMs);
        return note;
    }

    private JSONObject workspacePayload(String id, String name) throws JSONException {
        return new JSONObject().put("id", id).put("name", name);
    }

    private String noteWorkspaceId(JSONObject note) {
        String value = note.optString("folder", note.optString("workspace", UNFILED_WORKSPACE_ID)).trim();
        return value.isEmpty() ? UNFILED_WORKSPACE_ID : value;
    }

    private String noteWorkspaceName(JSONObject note, String workspaceId) {
        String value = note.optString("workspaceName", note.optString("workspaceLabel", workspaceId)).trim();
        return value.isEmpty() ? workspaceId : value;
    }

    private String noteFileName(JSONObject note) {
        String value = note.optString("fileName", "").trim();
        return value.isEmpty() ? safeFileName(note.optString("id", note.optString("title", "note"))) : safeFileName(value);
    }

    private String relativePathForNote(JSONObject note) {
        String relativePath = normalizeRelativePath(note.optString("relativePath", ""));
        if (!relativePath.isEmpty()) return relativePath;
        String workspaceId = noteWorkspaceId(note);
        String fileName = noteFileName(note);
        return UNFILED_WORKSPACE_ID.equals(workspaceId) ? fileName : normalizeRelativePath(workspaceId + "/" + fileName);
    }

    private JSONArray noteAttachmentsForMetadata(JSONObject note, String noteRelativePath) throws Exception {
        JSONArray source = note.optJSONArray("attachments");
        JSONArray result = new JSONArray();
        if (source == null) return result;
        for (int i = 0; i < source.length(); i++) {
            JSONObject attachment = source.optJSONObject(i);
            if (attachment == null || attachment.optBoolean("deleted", false)) continue;
            if (normalizeRelativePath(attachment.optString("relativePath", "")).isEmpty()) continue;
            result.put(normalizeAttachmentMetadata(attachment, noteRelativePath));
        }
        return result;
    }

    private JSONObject normalizeAttachmentMetadata(JSONObject attachment, String noteRelativePath) throws Exception {
        String relativePath = normalizeRelativePath(attachment.optString("relativePath", ""));
        JSONObject result = new JSONObject();
        result.put("id", attachment.optString("id", attachment.optString("attachmentId", "att-" + sha1(relativePath).substring(0, 16))));
        result.put("fileName", safeAttachmentFileName(attachment.optString("fileName", new File(relativePath).getName())));
        result.put("relativePath", relativePath);
        result.put("noteRelativePath", normalizeRelativePath(attachment.optString("noteRelativePath", noteRelativePath)));
        String mimeType = attachment.optString("mimeType", "");
        result.put("mimeType", mimeType.isEmpty() || "null".equals(mimeType) ? JSONObject.NULL : mimeType);
        result.put("size", attachment.has("size") ? attachment.optLong("size") : JSONObject.NULL);
        result.put("contentHash", attachment.optString("contentHash", ""));
        result.put("updatedAtMs", attachment.has("updatedAtMs") ? attachment.optLong("updatedAtMs") : JSONObject.NULL);
        result.put("deleted", attachment.optBoolean("deleted", false));
        return result;
    }

    private JSONObject findMetadataNote(JSONObject metadata, String relativePath) {
        JSONArray notes = metadata.optJSONArray("notes");
        if (notes == null) return null;
        for (int i = 0; i < notes.length(); i++) {
            JSONObject note = notes.optJSONObject(i);
            if (note == null) continue;
            if (normalizeRelativePath(note.optString("relativePath", "")).equals(relativePath)) return note;
        }
        return null;
    }

    private void upsertMetadataNote(JSONObject metadata, JSONObject note) throws JSONException {
        JSONArray notes = metadata.optJSONArray("notes");
        if (notes == null) {
            notes = new JSONArray();
            metadata.put("notes", notes);
        }
        String relativePath = normalizeRelativePath(note.optString("relativePath", ""));
        for (int i = 0; i < notes.length(); i++) {
            JSONObject item = notes.optJSONObject(i);
            if (item != null && normalizeRelativePath(item.optString("relativePath", "")).equals(relativePath)) {
                notes.put(i, note);
                return;
            }
        }
        notes.put(note);
    }

    private JSONObject notePayload(JSONObject note, String relativePath) throws Exception {
        JSONObject result = cloneObject(note);
        result.put("relativePath", relativePath);
        result.put("workspace", noteWorkspaceId(note));
        result.put("folder", noteWorkspaceId(note));
        result.put("workspaceName", noteWorkspaceName(note, noteWorkspaceId(note)));
        result.put("fileName", noteFileName(note));
        result.put("attachments", noteAttachmentsForMetadata(note, relativePath));
        return result;
    }

    private void upsertMetadataAttachment(JSONObject metadata, String noteRelativePath, JSONObject attachment) throws JSONException {
        JSONObject note = findMetadataNote(metadata, noteRelativePath);
        if (note == null) return;
        JSONArray attachments = note.optJSONArray("attachments");
        if (attachments == null) {
            attachments = new JSONArray();
            note.put("attachments", attachments);
        }
        String relativePath = attachment.optString("relativePath", "");
        String id = attachment.optString("id", "");
        for (int i = 0; i < attachments.length(); i++) {
            JSONObject item = attachments.optJSONObject(i);
            if (item == null) continue;
            if (relativePath.equals(item.optString("relativePath", "")) || (!id.isEmpty() && id.equals(item.optString("id", "")))) {
                attachments.put(i, attachment);
                return;
            }
        }
        attachments.put(attachment);
    }

    private String noteAttachmentDirectory(String noteRelativePath, JSONObject note) {
        String safeNoteRelativePath = normalizeRelativePath(noteRelativePath);
        int slash = safeNoteRelativePath.lastIndexOf('/');
        String noteDir = slash >= 0 ? safeNoteRelativePath.substring(0, slash) : "";
        String noteFile = slash >= 0 ? safeNoteRelativePath.substring(slash + 1) : safeNoteRelativePath;
        String noteName = noteFile.replaceAll("(?i)\\.md$", "");
        String noteSegment = safePathSegment(note.optString("id", noteName));
        return normalizeRelativePath((noteDir.isEmpty() ? "" : noteDir + "/") + ".attachments/" + noteSegment);
    }

    private String uniqueAttachmentRelativePath(File storage, String baseRelativePath) throws IOException {
        String safeRelativePath = normalizeRelativePath(baseRelativePath);
        String extension = "";
        int dot = safeRelativePath.lastIndexOf('.');
        int slash = safeRelativePath.lastIndexOf('/');
        if (dot > slash) extension = safeRelativePath.substring(dot);
        String stem = extension.isEmpty() ? safeRelativePath : safeRelativePath.substring(0, safeRelativePath.length() - extension.length());
        String candidate = safeRelativePath;
        int suffix = 2;
        while (resolveStorageFile(storage, candidate).exists()) {
            candidate = normalizeRelativePath(stem + "-" + suffix + extension);
            suffix++;
        }
        return candidate;
    }

    private void removeMetadataOrphans(File storage, JSONObject previousMetadata, List<String> writtenRelativePaths, List<String> writtenAttachmentPaths) {
        if (previousMetadata == null) return;
        JSONArray notes = previousMetadata.optJSONArray("notes");
        if (notes == null) return;
        for (int i = 0; i < notes.length(); i++) {
            JSONObject note = notes.optJSONObject(i);
            if (note == null) continue;
            String relativePath = normalizeRelativePath(note.optString("relativePath", ""));
            if (!relativePath.isEmpty() && !writtenRelativePaths.contains(relativePath)) {
                deleteStoragePath(storage, relativePath);
            }
            JSONArray attachments = note.optJSONArray("attachments");
            if (attachments == null) continue;
            for (int j = 0; j < attachments.length(); j++) {
                JSONObject attachment = attachments.optJSONObject(j);
                if (attachment == null) continue;
                String attachmentPath = normalizeRelativePath(attachment.optString("relativePath", ""));
                if (!attachmentPath.isEmpty() && !writtenAttachmentPaths.contains(attachmentPath)) {
                    deleteStoragePath(storage, attachmentPath);
                }
            }
        }
    }

    private void deleteStoragePath(File storage, String relativePath) {
        try {
            File target = resolveStorageFile(storage, relativePath);
            if (target.exists()) target.delete();
            removeEmptyParents(target.getParentFile(), storage.getCanonicalFile());
        } catch (Exception ignored) {
        }
    }

    private void removeEmptyParents(File dir, File stop) throws IOException {
        File current = dir;
        while (current != null && !current.getCanonicalPath().equals(stop.getCanonicalPath()) && current.getCanonicalPath().startsWith(stop.getCanonicalPath())) {
            String[] children = current.list();
            if (children == null || children.length > 0) return;
            if (!current.delete()) return;
            current = current.getParentFile();
        }
    }

    private String normalizeRelativePath(String relativePath) {
        String normalized = relativePath == null ? "" : relativePath.replace('\\', '/').replaceAll("^/+", "");
        String[] parts = normalized.split("/");
        List<String> safe = new ArrayList<>();
        for (String part : parts) {
            if (part.isEmpty()) continue;
            if (".".equals(part) || "..".equals(part)) throw new IllegalArgumentException("허용되지 않는 파일 경로입니다.");
            safe.add(part);
        }
        if (safe.isEmpty()) return "";
        if (METADATA_FILE.equals(safe.get(0)) || SYNC_STATE_FILE.equals(safe.get(0))) {
            throw new IllegalArgumentException("동기화할 수 없는 시스템 파일입니다.");
        }
        return String.join("/", safe);
    }

    private String safeWorkspaceId(String name) {
        String normalized = name == null ? "" : name.trim().replaceAll("[^\\p{L}\\p{N}_-]+", "-").replaceAll("^-+|-+$", "");
        return normalized.isEmpty() ? UNFILED_WORKSPACE_ID : normalized;
    }

    private String safeFileName(String name) {
        String base = name == null ? "note" : name.replaceAll("(?i)\\.md$", "").replaceAll("[/:\\\\?%*\"<>|]+", "_").replaceAll("\\s+", " ").trim();
        if (base.isEmpty()) base = "note";
        if (base.length() > 120) base = base.substring(0, 120);
        return base + ".md";
    }

    private String safeAttachmentFileName(String name) {
        String raw = name == null || name.trim().isEmpty() ? "attachment" : name.trim();
        int dot = raw.lastIndexOf('.');
        String stem = dot > 0 ? raw.substring(0, dot) : raw;
        String ext = dot > 0 ? raw.substring(dot) : "";
        stem = stem.replaceAll("[/:\\\\?%*\"<>|]+", "_").replaceAll("\\s+", " ").trim();
        ext = ext.replaceAll("[/:\\\\?%*\"<>|\\s]+", "");
        if (stem.isEmpty()) stem = "attachment";
        if (stem.length() > 120) stem = stem.substring(0, 120);
        if (ext.length() > 24) ext = ext.substring(0, 24);
        return stem + ext;
    }

    private String safePathSegment(String name) {
        String value = name == null ? "item" : name.replaceAll("(?i)\\.[a-z0-9]{1,12}$", "").replaceAll("[/:\\\\?%*\"<>|.]+", "-").replaceAll("\\s+", "-").replaceAll("^-+|-+$", "");
        if (value.isEmpty()) value = "item";
        return value.length() > 80 ? value.substring(0, 80) : value;
    }

    private String titleFromMarkdown(String markdown, String fileName) {
        String[] lines = markdown == null ? new String[0] : markdown.split("\\r?\\n");
        for (String line : lines) {
            if (line.startsWith("# ")) return line.substring(2).trim();
        }
        String title = fileName == null ? "제목 없음" : fileName.replaceAll("(?i)\\.md$", "");
        return title.isEmpty() ? "제목 없음" : title;
    }

    private String noteIdFromRelativePath(String relativePath) throws Exception {
        return "note-" + sha1(relativePath).substring(0, 16);
    }

    private String labelForDate(long ms) {
        return new SimpleDateFormat("MM. dd. a hh:mm:ss", Locale.KOREA).format(new Date(ms));
    }

    private String isoNow() {
        return new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSSXXX", Locale.US).format(new Date());
    }

    private String sha1(String value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-1");
        byte[] bytes = digest.digest(value.getBytes(StandardCharsets.UTF_8));
        return hex(bytes);
    }

    private String sha256(byte[] value) throws Exception {
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        return hex(digest.digest(value));
    }

    private String hex(byte[] bytes) {
        StringBuilder builder = new StringBuilder();
        for (byte b : bytes) builder.append(String.format("%02x", b));
        return builder.toString();
    }

    private String mimeTypeForFileName(String fileName) {
        String lower = fileName == null ? "" : fileName.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
        if (lower.endsWith(".gif")) return "image/gif";
        if (lower.endsWith(".webp")) return "image/webp";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".avif")) return "image/avif";
        if (lower.endsWith(".bmp")) return "image/bmp";
        if (lower.endsWith(".pdf")) return "application/pdf";
        if (lower.endsWith(".txt") || lower.endsWith(".md")) return "text/plain";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".csv")) return "text/csv";
        return "*/*";
    }

    private JSONObject cloneObject(JSONObject source) throws JSONException {
        return new JSONObject(source.toString());
    }

    private String readText(File file, String fallback) throws IOException {
        if (!file.exists()) return fallback;
        return new String(readBytes(file), StandardCharsets.UTF_8);
    }

    private byte[] readBytes(File file) throws IOException {
        ByteArrayOutputStream output = new ByteArrayOutputStream();
        FileInputStream input = new FileInputStream(file);
        byte[] buffer = new byte[8192];
        int read;
        while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
        input.close();
        return output.toByteArray();
    }

    private void writeText(File file, String content) throws IOException {
        writeBytes(file, content.getBytes(StandardCharsets.UTF_8));
    }

    private void writeBytes(File file, byte[] bytes) throws IOException {
        ensureDirectory(file.getParentFile());
        Files.write(file.toPath(), bytes);
    }

    private static class PdfRenderResult {
        final byte[] bytes;
        final int pages;

        PdfRenderResult(byte[] bytes, int pages) {
            this.bytes = bytes;
            this.pages = pages;
        }
    }

    private interface FileTask {
        JSObject run() throws Exception;
    }
}
