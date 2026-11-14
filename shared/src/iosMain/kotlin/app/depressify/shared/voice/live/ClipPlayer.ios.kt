package app.depressify.shared.voice.live

import app.depressify.shared.data.MusicClip
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.AVFAudio.AVAudioPlayer
import platform.AVFAudio.AVAudioPlayerDelegateProtocol
import platform.Foundation.NSError
import platform.darwin.NSObject
import platform.Foundation.NSData
import platform.Foundation.create

actual fun createClipPlayer(): ClipPlayer = IosClipPlayer()

@OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
private class IosClipPlayer : ClipPlayer {
    private var player: AVAudioPlayer? = null
    private var done: (() -> Unit)? = null
    private var failed: (() -> Unit)? = null
    private val delegate = object : NSObject(), AVAudioPlayerDelegateProtocol {
        override fun audioPlayerDidFinishPlaying(player: AVAudioPlayer, successfully: Boolean) {
            if (successfully) done?.invoke() else failed?.invoke()
        }
        override fun audioPlayerDecodeErrorDidOccur(player: AVAudioPlayer, error: NSError?) { failed?.invoke() }
    }
    override val positionMillis: Int get() = ((player?.currentTime ?: 0.0) * 1000).toInt()
    override val durationMillis: Int get() = ((player?.duration ?: 0.0) * 1000).toInt()

    override fun play(clip: MusicClip, onReady: () -> Unit, onDone: () -> Unit, onError: () -> Unit) {
        stop()
        if (clip.bytes.isEmpty()) { onError(); return }
        done = onDone
        failed = onError
        val data = clip.bytes.usePinned { NSData.create(bytes = it.addressOf(0), length = clip.bytes.size.toULong()) }
        player = AVAudioPlayer(data = data, error = null).also { it.delegate = delegate }
        if (player?.play() == true) onReady() else { stop(); onError() }
    }

    override fun pause() { player?.pause() }
    override fun resume() { player?.play() }
    override fun seekTo(positionMillis: Int) { player?.currentTime = positionMillis / 1000.0 }

    override fun stop() {
        player?.stop()
        player = null
        done = null
        failed = null
    }
}
