package app.depressify.shared.voice.live

import io.ktor.client.HttpClient
import io.ktor.client.plugins.websocket.WebSockets
import io.ktor.client.plugins.websocket.webSocket
import io.ktor.http.encodeURLParameter
import io.ktor.websocket.Frame
import io.ktor.websocket.readBytes
import io.ktor.websocket.readText
import kotlinx.coroutines.channels.ReceiveChannel
import kotlinx.coroutines.launch

/** One Gemini Live connection. No SDK types above this interface, so a Check-in is tested with a fake. */
interface LiveClient {
    /**
     * Connects with a short-lived [token], sends the setup for [model], then sends every message
     * from [outgoing] and passes each server event to [onEvent]. Returns when the server closes the
     * connection; throws when it cannot connect or the connection breaks.
     */
    suspend fun run(token: String, model: String, outgoing: ReceiveChannel<String>, onEvent: suspend (ServerEvent) -> Unit)
}

/** The raw WebSocket client in shared Kotlin (ADR 0002): one implementation for Android and iOS. */
class KtorLiveClient(private val http: HttpClient = HttpClient { install(WebSockets) }) : LiveClient {
    override suspend fun run(token: String, model: String, outgoing: ReceiveChannel<String>, onEvent: suspend (ServerEvent) -> Unit) {
        http.webSocket(LiveProtocol.URL + "?access_token=" + token.encodeURLParameter()) {
            send(Frame.Text(LiveProtocol.setup(model)))
            val sender = launch { for (message in outgoing) send(Frame.Text(message)) }
            try {
                for (frame in incoming) {
                    // The server sends JSON in either text or binary frames.
                    val message = when (frame) {
                        is Frame.Text -> frame.readText()
                        is Frame.Binary -> frame.readBytes().decodeToString()
                        else -> continue
                    }
                    LiveProtocol.parse(message).forEach { onEvent(it) }
                }
            } finally {
                sender.cancel()
            }
        }
    }
}
