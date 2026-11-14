package app.depressify.shared.voice.live

import android.media.AudioAttributes
import android.media.MediaDataSource
import android.media.MediaPlayer
import app.depressify.shared.data.MusicClip

actual fun createClipPlayer(): ClipPlayer = AndroidClipPlayer()

private class AndroidClipPlayer : ClipPlayer {
    private var player: MediaPlayer? = null

    override fun play(clip: MusicClip, onDone: () -> Unit) {
        stop()
        player = MediaPlayer().apply {
            setAudioAttributes(AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_MEDIA).setContentType(AudioAttributes.CONTENT_TYPE_MUSIC).build())
            setDataSource(BytesSource(clip.bytes))
            setOnPreparedListener { it.start() }
            setOnCompletionListener { onDone() }
            setOnErrorListener { _, _, _ -> onDone(); true }
            prepareAsync()
        }
    }

    override fun stop() {
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
