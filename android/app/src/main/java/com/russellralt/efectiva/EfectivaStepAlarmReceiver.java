package com.russellralt.efectiva;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

/**
 * Receiver exacto para disparar una alarma escandalosa (USAGE_ALARM) cuando se vence
 * el tiempo de un paso en Modo Play, incluso en Doze o usando otra aplicación.
 */
public class EfectivaStepAlarmReceiver extends BroadcastReceiver {
    public static final String ACTION_FIRE_STEP_ALARM = "com.russellralt.efectiva.FIRE_STEP_ALARM";
    private static final String PREFS_NAME = "efectiva_play_alarm_prefs";
    private static final String KEY_TASK_NAME = "taskName";
    private static final String KEY_STEP_INDEX = "stepIndex";
    private static final String KEY_TOTAL_STEPS = "totalSteps";
    private static final String KEY_STEP_TEXT = "stepText";
    private static final int ALARM_REQ_CODE = 4199;

    @Override
    public void onReceive(Context context, Intent intent) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String taskName = prefs.getString(KEY_TASK_NAME, "Tarea en curso");
        int stepIndex = prefs.getInt(KEY_STEP_INDEX, 1);
        int totalSteps = prefs.getInt(KEY_TOTAL_STEPS, 1);
        String stepText = prefs.getString(KEY_STEP_TEXT, "Paso actual");

        Intent alarmSvc = new Intent(context, EfectivaLoudAlarmService.class);
        alarmSvc.setAction(EfectivaLoudAlarmService.ACTION_START);
        alarmSvc.putExtra(EfectivaLoudAlarmService.EXTRA_TITLE, "⏰ ¡Tiempo agotado! · " + taskName);
        alarmSvc.putExtra(EfectivaLoudAlarmService.EXTRA_BODY, "Paso " + stepIndex + "/" + totalSteps + ": " + stepText);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(alarmSvc);
            } else {
                context.startService(alarmSvc);
            }
        } catch (Exception ignored) {}

        Intent liveSvc = new Intent(context, EfectivaPlayForegroundService.class);
        liveSvc.setAction(EfectivaPlayForegroundService.ACTION_UPDATE);
        liveSvc.putExtra(EfectivaPlayForegroundService.EXTRA_TASK_NAME, taskName);
        liveSvc.putExtra(EfectivaPlayForegroundService.EXTRA_STEP_INDEX, stepIndex);
        liveSvc.putExtra(EfectivaPlayForegroundService.EXTRA_TOTAL_STEPS, totalSteps);
        liveSvc.putExtra(EfectivaPlayForegroundService.EXTRA_STEP_TEXT, stepText);
        liveSvc.putExtra(EfectivaPlayForegroundService.EXTRA_HAS_COUNTDOWN, true);
        liveSvc.putExtra(EfectivaPlayForegroundService.EXTRA_SECONDS, 0);
        liveSvc.putExtra(EfectivaPlayForegroundService.EXTRA_IS_OVERDUE, true);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(liveSvc);
            } else {
                context.startService(liveSvc);
            }
        } catch (Exception ignored) {}
    }

    public static void scheduleExact(
            Context ctx,
            long delayMs,
            String taskName,
            int stepIndex,
            int totalSteps,
            String stepText
    ) {
        try {
            SharedPreferences prefs = ctx.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
            prefs.edit()
                    .putString(KEY_TASK_NAME, taskName != null ? taskName : "Tarea en curso")
                    .putInt(KEY_STEP_INDEX, Math.max(1, stepIndex))
                    .putInt(KEY_TOTAL_STEPS, Math.max(1, totalSteps))
                    .putString(KEY_STEP_TEXT, stepText != null ? stepText : "Paso actual")
                    .apply();

            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am == null) return;

            long triggerAt = System.currentTimeMillis() + Math.max(1000L, delayMs);
            PendingIntent pi = buildPendingIntent(ctx);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms()) {
                    Intent showIntent = new Intent(ctx, MainActivity.class);
                    int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                            ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                            : PendingIntent.FLAG_UPDATE_CURRENT;
                    PendingIntent showPi = PendingIntent.getActivity(ctx, 4198, showIntent, flags);
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

    public static void cancel(Context ctx) {
        try {
            AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
            if (am != null) {
                am.cancel(buildPendingIntent(ctx));
            }
        } catch (Exception ignored) {}
    }

    private static PendingIntent buildPendingIntent(Context ctx) {
        Intent i = new Intent(ctx, EfectivaStepAlarmReceiver.class);
        i.setAction(ACTION_FIRE_STEP_ALARM);
        int flags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;
        return PendingIntent.getBroadcast(ctx, ALARM_REQ_CODE, i, flags);
    }
}
