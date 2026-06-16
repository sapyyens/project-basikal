# Prompt Pengerjaan — Per Fase (v2)

Jalankan satu prompt per sesi Claude terpisah. Tiap prompt sudah memuat **guard anti-boros** dan **langkah verifikasi**.
Lampirkan file di baris "Attach" pakai `@` mention.

> Aturan emas (berlaku semua fase):
> 1. **JANGAN rename** event Socket.IO `cb*`, nama fungsi, atau ID elemen yang sudah ada — repurpose saja.
> 2. **Bentuk kartu**: `{rank,value(1–13, A=1 terendah),suit("♠♥♦♣" simbol),isRed}`. Cocokkan suit: `card.suit === state.currentSuit`.
> 3. Kerjakan **hanya** scope fase ini. Tidak menambah fitur di luar plan.
> 4. Selesai = lewati "Verifikasi" di tiap prompt.

---

## PROMPT FASE 0 — Shared Deck Util
**Attach:** `@server/deckUtils.js`
```
Baca design.md (§0, §8) dan plans.md (Fase 0) di folder public/cardbattle.
Kerjakan FASE 0:

1. Salin server/deckUtils.js menjadi public/cardbattle/deckUtils.js (isi identik —
   UMD wrapper-nya sudah set window.BasikalDeckUtils di browser).
2. Tambahkan fungsi berikut di KEDUA file (harus identik), di dalam factory & di-return:
   - dealHands(deck, numPlayers, dealCount) -> { hands: Card[][], pile: Card[] }
   - drawForSuit(pile, suit) -> { drawn: Card[], matched: Card|null }
     (pop dari pile sampai dapat kartu ber-suit; TIDAK reshuffle; pile habis tanpa match -> matched null)
   - rankValue(card) -> default return card.value
JANGAN ubah buildDeck/shuffle/drawCard yang lama.

Verifikasi: jalankan
  node -e "const d=require('./server/deckUtils');const r=d.dealHands(d.buildDeck(),4,7);console.log(r.pile.length, r.hands.length)"
Harus cetak: 24 4
```

---

## PROMPT FASE 1 — HTML
**Attach:** `@public/cardbattle/index.html`
```
Baca design.md (§5) dan plans.md (Fase 1). Kerjakan FASE 1: edit index.html saja.

Pakai ID elemen YANG SUDAH ADA (jangan ganti id):
- .round-label "RONDE" -> "TRICK"; sembunyikan #round-max.
- .pot-label -> "SUIT AKTIF"; #pot-amount nanti diisi simbol suit; sembunyikan #pot-carry & .pot-unit.
- .ante-label -> "SISA PILE"; #ante-amount nanti diisi jumlah pile.
- Sembunyikan .player-chips (display:none).
- Tambah di .battle-arena: <div id="deck-pile"></div> dan <div id="suit-indicator"></div>.
- Tambah di .player-section: <button id="cangkul-btn" onclick="doCangkul()" style="display:none">⛏️ CANGKUL</button>.
- Ganti .mode-tagline & isi .rules-grid ke aturan Cangkul (lihat design.md §2).

Jangan sentuh cardbattle.js / cardbattle.css.
Verifikasi: buka file di browser, console tanpa error 404, label round-bar baru tampil, #cangkul-btn ada (hidden).
```

---

## PROMPT FASE 2 — CSS
**Attach:** `@public/cardbattle/cardbattle.css`
```
Baca design.md (§5) dan plans.md (Fase 2). Kerjakan FASE 2: tambah style di cardbattle.css (jangan hapus yang lama).

Tambahkan:
- #player-hand { overflow-x:auto; flex-wrap:nowrap; } + scrollbar tipis.
- .card-playable (glow hijau, pointer), .card-blocked (grayscale, opacity .45, pointer-events:none).
- #deck-pile (kotak tumpukan + counter, pojok arena).
- #suit-indicator (badge suit besar; merah utk ♥♦, putih utk ♠♣).
- #cangkul-btn (tombol mencolok + hover glow).
- .status-cangkuling (dot oranye, reuse animasi thinkPulse).
- .rank-badge (badge #1/#2 utk pemain selesai).

Jangan ubah file lain. Pakai variabel warna CSS yang sudah ada.
Verifikasi: render dengan 15 kartu bisa di-scroll; elemen rapi di lebar 360px & desktop.
```

---

## PROMPT FASE 3 — Logic single-player (INTI)
**Attach:** `@public/cardbattle/cardbattle.js` `@public/cardbattle/deckUtils.js`
```
Baca design.md (§2,§3,§6) dan plans.md (Fase 3). Pelajari struktur cardbattle.js dulu.
Kerjakan FASE 3 (single-player). Reuse fungsi & field yang ada; tambah field/fungsi baru sesuai plan.

State: tambah currentSuit, pile, pileCount, finishOrder, skipCount; player.finishRank, drawnCount
       (reuse 'eliminated' sebagai penanda finished). Tambah CONFIG.DEAL_COUNT = 7.

Deal: initSinglePlayer() pakai BasikalDeckUtils.buildDeck() + dealHands(); leader = pemegang 7♦
      (rank==="7"&&suit==="♦"), fallback value terendah.

Flow: repurpose startRound (mulai trick), submitSingleCard (lead set currentSuit; follow validasi suit),
      advanceSingleTurn (lompati finished; deteksi semua jalan -> resolveRound),
      resolveRound (value tertinggi di currentSuit menang -> leader berikut; handle all-skip & finish).
      Tambah: doCangkul() (pemain) & botCangkul(bot) pakai drawForSuit(); checkFinished(); checkGameOver().

Validasi: following hanya boleh buang suit==currentSuit; tak punya suit -> wajib cangkul/skip; all-skip -> trick batal, leader tetap.

Render: renderHand (.card-playable/.card-blocked), renderOpponents (hand.length, status, .rank-badge),
        renderRevealSlots (kartu trick + #suit-indicator + #deck-pile), round-bar (#pot-amount=suit,
        #ante-amount=pileCount, #round-num=trick#), updateCangkulBtn().

Pertahankan: Socket.IO setup, mpCreateRoom/mpJoinRoom, auth token. (Multiplayer logic = Fase 5.)
Verifikasi: main 1 game single-player sampai game over tanpa error; cangkul jalan; leader berpindah ke pemenang; finishRank benar.
```

---

## PROMPT FASE 4 — Bot AI
**Attach:** `@public/cardbattle/cardbattle.js`
```
Baca design.md (§6) dan plans.md (Fase 4). cardbattle.js sudah diupdate Fase 3.
Kerjakan FASE 4:
- botChooseCard(bot): leading = suit terbanyak (value rendah); following = strategi sesuai hand.length (lihat §6).
- botCangkul(bot): auto drawForSuit + delay visual + status 'cangkuling'.
- Integrasi setTimeout di advanceSingleTurn saat giliran bot.

Verifikasi: 3 bot main 1 game penuh tanpa intervensi & tanpa error; bot tidak skip saat punya suit; bot cangkul saat tak punya suit.
```

---

## PROMPT FASE 5 — Multiplayer
**Attach:** `@public/cardbattle/cardbattle.js` `@server/server.js` `@server/deckUtils.js`
```
Baca design.md (§4) dan plans.md (Fase 5). cardbattle.js sudah jalan single-player (Fase 3–4).
Kerjakan FASE 5. REUSE event cb*; hanya tambah 2 event baru: cbCangkul (client->server), cbCardDrawn (server->client).

SERVER (server/server.js): repurpose cbStartRound (deal Cangkul via dealHands, leader 7♦),
handler cbPlayCard (validasi suit, set currentSuit saat lead, resolve saat semua jalan),
TAMBAH handler cbCangkul (drawForSuit -> kirim cbCardDrawn privat + broadcast pileCount -> auto-play matched),
cbResolve (pemenang=leader berikut, track finishOrder, ->cbRoundEnd; <=1 tersisa ->cbEndGame/cbGameOver).
Tambah CB_CONFIG.DEAL_COUNT=7; simpan currentSuit/pile/finishOrder di cbRooms[code].
cbBroadcast: tangan lawan TIDAK boleh bocor (hanya handCount/pileCount).

CLIENT (cardbattle.js): update syncStateFromMp (map currentSuit/pileCount/finishOrder, sembunyikan tangan lawan),
handleMpReveal, TAMBAH listener cbCardDrawn, handleMpRoundEnd, handleMpGameOver.
confirmPickedCard -> emit cbPlayCard; doCangkul -> emit cbCangkul.

Verifikasi: 2 tab browser main 1 game penuh tanpa desync; tangan lawan tak terlihat; cangkul & finish sinkron.
```

---

## PROMPT FASE 6 — Polish & Test
**Attach:** file yang relevan dengan bug
```
Baca plans.md (Fase 6). Kerjakan polish & test:
- Edge cases: pile habis, semua skip (trick batal), pemenang habis kartu saat menang, tinggal 1 pemain.
- Animasi cangkul: kartu terbang dari #deck-pile ke #player-hand.
- Disconnect mid-game (reuse handleRoomExit/eliminatePlayer).
- Mobile: hand scroll & #cangkul-btn terjangkau.
Laporkan tiap bug + fix-nya.
```

---

## Tips hemat token
1. **Backup sebelum edit file besar** (bukan git repo): `cp cardbattle.js cardbattle.js.bak`.
2. Satu prompt = satu fase; lampirkan hanya file di baris "Attach".
3. Selalu "Baca dulu" design.md/plans.md di awal sesi — konteks sudah lengkap di sana, tak perlu diketik ulang.
4. Kalau error: buka sesi baru, lampirkan file error + pesan error + section design.md relevan saja.
5. Verifikasi tiap fase sebelum lanjut — bug yang ketahuan dini jauh lebih murah diperbaiki.
```
