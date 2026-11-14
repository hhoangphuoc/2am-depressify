package app.depressify.shared.voice.live

import app.depressify.shared.data.MusicClip

/** Plays one generated music clip from memory; the clip never touches disk (ADR 0006). */
interface ClipPlayer {
    val positionMillis: Int
    val durationMillis: Int

    /** Starts from the beginning. Callbacks distinguish preparation, completion and playback errors. */
    fun play(clip: MusicClip, onReady: () -> Unit, onDone: () -> Unit, onError: () -> Unit)

    fun pause()
    fun resume()
    fun seekTo(positionMillis: Int)

    fun stop()
}

/** MediaPlayer on Android, AVAudioPlayer on iOS. */
expect fun createClipPlayer(): ClipPlayer
