package kr.farmassi.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import kr.farmassi.app.autosms.AutoSmsPlugin;
import kr.farmassi.app.share.FarmassiSharePlugin;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FarmassiSharePlugin.class);
        registerPlugin(AutoSmsPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
