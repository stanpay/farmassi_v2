package kr.farmassi.app.autosms;

import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 설정은 SharedPreferences, 전송 이력과 번호별 마지막 발송 시각은 SQLite 에 둔다.
 * 기기 밖으로는 보내지 않는다.
 */
final class AutoSmsStore extends SQLiteOpenHelper {

    static final String STATUS_SENDING = "sending";
    static final String STATUS_SENT = "sent";
    static final String STATUS_FAILED = "failed";
    static final String STATUS_SKIPPED = "skipped";

    private static final String PREFS = "farmassi_auto_sms";
    private static final String KEY_CONFIG = "config";
    private static final int HISTORY_LIMIT = 500;

    private static AutoSmsStore instance;

    private final SharedPreferences prefs;

    static synchronized AutoSmsStore get(Context context) {
        if (instance == null) instance = new AutoSmsStore(context.getApplicationContext());
        return instance;
    }

    private AutoSmsStore(Context context) {
        super(context, "farmassi_auto_sms.db", null, 1);
        prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        db.execSQL(
            "CREATE TABLE history ("
                + "id INTEGER PRIMARY KEY AUTOINCREMENT,"
                + "created_at INTEGER NOT NULL,"
                + "number TEXT NOT NULL,"
                + "event TEXT NOT NULL,"
                + "rule_name TEXT,"
                + "status TEXT NOT NULL,"
                + "reason TEXT,"
                + "message TEXT)"
        );
        db.execSQL(
            "CREATE TABLE sent_log ("
                + "rule_id TEXT NOT NULL,"
                + "number TEXT NOT NULL,"
                + "last_sent_at INTEGER NOT NULL,"
                + "PRIMARY KEY (rule_id, number))"
        );
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {}

    String loadConfigJson() {
        return prefs.getString(KEY_CONFIG, AutoSmsConfig.DEFAULT_JSON);
    }

    AutoSmsConfig loadConfig() {
        return AutoSmsConfig.parse(loadConfigJson());
    }

    void saveConfigJson(String json) {
        prefs.edit().putString(KEY_CONFIG, json).apply();
    }

    synchronized long addHistory(
        String number,
        CallEvent event,
        String ruleName,
        String status,
        String reason,
        String message
    ) {
        ContentValues values = new ContentValues();
        values.put("created_at", System.currentTimeMillis());
        values.put("number", number);
        values.put("event", event.key);
        values.put("rule_name", ruleName);
        values.put("status", status);
        values.put("reason", reason);
        values.put("message", message);
        SQLiteDatabase db = getWritableDatabase();
        long id = db.insert("history", null, values);
        db.execSQL(
            "DELETE FROM history WHERE id NOT IN (SELECT id FROM history ORDER BY id DESC LIMIT " + HISTORY_LIMIT + ")"
        );
        return id;
    }

    synchronized void markSent(long historyId) {
        ContentValues values = new ContentValues();
        values.put("status", STATUS_SENT);
        getWritableDatabase().update(
            "history",
            values,
            "id = ? AND status = ?",
            new String[] { String.valueOf(historyId), STATUS_SENDING }
        );
    }

    synchronized void markFailed(long historyId, String reason) {
        ContentValues values = new ContentValues();
        values.put("status", STATUS_FAILED);
        values.put("reason", reason);
        getWritableDatabase().update("history", values, "id = ?", new String[] { String.valueOf(historyId) });
    }

    synchronized Long lastSentAt(String ruleId, String number) {
        try (
            Cursor cursor = getReadableDatabase().rawQuery(
                "SELECT last_sent_at FROM sent_log WHERE rule_id = ? AND number = ?",
                new String[] { ruleId, number }
            )
        ) {
            return cursor.moveToFirst() ? cursor.getLong(0) : null;
        }
    }

    synchronized void recordSent(String ruleId, String number, long at) {
        ContentValues values = new ContentValues();
        values.put("rule_id", ruleId);
        values.put("number", number);
        values.put("last_sent_at", at);
        getWritableDatabase().insertWithOnConflict("sent_log", null, values, SQLiteDatabase.CONFLICT_REPLACE);
    }

    synchronized JSONArray history(int limit) {
        JSONArray rows = new JSONArray();
        try (
            Cursor cursor = getReadableDatabase().rawQuery(
                "SELECT id, created_at, number, event, rule_name, status, reason, message "
                    + "FROM history ORDER BY id DESC LIMIT ?",
                new String[] { String.valueOf(limit) }
            )
        ) {
            while (cursor.moveToNext()) {
                JSONObject row = new JSONObject();
                row.put("id", cursor.getLong(0));
                row.put("createdAt", cursor.getLong(1));
                row.put("number", cursor.getString(2));
                row.put("event", cursor.getString(3));
                row.put("ruleName", cursor.isNull(4) ? JSONObject.NULL : cursor.getString(4));
                row.put("status", cursor.getString(5));
                row.put("reason", cursor.isNull(6) ? JSONObject.NULL : cursor.getString(6));
                row.put("message", cursor.isNull(7) ? JSONObject.NULL : cursor.getString(7));
                rows.put(row);
            }
        } catch (Exception ignored) {
            // JSONObject.put 은 숫자가 NaN 일 때만 실패한다.
        }
        return rows;
    }

    synchronized void clearHistory() {
        getWritableDatabase().delete("history", null, null);
    }
}
