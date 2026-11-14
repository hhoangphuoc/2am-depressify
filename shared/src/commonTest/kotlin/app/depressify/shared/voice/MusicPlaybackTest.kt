package app.depressify.shared.voice

import app.depressify.shared.data.MusicClip
import app.depressify.shared.voice.live.*
import kotlinx.coroutines.test.runTest
import kotlin.test.*

class MusicPlaybackTest {
    private val clip = MusicClip("audio/mpeg", byteArrayOf(1))

    @Test
    fun playingPausesTheMicAndPauseResumesThePreviousConversationState() = runTest {
        val player = Player()
        var muted = false
        var interrupted = false
        var companionAudioPaused = false
        val playback = MusicPlayback(player, backgroundScope, { muted }, { muted = it }, { interrupted = true }, { companionAudioPaused = it })

        playback.toggle(clip)
        assertTrue(muted)
        assertTrue(interrupted)
        assertTrue(companionAudioPaused)
        assertEquals(PlaybackStatus.Preparing, playback.snapshot.value.status)
        player.ready()
        assertEquals(60_000, playback.snapshot.value.durationMillis)
        assertEquals(PlaybackStatus.Playing, playback.snapshot.value.status)

        player.positionMillis = 4500
        playback.pause()
        assertFalse(muted)
        assertFalse(companionAudioPaused)
        assertEquals(4500, playback.snapshot.value.positionMillis)
        playback.toggle(clip)
        assertTrue(muted)
        assertEquals(1, player.starts)
        assertEquals(1, player.resumes)
        player.done()
        assertFalse(muted)
        assertEquals(PlaybackStatus.Idle, playback.snapshot.value.status)
    }

    @Test
    fun aTypedOrAlreadyMutedSessionStaysMutedAfterMusic() = runTest {
        val player = Player()
        var muted = true
        val playback = MusicPlayback(player, backgroundScope, { muted }, { muted = it }, {})
        playback.toggle(clip)
        player.ready()
        player.done()
        assertTrue(muted)
    }

    @Test
    fun anAudioErrorRestoresTheMicAndAllowsRetry() = runTest {
        val player = Player()
        var muted = false
        val playback = MusicPlayback(player, backgroundScope, { muted }, { muted = it }, {})
        playback.toggle(clip)
        player.error()
        assertFalse(muted)
        assertEquals(PlaybackStatus.Failed, playback.snapshot.value.status)
        playback.toggle(clip)
        player.ready()
        assertEquals(2, player.starts)
        assertEquals(PlaybackStatus.Playing, playback.snapshot.value.status)
        playback.stop()
    }

    @Test
    fun listeningViewWaitsWithoutAutoplayAndRestoresThePreviousMicOnReturn() = runTest {
        for (initialMute in listOf(false, true)) {
            val player = Player()
            var muted = initialMute
            var audioPaused = false
            val playback = MusicPlayback(player, backgroundScope, { muted }, { muted = it }, {}, { audioPaused = it })
            playback.enterListening()
            playback.enterListening()
            assertTrue(muted)
            assertTrue(audioPaused)
            assertEquals(0, player.starts)
            playback.leaveListening()
            assertEquals(initialMute, muted)
            assertFalse(audioPaused)

            playback.enterListening()
            playback.toggle(clip)
            player.ready()
            player.positionMillis = 12_000
            playback.pause()
            assertTrue(muted)
            assertTrue(audioPaused)
            playback.leaveListening()
            assertEquals(initialMute, muted)
            assertEquals(12_000, playback.snapshot.value.positionMillis)
            assertEquals(PlaybackStatus.Paused, playback.snapshot.value.status)
            playback.enterListening()
            playback.toggle(clip)
            assertEquals(1, player.resumes)
            player.done()
            assertTrue(muted)
            assertTrue(audioPaused)
            playback.leaveListening()
            assertEquals(initialMute, muted)
        }
    }

    @Test
    fun backgroundingPreventsBackFromRestoringAStaleUnmutedState() = runTest {
        for (startPlaying in listOf(false, true)) {
            val player = Player()
            var muted = false
            val playback = MusicPlayback(player, backgroundScope, { muted }, { muted = it }, {})
            playback.enterListening()
            if (startPlaying) { playback.toggle(clip); player.ready() }
            playback.onBackground()
            assertTrue(muted)
            playback.leaveListening()
            assertTrue(muted)
            assertNotEquals(PlaybackStatus.Playing, playback.snapshot.value.status)
        }
    }

    @Test
    fun lateCallbacksCannotRestartACancelledPlayerOrMuteTheConversation() = runTest {
        val player = Player()
        var muted = false
        val playback = MusicPlayback(player, backgroundScope, { muted }, { muted = it }, {})
        playback.toggle(clip)
        playback.stop()
        player.ready()
        player.error()
        assertFalse(muted)
        assertEquals(PlaybackStatus.Idle, playback.snapshot.value.status)
    }

    private class Player : ClipPlayer {
        override var positionMillis = 0
        override val durationMillis = 60_000
        var starts = 0
        var resumes = 0
        var ready: () -> Unit = {}
        var done: () -> Unit = {}
        var error: () -> Unit = {}
        override fun play(clip: MusicClip, onReady: () -> Unit, onDone: () -> Unit, onError: () -> Unit) {
            starts++; ready = onReady; done = onDone; error = onError
        }
        override fun pause() = Unit
        override fun resume() { resumes++ }
        override fun stop() = Unit
    }
}
