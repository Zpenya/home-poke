package com.poker.sixplayers

import android.content.Intent
import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

class RoomActivity : AppCompatActivity() {

    private lateinit var tvTitle: TextView
    private lateinit var seatsBox: LinearLayout
    private lateinit var btnStart: Button
    private var entered = false

    private val listener: (JSONObject) -> Unit = { m ->
        runOnUiThread {
            when (m.optString("type")) {
                "room_state" -> render(m)
                "deal", "game_start", "state" -> enterGame()
                "error" -> Toast.makeText(this, m.optString("message"), Toast.LENGTH_SHORT).show()
            }
        }
    }

    private fun enterGame() {
        if (entered) return
        entered = true
        startActivity(Intent(this, GameActivity::class.java))
        finish()
    }

    private fun render(m: JSONObject) {
        val code = m.optString("code")
        tvTitle.text = "房间 $code"
        PokerConnection.hostSeat = m.optInt("hostSeat", -1)
        seatsBox.removeAllViews()
        val players = m.getJSONArray("players")
        for (i in 0 until players.length()) {
            val p = players.getJSONObject(i)
            val tv = TextView(this)
            val name = if (p.isNull("name")) "（空位）" else p.optString("name")
            val bot = p.optBoolean("isBot")
            tv.text = "座位 ${p.getInt("seat") + 1}：$name${if (bot) "（机器人）" else ""}"
            tv.textSize = 17f
            tv.setPadding(12, 16, 12, 16)
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            lp.bottomMargin = 10
            tv.layoutParams = lp
            tv.setBackgroundResource(R.drawable.chip_bg)
            if (p.isNull("name")) tv.setTextColor(Color.GRAY)
            seatsBox.addView(tv)
        }
        btnStart.visibility =
            if (PokerConnection.hostSeat == PokerConnection.mySeat) Button.VISIBLE else Button.GONE
        btnStart.gravity = Gravity.CENTER
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_room)
        tvTitle = findViewById(R.id.tvTitle)
        seatsBox = findViewById(R.id.seatsBox)
        btnStart = findViewById(R.id.btnStart)
        btnStart.setOnClickListener { PokerConnection.send("start_game") }
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
