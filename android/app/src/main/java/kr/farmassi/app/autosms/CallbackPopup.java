package kr.farmassi.app.autosms;

import android.content.Context;
import android.graphics.Color;
import android.graphics.PixelFormat;
import android.graphics.drawable.GradientDrawable;
import android.os.Handler;
import android.os.Looper;
import android.text.TextUtils;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/**
 * 자동 발신이 꺼져 있을 때 통화가 끝나면 띄우는 선택 팝업.
 * 아무것도 누르지 않으면 10초 뒤 저절로 닫힌다.
 */
final class CallbackPopup {

    private static final int AUTO_CLOSE_SECONDS = 10;
    private static final int PRIMARY = Color.parseColor("#1B7E3C");

    private static View current;

    private CallbackPopup() {}

    static void show(Context context, String digits, CallEvent event, String text) {
        Context appContext = context.getApplicationContext();
        new Handler(Looper.getMainLooper()).post(() -> showOnMain(appContext, digits, event, text));
    }

    private static void showOnMain(Context context, String digits, CallEvent event, String text) {
        WindowManager windowManager = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
        AutoSmsStore store = AutoSmsStore.get(context);
        Handler handler = new Handler(Looper.getMainLooper());
        dismiss(windowManager);

        LinearLayout root = new LinearLayout(context);
        root.setOrientation(LinearLayout.VERTICAL);
        int padding = dp(context, 20);
        root.setPadding(padding, padding, padding, dp(context, 12));
        GradientDrawable background = new GradientDrawable();
        background.setColor(Color.WHITE);
        background.setCornerRadius(dp(context, 20));
        root.setBackground(background);
        root.setElevation(dp(context, 12));

        TextView title = new TextView(context);
        title.setText(event.label + " · " + PhoneNumbers.format(digits));
        title.setTextSize(TypedValue.COMPLEX_UNIT_SP, 17);
        title.setTextColor(Color.parseColor("#111827"));
        title.setTypeface(title.getTypeface(), android.graphics.Typeface.BOLD);
        root.addView(title);

        TextView preview = new TextView(context);
        preview.setText(text);
        preview.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        preview.setTextColor(Color.parseColor("#4B5563"));
        preview.setMaxLines(4);
        preview.setEllipsize(TextUtils.TruncateAt.END);
        preview.setPadding(0, dp(context, 8), 0, dp(context, 12));
        root.addView(preview);

        TextView countdown = new TextView(context);
        countdown.setTextSize(TypedValue.COMPLEX_UNIT_SP, 12);
        countdown.setTextColor(Color.parseColor("#9CA3AF"));
        root.addView(countdown);

        LinearLayout buttons = new LinearLayout(context);
        buttons.setOrientation(LinearLayout.HORIZONTAL);
        buttons.setGravity(Gravity.END);
        Button close = new Button(context);
        close.setText("닫기");
        close.setTextColor(Color.parseColor("#6B7280"));
        close.setBackgroundColor(Color.TRANSPARENT);
        Button send = new Button(context);
        send.setText("콜백문자 보내기");
        send.setTextColor(PRIMARY);
        send.setBackgroundColor(Color.TRANSPARENT);
        buttons.addView(close);
        buttons.addView(send);
        root.addView(buttons);

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
            WindowManager.LayoutParams.MATCH_PARENT,
            WindowManager.LayoutParams.WRAP_CONTENT,
            WindowManager.LayoutParams.TYPE_APPLICATION_OVERLAY,
            WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL,
            PixelFormat.TRANSLUCENT
        );
        params.gravity = Gravity.CENTER;
        params.horizontalMargin = 0.05f;

        final boolean[] handled = { false };
        final int[] remaining = { AUTO_CLOSE_SECONDS };
        Runnable tick = new Runnable() {
            @Override
            public void run() {
                if (handled[0]) return;
                if (remaining[0] <= 0) {
                    handled[0] = true;
                    store.addHistory(digits, event, null, AutoSmsStore.STATUS_SKIPPED, "popup_timeout", null);
                    dismiss(windowManager);
                    return;
                }
                countdown.setText(remaining[0] + "초 뒤 닫힙니다");
                remaining[0]--;
                handler.postDelayed(this, 1000);
            }
        };

        close.setOnClickListener((v) -> {
            if (handled[0]) return;
            handled[0] = true;
            store.addHistory(digits, event, null, AutoSmsStore.STATUS_SKIPPED, "popup_dismissed", null);
            dismiss(windowManager);
        });
        send.setOnClickListener((v) -> {
            if (handled[0]) return;
            handled[0] = true;
            dismiss(windowManager);
            new Thread(() -> SmsSender.send(context, digits, text, event, "직접 선택")).start();
        });

        try {
            windowManager.addView(root, params);
            current = root;
            handler.post(tick);
        } catch (Exception e) {
            store.addHistory(digits, event, null, AutoSmsStore.STATUS_SKIPPED, "popup_failed", null);
        }
    }

    private static void dismiss(WindowManager windowManager) {
        if (current == null) return;
        try {
            windowManager.removeView(current);
        } catch (Exception ignored) {
            // 이미 떨어진 뷰
        }
        current = null;
    }

    private static int dp(Context context, int value) {
        return Math.round(value * context.getResources().getDisplayMetrics().density);
    }
}
