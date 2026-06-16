# Cangkul Card Game — Implementation Plan (v2)

> Pakai bareng `design.md`. Setiap fase = 1 sesi Claude. Identifier (fungsi/ID/event) di sini sudah dicocokkan dgn kode asli.

## Prinsip Hemat Token
- 1 sesi = 1 fase. Lampirkan **hanya file yang fase itu butuh** (lihat kolom "Attach").
- **Reuse, jangan rename.** Pertahankan nama event `cb*`, nama fungsi & ID elemen yang ada.
- Test manual tiap akhir fase sebelum lanjut.
- Single-player harus jalan penuh (Fase 1–4) sebelum sentuh multiplayer (Fase 5).

---

## Fase 0 — Shared Deck Util (fondasi, kerjakan PERTAMA)
**Attach:** `server/deckUtils.js`
**Estimasi:** singkat

### Kenapa duluan
`deckUtils.js` hanya ada di `server/`; client memuatnya tapi 404. Kita jadikan satu sumber kebenaran deck untuk client & server → anti-desync.

### Tasks
- [ ] **Salin** `server/deckUtils.js` → `public/cardbattle/deckUtils.js` (identik; UMD wrapper sudah mendukung browser via `window.BasikalDeckUtils`).
- [ ] Tambah helper baru di KEDUA file (jaga identik):
  - [ ] `dealHands(deck, numPlayers, dealCount)` → `{ hands: Card[][], pile: Card[] }`
  - [ ] `drawForSuit(pile, suit)` → tarik dari `pile` (pop) sampai ketemu kartu ber-`suit`; return `{ drawn: Card[], matched: Card|null }`. **TIDAK reshuffle**; jika pile habis tanpa match → `matched:null`.
  - [ ] `rankValue(card)` → util perbandingan (default `card.value`; jika nanti Ace-high, ubah di sini saja).
- [ ] JANGAN ubah `buildDeck`/`shuffle` yang lama. JANGAN pakai `drawCard` lama untuk pile (ia reshuffle 52 kartu — salah untuk Cangkul).

**Acceptance:** `node -e "const d=require('./server/deckUtils'); console.log(d.dealHands(d.buildDeck(),4,7).pile.length)"` → cetak `24` (52−4×7). Di browser, `window.BasikalDeckUtils` terdefinisi (tidak 404).

---

## Fase 1 — HTML: label & elemen baru
**Attach:** `index.html`, `design.md` (§5)
**Estimasi:** singkat

### Tasks (pakai ID elemen NYATA)
- [ ] Round bar: `.round-label` "RONDE"→"TRICK"; sembunyikan `#round-max`.
- [ ] `.pot-label` "💰 POT TENGAH"→"SUIT AKTIF"; `#pot-amount` akan diisi simbol suit; sembunyikan `#pot-carry` & `.pot-unit`.
- [ ] `.ante-label` "ANTE"→"SISA PILE"; `#ante-amount` akan diisi `pileCount`.
- [ ] Sembunyikan blok chips pemain (`.player-chips`) — boleh `style="display:none"`.
- [ ] Tambah `#deck-pile` di dalam `.battle-arena` (counter pile).
- [ ] Tambah `#suit-indicator` di dalam `.battle-arena` (badge suit besar).
- [ ] Tambah `<button id="cangkul-btn" onclick="doCangkul()" style="display:none">⛏️ CANGKUL</button>` di `.player-section`.
- [ ] Ganti isi `.rules-grid` & `.mode-tagline` ke aturan Cangkul (lihat design.md §2).
- [ ] (Opsional) ralat `<script src="deckUtils.js">` tetap dibiarkan — setelah Fase 0 file-nya sudah ada.

**Acceptance:** Halaman dibuka, tidak ada error 404 di console (deckUtils ada), layout round-bar tampil dgn label baru, tombol cangkul ada tapi hidden.

---

## Fase 2 — CSS: elemen baru
**Attach:** `cardbattle.css`, `design.md` (§5)
**Estimasi:** singkat

### Tasks (tambah, jangan hapus style lama)
- [ ] `#player-hand`: `overflow-x:auto; flex-wrap:nowrap;` + scrollbar tipis.
- [ ] `.card-playable`: border/glow hijau, cursor pointer.
- [ ] `.card-blocked`: grayscale + opacity .45 + `pointer-events:none`.
- [ ] `#deck-pile`: kotak tumpukan + counter, pojok arena.
- [ ] `#suit-indicator`: badge besar; warna merah utk ♥♦ (isRed), putih utk ♠♣.
- [ ] `#cangkul-btn`: tombol mencolok + hover glow.
- [ ] `.status-cangkuling`: dot oranye + pulse (reuse animasi `thinkPulse` yang ada).
- [ ] `.rank-badge`: badge `#1/#2` utk pemain finished.

**Acceptance:** Semua elemen baru rapi di desktop & ≤560px. Hand dengan 15 kartu bisa di-scroll.

---

## Fase 3 — Game Logic single-player (INTI, paling besar)
**Attach:** `cardbattle.js`, `public/cardbattle/deckUtils.js`, `design.md` (§2,§3,§6)
**Estimasi:** panjang

### 3a. State (tambah field, lihat design.md §3)
- [ ] Tambah `state.currentSuit, state.pile, state.pileCount, state.finishOrder, state.skipCount`.
- [ ] Tambah `player.finishRank, player.drawnCount`. Reuse `eliminated` sebagai penanda finished.

### 3b. Deal & leader
- [ ] `initSinglePlayer()`: pakai `BasikalDeckUtils.buildDeck()` + `dealHands(deck, n, CONFIG.DEAL_COUNT)`; isi `pile`/`pileCount`.
- [ ] Tambah `CONFIG.DEAL_COUNT = 7`.
- [ ] `findFirstLeader()`: cari pemegang 7♦ (`rank==="7"&&suit==="♦"`), fallback value terendah.

### 3c. Flow trick (repurpose fungsi yang ada)
- [ ] `startRound()` → mulai trick: `currentSuit=null`, kosongkan `pickedCard` semua, `phase="leading"`, set leader & `buildSingleTurnOrder`.
- [ ] `submitSingleCard(player, cardIdx)`: jika leading → set `currentSuit=card.suit`. Validasi follow (suit match). Pindah giliran via `advanceSingleTurn()`.
- [ ] **BARU** `doCangkul()` (pemain) & `botCangkul(bot)`: panggil `drawForSuit(state.pile, currentSuit)`, tambah `drawn` ke hand, `pileCount` turun, lalu auto-buang `matched` (atau skip bila `null`).
- [ ] `advanceSingleTurn()`: lompati pemain `finished`; deteksi semua-sudah-jalan → `resolveRound()`.
- [ ] `resolveRound()`: tentukan pemenang (value tertinggi di `currentSuit`), set leader berikut, handle all-skip (trick batal), handle finish.
- [ ] **BARU** `checkFinished(player)`: `hand.length===0` → set finished + `finishRank`, push ke `finishOrder`.
- [ ] **BARU** `checkGameOver()`: jika ≤1 pemain belum finished → `endGame()`.

### 3d. Validasi
- [ ] Following: hanya boleh buang kartu `suit===currentSuit`.
- [ ] Jika tak punya suit → harus cangkul (atau skip bila pile habis), tak boleh buang sembarang.
- [ ] All-skip → reset trick, leader tetap.

### 3e. Render (repurpose fungsi yang ada)
- [ ] `renderHand()`: tandai `.card-playable`/`.card-blocked` sesuai `currentSuit` & phase.
- [ ] `renderOpponents()`: tampil `hand.length`, status (+`cangkuling`), `.rank-badge`.
- [ ] `renderRevealSlots()`: kartu trick + isi `#suit-indicator` + `#deck-pile`.
- [ ] Round-bar: isi `#pot-amount`=simbol suit, `#ante-amount`=`pileCount`, `#round-num`=trick#.
- [ ] **BARU** `updateCangkulBtn()`: tampil `#cangkul-btn` hanya saat giliranmu & tak punya suit.

**Acceptance:** Main single-player vs bot dari awal sampai game over tanpa error; cangkul jalan saat tak punya suit; pemenang trick jadi leader; pemain habis kartu keluar dgn rank benar.

---

## Fase 4 — Bot AI
**Attach:** `cardbattle.js`, `design.md` (§6)
**Estimasi:** sedang

### Tasks
- [ ] `botChooseCard(bot)`: strategi leading (suit terbanyak, value rendah) & following (lihat design.md §6).
- [ ] `botCangkul(bot)`: auto `drawForSuit` + delay visual; set status `cangkuling`.
- [ ] Integrasi delay (`setTimeout`) di `advanceSingleTurn()` saat giliran bot.

**Acceptance:** 3 bot main 1 game penuh tanpa intervensi & tanpa error; keputusan masuk akal (tidak skip saat sebenarnya punya suit).

---

## Fase 5 — Multiplayer (Socket.IO)
**Attach:** `cardbattle.js`, `server/server.js`, `server/deckUtils.js`, `design.md` (§4)
**Estimasi:** panjang

### Server (`server/server.js`) — repurpose handler yang ada
- [ ] `cbStartRound(room)`: deal Cangkul via `dealHands`, simpan `room.pile`, set leader (7♦), broadcast `cbGameStart` + state (pakai `cbBroadcast(code, includeHand)`).
- [ ] Handler `cbPlayCard`: validasi suit; set `currentSuit` bila lead; emit `cbReveal`; jika semua jalan → resolve.
- [ ] **BARU** handler `cbCangkul`: `drawForSuit(room.pile, suit)`; kirim `cbCardDrawn` ke pemain ybs (kartu privat) + broadcast `pileCount`; lalu auto-play matched.
- [ ] `cbResolve(room)`: pemenang trick = leader berikut; track `finishOrder`; emit `cbRoundEnd`; bila ≤1 tersisa → `cbEndGame`→`cbGameOver`.
- [ ] Tambah `CB_CONFIG.DEAL_COUNT = 7`. Simpan `currentSuit/pile/finishOrder` di `cbRooms[code]`.
- [ ] `cbBroadcast`: pastikan tangan pemain lain TIDAK bocor (hanya `handCount`).

### Client (`cardbattle.js`) — update handler mp yang ada
- [ ] `syncStateFromMp(data)`: map `currentSuit/pileCount/finishOrder`, sembunyikan tangan lawan.
- [ ] `handleMpReveal`: tampilkan kartu di slot + suit indicator.
- [ ] **BARU** listener `cbCardDrawn`: tambah kartu ke tangan sendiri / update `pileCount`.
- [ ] `handleMpRoundEnd`: animasi resolve, update leader & rank.
- [ ] `handleMpGameOver`: tampilkan ranking via game-over overlay.
- [ ] `confirmPickedCard()`: emit `cbPlayCard`. `doCangkul()`: emit `cbCangkul`.

**Acceptance:** 2 tab browser main 1 game penuh tanpa desync; tangan lawan tak pernah terlihat; cangkul & finish sinkron.

---

## Fase 6 — Polish & Test
**Attach:** sesuai bug yang muncul
**Estimasi:** singkat

### Tasks
- [ ] Edge cases: pile habis, semua skip (trick batal), pemenang habis kartu saat menang, tinggal 1 pemain.
- [ ] Animasi cangkul: kartu "terbang" dari `#deck-pile` ke `#player-hand`.
- [ ] Disconnect mid-game (reuse `handleRoomExit`/`eliminatePlayer`).
- [ ] Mobile: hand scroll & `#cangkul-btn` terjangkau.
- [ ] (Opsional) sound cue cangkul/menang.

**Acceptance:** Semua edge case di atas tidak crash; laporan bug + fix didokumentasikan.

---

## Urutan
```
Fase 0 (deckUtils) → 1 (HTML) → 2 (CSS) → 3 (Logic SP) → 4 (Bot) → 5 (Multiplayer) → 6 (Polish)
```

## Catatan keamanan kerja (bukan git repo)
Sebelum mengubah file besar (`cardbattle.js`, `server/server.js`), **backup dulu**:
`cp cardbattle.js cardbattle.js.bak` — supaya bisa rollback tanpa git.

## Referensi cepat identifier nyata
- Card: `{rank,value(1-13,A=1),suit("♥"),isRed}` · SUITS `["♠","♥","♦","♣"]`
- Event emit: `cbCreateRoom,cbJoinRoom,cbStartGame,cbPlayCard,cbSurrender,cbLeaveRoom` (+BARU `cbCangkul`)
- Event listen: `cbRoomState,cbGameStart,cbReveal,cbRoundEnd,cbGameOver,cbPlayerSurrendered,cbError` (+BARU `cbCardDrawn`)
- Fungsi client kunci: `initSinglePlayer,startRound,buildSingleTurnOrder,advanceSingleTurn,submitSingleCard,revealPhase,resolveRound,botChooseCard,renderAll,renderOpponents,renderHand,renderRevealSlots`
- Server kunci: `cbRooms`, `CB_CONFIG`, `cbStartRound,cbReveal,cbResolve,cbEndGame,cbBroadcast`
- ID elemen: `round-num,round-max,pot-amount,pot-carry,ante-amount,opponents-row,reveal-slots,phase-text,round-result,player-hand,player-chips,game-over-overlay,go-ranking-list`
