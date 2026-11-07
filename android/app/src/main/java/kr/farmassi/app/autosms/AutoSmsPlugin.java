package kr.farmassi.app.autosms;

import android.Manifest;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.PowerManager;
import android.provider.ContactsContract;
import android.provider.Settings;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/** 웹 설정 화면(src/lib/autoSms.ts)과 네이티브 콜백문자 엔진을 잇는다. */
@CapacitorPlugin(
    name = "AutoSms",
    permissions = {
        @Permission(alias = "phone", strings = { Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG }),
        @Permission(alias = "sms", strings = { Manifest.permission.SEND_SMS }),
    }
)
public class AutoSmsPlugin extends Plugin {

    private AutoSmsStore store() {
        return AutoSmsStore.get(getContext());
    }

    @PluginMethod
    public void getConfig(PluginCall call) {
        try {
            JSObject result = new JSObject();
            result.put("config", new JSObject(store().loadConfigJson()));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("설정을 읽지 못했습니다.", e);
        }
    }

    @PluginMethod
    public void setConfig(PluginCall call) {
        JSObject config = call.getObject("config");
        if (config == null) {
            call.reject("config 가 필요합니다.");
            return;
        }
        store().saveConfigJson(config.toString());
        call.resolve();
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        PowerManager power = (PowerManager) getContext().getSystemService(android.content.Context.POWER_SERVICE);
        JSObject result = new JSObject();
        result.put("phone", getPermissionState("phone") == PermissionState.GRANTED);
        result.put("sms", getPermissionState("sms") == PermissionState.GRANTED);
        result.put("overlay", Settings.canDrawOverlays(getContext()));
        result.put("batteryUnrestricted", power.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        call.resolve(result);
    }

    @PluginMethod
    public void openOverlaySettings(PluginCall call) {
        Intent intent = new Intent(
            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
            Uri.parse("package:" + getContext().getPackageName())
        );
        getActivity().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void openBatteryOptimizationSettings(PluginCall call) {
        Intent intent = new Intent(
            Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
            Uri.parse("package:" + getContext().getPackageName())
        );
        try {
            getActivity().startActivity(intent);
        } catch (Exception e) {
            getActivity().startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
        }
        call.resolve();
    }

    @PluginMethod
    public void getHistory(PluginCall call) {
        int limit = call.getInt("limit", 100);
        try {
            JSObject result = new JSObject();
            result.put("items", new JSArray(store().history(limit).toString()));
            call.resolve(result);
        } catch (Exception e) {
            call.reject("이력을 읽지 못했습니다.", e);
        }
    }

    @PluginMethod
    public void clearHistory(PluginCall call) {
        store().clearHistory();
        call.resolve();
    }

    /** 받는 번호로 지금 저장된 문구를 바로 보낸다. 규칙·빈도 제한은 보지 않는다. */
    @PluginMethod
    public void sendTest(PluginCall call) {
        String digits = PhoneNumbers.normalize(call.getString("phone", ""));
        if (!PhoneNumbers.isMobile(digits)) {
            call.reject("휴대폰 번호를 입력해 주세요.");
            return;
        }
        if (!SmsSender.hasPermission(getContext())) {
            call.reject("문자 보내기 권한이 없습니다.");
            return;
        }
        AutoSmsConfig config = store().loadConfig();
        if (config.message.trim().isEmpty()) {
            call.reject("보낼 문자 내용이 없습니다.");
            return;
        }
        String text = SmsSender.fill(config.message, CallEvent.TEST, digits, System.currentTimeMillis());
        SmsSender.send(getContext(), digits, text, CallEvent.TEST, "테스트 발송");
        call.resolve();
    }

    /** 주소록에서 한 명을 고른다. 고른 연락처만 읽으므로 주소록 권한은 필요 없다. */
    @PluginMethod
    public void pickContact(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_PICK, ContactsContract.CommonDataKinds.Phone.CONTENT_URI);
        startActivityForResult(call, intent, "onContactPicked");
    }

    @ActivityCallback
    private void onContactPicked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (data == null || data.getData() == null) {
            call.resolve(new JSObject());
            return;
        }
        String[] projection = {
            ContactsContract.CommonDataKinds.Phone.DISPLAY_NAME,
            ContactsContract.CommonDataKinds.Phone.NUMBER,
        };
        try (Cursor cursor = getContext().getContentResolver().query(data.getData(), projection, null, null, null)) {
            JSObject contact = new JSObject();
            if (cursor != null && cursor.moveToFirst()) {
                contact.put("name", cursor.getString(0));
                contact.put("phone", PhoneNumbers.normalize(cursor.getString(1)));
            }
            call.resolve(contact);
        } catch (Exception e) {
            call.reject("연락처를 읽지 못했습니다.", e);
        }
    }
}
