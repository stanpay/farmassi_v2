package kr.farmassi.app.autosms;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.telephony.TelephonyManager;

/**
 * 전화 상태 변화를 따라가다 통화가 끝나면(IDLE) 콜백 처리를 넘긴다.
 * PHONE_STATE 는 앱이 꺼져 있어도 매니페스트 리시버로 받을 수 있는 예외 브로드캐스트다.
 * 단, 사용자가 앱을 '강제 종료'하면 다시 실행할 때까지 받지 못한다.
 *
 * 상황 판단: 울림 → 종료 = 부재중, 울림 → 통화 → 종료 = 수신, 통화 → 종료 = 발신.
 */
public class CallStateReceiver extends BroadcastReceiver {

    private static final String PREFS = "farmassi_call_tracker";
    /** 통화 기록이 기록될 때까지 잠깐 기다린다. */
    private static final long CALL_LOG_DELAY_MS = 1500;

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
        String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
        if (state == null) return;
        @SuppressWarnings("deprecation")
        String number = intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER);

        EndedCall ended = track(context, state, number);
        if (ended == null) return;

        Context appContext = context.getApplicationContext();
        PendingResult pending = goAsync();
        new Thread(() -> {
            try {
                Thread.sleep(CALL_LOG_DELAY_MS);
                CallbackProcessor.handle(appContext, ended);
            } catch (InterruptedException ignored) {
                Thread.currentThread().interrupt();
            } finally {
                pending.finish();
            }
        }).start();
    }

    /** 같은 상태가 두 번 오기도 한다(번호 권한이 있으면 번호 없는 것 + 있는 것). 상태가 바뀔 때만 처리한다. */
    private static synchronized EndedCall track(Context context, String state, String number) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String previous = prefs.getString("state", TelephonyManager.EXTRA_STATE_IDLE);
        SharedPreferences.Editor editor = prefs.edit();
        long now = System.currentTimeMillis();

        if (state.equals(previous)) {
            if (number != null && !number.isEmpty()) editor.putString("number", number).apply();
            return null;
        }

        EndedCall ended = null;
        if (TelephonyManager.EXTRA_STATE_RINGING.equals(state)) {
            if (TelephonyManager.EXTRA_STATE_IDLE.equals(previous)) {
                editor.putBoolean("ringing", true).putBoolean("offhook", false).putLong("startedAt", now).remove("number");
            }
        } else if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
            if (TelephonyManager.EXTRA_STATE_IDLE.equals(previous)) {
                editor.putBoolean("ringing", false).putLong("startedAt", now).remove("number");
            }
            editor.putBoolean("offhook", true);
        } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
            boolean ringing = prefs.getBoolean("ringing", false);
            boolean offhook = prefs.getBoolean("offhook", false);
            CallEvent event = ringing ? (offhook ? CallEvent.INCOMING : CallEvent.MISSED) : CallEvent.OUTGOING;
            String storedNumber = prefs.getString("number", null);
            ended = new EndedCall(
                event,
                number != null && !number.isEmpty() ? number : storedNumber,
                prefs.getLong("startedAt", now),
                now
            );
        }

        if (number != null && !number.isEmpty()) editor.putString("number", number);
        editor.putString("state", state).apply();
        return ended;
    }

    static final class EndedCall {
        final CallEvent event;
        final String number;
        final long startedAt;
        final long endedAt;

        EndedCall(CallEvent event, String number, long startedAt, long endedAt) {
            this.event = event;
            this.number = number;
            this.startedAt = startedAt;
            this.endedAt = endedAt;
        }
    }
}
