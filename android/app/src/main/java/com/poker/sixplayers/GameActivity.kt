package com.poker.sixplayers

import android.graphics.Color
import android.os.Bundle
import android.view.Gravity
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONArray
import org.json.JSONObject

class GameActivity : AppCompatActivity() {

    private data class PInfo(
        var name: String = "",
        var cardCount: Int = 0,
        var online: Boolean = true,
        var isBot: Boolean = false,
        var rank: Int = 0
    )

    private lateinit var playersRow: LinearLayout
    private lateinit var tableRow: LinearLayout
    private lateinit var handRow: LinearLayout
    private lateinit var tvStatus: TextView
    private lateinit var tvLog: TextView
    private lateinit var btnPlay: Button
    private lateinit var btnPass: Button
    private lateinit var btnHint: Button

    private var hand = mutableListOf<Card>()
    private val pinfos = Array(6) { PInfo() }
    private var currentTurn = -1
    private var free = false
    private var tableCards = listOf<Card>()
    private var tableSeat = -1
    private val selected = mutableSetOf<String>()
    private var hintCandidates = listOf<List<String>>()
    private var hintIndex = 0
    private var gameState = ""
    private val logLines = ArrayDeque<String>()

    private fun dp(v: Int): Int = (v * resources.displayMetrics.density).toInt()

    private fun parseCards(arr: JSONArray): List<Card> =
        (0 until arr.length()).map { arr.getJSONObject(it).toCard() }

    // ---------- 牌 View ----------
    private fun makeCardView(card: Card, w: Int, h: Int, clickable: Boolean): TextView {
        val tv = TextView(this)
        val label = rankLabel(card.rank)
        tv.text = if (card.suit == 4) label else "$label\n${suitSymbol(card.suit)}"
        tv.gravity = Gravity.CENTER
        tv.textSize = 13f
        tv.setTextColor(if (cardIsRed(card)) Color.RED else Color.BLACK)
        val lp = LinearLayout.LayoutParams(w, h)
        lp.marginEnd = dp(-18)
        tv.layoutParams = lp
        tv.setBackgroundResource(if (card.id in selected) R.drawable.card_sel else R.drawable.card_bg)
        if (card.id in selected) tv.translationY = dp(14).toFloat()
        if (clickable) {
            tv.setOnClickListener {
                if (card.id in selected) selected.remove(card.id) else selected.add(card.id)
                renderHand()
            }
        }
        return tv
    }

    // ---------- 渲染 ----------
    private fun renderHand() {
        handRow.removeAllViews()
        hand.sortedWith(compareBy({ it.rank }, { it.suit }, { it.deck })).forEach { c ->
            handRow.addView(makeCardView(c, dp(50), dp(74), true))
        }
    }

    private fun renderPlayers() {
        playersRow.removeAllViews()
        for (s in 0..5) {
            val p = pinfos[s]
            val tv = TextView(this)
            val me = s == PokerConnection.mySeat
            val stateTxt = when {
                p.rank > 0 -> "第${p.rank}名"
                else -> "${p.cardCount}张"
            }
            tv.text = "${if (me) "【我】" else ""}${p.name}\n$stateTxt"
            tv.textSize = 12f
            tv.gravity = Gravity.CENTER
            tv.setPadding(dp(10), dp(8), dp(10), dp(8))
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.WRAP_CONTENT,
                LinearLayout.LayoutParams.WRAP_CONTENT
            )
            lp.marginEnd = dp(6)
            tv.layoutParams = lp
            tv.setBackgroundResource(if (currentTurn == s) R.drawable.chip_turn else R.drawable.chip_bg)
            if (!p.online && !p.isBot) tv.alpha = 0.5f
            playersRow.addView(tv)
        }
    }

    private fun renderTable() {
        tableRow.removeAllViews()
        if (tableCards.isEmpty()) return
        tableCards.forEach { tableRow.addView(makeCardView(it, dp(40), dp(58), false)) }
        val name = if (tableSeat >= 0) pinfos[tableSeat].name else ""
        tvStatus.text = "$name 出牌（${tableCards.size} 张）"
    }

    private fun updateButtons() {
        val myTurn = currentTurn == PokerConnection.mySeat && gameState == "playing"
        btnPlay.isEnabled = myTurn
        btnPass.isEnabled = myTurn && !free
        btnHint.isEnabled = myTurn
    }

    private fun addLog(s: String) {
        logLines.addLast(s)
        if (logLines.size > 30) logLines.removeFirst()
        tvLog.text = logLines.joinToString("\n")
    }

    // ---------- 弹窗 ----------
    private fun pickDialog(title: String, cards: List<Card>, onPick: (Card) -> Unit) {
        val items = cards.map {
            rankLabel(it.rank) + if (it.suit == 4) "" else suitSymbol(it.suit)
        }.toTypedArray()
        AlertDialog.Builder(this)
            .setTitle(title)
            .setCancelable(false)
            .setItems(items) { _, w -> onPick(cards[w]) }
            .show()
    }

    private fun showRoundOver(m: JSONObject) {
        val ranking = m.getJSONArray("ranking")
        val sb = StringBuilder()
        for (i in 0 until ranking.length()) {
            val seat = ranking.getInt(i)
            sb.append("第${i + 1}名：${pinfos[seat].name}\n")
        }
        val isHost = PokerConnection.mySeat == PokerConnection.hostSeat
        val d = AlertDialog.Builder(this)
            .setTitle("本局结束")
            .setMessage(sb.toString())
            .setCancelable(false)
        if (isHost) {
            d.setPositiveButton("开始下一局") { _, _ -> PokerConnection.send("next_round") }
        } else {
            d.setPositiveButton("等待房主…", null)
        }
        d.show()
    }

    // ---------- 消息 ----------
    private val listener: (JSONObject) -> Unit = { m ->
        runOnUiThread { handle(m) }
    }

    private fun setHand(arr: JSONArray) {
        hand = parseCards(arr).toMutableList()
        renderHand()
    }

    private fun handle(m: JSONObject) {
        when (m.optString("type")) {
            "deal", "hand_update" -> {
                setHand(m.getJSONArray("hand"))
                renderPlayers()
            }
            "room_state" -> {
                val arr = m.getJSONArray("players")
                for (i in 0 until arr.length()) {
                    val p = arr.getJSONObject(i)
                    pinfos[i].apply {
                        name = if (p.isNull("name")) "" else p.optString("name")
                        isBot = p.optBoolean("isBot")
                        online = p.optBoolean("online")
                        cardCount = p.optInt("cardCount")
                        rank = p.optInt("rank")
                    }
                }
                renderPlayers()
            }
            "state" -> restoreSnapshot(m)
            "turn" -> {
                currentTurn = m.getInt("seat")
                free = m.optBoolean("free")
                if (free) {
                    tableCards = listOf()
                    tableSeat = -1
                    tvStatus.text = "轮到你自由出牌"
                    renderTable()
                }
                renderPlayers()
                updateButtons()
            }
            "played" -> {
                val seat = m.getInt("seat")
                val cards = parseCards(m.getJSONArray("cards"))
                tableCards = cards
                tableSeat = seat
                pinfos[seat].cardCount -= cards.size
                if (seat == PokerConnection.mySeat) {
                    val ids = cards.map { it.id }.toSet()
                    hand.removeAll { it.id in ids }
                    renderHand()
                }
                renderTable()
                renderPlayers()
            }
            "passed" -> {
                val seat = m.getInt("seat")
                addLog("${pinfos[seat].name} 不要")
            }
            "player_finished" -> {
                val seat = m.getInt("seat")
                pinfos[seat].rank = m.getInt("rank")
                pinfos[seat].cardCount = 0
                addLog("${pinfos[seat].name} 第${m.getInt("rank")}名")
                renderPlayers()
            }
            "tribute_announce" -> addLog("进入进贡环节")
            "tribute_required" -> {
                val maxR = m.getInt("maxRank")
                val choices = hand.filter { it.rank == maxR }
                pickDialog("请进贡你最大的牌", choices) { c ->
                    PokerConnection.send("tribute") { put("cardId", c.id) }
                }
            }
            "tribute_paid" -> addLog("${pinfos[m.getInt("fromSeat")].name} 进贡 ${rankLabel(m.getInt("rank"))}")
            "return_tribute_required" -> {
                val forbidden = m.getString("forbiddenId")
                val choices = hand.filter { it.id != forbidden }
                pickDialog("请选择回贡牌（不能回刚收到的牌）", choices) { c ->
                    PokerConnection.send("return_tribute") { put("cardId", c.id) }
                }
            }
            "return_tribute_paid" -> addLog("${pinfos[m.getInt("fromSeat")].name} 回贡 ${rankLabel(m.getInt("rank"))}")
            "resistance" -> addLog("${pinfos[m.getInt("seat")].name} 两张大王，抗贡")
            "round_over" -> {
                gameState = "round_over"
                val fr = m.getJSONArray("finishRanks")
                for (s in 0..5) pinfos[s].rank = fr.getInt(s)
                renderPlayers()
                showRoundOver(m)
            }
            "hint_result" -> {
                val arr = m.getJSONArray("candidates")
                hintCandidates = (0 until arr.length()).map { gi ->
                    val inner = arr.getJSONArray(gi)
                    (0 until inner.length()).map { inner.getString(it) }
                }
                if (hintCandidates.isNotEmpty()) {
                    val g = hintCandidates[hintIndex % hintCandidates.size]
                    hintIndex += 1
                    selected.clear()
                    selected.addAll(g)
                    renderHand()
                } else {
                    Toast.makeText(this, "没有能压过的牌", Toast.LENGTH_SHORT).show()
                }
            }
            "error" -> Toast.makeText(this, m.optString("message"), Toast.LENGTH_SHORT).show()
        }
    }

    private fun restoreSnapshot(m: JSONObject) {
        gameState = m.optString("state")
        currentTurn = m.optInt("currentTurn", -1)
        val arr = m.getJSONArray("players")
        for (i in 0 until arr.length()) {
            val p = arr.getJSONObject(i)
            pinfos[i].apply {
                name = if (p.isNull("name")) "" else p.optString("name")
                isBot = p.optBoolean("isBot")
                online = p.optBoolean("online")
                cardCount = p.optInt("cardCount")
                rank = p.optInt("rank")
            }
        }
        val table = m.optJSONObject("table")
        if (table != null) {
            tableCards = parseCards(table.getJSONArray("cards"))
            tableSeat = table.getInt("seat")
            free = false
        } else {
            tableCards = listOf()
            tableSeat = -1
            free = true
        }
        setHand(m.getJSONArray("hand"))
        renderTable()
        renderPlayers()
        updateButtons()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_game)
        playersRow = findViewById(R.id.playersRow)
        tableRow = findViewById(R.id.tableRow)
        handRow = findViewById(R.id.handRow)
        tvStatus = findViewById(R.id.tvStatus)
        tvLog = findViewById(R.id.tvLog)
        btnPlay = findViewById(R.id.btnPlay)
        btnPass = findViewById(R.id.btnPass)
        btnHint = findViewById(R.id.btnHint)

        btnPlay.setOnClickListener {
            if (selected.isEmpty()) {
                Toast.makeText(this, "请选择要出的牌", Toast.LENGTH_SHORT).show()
                return@setOnClickListener
            }
            PokerConnection.send("play") { put("cardIds", JSONArray(ArrayList(selected))) }
            selected.clear()
        }
        btnPass.setOnClickListener {
            PokerConnection.send("pass")
            selected.clear()
        }
        btnHint.setOnClickListener {
            hintIndex = 0
            PokerConnection.send("hint")
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
