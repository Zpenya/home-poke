package com.poker.sixplayers

import org.json.JSONObject

data class Card(val id: String, val rank: Int, val suit: Int, val deck: Int)

fun JSONObject.toCard(): Card =
    Card(getString("id"), getInt("rank"), getInt("suit"), getInt("deck"))

fun rankLabel(rank: Int): String = when {
    rank <= 10 -> rank.toString()
    rank == 11 -> "J"
    rank == 12 -> "Q"
    rank == 13 -> "K"
    rank == 14 -> "A"
    rank == 15 -> "2"
    rank == 16 -> "小王"
    else -> "大王"
}

fun suitSymbol(suit: Int): String = when (suit) {
    0 -> "♠"
    1 -> "♥"
    2 -> "♣"
    3 -> "♦"
    else -> ""
}

fun cardIsRed(card: Card): Boolean = card.suit == 1 || card.rank == 17
