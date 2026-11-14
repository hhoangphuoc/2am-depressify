package app.depressify.shared.voice.live

import app.depressify.shared.data.MusicClip
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch

enum class PlaybackStatus { Idle, Preparing, Playing, Paused, Failed }

data class MusicPlaybackState(
    val clip: MusicClip? = null,
    val status: PlaybackStatus = PlaybackStatus.Idle,
    val positionMillis: Int = 0,
    val durationMillis: Int = 0,
)

/** One player per Check-in, shared by typing and voice. Restores the microphone's prior state. */
class MusicPlayback(
    private val player: ClipPlayer,
    private val scope: CoroutineScope,
    private val isMuted: () -> Boolean,
    private val mute: (Boolean) -> Unit,
    private val interrupt: () -> Unit,
    private val pauseCompanionAudio: (Boolean) -> Unit = {},
) {
    private val state = MutableStateFlow(MusicPlaybackState())
    val snapshot = state.asStateFlow()
    private var progress: Job? = null
    private var previousMute: Boolean? = null
    private var listeningMute: Boolean? = null
    private var generation = 0

    fun enterListening() {
        if (listeningMute != null) return
        listeningMute = previousMute ?: isMuted()
        interrupt()
        mute(true)
        pauseCompanionAudio(true)
    }

    fun leaveListening() {
        pause()
        listeningMute?.let { mute(it); pauseCompanionAudio(false) }
        listeningMute = null
    }

    fun onBackground() {
        pause()
        // Returning from a listening screen must preserve the explicit background mute.
        if (listeningMute != null) listeningMute = true
        mute(true)
    }

    fun skipBy(millis: Int) {
        val current = state.value
        if (current.status !in listOf(PlaybackStatus.Playing, PlaybackStatus.Paused) || current.durationMillis <= 0) return
        val target = (current.positionMillis.toLong() + millis).coerceIn(0, (current.durationMillis - 1).toLong()).toInt()
        runCatching { player.seekTo(target) }
            .onSuccess { state.value = current.copy(positionMillis = target) }
            .onFailure { fail() }
    }

    fun toggle(clip: MusicClip) {
        if (state.value.clip === clip && state.value.status == PlaybackStatus.Playing) { pause(); return }
        if (state.value.status == PlaybackStatus.Preparing) { stop(); return }
        val resume = state.value.clip === clip && state.value.status == PlaybackStatus.Paused
        if (!resume) stop()
        previousMute = isMuted()
        interrupt()
        mute(true)
        pauseCompanionAudio(true)
        if (resume) {
            runCatching { player.resume() }.onSuccess { playing() }.onFailure { fail() }
        } else {
            val request = ++generation
            state.value = MusicPlaybackState(clip = clip, status = PlaybackStatus.Preparing)
            player.play(clip,
                onReady = { if (request == generation) playing() },
                onDone = { if (request == generation) stop() },
                onError = { if (request == generation) fail() },
            )
        }
    }

    private fun playing() {
        state.value = state.value.copy(status = PlaybackStatus.Playing, durationMillis = player.durationMillis)
        progress?.cancel()
        progress = scope.launch {
            while (true) {
                state.value = state.value.copy(positionMillis = player.positionMillis)
                delay(250)
            }
        }
    }

    fun pause() {
        if (state.value.status == PlaybackStatus.Preparing) { stop(); return }
        if (state.value.status != PlaybackStatus.Playing) return
        runCatching { player.pause() }.onFailure { fail(); return }
        progress?.cancel()
        state.value = state.value.copy(status = PlaybackStatus.Paused, positionMillis = player.positionMillis)
        restoreMic()
    }

    fun stop() {
        generation++
        progress?.cancel()
        player.stop()
        restoreMic()
        state.value = MusicPlaybackState()
    }

    private fun fail() {
        val clip = state.value.clip
        stop()
        state.value = MusicPlaybackState(clip = clip, status = PlaybackStatus.Failed)
    }

    private fun restoreMic() { previousMute?.let { mute(if (listeningMute != null) true else it); pauseCompanionAudio(listeningMute != null) }; previousMute = null }
}
