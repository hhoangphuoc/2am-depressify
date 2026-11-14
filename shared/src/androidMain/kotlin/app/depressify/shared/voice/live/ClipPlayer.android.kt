package app.depressify.shared.voice.live

import android.media.AudioAttributes
import android.media.MediaDataSource
import android.media.MediaPlayer
import app.depressify.shared.data.MusicClip

actual fun createClipPlayer(): ClipPlayer = AndroidClipPlayer()

private class AndroidClipPlayer : ClipPlayer {
    private var player: MediaPlayer? = null
    private var prepared = false
    override val positionMillis: Int get() = if (prepared) runCatching { player?.currentPosition ?: 0 }.getOrDefault(0) else 0
    override val durationMillis: Int get() = if (prepared) runCatching { player?.duration ?: 0 }.getOrDefault(0) else 0

    override fun play(clip: MusicClip, onReady: () -> Unit, onDone: () -> Unit, onError: () -> Unit) {
        stop()
        runCatching {
            player = MediaPlayer().also { media ->
                media.apply {
                    setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
                    setDataSource(BytesSource(clip.bytes))
                    setOnPreparedListener {
                        runCatching { prepared = true; it.start(); onReady() }.onFailure { stop(); onError() }
                    }
                    setOnCompletionListener { onDone() }
                    setOnErrorListener { _, _, _ -> stop(); onError(); true }
                    prepareAsync()
                }
            }
        }.onFailure { stop(); onError() }
    }

    override fun pause() { if (prepared) player?.pause() }
    override fun resume() { if (prepared) player?.start() }

    override fun stop() {
        prepared = false
        player?.release()
        player = null
    }
}

/** The clip's bytes as a MediaPlayer source, read straight from memory. */
private class BytesSource(private val bytes: ByteArray) : MediaDataSource() {
    override fun readAt(position: Long, buffer: ByteArray, offset: Int, size: Int): Int {
        if (position >= bytes.size) return -1
        val count = minOf(size, bytes.size - position.toInt())
        System.arraycopy(bytes, position.toInt(), buffer, offset, count)
        return count
    }

    override fun getSize(): Long = bytes.size.toLong()

    override fun close() = Unit
}
