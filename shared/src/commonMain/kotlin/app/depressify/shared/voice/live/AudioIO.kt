package app.depressify.shared.voice.live

/** The microphone and the speaker for a Check-in. Audio never touches disk (ADR 0006). */
interface AudioIO {
    /**
     * Starts the microphone and playback. [onFrame] gets 16 kHz mono 16-bit little-endian PCM in
     * short chunks, on an audio thread. False when the microphone is unavailable or not permitted;
     * the Check-in then continues typed.
     */
    fun start(onFrame: (ByteArray) -> Unit): Boolean

    /** Queues 24 kHz mono 16-bit little-endian PCM from the Companion. */
    fun play(pcm24k: ByteArray)

    /** Drops queued speech at once, when the Patient interrupts. */
    fun stopPlayback()

    fun stop()
}

/** The platform's audio: AudioRecord and AudioTrack on Android, AVAudioEngine on iOS. */
expect fun createAudioIO(): AudioIO
