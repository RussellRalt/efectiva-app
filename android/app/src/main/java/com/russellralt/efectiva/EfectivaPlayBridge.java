package com.russellralt.efectiva;

import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.webkit.JavascriptInterface;

/**
 * Puente JavaScript <-> Android para mantener vivo el Modo Play en la barra superior
 * y programar la alarma exacta escandalosa al finalizar cada paso.
 * Expuesto como window.EfectivaPlayBridge en MainActivity.
 */
public class EfectivaPlayBridge {
    private final Context context;

    public EfectivaPlayBridge(Context context) {
        this.context = context.getApplicationContext();
    }

    @JavascriptInterface
    public void startOrUpdate(
            String taskName,
            int stepIndex,
            int totalSteps,
            String stepText,
            boolean hasCountdown,
            int secondsValue
    ) {
        boolean isOverdue = hasCountdown && secondsValue <= 0;

        try {
            Intent svc = new Intent(context, EfectivaPlayForegroundService.class);
            svc.setAction(EfectivaPlayForegroundService.ACTION_UPDATE);
            svc.putExtra(EfectivaPlayForegroundService.EXTRA_TASK_NAME, taskName != null ? taskName : "Tarea en curso");
            svc.putExtra(EfectivaPlayForegroundService.EXTRA_STEP_INDEX, Math.max(1, stepIndex));
            svc.putExtra(EfectivaPlayForegroundService.EXTRA_TOTAL_STEPS, Math.max(1, totalSteps));
            svc.putExtra(EfectivaPlayForegroundService.EXTRA_STEP_TEXT, stepText != null ? stepText : "Paso actual");
            svc.putExtra(EfectivaPlayForegroundService.EXTRA_HAS_COUNTDOWN, hasCountdown);
            svc.putExtra(EfectivaPlayForegroundService.EXTRA_SECONDS, secondsValue);
            svc.putExtra(EfectivaPlayForegroundService.EXTRA_IS_OVERDUE, isOverdue);

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(svc);
            } else {
                context.startService(svc);
            }
        } catch (Exception ignored) {}

        if (hasCountdown && secondsValue > 0) {
            EfectivaStepAlarmReceiver.scheduleExact(
                    context,
                    ((long) secondsValue) * 1000L,
                    taskName,
                    stepIndex,
                    totalSteps,
                    stepText
            );
        } else {
            EfectivaStepAlarmReceiver.cancel(context);
        }
    }

    @JavascriptInterface
    public void stop() {
        EfectivaStepAlarmReceiver.cancel(context);
        try {
            Intent stopPlay = new Intent(context, EfectivaPlayForegroundService.class);
            stopPlay.setAction(EfectivaPlayForegroundService.ACTION_STOP);
            context.startService(stopPlay);
        } catch (Exception ignored) {}
        stopStepAlarmSound();
    }

    @JavascriptInterface
    public void stopStepAlarmSound() {
        try {
            Intent stopAlarm = new Intent(context, EfectivaLoudAlarmService.class);
            stopAlarm.setAction(EfectivaLoudAlarmService.ACTION_STOP);
            context.startService(stopAlarm);
        } catch (Exception ignored) {}
    }
}
