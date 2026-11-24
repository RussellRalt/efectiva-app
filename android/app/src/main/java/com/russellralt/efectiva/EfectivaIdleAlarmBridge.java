package com.russellralt.efectiva;

import android.Manifest;
import android.app.Activity;
import android.app.AlarmManager;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import android.webkit.JavascriptInterface;
import androidx.core.app.ActivityCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;
import org.json.JSONObject;

/**
 * Puente JavaScript <-> Android para la Alarma Perenne Escandalosa y gestión guiada de permisos.
 * Expuesto como window.EfectivaIdleAlarmBridge en MainActivity.
 */
public class EfectivaIdleAlarmBridge {
    private final Activity activity;
    private final Context context;

    public EfectivaIdleAlarmBridge(Activity activity) {
        this.activity = activity;
        this.context = activity.getApplicationContext();
    }

    @JavascriptInterface
    public void syncState(boolean enabled, boolean isPlaying, int intervalMin, int pendingCount, String pendingSummary, long snoozeUntilMs) {
        SharedPreferences prefs = context.getSharedPreferences(EfectivaIdleAlarmReceiver.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
                .putBoolean(EfectivaIdleAlarmReceiver.KEY_ENABLED, enabled)
                .putBoolean(EfectivaIdleAlarmReceiver.KEY_IS_PLAYING, isPlaying)
                .putInt(EfectivaIdleAlarmReceiver.KEY_INTERVAL_MIN, Math.max(1, intervalMin))
                .putInt(EfectivaIdleAlarmReceiver.KEY_PENDING_COUNT, Math.max(0, pendingCount))
                .putString(EfectivaIdleAlarmReceiver.KEY_PENDING_SUMMARY, pendingSummary != null ? pendingSummary : "")
                .putLong(EfectivaIdleAlarmReceiver.KEY_SNOOZE_UNTIL, Math.max(0L, snoozeUntilMs))
                .apply();

        if (!enabled || isPlaying || pendingCount <= 0) {
            stopRingingNow();
            EfectivaIdleAlarmReceiver.cancelScheduled(context);
            return;
        }

        long now = System.currentTimeMillis();
        long delayMs = (snoozeUntilMs > now) ? (snoozeUntilMs - now) : (Math.max(1, intervalMin) * 60_000L);
        EfectivaIdleAlarmReceiver.scheduleNext(context, delayMs);
    }

    @JavascriptInterface
    public void stopRingingNow() {
        try {
            Intent stop = new Intent(context, EfectivaLoudAlarmService.class);
            stop.setAction(EfectivaLoudAlarmService.ACTION_STOP);
            context.startService(stop);
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public void triggerTestAlarm(String summary) {
        try {
            Intent svc = new Intent(context, EfectivaLoudAlarmService.class);
            svc.setAction(EfectivaLoudAlarmService.ACTION_START);
            svc.putExtra(EfectivaLoudAlarmService.EXTRA_TITLE, "🚨 Prueba de Alarma Escandalosa");
            svc.putExtra(EfectivaLoudAlarmService.EXTRA_BODY,
                    (summary != null && !summary.isEmpty()) ? summary : "Así sonará incluso con la app cerrada.");
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public String getPermissionsStatus() {
        JSONObject out = new JSONObject();
        try {
            boolean notifOk = NotificationManagerCompat.from(context).areNotificationsEnabled();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                notifOk = notifOk && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED;
            }
            boolean exactOk = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
                exactOk = am != null && am.canScheduleExactAlarms();
            }
            boolean batteryOk = true;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                PowerManager pm = (PowerManager) context.getSystemService(Context.POWER_SERVICE);
                batteryOk = pm != null && pm.isIgnoringBatteryOptimizations(context.getPackageName());
            }
            boolean fullScreenOk = true;
            if (Build.VERSION.SDK_INT >= 34) {
                NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
                fullScreenOk = nm != null && nm.canUseFullScreenIntent();
            }
            out.put("notifications", notifOk);
            out.put("exactAlarm", exactOk);
            out.put("batteryOptimization", batteryOk);
            out.put("fullScreenIntent", fullScreenOk);
        } catch (Exception ignored) {}
        return out.toString();
    }

    @JavascriptInterface
    public void requestNotificationPermission() {
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                        && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
                    ActivityCompat.requestPermissions(activity, new String[]{Manifest.permission.POST_NOTIFICATIONS}, 4021);
                } else {
                    Intent intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS);
                    intent.putExtra(Settings.EXTRA_APP_PACKAGE, context.getPackageName());
                    activity.startActivity(intent);
                }
            } catch (Exception ignored) {}
        });
    }

    @JavascriptInterface
    public void requestExactAlarmPermission() {
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM);
                    intent.setData(Uri.parse("package:" + context.getPackageName()));
                    activity.startActivity(intent);
                }
            } catch (Exception ignored) {}
        });
    }

    @JavascriptInterface
    public void requestIgnoreBatteryOptimizations() {
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                    Intent intent = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS);
                    intent.setData(Uri.parse("package:" + context.getPackageName()));
                    activity.startActivity(intent);
                }
            } catch (Exception ignored) {}
        });
    }

    @JavascriptInterface
    public void requestFullScreenIntentPermission() {
        activity.runOnUiThread(() -> {
            try {
                if (Build.VERSION.SDK_INT >= 34) {
                    Intent intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT);
                    intent.setData(Uri.parse("package:" + context.getPackageName()));
                    activity.startActivity(intent);
                }
            } catch (Exception ignored) {}
        });
    }
}
