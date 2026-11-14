package app.depressify.shared.voice.live

import android.annotation.SuppressLint
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioRecord
import android.media.AudioTrack
import android.media.MediaRecorder
import android.media.audiofx.AcousticEchoCanceler
import java.util.concurrent.LinkedBlockingQueue
import kotlin.concurrent.thread

actual fun createAudioIO(): AudioIO = AndroidAudioIO()

/**
 * AudioRecord at 16 kHz with the voice-communication source (echo cancelling where the phone has
 * it) and a streaming AudioTrack at 24 kHz. Needs RECORD_AUDIO; without it [start] returns false.
 */
private class AndroidAudioIO : AudioIO {
    @Volatile private var running = false
    private var record: AudioRecord? = null
    private var track: AudioTrack? = null
    private val speech = LinkedBlockingQueue<ByteArray>()

    @SuppressLint("MissingPermission") // Checked by the result: an AudioRecord without permission fails to initialise.
    override fun start(onFrame: (ByteArray) -> Unit): Boolean {
        stop()
        running = true
        val out = AudioTrack.Builder()
            .setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_VOICE_COMMUNICATION).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build())
            .setAudioFormat(AudioFormat.Builder().setSampleRate(24_000).setEncoding(AudioFormat.ENCODING_PCM_16BIT).setChannelMask(AudioFormat.CHANNEL_OUT_MONO).build())
            .setBufferSizeInBytes(AudioTrack.getMinBufferSize(24_000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT) * 2)
            .setTransferMode(AudioTrack.MODE_STREAM)
            .build()
        track = out
        out.play()
        thread(name = "companion-speech") {
            while (running) speech.poll(100, java.util.concurrent.TimeUnit.MILLISECONDS)?.let { out.write(it, 0, it.size) }
        }

        val minBuffer = AudioRecord.getMinBufferSize(16_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
        val mic = try {
            AudioRecord(MediaRecorder.AudioSource.VOICE_COMMUNICATION, 16_000, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT, maxOf(minBuffer, FRAME_BYTES * 4))
        } catch (e: Exception) {
            return false
        }
        if (mic.state != AudioRecord.STATE_INITIALIZED) { mic.release(); return false }
        if (AcousticEchoCanceler.isAvailable()) AcousticEchoCanceler.create(mic.audioSessionId)?.enabled = true
        record = mic
        mic.startRecording()
        thread(name = "patient-microphone") {
            val buffer = ByteArray(FRAME_BYTES)
            while (running) {
                val read = mic.read(buffer, 0, buffer.size)
                if (read > 0) onFrame(buffer.copyOf(read)) else if (read < 0) break
            }
        }
        return true
    }

    override fun play(pcm24k: ByteArray) { if (running) speech.put(pcm24k) }

    override fun stopPlayback() {
        speech.clear()
        track?.let { it.pause(); it.flush(); it.play() }
    }

    override fun stop() {
        running = false
        speech.clear()
        record?.let { runCatching { it.stop() }; it.release() }
        track?.let { runCatching { it.stop() }; it.release() }
        record = null
        track = null
    }

    private companion object {
        /** 40 ms of 16 kHz 16-bit mono: Google asks for 20 to 40 ms chunks. */
        const val FRAME_BYTES = 1280
    }
}
