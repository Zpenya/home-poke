package com.poker.sixplayers

import android.util.Log
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

object PokerConnection {
    private const val TAG = "PokerConn"

    private val client = OkHttpClient.Builder()
        .pingInterval(20, TimeUnit.SECONDS)
        .connectTimeout(10, TimeUnit.SECONDS)
        .build()

    private var ws: WebSocket? = null
    val listeners = CopyOnWriteArrayList<(JSONObject) -> Unit>()

    var connected = false
        private set
    var mySeat = -1
    var roomCode: String? = null
    var token: String? = null
    var hostSeat = -1

    fun open(
        server: String,
        onOpen: () -> Unit,
        onError: (String) -> Unit
    ) {
        val url = if (server.startsWith("ws")) server else "ws://$server"
        val request = Request.Builder().url(url).build()
        ws = client.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                connected = true
                onOpen()
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val m = JSONObject(text)
                    listeners.forEach { it(m) }
                } catch (e: Exception) {
                    Log.e(TAG, "消息解析失败", e)
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                connected = false
                onError(t.message ?: "连接失败")
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                connected = false
            }
        })
    }

    fun send(msg: JSONObject) {
        ws?.send(msg.toString())
    }

    fun send(type: String, block: JSONObject.() -> Unit = {}) {
        val m = JSONObject()
        m.put("type", type)
        m.block()
        send(m)
    }

    fun on(listener: (JSONObject) -> Unit) {
        listeners.add(listener)
    }

    fun off(listener: (JSONObject) -> Unit) {
        listeners.remove(listener)
    }

    fun close() {
        ws?.close(1000, null)
        ws = null
        connected = false
    }
}
