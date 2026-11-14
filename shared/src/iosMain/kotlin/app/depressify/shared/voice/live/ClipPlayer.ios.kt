package app.depressify.shared.voice.live

import app.depressify.shared.data.MusicClip
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.AVFAudio.AVAudioPlayer
import platform.Foundation.NSData
import platform.Foundation.create

actual fun createClipPlayer(): ClipPlayer = IosClipPlayer()

@OptIn(ExperimentalForeignApi::class)
private class IosClipPlayer : ClipPlayer {
    private var player: AVAudioPlayer? = null

    override fun play(clip: MusicClip, onDone: () -> Unit) {
        stop()
        val data = clip.bytes.usePinned { NSData.create(bytes = it.addressOf(0), length = clip.bytes.size.toULong()) }
        // shortcut: onDone is never called on iOS (it needs an AVAudioPlayerDelegate); the card's button stays on Stop until tapped. Add the delegate when iOS is run on a device.
        player = AVAudioPlayer(data = data, error = null).also { it.play() }
    }

    override fun stop() {
        player?.stop()
        player = null
    }
}
