package com.russellralt.efectiva;

import android.os.Bundle;
import android.webkit.WebView;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    private EfectivaAndroidTtsBridge nativeTtsBridge = null;
    private EfectivaBgBridge bgBridge = null;
    private EfectivaIdleAlarmBridge idleAlarmBridge = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(EfectivaTtsPlugin.class);
        super.onCreate(savedInstanceState);
        if (getIntent() != null && getIntent().getBooleanExtra("fromLoudAlarm", false)) {
            stopLoudAlarmOnOpen();
        }
    }

    @Override
    protected void onNewIntent(android.content.Intent intent) {
        super.onNewIntent(intent);
        if (intent != null && intent.getBooleanExtra("fromLoudAlarm", false)) {
            stopLoudAlarmOnOpen();
        }
    }

    private void stopLoudAlarmOnOpen() {
        try {
            android.content.Intent stop = new android.content.Intent(this, EfectivaLoudAlarmService.class);
            stop.setAction(EfectivaLoudAlarmService.ACTION_STOP);
            startService(stop);
        } catch (Exception ignored) {}
    }

    @Override
    protected void load() {
        WebView wv = findViewById(com.getcapacitor.android.R.id.webview);
        if (wv != null && nativeTtsBridge == null) {
            nativeTtsBridge = new EfectivaAndroidTtsBridge(getApplicationContext(), wv);
            wv.addJavascriptInterface(nativeTtsBridge, "EfectivaAndroidBridge");
        }
        if (wv != null && bgBridge == null) {
            bgBridge = new EfectivaBgBridge(getApplicationContext());
            wv.addJavascriptInterface(bgBridge, "EfectivaBgBridge");
        }
        if (wv != null && idleAlarmBridge == null) {
            idleAlarmBridge = new EfectivaIdleAlarmBridge(this);
            wv.addJavascriptInterface(idleAlarmBridge, "EfectivaIdleAlarmBridge");
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
