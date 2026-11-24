package com.russellralt.efectiva;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * Receiver exacto para disparar la Alarma Perenne Escandalosa incluso con la app
 * completamente cerrada o tras reiniciar el teléfono (BOOT_COMPLETED).
 */
public class EfectivaIdleAlarmReceiver extends BroadcastReceiver {
    public static final String PREFS_NAME = "efectiva_idle_alarm_prefs";
    public static final String KEY_ENABLED = "enabled";
    public static final String KEY_IS_PLAYING = "is_playing";
    public static final String KEY_INTERVAL_MIN = "interval_min";
    public static final String KEY_PENDING_COUNT = "pending_count";
    public static final String KEY_PENDING_SUMMARY = "pending_summary";
    public static final String KEY_SNOOZE_UNTIL = "snooze_until";
    public static final String ACTION_FIRE_IDLE_ALARM = "com.russellralt.efectiva.FIRE_IDLE_ALARM";
    private static final int ALARM_REQ_CODE = 4099;

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent != null ? intent.getAction() : "";
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        boolean enabled = prefs.getBoolean(KEY_ENABLED, true);
        boolean isPlaying = prefs.getBoolean(KEY_IS_PLAYING, false);
        int pendingCount = prefs.getInt(KEY_PENDING_COUNT, 0);
        int intervalMin = Math.max(1, prefs.getInt(KEY_INTERVAL_MIN, 5));
        long snoozeUntil = prefs.getLong(KEY_SNOOZE_UNTIL, 0L);

        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_LOCKED_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            if (enabled && !isPlaying && pendingCount > 0) {
                long delayMs = Math.max(60_000L, snoozeUntil - System.currentTimeMillis());
                scheduleNext(context, delayMs);
            }
            return;
        }

        // Disparo normal del AlarmManager
        if (!enabled || isPlaying || pendingCount <= 0) {
            cancelScheduled(context);
            return;
        }

        long now = System.currentTimeMillis();
        if (snoozeUntil > now) {
            scheduleNext(context, snoozeUntil - now);
            return;
        }

        String summary = prefs.getString(KEY_PENDING_SUMMARY, "Abrí Efectiva y dale ▶ Play a una tarea pendiente.");
        String title = "🚨 ¡" + pendingCount + " pendiente(s) sin Play!";

        Intent svc = new Intent(context, EfectivaLoudAlarmService.class);
        svc.setAction(EfectivaLoudAlarmService.ACTION_START);
        svc.putExtra(EfectivaLoudAlarmService.EXTRA_TITLE, title);
        svc.putExtra(EfectivaLoudAlarmService.EXTRA_BODY, summary);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } catch (Exception ignored) {}

        // Reprogramar automáticamente el siguiente ciclo perenne
        scheduleNext(context, intervalMin * 60_000L);
    }

    public static void setEnabledAndSync(Context context, boolean enabled) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit().putBoolean(KEY_ENABLED, enabled).apply();
        if (!enabled) {
            cancelScheduled(context);
        } else {
            int intervalMin = Math.max(1, prefs.getInt(KEY_INTERVAL_MIN, 5));
            boolean isPlaying = prefs.getBoolean(KEY_IS_PLAYING, false);
            int pendingCount = prefs.getInt(KEY_PENDING_COUNT, 0);
            if (!isPlaying && pendingCount > 0) {
                scheduleNext(context, intervalMin * 60_000L);
            }
        }
    }

    public static void scheduleNext(Context context, long delayMs) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;
            long triggerAt = System.currentTimeMillis() + Math.max(15_000L, delayMs);
            PendingIntent pi = buildAlarmPendingIntent(context);

            // setAlarmClock atraviesa Doze Mode incluso con la app 100% cerrada
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()) {
                    Intent showIntent = new Intent(context, MainActivity.class);
                    int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                            : PendingIntent.FLAG_UPDATE_CURRENT;
                    PendingIntent showPi = PendingIntent.getActivity(context, 4098, showIntent, flags);
                    am.setAlarmClock(new AlarmManager.AlarmClockInfo(triggerAt, showPi), pi);
                    return;
                }
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            } else {
                am.set(AlarmManager.RTC_WAKEUP, triggerAt, pi);
            }
        } catch (Exception ignored) {}
    }

    public static void cancelScheduled(Context context) {
        try {
            AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                am.cancel(buildAlarmPendingIntent(context));
            }
        } catch (Exception ignored) {}
    }

    private static PendingIntent buildAlarmPendingIntent(Context context) {
        Intent i = new Intent(context, EfectivaIdleAlarmReceiver.class);
        i.setAction(ACTION_FIRE_IDLE_ALARM);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;
        return PendingIntent.getBroadcast(context, ALARM_REQ_CODE, i, flags);
    }
}
