package app.depressify.shared.voice.live

import app.depressify.core.live.LiveEvent
import app.depressify.core.live.LiveProtocol
import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.http.encodeURLParameter
import io.ktor.websocket.Frame
import io.ktor.websocket.readBytes
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.launch

/** One Gemini Live connection. No SDK types above this interface, so a Check-in is tested with a fake. */
interface LiveClient {
    /**
     * Connects to [endpoint] with a short-lived [token], sends the setup for [model], then sends
     * every message from [outgoing] and passes each server event to [onEvent]. Returns when the
     * server closes the connection; throws when it cannot connect or the connection breaks.
     */
    suspend fun run(endpoint: String, token: String, model: String, outgoing: ReceiveChannel<String>, onEvent: suspend (LiveEvent) -> Unit)
}

/**
 * The raw WebSocket client in shared Kotlin (ADR 0002): one implementation for Android and iOS.
 * The messages are core's [LiveProtocol], written against the exchange recorded in the #6 spike.
 */
class KtorLiveClient(private val http: HttpClient = HttpClient { install(WebSockets) }) : LiveClient {
    override suspend fun run(endpoint: String, token: String, model: String, outgoing: ReceiveChannel<String>, onEvent: suspend (LiveEvent) -> Unit) {
        http.webSocket(endpoint + "?access_token=" + token.encodeURLParameter()) {
            send(Frame.Text(LiveProtocol.setupMessage(model)))
            val sender = launch { for (message in outgoing) send(Frame.Text(message)) }
            try {
                for (frame in incoming) {
                    // The server sends UTF-8 JSON in binary frames (spike results, section 1).
                    if (frame is Frame.Binary || frame is Frame.Text) LiveProtocol.parse(frame.readBytes()).forEach { onEvent(it) }
                }
            } finally {
                sender.cancel()
            }
        }
    }
}
