package kr.farmassi.app.autosms;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** 문자 한 조각마다 통신사 전송 결과가 온다. 하나라도 실패하면 실패로 남긴다. */
public class SmsResultReceiver extends BroadcastReceiver {

    static final String ACTION_SENT = "kr.farmassi.app.autosms.SMS_SENT";
    static final String EXTRA_HISTORY_ID = "historyId";
    static final String EXTRA_PART_INDEX = "partIndex";
    static final String EXTRA_PART_COUNT = "partCount";

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!ACTION_SENT.equals(intent.getAction())) return;
        long historyId = intent.getLongExtra(EXTRA_HISTORY_ID, -1);
        if (historyId < 0) return;

        AutoSmsStore store = AutoSmsStore.get(context);
        int resultCode = getResultCode();
        if (resultCode != Activity.RESULT_OK) {
            store.markFailed(historyId, "sms_error:" + resultCode);
            return;
        }

        int index = intent.getIntExtra(EXTRA_PART_INDEX, 0);
        int count = intent.getIntExtra(EXTRA_PART_COUNT, 1);
        if (index == count - 1) store.markSent(historyId);
    }
}
