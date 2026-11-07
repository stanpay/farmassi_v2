package kr.farmassi.app.autosms;

import android.Manifest;
import android.content.Context;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.provider.CallLog;
import android.provider.Settings;
import java.util.Calendar;

/** 끝난 통화 하나를 보고 보낼지, 팝업을 띄울지, 왜 안 보내는지 정한다. */
final class CallbackProcessor {

    /** 통화 기록 시각이 추적 시작보다 이만큼 이르더라도 같은 통화로 본다. */
    private static final long CALL_LOG_MATCH_WINDOW_MS = 10_000;

    private CallbackProcessor() {}

    static void handle(Context context, CallStateReceiver.EndedCall call) {
        CallEvent event = call.event;
        String rawNumber = call.number;

        // 통화 기록이 상태 추적보다 정확하다. 거절(REJECTED)도 부재중으로 친다.
        CallLogEntry entry = latestCallLog(context, call.startedAt);
        if (entry != null) {
            if (entry.event == null) return;
            event = entry.event;
            if (entry.number != null && !entry.number.isEmpty()) rawNumber = entry.number;
        }

        AutoSmsStore store = AutoSmsStore.get(context);
        AutoSmsConfig config = store.loadConfig();
        String digits = PhoneNumbers.normalize(rawNumber);

        if (digits.isEmpty()) {
            store.addHistory("", event, null, AutoSmsStore.STATUS_SKIPPED, "no_number", null);
            return;
        }
        if (!PhoneNumbers.isMobile(digits)) {
            store.addHistory(digits, event, null, AutoSmsStore.STATUS_SKIPPED, "not_mobile", null);
            return;
        }
        if (config.excludedNumbers.contains(digits)) {
            store.addHistory(digits, event, null, AutoSmsStore.STATUS_SKIPPED, "excluded", null);
            return;
        }
        if (config.message.trim().isEmpty()) {
            store.addHistory(digits, event, null, AutoSmsStore.STATUS_SKIPPED, "no_message", null);
            return;
        }

        String text = SmsSender.fill(config.message, event, digits, call.endedAt);

        if (!config.master) {
            if (config.popupWhenOff && Settings.canDrawOverlays(context)) {
                CallbackPopup.show(context, digits, event, text);
            } else {
                store.addHistory(digits, event, null, AutoSmsStore.STATUS_SKIPPED, "auto_off", null);
            }
            return;
        }

        Calendar at = Calendar.getInstance();
        at.setTimeInMillis(call.endedAt);
        AutoSmsConfig.Rule rule = config.findRule(event, at);
        if (rule == null) {
            store.addHistory(digits, event, null, AutoSmsStore.STATUS_SKIPPED, "no_rule", null);
            return;
        }
        if (!rule.frequencyAllows(store.lastSentAt(rule.id, digits), call.endedAt)) {
            store.addHistory(digits, event, rule.name, AutoSmsStore.STATUS_SKIPPED, "frequency", null);
            return;
        }

        if (SmsSender.hasPermission(context)) store.recordSent(rule.id, digits, call.endedAt);
        SmsSender.send(context, digits, text, event, rule.name);
    }

    private static CallLogEntry latestCallLog(Context context, long startedAt) {
        if (context.checkSelfPermission(Manifest.permission.READ_CALL_LOG) != PackageManager.PERMISSION_GRANTED) {
            return null;
        }
        String[] projection = { CallLog.Calls.NUMBER, CallLog.Calls.TYPE, CallLog.Calls.DATE };
        try (
            Cursor cursor = context.getContentResolver().query(
                CallLog.Calls.CONTENT_URI,
                projection,
                CallLog.Calls.DATE + " >= ?",
                new String[] { String.valueOf(startedAt - CALL_LOG_MATCH_WINDOW_MS) },
                CallLog.Calls.DATE + " DESC"
            )
        ) {
            if (cursor == null || !cursor.moveToFirst()) return null;
            return new CallLogEntry(cursor.getString(0), eventForType(cursor.getInt(1)));
        } catch (Exception e) {
            return null;
        }
    }

    /** 차단된 전화 등은 null. 콜백하지 않는다. */
    private static CallEvent eventForType(int type) {
        switch (type) {
            case CallLog.Calls.INCOMING_TYPE:
                return CallEvent.INCOMING;
            case CallLog.Calls.OUTGOING_TYPE:
                return CallEvent.OUTGOING;
            case CallLog.Calls.MISSED_TYPE:
            case CallLog.Calls.REJECTED_TYPE:
                return CallEvent.MISSED;
            default:
                return null;
        }
    }

    private static final class CallLogEntry {
        final String number;
        final CallEvent event;

        CallLogEntry(String number, CallEvent event) {
            this.number = number;
            this.event = event;
        }
    }
}
