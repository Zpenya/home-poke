package com.poker.sixplayers

import android.content.Intent
import android.os.Bundle
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class MainActivity : AppCompatActivity() {

    private lateinit var etName: EditText
    private lateinit var etServer: EditText
    private lateinit var etRoom: EditText
    private lateinit var tvMsg: TextView

    private val listener: (JSONObject) -> Unit = { m ->
        runOnUiThread {
            when (m.optString("type")) {
                "room_created", "room_joined" -> {
                    PokerConnection.mySeat = m.getInt("seat")
                    PokerConnection.token = m.getString("token")
                    PokerConnection.roomCode = m.optString("code")
                    getSharedPreferences("poker", MODE_PRIVATE).edit()
                        .putString("token", m.getString("token"))
                        .putString("room", m.optString("code"))
                        .putInt("seat", m.getInt("seat"))
                        .apply()
                    startActivity(Intent(this, RoomActivity::class.java))
                }
                "error" -> {
                    tvMsg.text = m.optString("message")
                }
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        etName = findViewById(R.id.etName)
        etServer = findViewById(R.id.etServer)
        etRoom = findViewById(R.id.etRoom)
        tvMsg = findViewById(R.id.tvMsg)

        val prefs = getSharedPreferences("poker", MODE_PRIVATE)
        etName.setText(prefs.getString("name", ""))
        etServer.setText(prefs.getString("server", ""))

        findViewById<Button>(R.id.btnCreate).setOnClickListener {
            connectThen {
                PokerConnection.send("create_room") {
                    put("name", etName.text.toString().ifBlank { "玩家" })
                }
            }
        }
        findViewById<Button>(R.id.btnJoin).setOnClickListener {
            val room = etRoom.text.toString().trim()
            if (room.length != 6) {
                Toast.makeText(this, "请输入 6 位房号", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            connectThen {
                PokerConnection.send("join_room") {
                    put("roomCode", room)
                    put("name", etName.text.toString().ifBlank { "玩家" })
                }
            }
        }
    }

    private fun connectThen(after: () -> Unit) {
        val server = etServer.text.toString().trim()
        if (server.isBlank()) {
            Toast.makeText(this, "请填写服务器地址", Toast.LENGTH_SHORT).show()
            return
        }
        tvMsg.text = "连接中…"
        getSharedPreferences("poker", MODE_PRIVATE).edit()
            .putString("name", etName.text.toString())
            .putString("server", server)
            .apply()

        if (PokerConnection.connected) {
            after()
        } else {
            PokerConnection.open(
                server,
                onOpen = { runOnUiThread { tvMsg.text = ""; after() } },
                onError = { e -> runOnUiThread { tvMsg.text = "连接失败：$e" } }
            )
        }
    }

    override fun onStart() {
        super.onStart()
        PokerConnection.on(listener)
    }

    override fun onStop() {
        super.onStop()
        PokerConnection.off(listener)
    }
}
