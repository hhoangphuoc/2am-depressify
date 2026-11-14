package app.depressify.shared.voice.live

import app.depressify.shared.data.MusicClip

/** Plays one generated music clip from memory; the clip never touches disk (ADR 0006). */
interface ClipPlayer {
    /** Starts [clip] from the beginning, replacing anything playing. [onDone] runs when it ends. */
    fun play(clip: MusicClip, onDone: () -> Unit)

    fun stop()
}

/** MediaPlayer on Android, AVAudioPlayer on iOS. */
expect fun createClipPlayer(): ClipPlayer
