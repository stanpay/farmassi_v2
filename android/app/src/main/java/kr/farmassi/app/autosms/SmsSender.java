package kr.farmassi.app.autosms;

import android.Manifest;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.telephony.SmsManager;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Date;
import java.util.Locale;

final class SmsSender {

    private SmsSender() {}

    static boolean hasPermission(Context context) {
        return context.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    /** 템플릿 치환자 {event} {number} {time} 를 채운다. */
    static String fill(String template, CallEvent event, String digits, long endedAt) {
        String time = new SimpleDateFormat("HH:mm", Locale.KOREA).format(new Date(endedAt));
        return template
            .replace("{event}", event.label)
            .replace("{number}", PhoneNumbers.format(digits))
            .replace("{time}", time);
    }

    /**
     * 이력을 '발송 중'으로 남기고 보낸다. 결과는 SmsResultReceiver 가 이력에 반영한다.
     * 긴 문자는 여러 통으로 나뉘어 나가고, 받는 폰에서는 대부분 한 통으로 합쳐 보인다.
     */
    static long send(Context context, String digits, String text, CallEvent event, String ruleName) {
        AutoSmsStore store = AutoSmsStore.get(context);
        if (!hasPermission(context)) {
            return store.addHistory(digits, event, ruleName, AutoSmsStore.STATUS_SKIPPED, "no_permission", text);
        }

        long historyId = store.addHistory(digits, event, ruleName, AutoSmsStore.STATUS_SENDING, null, text);
        try {
            SmsManager manager = smsManager(context);
            ArrayList<String> parts = manager.divideMessage(text);
            ArrayList<PendingIntent> sentIntents = new ArrayList<>();
            for (int i = 0; i < parts.size(); i++) {
                Intent intent = new Intent(context, SmsResultReceiver.class)
                    .setAction(SmsResultReceiver.ACTION_SENT)
                    .putExtra(SmsResultReceiver.EXTRA_HISTORY_ID, historyId)
                    .putExtra(SmsResultReceiver.EXTRA_PART_INDEX, i)
                    .putExtra(SmsResultReceiver.EXTRA_PART_COUNT, parts.size());
                int requestCode = (int) (historyId * 32 + i);
                sentIntents.add(
                    PendingIntent.getBroadcast(
                        context,
                        requestCode,
                        intent,
                        PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                    )
                );
            }
            manager.sendMultipartTextMessage(digits, null, parts, sentIntents, null);
        } catch (Exception e) {
            store.markFailed(historyId, "exception:" + e.getClass().getSimpleName());
        }
        return historyId;
    }

    @SuppressWarnings("deprecation")
    private static SmsManager smsManager(Context context) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            return context.getSystemService(SmsManager.class);
        }
        return SmsManager.getDefault();
    }
}
