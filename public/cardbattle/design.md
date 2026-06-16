# Cangkul Card Game — Design Document (v2, grounded in real code)

> Konversi permainan **Card Battle** → **Cangkul** dengan reuse maksimal aset & infra yang sudah ada.
> Dokumen ini sudah dicocokkan dengan kode asli (nama fungsi, ID elemen, event Socket.IO, bentuk kartu).

---

## 0. Code Grounding (FAKTA dari kode asli — JANGAN diubah asal)

### File & lokasi nyata
| Hal | Lokasi nyata | Catatan |
|---|---|---|
| Client logic | `public/cardbattle/cardbattle.js` (~1320 baris) | Plain script, global scope (bukan module/IIFE) |
| Client markup | `public/cardbattle/index.html` | |
| Client style | `public/cardbattle/cardbattle.css` | |
| **Deck util (shared)** | `server/deckUtils.js` | **UMD module** — `module.exports` (Node) + `window.BasikalDeckUtils` (browser) |
| Server | `server/server.js` | CommonJS. Card-battle handlers + state `cbRooms` |
| Server config | `server/server.js` → `CB_CONFIG` | |

### ✅ Cara deckUtils sampai ke client (PENTING — sudah terverifikasi)
- `deckUtils.js` **fisiknya hanya 1 file**: `server/deckUtils.js`. File ini **disajikan ke client** lewat route eksplisit di `server/server.js` baris 76–78:
  ```js
  app.get("/cardbattle/deckUtils.js", (req,res)=> res.type("application/javascript").sendFile(path.join(__dirname,"deckUtils.js")));
  ```
  Jadi `<script src="deckUtils.js">` di `index.html` (baris 281) **TIDAK 404** — `window.BasikalDeckUtils` terdefinisi di client. (UMD wrapper: `module.exports` utk Node + `window.BasikalDeckUtils` utk browser.)
- **JANGAN buat `public/cardbattle/deckUtils.js`.** `express.static(public)` (server.js:66) terdaftar SEBELUM route itu; jika file duplikat ada di `public/`, ia akan **menutupi** route server → muncul 2 file yang bisa divergen (sumber desync). **Satu sumber kebenaran: edit `server/deckUtils.js` saja** (otomatis kepakai client + server). Lihat §10.

### ⚠️ Bug/gotcha eksisting yang ditemukan
- `server/deckUtils.js` → `drawCard(deck)` **otomatis membuat 52 kartu baru saat deck kosong** (baris 46–48). Ini FATAL untuk Cangkul (kartu tak boleh muncul dari ketiadaan). Pile cangkul WAJIB pakai draw varian yang return `null` saat habis (`drawForSuit`, lihat §8).

### Bentuk kartu NYATA (dari `server/deckUtils.js`)
```js
// Card — JANGAN pakai bentuk lain
{ rank: "A"|"2"|...|"10"|"J"|"Q"|"K", value: 1..13, suit: "♠"|"♥"|"♦"|"♣", isRed: boolean }

// PENTING:
// - suit = SIMBOL langsung ("♥"), bukan "H"/"D". Cocokkan suit: card.suit === state.currentSuit
// - value: A=1 (TERENDAH), 2=2, ..., 10=10, J=11, Q=12, K=13 (TERTINGGI). TIDAK ADA Ace-high.
const SUITS = ["♠","♥","♦","♣"];
```

### Nama fungsi client yang RELEVAN (yang akan kita ubah/reuse)
| Kategori | Fungsi nyata |
|---|---|
| Mode & init | `selectMode(mode)`, `initSinglePlayer()`, `restartGame()` |
| Flow single-player | `startRound()`, `buildSingleTurnOrder(alive)`, `advanceSingleTurn()`, `submitSingleCard(player, cardIdx)`, `revealPhase()`, `resolveRound()` |
| Input pemain | `selectHandCard(idx)`, `confirmPickedCard()` |
| Bot | `botChooseCard(bot)`, `botSubmitCard(bot, cardIdx)` |
| Render | `renderAll(skipSlots)`, `renderOpponents()`, `renderHand()`, `renderRevealSlots()`, `setPhaseText(t)`, `showRoundResult(type,msg)`, `hideRoundResult()` |
| Multiplayer | `initMultiplayer()`, `mpCreateRoom()`, `mpJoinRoom()`, `mpStartGame()`, `syncStateFromMp(data)`, `handleMpReveal(data)`, `handleMpRoundEnd(data)`, `handleMpGameOver(data)` |
| End/util | `endGame(winner)`, `surrender()`, `showToast(msg,type)`, `escapeHtml(s)` |

### Event Socket.IO NYATA — **REUSE nama ini, JANGAN rename**
> Rename `cb*`→`cg*` memaksa edit registrasi di client **dan** server. Repurpose payload saja = jauh lebih hemat token.

**Client emit → Server listen:** `cbCreateRoom`, `cbJoinRoom`, `cbStartGame`, `cbPlayCard`, `cbSurrender`, `cbLeaveRoom`
**Server emit → Client listen:** `cbRoomState`, `cbGameStart`, `cbReveal`, `cbRoundEnd`, `cbGameOver`, `cbPlayerSurrendered`, `cbError`

> Untuk aksi BARU yang tak ada padanannya (cangkul), tambah **satu** event baru: `cbCangkul` (client→server) + `cbCardDrawn` (server→client). Selain itu pakai event lama.

### State client NYATA (`const state`)
```
mode, players[], pot, round, ante, carryOver, deck[], phase,
selectedCardIdx, currentLeaderId, currentTurnId, turnOrder[], turnIndex,
timer, timerInterval, roundsPlayed
```
Player: `{ id, name, avatar, chips, hand[], isBot, isYou, picked, pickedCard, eliminated }`

### State server NYATA (`cbRooms[code]`)
```
code, players[], round, pot, ante, carryOver, phase, deck[], timerId, timerLeft
```
Player(server): `{ id, username, chips, hand[], picked, pickedCard, eliminated, host }`

### CONFIG nyata
- Client `CONFIG`: `STARTING_CHIPS, HAND_SIZE(5), BASE_ANTE, ANTE_INCREMENT, ANTE_INCREASE_EVERY, ROUND_TIMER(15), MAX_ROUNDS(20), ENTRY_FEE_GEMS(50), PAYOUT_RATIO(0.5), BOT_NAMES[]`
- Server `CB_CONFIG`: idem + `SINGLE_PLAYER_WIN_GEMS(100)`
- Auth: client kirim `io(..., { auth: { token: authToken } })`; server verifikasi via `io.use` middleware → `socket.user`. **Tidak perlu disentuh.**

---

## 1. Pemetaan Konsep (lama → Cangkul)

| Konsep lama | Jadi (Cangkul) | Implementasi reuse |
|---|---|---|
| `round` | **Trick #** | Pakai `state.round` apa adanya, ganti label saja |
| `pot` (chips) | **Suit aktif** trick ini | Repurpose slot UI `pot-display`; data baru `state.currentSuit` |
| `ante` | **Sisa pile cangkul** | Repurpose slot UI `ante-info`; data baru `state.pileCount` |
| `chips` per pemain | **Jumlah kartu di tangan** | `player.hand.length`; field `chips` boleh diabaikan/di-hide |
| `eliminated` | **finished** (kartu habis) | Reuse field `eliminated` = sudah keluar; tambah `finishRank` |
| `pickedCard` | kartu yang dilempar di trick | Reuse apa adanya |
| `currentLeaderId` | leader trick | Reuse apa adanya |
| `turnOrder`/`turnIndex` | urutan giliran trick | Reuse `buildSingleTurnOrder` + `advanceSingleTurn` |

> Strategi: **repurpose field & slot UI yang ada** alih-alih bikin baru, supaya perubahan minimal.

---

## 2. Aturan Permainan

### Tujuan
Jadi pemain **pertama yang menghabiskan semua kartu** di tangan.

### Setup
- Deck 52 kartu via `BasikalDeckUtils.buildDeck()` (sudah ter-shuffle).
- 2–6 pemain (ideal 3–5).
- **Bagikan `DEAL_COUNT` kartu/pemain** (default **7**, lihat §8 Keputusan). Sisanya = **pile cangkul** di tengah.

### Penentuan leader pertama
- Cari pemegang **7♦** (`rank==="7" && suit==="♦"`) → dia leader trick #1.
- Fallback (7♦ ada di pile): pemain dengan kartu `value` terendah, atau pemain index 0.

### Alur satu trick
```
1. LEAD    Leader buang 1 kartu bebas → set state.currentSuit = kartu.suit
2. FOLLOW  Giliran searah turnOrder. Tiap pemain WAJIB buang kartu ber-suit sama.
3. CANGKUL Jika tak punya suit → tarik dari pile 1-per-1 SAMPAI dapat suit, lalu wajib buang kartu itu.
           Jika pile habis & tetap tak punya suit → SKIP (pickedCard = null).
4. RESOLVE Semua sudah jalan → di antara kartu ber-suit = currentSuit, value TERTINGGI menang.
5. NEXT    Pemenang = leader trick berikutnya (lihat edge case bila pemenang baru saja habis kartunya).
```

### Perbandingan nilai
- Hanya kartu dengan `suit === currentSuit` yang dibandingkan, pakai `value` (1–13).
- A=1 (terendah) sesuai deckUtils. (Override Ace-high opsional — lihat §8.)
- Kartu hasil cangkul yang suit-nya beda **tidak mungkin** dibuang (pemain wajib buang kartu suit yang baru didapat). Skip hanya saat pile habis.

### Menang / kalah
- Tangan kosong → `finished`, dicatat ke `state.finishOrder` (rank 1 = tercepat).
- Permainan lanjut sampai tersisa 1 pemain → dia juru kunci (**KALAH**).
- Game over saat `players.filter(belum finished).length <= 1`.

### Kondisi khusus (WAJIB di-handle)
1. **Pile habis + tak punya suit** → pemain skip (`pickedCard=null`), giliran lanjut.
2. **Semua pemain skip** dalam 1 trick (tak ada yang bisa ikut suit) → trick batal: `currentSuit=null`, leader tetap, mulai ulang lead.
3. **Pemain habis kartu saat melempar kartu pemenang** → kartunya tetap ikut resolusi trick ini; tapi karena sudah `finished`, leader berikutnya = pemain **belum finished** berikutnya searah jarum jam dari posisi dia.
4. **Pemain finished** dikeluarkan dari `turnOrder` trick berikutnya.
5. **Leader finished di tengah** (tak mungkin saat dia menang, tapi jaga-jaga) → fallback ke pemain aktif pertama di turnOrder.

---

## 3. Struktur State (delta dari yang sudah ada)

> Tambah field ke `state` & `player`. JANGAN ganti nama yang sudah dipakai luas; cukup tambah + abaikan yang tak relevan.

```js
// Tambahan di state:
state.currentSuit = null;   // "♠"|"♥"|"♦"|"♣"|null  (suit trick aktif)
state.pile        = [];      // sisa kartu cangkul (client single-player & server)
state.pileCount   = 0;       // jumlah pile (publik, untuk UI & multiplayer)
state.finishOrder = [];      // array id pemain urut selesai (rank 1 = pertama)
state.skipCount   = 0;       // jumlah skip beruntun di trick ini (deteksi all-skip)
// Reuse: round (=trick#), currentLeaderId, currentTurnId, turnOrder, turnIndex, phase, pickedCard

// Tambahan di player:
player.finishRank = null;    // 1,2,3... saat habis
player.drawnCount = 0;       // statistik total kartu hasil cangkul
// Reuse: hand[], pickedCard, eliminated(=finished), id, name, avatar, isBot, isYou

// phase: "waiting" | "leading" | "following" | "resolving" | "gameover"
//   (cangkul bukan phase terpisah — ditangani di dalam giliran following)
```

---

## 4. Socket.IO (multiplayer) — reuse + 1 event baru

### Client → Server
| Event | Status | Payload | Keterangan |
|---|---|---|---|
| `cbCreateRoom` | reuse | `{ username }` | tak berubah |
| `cbJoinRoom` | reuse | `{ roomCode, username }` | tak berubah |
| `cbStartGame` | reuse | `{ roomCode }` | server deal Cangkul, bukan 5-kartu |
| `cbPlayCard` | reuse | `{ roomCode, cardIdx }` | validasi suit di server |
| `cbCangkul` | **BARU** | `{ roomCode }` | tarik dari pile sampai dapat suit |
| `cbSurrender` | reuse | `{ roomCode }` | keluar = otomatis jadi juru kunci |
| `cbLeaveRoom` | reuse | — | tak berubah |

### Server → Client
| Event | Status | Payload (delta) | Keterangan |
|---|---|---|---|
| `cbRoomState` | reuse | `{ players(handCount), roomCode, hostId }` | lobby |
| `cbGameStart` | reuse | `{ hand, state(pileCount,currentLeaderId,turnOrder) }` | kirim tangan privat |
| `cbReveal` | reuse | `{ playerId, card, currentSuit, currentTrick }` | kartu dimainkan |
| `cbCardDrawn` | **BARU** | `{ toPlayerId, card?(privat), pileCount }` | hasil cangkul; `card` hanya ke pemain ybs |
| `cbRoundEnd` | reuse | `{ winnerId, trickCards, finished?[] , state }` | hasil trick (= 1 trick) |
| `cbGameOver` | reuse | `{ finishOrder, stats }` | selesai |
| `cbPlayerSurrendered` | reuse | `{ playerId }` | — |
| `cbError` | reuse | `{ message }` | validasi |

> Kartu pemain lain TIDAK pernah dikirim ke client lain. Server hanya broadcast `handCount`/`pileCount`; tangan asli hanya ke pemiliknya (pola `cbBroadcast(code, includeHand)` yang sudah ada).

---

## 5. Komponen UI (pakai ID elemen NYATA)

### Reuse penuh (tanpa ubah struktur)
Header, currency bar, `mode-overlay`, `mp-overlay` (lobby create/join), `game-over-overlay`, canvas partikel, animasi flip kartu, seluruh palet CSS.

### Round bar — ubah label & isi (ID tetap)
```
[ TRICK  #id=round-num ]   [ SUIT  #id=pot-amount → "♥" ]   [ PILE  #id=ante-amount → "14" ]
```
- `#round-num` → nomor trick (reuse). `#round-max` → bisa di-hide.
- `.pot-label` → "SUIT AKTIF"; `#pot-amount` → tampil simbol suit (warna ikut isRed). `#pot-carry` → hide.
- `.ante-label` → "SISA PILE"; `#ante-amount` → `state.pileCount`.

### Opponents (`#opponents-row`, via `renderOpponents()`)
- Ganti tampilan chips → **jumlah kartu** (`hand.length`).
- Status dot: `thinking` / `playing` / `cangkuling` (BARU, oranye) / `finished`.
- Badge rank untuk yang finished: `🥇#1`, `🥈#2`, … (class `.rank-badge`).

### Battle arena (`#reveal-slots`, via `renderRevealSlots()`)
- Slot kartu tiap pemain (reuse).
- Tambah **deck pile** (`#deck-pile`) di pojok: ikon tumpukan + `pileCount`.
- Tambah **suit indicator** (`#suit-indicator`) di tengah: "♥ HATI — ikuti suit ini".
- `#phase-text` (reuse) untuk instruksi (mis. "Giliranmu — buang ♥ atau CANGKUL").

### Player hand (`#player-hand`, via `renderHand()`)
- Kartu bisa banyak (7→naik saat cangkul) → container `overflow-x:auto`, `flex-wrap:nowrap`.
- Kartu dengan `suit===currentSuit` → `.card-playable` (glow hijau). Sisanya → `.card-blocked` (greyed, non-klik) saat phase following.
- Saat **leading**, semua kartu playable.
- Tombol **CANGKUL** (`#cangkul-btn`, hidden default) muncul **hanya** saat: giliranmu, phase following, dan kamu tak punya `currentSuit`.

---

## 6. Bot AI (single-player, di `botChooseCard(bot)` + helper baru `botCangkul`)
```
LEADING   : buang kartu dari suit yang JUMLAHNYA terbanyak di tangan (peluang menang lead besar),
            pilih value terendah dari suit itu (simpan kartu kuat).
FOLLOWING (punya suit):
  - hand.length <= 4  → main value TERTINGGI dari suit (rebut leader agar bisa atur trick & buang cepat)
  - hand.length >= 8  → main value TERENDAH dari suit (buang sampah, hemat kartu kuat)
  - selain itu        → main value menengah
FOLLOWING (tak punya suit):
  - pile masih ada → CANGKUL otomatis sampai dapat suit, lalu buang kartu hasil cangkul
  - pile habis     → SKIP
Semua aksi bot diberi delay (mis. 600–1000ms) lewat setTimeout agar terlihat natural.
```

---

## 7. File yang diubah & ringkasan perubahan
| File | Perubahan inti |
|---|---|
| `server/deckUtils.js` | **Satu-satunya** file deck — tambah helper Cangkul (`dealHands`, `drawForSuit`, `rankValue`). Otomatis kepakai client (via route server.js:76) + server. JANGAN buat duplikat di `public/`. |
| `public/cardbattle/index.html` | Ganti label round-bar; tambah `#deck-pile`, `#suit-indicator`, `#cangkul-btn`; ganti teks rules; sembunyikan elemen chips |
| `public/cardbattle/cardbattle.css` | Tambah style: hand scroll, `.card-playable/.card-blocked`, `#deck-pile`, `#suit-indicator`, `#cangkul-btn`, `.status-cangkuling`, `.rank-badge` |
| `public/cardbattle/cardbattle.js` | Ganti logic single-player (deal-all, lead/follow/cangkul/resolve, finish), bot, render; tambah handler `cbCangkul`/`cbCardDrawn` & repurpose handler mp |
| `server/server.js` | Repurpose `cbStartRound`/`cbPlayCard`/`cbReveal`/`cbResolve`; tambah handler `cbCangkul`; state pile di `cbRooms[code]` |

---

## 8. Keputusan desain (default sudah dipilih — boleh di-override)
1. **Jumlah bagi kartu**: `DEAL_COUNT = 7` (default). Alasan: jika dibagi rata habis, pile kosong → cangkul nyaris tak pernah jalan. Dengan 7, selalu ada pile yang berarti. → tambah `CONFIG.DEAL_COUNT = 7` & `CB_CONFIG.DEAL_COUNT = 7`.
2. **Ace**: tetap **A=1 (terendah)** mengikuti deckUtils (reuse tanpa ubah). Jika mau Ace-high, tambah helper `rankValue(card){ return card.value===1 ? 14 : card.value }` dan pakai itu di perbandingan — JANGAN ubah deckUtils.
3. **Pile habis**: tidak reshuffle discard. Pakai draw varian non-reshuffle (return `null`). Pemain yang tak bisa ikut suit → skip.
4. **Reuse event `cb*`** (jangan rename) + hanya 2 event baru (`cbCangkul`, `cbCardDrawn`).
5. **Currency/entry-fee**: pertahankan alur gems (`ENTRY_FEE_GEMS`, payout di `endGame`) agar tak merusak ekonomi game. Hanya sembunyikan tampilan chips in-game.

---

## 9. Scope yang TIDAK disentuh
Login/auth (JWT middleware), koneksi & versi Socket.IO, struktur DB/storage, palet warna & variabel CSS, partikel & ambient orbs, breakpoint responsive.
