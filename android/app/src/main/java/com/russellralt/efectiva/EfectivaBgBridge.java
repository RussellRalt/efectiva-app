package com.russellralt.efectiva;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.webkit.JavascriptInterface;

public class EfectivaBgBridge {
    private final Context context;

    public EfectivaBgBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public void start(String message) {
        try {
            Intent intent = new Intent(context, EfectivaAiForegroundService.class);
            intent.setAction(EfectivaAiForegroundService.ACTION_START);
            intent.putExtra(EfectivaAiForegroundService.EXTRA_TEXT, message != null ? message : "Copiloto IA trabajando...");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent);
            } else {
                context.startService(intent);
            }
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public void stop() {
        try {
            Intent intent = new Intent(context, EfectivaAiForegroundService.class);
            intent.setAction(EfectivaAiForegroundService.ACTION_STOP);
            context.startService(intent);
        } catch (Exception ignored) {}
    }
}
