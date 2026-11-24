package com.russellralt.efectiva;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;

/**
 * Servicio de Alarma Perenne Escandalosa a nivel sistema Android.
 * Usa AudioAttributes.USAGE_ALARM (suena incluso en modo Silencio/Vibración),
 * vibración continua y notificación de máxima prioridad con FullScreenIntent.
 */
public class EfectivaLoudAlarmService extends Service {
    public static final String CHANNEL_ID = "efectiva_loud_idle_alarm_v40";
    public static final int NOTIF_ID = 4001;
    public static final String ACTION_START = "com.russellralt.efectiva.LOUD_ALARM_START";
    public static final String ACTION_STOP = "com.russellralt.efectiva.LOUD_ALARM_STOP";
    public static final String ACTION_DISABLE = "com.russellralt.efectiva.LOUD_ALARM_DISABLE";
    public static final String EXTRA_TITLE = "title";
    public static final String EXTRA_BODY = "body";

    private MediaPlayer mediaPlayer = null;
    private Vibrator vibrator = null;
    private PowerManager.WakeLock wakeLock = null;

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : ACTION_START;

        if (ACTION_STOP.equals(action)) {
            stopAlarmAndSelf();
            return START_NOT_STICKY;
        }
        if (ACTION_DISABLE.equals(action)) {
            EfectivaIdleAlarmReceiver.setEnabledAndSync(this, false);
            stopAlarmAndSelf();
            return START_NOT_STICKY;
        }

        String title = (intent != null && intent.getStringExtra(EXTRA_TITLE) != null)
                ? intent.getStringExtra(EXTRA_TITLE)
                : "🚨 ¡SIN TAREA EN PLAY!";
        String body = (intent != null && intent.getStringExtra(EXTRA_BODY) != null)
                ? intent.getStringExtra(EXTRA_BODY)
                : "Abrí Efectiva y dale ▶ Play a una tarea pendiente.";

        ensureAlarmChannel();
        Notification notification = buildAlarmNotification(title, body);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            startForeground(NOTIF_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK);
        } else {
            startForeground(NOTIF_ID, notification);
        }

        acquireWakeLock();
        startLoudSound();
        startStrongVibration();
        return START_NOT_STICKY;
    }

    private void ensureAlarmChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(
                    CHANNEL_ID,
                    "Alarma Escandalosa de Pendientes",
                    NotificationManager.IMPORTANCE_HIGH
            );
            ch.setDescription("Suena a volumen de alarma cuando no estás ejecutando ninguna tarea en Play.");
            ch.enableVibration(true);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            ch.setBypassDnd(true);
            ch.setSound(null, null); // El sonido en loop lo controla MediaPlayer sobre USAGE_ALARM
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.createNotificationChannel(ch);
        }
    }

    private Notification buildAlarmNotification(String title, String body) {
        int piFlags = Build.VERSION.SDK_INT >= Build.VERSION_CODES.M
                ? PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
                : PendingIntent.FLAG_UPDATE_CURRENT;

        Intent openIntent = new Intent(this, MainActivity.class);
        openIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        openIntent.putExtra("fromLoudAlarm", true);
        PendingIntent openPi = PendingIntent.getActivity(this, 4010, openIntent, piFlags);

        Intent stopIntent = new Intent(this, EfectivaLoudAlarmService.class);
        stopIntent.setAction(ACTION_STOP);
        PendingIntent stopPi = PendingIntent.getService(this, 4011, stopIntent, piFlags);

        Intent disableIntent = new Intent(this, EfectivaLoudAlarmService.class);
        disableIntent.setAction(ACTION_DISABLE);
        PendingIntent disablePi = PendingIntent.getService(this, 4012, disableIntent, piFlags);

        return new NotificationCompat.Builder(this, CHANNEL_ID)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setSmallIcon(R.mipmap.ic_launcher)
                .setCategory(NotificationCompat.CATEGORY_ALARM)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setOngoing(true)
                .setAutoCancel(false)
                .setFullScreenIntent(openPi, true)
                .setContentIntent(openPi)
                .addAction(0, "▶ Abrir y dar Play", openPi)
                .addAction(0, "🔇 Silenciar", stopPi)
                .addAction(0, "🔕 Desactivar", disablePi)
                .build();
    }

    private void startLoudSound() {
        stopLoudSound();
        try {
            // Subir un poco el volumen de alarma si estuviera en 0? No forzamos sin permiso, pero usamos STREAM_ALARM
            Uri alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM);
            if (alarmUri == null) alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            if (alarmUri == null) alarmUri = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_NOTIFICATION);

            mediaPlayer = new MediaPlayer();
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                mediaPlayer.setAudioAttributes(new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_ALARM)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                        .build());
            } else {
                mediaPlayer.setAudioStreamType(AudioManager.STREAM_ALARM);
            }
            mediaPlayer.setDataSource(this, alarmUri);
            mediaPlayer.setLooping(true);
            mediaPlayer.setVolume(1.0f, 1.0f);
            mediaPlayer.prepare();
            mediaPlayer.start();
        } catch (Exception ignored) {}
    }

    private void stopLoudSound() {
        try {
            if (mediaPlayer != null) {
                if (mediaPlayer.isPlaying()) mediaPlayer.stop();
                mediaPlayer.release();
                mediaPlayer = null;
            }
        } catch (Exception ignored) {}
    }

    private void startStrongVibration() {
        try {
            vibrator = (Vibrator) getSystemService(Context.VIBRATOR_SERVICE);
            if (vibrator != null && vibrator.hasVibrator()) {
                long[] pattern = new long[]{0, 700, 300, 700, 300, 900, 400};
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                    vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
                } else {
                    vibrator.vibrate(pattern, 0);
                }
            }
        } catch (Exception ignored) {}
    }

    private void stopStrongVibration() {
        try {
            if (vibrator != null) {
                vibrator.cancel();
                vibrator = null;
            }
        } catch (Exception ignored) {}
    }

    private void acquireWakeLock() {
        try {
            if (wakeLock == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) {
                    wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "efectiva:LoudAlarmWakeLock");
                    wakeLock.setReferenceCounted(false);
                }
            }
            if (wakeLock != null && !wakeLock.isHeld()) {
                wakeLock.acquire(5 * 60 * 1000L);
            }
        } catch (Exception ignored) {}
    }

    private void releaseWakeLock() {
        try {
            if (wakeLock != null && wakeLock.isHeld()) {
                wakeLock.release();
            }
        } catch (Exception ignored) {}
    }

    private void stopAlarmAndSelf() {
        stopLoudSound();
        stopStrongVibration();
        releaseWakeLock();
        stopForeground(true);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        stopLoudSound();
        stopStrongVibration();
        releaseWakeLock();
        super.onDestroy();
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
