package com.russellralt.efectiva;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import androidx.core.app.NotificationCompat;

/**
 * Foreground Service persistente durante Modo Play.
 * Mantiene vivo el proceso en Android al ir a WhatsApp/Telegram y muestra en la
 * barra superior la tarea actual, el número de paso, el texto resumido y un
 * cronómetro nativo en vivo (cuenta regresiva o transcurrida).
 */
public class EfectivaPlayForegroundService extends Service {
    public static final String CHANNEL_ID = "efectiva_play_live_v42";
    public static final int NOTIF_ID = 4101;
    public static final String ACTION_UPDATE = "com.russellralt.efectiva.PLAY_LIVE_UPDATE";
    public static final String ACTION_STOP = "com.russellralt.efectiva.PLAY_LIVE_STOP";

    public static final String EXTRA_TASK_NAME = "taskName";
    public static final String EXTRA_STEP_INDEX = "stepIndex";
    public static final String EXTRA_TOTAL_STEPS = "totalSteps";
    public static final String EXTRA_STEP_TEXT = "stepText";
    public static final String EXTRA_HAS_COUNTDOWN = "hasCountdown";
    public static final String EXTRA_SECONDS = "seconds";
    public static final String EXTRA_IS_OVERDUE = "isOverdue";

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_UPDATE;
        if (ACTION_STOP.equals(action)) {
            EfectivaStepAlarmReceiver.cancel(this);
            try {
                Intent stopAlarm = new Intent(this, EfectivaLoudAlarmService.class);
                stopAlarm.setAction(EfectivaLoudAlarmService.ACTION_STOP);
                startService(stopAlarm);
            } catch (Exception ignored) {}
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        String taskName = intent != null && intent.getStringExtra(EXTRA_TASK_NAME) != null
                ? intent.getStringExtra(EXTRA_TASK_NAME) : "Tarea en curso";
        int stepIndex = intent != null ? Math.max(1, intent.getIntExtra(EXTRA_STEP_INDEX, 1)) : 1;
        int totalSteps = intent != null ? Math.max(1, intent.getIntExtra(EXTRA_TOTAL_STEPS, 1)) : 1;
        String stepText = intent != null && intent.getStringExtra(EXTRA_STEP_TEXT) != null
                ? intent.getStringExtra(EXTRA_STEP_TEXT) : "Ejecutando paso actual...";
        boolean hasCountdown = intent != null && intent.getBooleanExtra(EXTRA_HAS_COUNTDOWN, false);
        int seconds = intent != null ? intent.getIntExtra(EXTRA_SECONDS, 0) : 0;
        boolean isOverdue = intent != null && intent.getBooleanExtra(EXTRA_IS_OVERDUE, false);

        ensureChannel();
        Notification notification = buildNotification(taskName, stepIndex, totalSteps, stepText, hasCountdown, seconds, isOverdue);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID, notification);
        }

        return START_STICKY;
    }

    private void ensureChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID,
                    "Presentación en vivo (Modo Play)",
                    NotificationManager.IMPORTANCE_LOW
            );
            ch.setDescription("Muestra la tarea, paso actual y tiempo restante mientras usás otras apps.");
            ch.setShowBadge(false);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildNotification(
            String taskName,
            int stepIndex,
            int totalSteps,
            String stepText,
            boolean hasCountdown,
            int seconds,
            boolean isOverdue
    ) {
        int piFlags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 4110, openIntent, piFlags);

        Intent stopIntent = new Intent(this, EfectivaPlayForegroundService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 4111, stopIntent, piFlags);

        String shortBody = stepText.length() > 120 ? stepText.substring(0, 117) + "..." : stepText;
        String title;
        long now = System.currentTimeMillis();
        long chronometerWhen;
        boolean countDown;

        if (isOverdue) {
            title = "⏰ VENCIDO · " + taskName + " (Paso " + stepIndex + "/" + totalSteps + ")";
            chronometerWhen = now - (Math.abs((long) seconds) * 1000L);
            countDown = false;
        } else if (hasCountdown && seconds > 0) {
            title = "▶ " + taskName + " · Paso " + stepIndex + "/" + totalSteps;
            chronometerWhen = now + ((long) seconds * 1000L);
            countDown = true;
        } else {
            title = "▶ " + taskName + " · Paso " + stepIndex + "/" + totalSteps;
            chronometerWhen = now - (Math.max(0L, (long) seconds) * 1000L);
            countDown = false;
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(shortBody)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(stepText))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setShowWhen(true)
                .setWhen(chronometerWhen)
                .setUsesChronometer(true)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setContentIntent(openPi)
                .addAction(0, "▶ Abrir", openPi)
                .addAction(0, "⏹ Detener", stopPi);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            builder.setChronometerCountDown(countDown);
        }

        return builder.build();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
