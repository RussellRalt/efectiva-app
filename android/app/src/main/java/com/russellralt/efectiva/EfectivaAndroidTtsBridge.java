package com.russellralt.efectiva;

import android.content.Context;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.os.Build;
import android.os.Bundle;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;
import java.util.Locale;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import org.json.JSONObject;

public class EfectivaAndroidTtsBridge {

    private final Context appContext;
    private final WebView webView;
    private volatile TextToSpeech tts = null;
    private volatile boolean ready = false;
    private volatile int initStatus = -999;
    private volatile String selectedLang = "";
    private volatile CountDownLatch initLatch = new CountDownLatch(1);
    private final ExecutorService executor = Executors.newSingleThreadExecutor();

    public EfectivaAndroidTtsBridge(Context appContext, WebView webView) {
        this.appContext = appContext;
        this.webView = webView;
        initEngine();
    }

    private synchronized void initEngine() {
        if (tts != null && ready) return;
        ready = false;
        initStatus = -999;
        initLatch = new CountDownLatch(1);
        try {
            if (tts != null) {
                try { tts.shutdown(); } catch (Exception ignored) {}
                tts = null;
            }
            tts = new TextToSpeech(appContext, status -> {
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
            public void onStart(String utteranceId) {
                emitJsEvent(utteranceId, "start", "");
            }

            @Override
            public void onDone(String utteranceId) {
                emitJsEvent(utteranceId, "done", "");
            }

            @Override
            public void onError(String utteranceId) {
                emitJsEvent(utteranceId, "error", "Error TTS Android");
            }

            @Override
            public void onError(String utteranceId, int errorCode) {
                emitJsEvent(utteranceId, "error", "Error TTS Android (" + errorCode + ")");
            }

            @Override
            public void onStop(String utteranceId, boolean interrupted) {
                emitJsEvent(utteranceId, "stop", "");
            }
        });
    }

    private void emitJsEvent(final String utteranceId, final String type, final String errorMsg) {
        if (webView == null) return;
        try {
            final String idJson = JSONObject.quote(utteranceId == null ? "" : utteranceId);
            final String typeJson = JSONObject.quote(type == null ? "" : type);
            final String errJson = JSONObject.quote(errorMsg == null ? "" : errorMsg);
            final String js = "window.__efectivaAndroidTtsEvent && window.__efectivaAndroidTtsEvent(" + idJson + "," + typeJson + "," + errJson + ");";
            webView.post(() -> {
                try { webView.evaluateJavascript(js, null); } catch (Exception ignored) {}
            });
        } catch (Exception ignored) {}
    }

    @JavascriptInterface
    public boolean isAvailable() {
        return true;
    }

    @JavascriptInterface
    public String getStatusJson() {
        JSONObject obj = new JSONObject();
        try {
            obj.put("ready", ready);
            obj.put("initStatus", initStatus);
            obj.put("selectedLang", selectedLang);
            obj.put("defaultEngine", tts != null ? String.valueOf(tts.getDefaultEngine()) : "");
            AudioManager am = (AudioManager) appContext.getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                obj.put("mediaVolume", am.getStreamVolume(AudioManager.STREAM_MUSIC));
                obj.put("mediaMaxVolume", am.getStreamMaxVolume(AudioManager.STREAM_MUSIC));
            }
        } catch (Exception ignored) {}
        return obj.toString();
    }

    @JavascriptInterface
    public void speak(final String text, final float rate, final String utteranceId) {
        final String clean = text == null ? "" : text.trim();
        if (clean.isEmpty()) {
            emitJsEvent(utteranceId, "done", "");
            return;
        }
        executor.execute(() -> {
            try {
                if (!ready) {
                    initLatch.await(3500, TimeUnit.MILLISECONDS);
                }
                if (!ready) {
                    initEngine();
                    initLatch.await(3000, TimeUnit.MILLISECONDS);
                }
                if (!ready || tts == null) {
                    emitJsEvent(utteranceId, "error", "Motor TTS Android no disponible (status=" + initStatus + ")");
                    return;
                }
                tts.stop();
                tts.setSpeechRate(Math.max(0.5f, Math.min(2.0f, rate <= 0 ? 1.0f : rate)));
                tts.setPitch(1.0f);

                Bundle params = new Bundle();
                params.putFloat(TextToSpeech.Engine.KEY_PARAM_VOLUME, 1.0f);
                params.putInt(TextToSpeech.Engine.KEY_PARAM_STREAM, AudioManager.STREAM_MUSIC);
                params.putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, utteranceId);

                int result = tts.speak(clean, TextToSpeech.QUEUE_FLUSH, params, utteranceId);
                if (result != TextToSpeech.SUCCESS) {
                    emitJsEvent(utteranceId, "error", "TextToSpeech.speak devolvió error (" + result + ")");
                }
            } catch (Exception ex) {
                emitJsEvent(utteranceId, "error", "Excepción TTS: " + ex.getLocalizedMessage());
            }
        });
    }

    @JavascriptInterface
    public void stop() {
        executor.execute(() -> {
            try {
                if (tts != null) tts.stop();
            } catch (Exception ignored) {}
        });
    }

    public void destroy() {
        try {
            if (tts != null) {
                tts.stop();
                tts.shutdown();
                tts = null;
            }
        } catch (Exception ignored) {}
        executor.shutdownNow();
    }
}
