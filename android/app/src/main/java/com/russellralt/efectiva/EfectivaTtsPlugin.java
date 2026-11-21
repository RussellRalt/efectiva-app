package com.russellralt.efectiva;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.Locale;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;

@CapacitorPlugin(name = "EfectivaTts")
public class EfectivaTtsPlugin extends Plugin {

    private volatile TextToSpeech tts = null;
    private volatile boolean ready = false;
    private volatile int initStatus = -999;
    private volatile String selectedLang = "";
    private volatile CountDownLatch initLatch = new CountDownLatch(1);
    private final ExecutorService executor = Executors.newSingleThreadExecutor();
    private final ConcurrentHashMap<String, PluginCall> pendingCalls = new ConcurrentHashMap<>();

    @Override
    public void load() {
        initEngine();
    }

    private synchronized void initEngine() {
        if (tts != null && ready) return;
        ready = false;
        initStatus = -999;
        initLatch = new CountDownLatch(1);
        final Context appCtx = getContext().getApplicationContext();
        try {
            if (tts != null) {
                try { tts.shutdown(); } catch (Exception ignored) {}
                tts = null;
            }
            tts = new TextToSpeech(appCtx, status -> {
                initStatus = status;
                if (status == TextToSpeech.SUCCESS && tts != null) {
                    configureEngine(tts);
                    ready = true;
                } else {
                    ready = false;
                }
                initLatch.countDown();
            });
        } catch (Exception ex) {
            initStatus = -2;
            ready = false;
            initLatch.countDown();
        }
    }

    private void configureEngine(TextToSpeech engine) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.LOLLIPOP) {
                engine.setAudioAttributes(
                    new AudioAttributes.Builder()
                        .setUsage(AudioAttributes.USAGE_MEDIA)
                        .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build()
                );
            }
        } catch (Exception ignored) {}

        // Seleccionar el mejor español disponible sin rechazar jamás si falta un dialecto
        Locale[] candidates = new Locale[] {
            Locale.forLanguageTag("es-GT"),
            Locale.forLanguageTag("es-MX"),
            Locale.forLanguageTag("es-419"),
            Locale.forLanguageTag("es-US"),
            Locale.forLanguageTag("es-ES"),
            new Locale("es")
        };
        selectedLang = "default";
        for (Locale loc : candidates) {
            try {
                int avail = engine.isLanguageAvailable(loc);
                if (avail == TextToSpeech.LANG_AVAILABLE
                    || avail == TextToSpeech.LANG_COUNTRY_AVAILABLE
                    || avail == TextToSpeech.LANG_COUNTRY_VAR_AVAILABLE) {
                    engine.setLanguage(loc);
                    selectedLang = loc.toLanguageTag();
                    break;
                }
            } catch (Exception ignored) {}
        }

        engine.setOnUtteranceProgressListener(new UtteranceProgressListener() {
            @Override
            public void onStart(String utteranceId) {}

            @Override
            public void onDone(String utteranceId) {
                PluginCall c = pendingCalls.remove(utteranceId);
                if (c != null) {
                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    ret.put("done", true);
                    c.resolve(ret);
                }
            }

            @Override
            public void onError(String utteranceId) {
                PluginCall c = pendingCalls.remove(utteranceId);
                if (c != null) {
                    c.reject("Error de síntesis TTS en Android");
                }
            }

            @Override
            public void onError(String utteranceId, int errorCode) {
                PluginCall c = pendingCalls.remove(utteranceId);
                if (c != null) {
                    c.reject("Error de síntesis TTS en Android (código " + errorCode + ")");
                }
            }

            @Override
            public void onStop(String utteranceId, boolean interrupted) {
                PluginCall c = pendingCalls.remove(utteranceId);
                if (c != null) {
                    JSObject ret = new JSObject();
                    ret.put("ok", true);
                    ret.put("interrupted", true);
                    c.resolve(ret);
                }
            }
        });
    }

    private void resolveAllPendingAsInterrupted() {
        for (Map.Entry<String, PluginCall> entry : pendingCalls.entrySet()) {
            PluginCall c = pendingCalls.remove(entry.getKey());
            if (c != null) {
                JSObject ret = new JSObject();
                ret.put("ok", true);
                ret.put("interrupted", true);
                c.resolve(ret);
            }
        }
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("ready", ready);
        ret.put("initStatus", initStatus);
        ret.put("selectedLang", selectedLang);
        try {
            ret.put("defaultEngine", tts != null ? String.valueOf(tts.getDefaultEngine()) : "");
        } catch (Exception ignored) {
            ret.put("defaultEngine", "");
        }
        try {
            AudioManager am = (AudioManager) getContext().getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                ret.put("mediaVolume", am.getStreamVolume(AudioManager.STREAM_MUSIC));
                ret.put("mediaMaxVolume", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
            }
        } catch (Exception ignored) {}
        call.resolve(ret);
    }

    @PluginMethod
    public void speak(PluginCall call) {
        final String text = call.getString("text", "").trim();
        final float rate = call.getFloat("rate", 1.0f);
        final float pitch = call.getFloat("pitch", 1.0f);
        final float volume = call.getFloat("volume", 1.0f);

        if (text.isEmpty()) {
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
            return;
        }

        executor.execute(() -> {
            try {
                if (!ready) {
                    initLatch.await(3500, TimeUnit.MILLISECONDS);
                }
                if (!ready) {
                    // Un reintento perezoso por si el servicio Google TTS estaba dormido
                    initEngine();
                    initLatch.await(3000, TimeUnit.MILLISECONDS);
                }
                if (!ready || tts == null) {
                    call.reject("Motor de voz Android no disponible (status=" + initStatus + ")");
                    return;
                }

                // Detener sincrónicamente cualquier locución previa sin condición de carrera
                tts.stop();
                resolveAllPendingAsInterrupted();

                tts.setSpeechRate(Math.max(0.5f, Math.min(2.0f, rate)));
                tts.setPitch(Math.max(0.5f, Math.min(2.0f, pitch)));

                String utteranceId = "ef_" + UUID.randomUUID().toString();
                pendingCalls.put(utteranceId, call);

                Bundle params = new Bundle();
                params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, Math.max(0.0f, Math.min(1.0f, volume)));
                params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
                params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);

                int result = tts.speak(text, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
                if (result != TextToSpeech.SUCCESS) {
                    pendingCalls.remove(utteranceId);
                    call.reject("Android TextToSpeech.speak devolvió error (" + result + ")");
                }
            } catch (Exception ex) {
                call.reject("Excepción TTS: " + ex.getLocalizedMessage());
            }
        });
    }

    @PluginMethod
    public void stop(PluginCall call) {
        executor.execute(() -> {
            try {
                if (tts != null) {
                    tts.stop();
                }
                resolveAllPendingAsInterrupted();
            } catch (Exception ignored) {}
            JSObject ret = new JSObject();
            ret.put("ok", true);
            call.resolve(ret);
        });
    }

    @Override
    protected void handleOnDestroy() {
        try {
            resolveAllPendingAsInterrupted();
            if (tts != null) {
                tts.stop();
                tts.shutdown();
                tts = null;
            }
        } catch (Exception ignored) {}
        executor.shutdownNow();
    }
}
