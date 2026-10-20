// SPDX-License-Identifier: AGPL-3.0-or-later
// Copyright (C) 2026 FunnyCups (https://github.com/funnycups)

package com.luker.app

/**
 * Scripted [CdpChannel] for capture tests: `sendText` records what the code
 * under test sent, `readMessage` replays a fixed list of server messages.
 */
internal class FakeChannel(private val scripted: List<String>) : CdpChannel {
    val sent = mutableListOf<String>()
    private var index = 0
    override fun sendText(text: String) { sent.add(text) }
    override fun readMessage(): String = scripted[index++]
}
