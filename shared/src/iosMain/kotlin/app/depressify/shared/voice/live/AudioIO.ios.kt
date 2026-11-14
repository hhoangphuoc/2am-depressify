package app.depressify.shared.voice.live

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.get
import kotlinx.cinterop.set
import platform.AVFAudio.AVAudioEngine
import platform.AVFAudio.AVAudioFormat
import platform.AVFAudio.AVAudioPCMBuffer
import platform.AVFAudio.AVAudioPCMFormatFloat32
import platform.AVFAudio.AVAudioPlayerNode
import platform.AVFAudio.AVAudioSession
import platform.AVFAudio.AVAudioSessionCategoryOptionDefaultToSpeaker
import platform.AVFAudio.AVAudioSessionCategoryPlayAndRecord
import platform.AVFAudio.AVAudioSessionModeVoiceChat
import platform.AVFAudio.setActive

actual fun createAudioIO(): AudioIO = IosAudioIO()

/**
 * AVAudioEngine with voice processing (echo cancelling) on the input, and a player node for the
 * Companion's 24 kHz speech. Built but not yet run on a device: see docs/implementation-status.md.
 */
@OptIn(ExperimentalForeignApi::class)
private class IosAudioIO : AudioIO {
    private var engine: AVAudioEngine? = null
    private var player: AVAudioPlayerNode? = null
    private val speechFormat = AVAudioFormat(commonFormat = AVAudioPCMFormatFloat32, sampleRate = 24_000.0, channels = 1u, interleaved = false)

    override fun start(onFrame: (ByteArray) -> Unit): Boolean {
        stop()
        val session = AVAudioSession.sharedInstance()
        session.setCategory(AVAudioSessionCategoryPlayAndRecord, mode = AVAudioSessionModeVoiceChat, options = AVAudioSessionCategoryOptionDefaultToSpeaker, error = null)
        session.setActive(true, error = null)

        val engine = AVAudioEngine()
        val player = AVAudioPlayerNode()
        val input = engine.inputNode
        input.setVoiceProcessingEnabled(true, error = null)
        engine.attachNode(player)
        engine.connect(player, engine.mainMixerNode, speechFormat)

        val micFormat = input.outputFormatForBus(0u)
        val step = micFormat.sampleRate / 16_000.0
        if (step < 1.0) return false
        input.installTapOnBus(0u, bufferSize = 2048u, format = micFormat) { buffer, _ ->
            val samples = buffer?.floatChannelData?.get(0) ?: return@installTapOnBus
            // Down to 16 kHz by taking the nearest sample; voice processing has already band-limited the input.
            val count = (buffer.frameLength.toInt() / step).toInt()
            val pcm = ByteArray(count * 2)
            for (i in 0 until count) {
                val value = (samples[(i * step).toInt()] * 32767f).toInt().coerceIn(-32768, 32767)
                pcm[i * 2] = value.toByte()
                pcm[i * 2 + 1] = (value shr 8).toByte()
            }
            if (count > 0) onFrame(pcm)
        }
        engine.prepare()
        if (!engine.startAndReturnError(null)) return false
        player.play()
        this.engine = engine
        this.player = player
        return true
    }

    override fun play(pcm24k: ByteArray) {
        val player = player ?: return
        val frames = pcm24k.size / 2
        if (frames == 0) return
        val buffer = AVAudioPCMBuffer(pCMFormat = speechFormat, frameCapacity = frames.toUInt())
        buffer.frameLength = frames.toUInt()
        val samples = buffer.floatChannelData?.get(0) ?: return
        for (i in 0 until frames) {
            val value = (pcm24k[i * 2].toInt() and 0xFF) or (pcm24k[i * 2 + 1].toInt() shl 8)
            samples[i] = value / 32768f
        }
        player.scheduleBuffer(buffer, completionHandler = null)
    }

    override fun stopPlayback() {
        player?.let { it.stop(); it.play() }
    }

    override fun stop() {
        engine?.let { it.inputNode.removeTapOnBus(0u); it.stop() }
        engine = null
        player = null
    }
}
