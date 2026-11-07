package kr.farmassi.app.share;

import android.content.Intent;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * 카카오톡·문자 등에서 "공유"로 넘어온 글을 웹으로 전달한다.
 * 앱이 꺼져 있다가 공유로 켜지면 웹이 getSharedText 로 꺼내 가고,
 * 이미 켜져 있으면 sharedText 이벤트로 바로 알린다.
 */
@CapacitorPlugin(name = "FarmassiShare")
public class FarmassiSharePlugin extends Plugin {

    private String pendingText;

    @Override
    public void load() {
        pendingText = takeSharedText(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        String text = takeSharedText(intent);
        if (text == null) return;

        JSObject data = new JSObject();
        data.put("text", text);
        notifyListeners("sharedText", data, true);
        pendingText = null;
    }

    @PluginMethod
    public void getSharedText(PluginCall call) {
        JSObject result = new JSObject();
        result.put("text", pendingText == null ? "" : pendingText);
        pendingText = null;
        call.resolve(result);
    }

    /** 같은 인텐트를 화면 회전 등으로 다시 처리하지 않도록 꺼낸 뒤 비운다. */
    private static String takeSharedText(Intent intent) {
        if (intent == null || !Intent.ACTION_SEND.equals(intent.getAction())) return null;
        CharSequence text = intent.getCharSequenceExtra(Intent.EXTRA_TEXT);
        intent.setAction(Intent.ACTION_MAIN);
        intent.removeExtra(Intent.EXTRA_TEXT);
        if (text == null || text.toString().trim().isEmpty()) return null;
        return text.toString();
    }
}
