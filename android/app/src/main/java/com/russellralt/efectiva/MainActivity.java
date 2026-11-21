package com.russellralt.efectiva;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private EfectivaAndroidTtsBridge nativeTtsBridge = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EfectivaTtsPlugin.class);
        super.onCreate(savedInstanceState);
    }

    @Override
    protected void load() {
        WebView wv = findViewById(com.getcapacitor.android.R.id.webview);
        if (wv != null && nativeTtsBridge == null) {
            nativeTtsBridge = new EfectivaAndroidTtsBridge(getApplicationContext(), wv);
            wv.addJavascriptInterface(nativeTtsBridge, "EfectivaAndroidBridge");
        }
        super.load();
    }

    @Override
    public void onDestroy() {
        if (nativeTtsBridge != null) {
            nativeTtsBridge.destroy();
            nativeTtsBridge = null;
        }
        super.onDestroy();
    }
}
