# Cangkul — Admin Luck Control (Plan)

> Tujuan: keberuntungan permainan Cangkul bisa diatur per-user dari **dashboard admin**, sama seperti Slot & Gacha.
> Pakai pola yang SUDAH ADA (slotProfile / gachaProfile) supaya konsisten & minim risiko.

---

## 0. Keputusan & Penamaan (FAKTA dari kode)

- Game ini secara tema "Cangkul" tapi **identitas kode = `cardbattle`/`cb`** (route `/api/cardbattle/reward`, `CB_CONFIG`, `cbRooms`, dll). 
  → **Profil luck dinamai `cardBattleProfile`**, tabel `cardbattle_profiles`, endpoint `/api/admin/cardbattle-profile`. JANGAN bikin nama baru "cangkulProfile" supaya seragam dgn route reward yang sudah ada.
- Pola referensi yang ditiru **persis**: `slotProfile` (4 slider) & `gachaProfile`. Lihat:
  - `server/storage.js` → `getSlotProfile/setSlotProfile`, `SLOT_PROFILE_DEFAULTS`, `validateSlotProfile`, tabel `slot_profiles`.
  - `server/server.js` → `GET/PATCH /api/admin/slot-profile`, `GET /api/me/slot-profile`.
  - `public/admin.html` + `public/admin.js` + `public/admin.css` → section "🎰 Slot Luck Manager".

---

## 1. Bentuk `cardBattleProfile` (final)

```js
{
  dealLuck: 0.5,         // 0..1 (default 0.5 = netral). >0.5 = tangan awal lebih bagus (banyak kartu tinggi / pegang 7♦). <0.5 = lebih jelek.
  cangkulLuck: 0.5,      // 0..1 (default 0.5). >0.5 = cangkul cepat ketemu suit (sedikit kartu nyangkut). <0.5 = lebih banyak narik.
  rewardMultiplier: 1.0, // 0.1..5 (default 1.0). Skala hadiah gems saat menang (server-enforced).
}
```

Range validasi (ikut gaya `validateSlotProfile`):
| field | min | max | tipe |
|---|---|---|---|
| dealLuck | 0 | 1 | float |
| cangkulLuck | 0 | 1 | float |
| rewardMultiplier | 0.1 | 5 | float |

---

## 2. Di mana luck diterapkan (titik injeksi NYATA)

| Mode | Titik | File | Lever |
|---|---|---|---|
| Single-player | deal awal `dealHands(buildDeck(),4,DEAL_COUNT)` di `initSinglePlayer()` | `public/cardbattle/cardbattle.js` | `dealLuck` (bias tangan human = `players[0]`) |
| Single-player | `drawForSuit(state.pile, currentSuit)` di `doCangkul()` | `public/cardbattle/cardbattle.js` | `cangkulLuck` |
| Single-player | hadiah `single_reward` | `server/server.js` → `/api/cardbattle/reward` | `rewardMultiplier` |
| Multiplayer (opsional) | `cbDealHands(...)` di `cbStartGame` | `server/server.js` | `dealLuck` per pemain |
| Multiplayer (opsional) | `cbDrawForSuit(room.pile,suit)` di `cbHandleCangkul` | `server/server.js` | `cangkulLuck` pemain ybs |
| Multiplayer (opsional) | hadiah di `cbEndGame` | `server/server.js` | `rewardMultiplier` pemenang |

### Catatan arsitektur (PENTING)
- **Single-player Cangkul jalan di client** (deal & cangkul di browser). Jadi `dealLuck`/`cangkulLuck` SP diterapkan **client-side** setelah client mengambil profilnya via endpoint read-only `GET /api/me/cardbattle-profile` (pola sama dgn `/api/me/slot-profile`). Ini **konsisten dgn model trust yang ada** (gameplay SP memang client-side; hanya reward yang divalidasi server).
- **`rewardMultiplier` SELALU server-side** (lever ekonomi sebenarnya) → di `/api/cardbattle/reward` & `cbEndGame`. Inilah kontrol admin yang benar-benar mengikat.
- **Multiplayer** deal & cangkul memang server-side → luck di sana otomatis enforce. Tapi MP per-pemain lebih kompleks → jadikan **Fase opsional L4**.

---

## 3. Helper bias di deckUtils (shared, identik di 2 file)

Tambah ke **`server/deckUtils.js` DAN `public/cardbattle/deckUtils.js`** (harus identik, di dalam factory & di-return). JANGAN ubah `dealHands`/`drawForSuit`/`buildDeck` lama.

```js
// Tukar kartu antara hand & pile berdasar luck (konservasi jumlah kartu).
// luck 0.5 = netral (tidak melakukan apa-apa).
// luck>0.5: tukar kartu TERENDAH di hand dgn kartu TERTINGGI dari pile (+coba selipkan 7♦).
// luck<0.5: kebalikannya (buang kartu tinggi, ambil rendah dari pile).
applyHandLuck(hand, pile, luck) -> void (mutasi hand & pile)

// Seperti drawForSuit tetapi bias.
// luck>0.5: dgn peluang (luck-0.5)*2, pindahkan 1 kartu ber-suit ke ujung pile (top) dulu → match cepat.
// luck<0.5: dgn peluang (0.5-luck)*2, pindahkan kartu ber-suit ke dasar → narik lebih banyak.
drawForSuitBiased(pile, suit, luck) -> { drawn, matched }  // fallback ke drawForSuit
```

> `drawForSuit` mem-`pop()` dari **akhir array** (akhir = "atas tumpukan"). Untuk match cepat: pindahkan kartu ber-suit ke index terakhir.

---

## 4. Pemecahan Fase (1 fase = 1 sesi agent)

| Fase | Isi | Attach |
|---|---|---|
| **L0** Storage + API | `cardBattleProfile` di `storage.js` (defaults, validate, normalize, get/set, tabel Postgres `cardbattle_profiles`, field JSON lokal, init di registerUser, join di getAdminOverview, daftar di interface). Endpoint `GET /api/me/cardbattle-profile`, `GET/PATCH /api/admin/cardbattle-profile`. Terapkan `rewardMultiplier` di `/api/cardbattle/reward`. | `server/storage.js`, `server/server.js` |
| **L1** Admin UI | Section "🎴 Cangkul Luck Manager" di `admin.html` (3 slider + presets + save), fungsi di `admin.js` (`loadCardBattleProfile`, `saveCardBattleProfile`, `setCardBattlePreset`, daftarkan slider di `setupSliders`, tambah `populateLuckSelect` di `populatePlayerDropdown`). | `public/admin.html`, `public/admin.js`, `public/admin.css` |
| **L2** deckUtils bias | `applyHandLuck` + `drawForSuitBiased` di KEDUA deckUtils (identik). | `server/deckUtils.js`, `public/cardbattle/deckUtils.js` |
| **L3** Wire SP | `cardbattle.js`: fetch profil saat boot, terapkan `applyHandLuck` di `initSinglePlayer` (human idx 0) & `drawForSuitBiased` di `doCangkul`. | `public/cardbattle/cardbattle.js` |
| **L4** (opsional) Wire MP | `server.js`: bias deal per-pemain di `cbStartGame` + `drawForSuitBiased` di `cbHandleCangkul` + `rewardMultiplier` pemenang di `cbEndGame`. | `server/server.js`, `server/deckUtils.js` |

> Urutan wajib: **L0 → L1 → L2 → L3** (inti). L4 opsional setelah inti jalan.
> Prompt siap-pakai tiap fase ada di **`luck-prompts.md`**.

---

## 5. Preset slider (admin)

| Preset | dealLuck | cangkulLuck | rewardMultiplier |
|---|---|---|---|
| 💀 KARMA BURUK | 0.10 | 0.10 | 0.5 |
| 😐 NORMAL | 0.50 | 0.50 | 1.0 |
| 😊 HOKI | 0.70 | 0.70 | 1.5 |
| 🍀 SULTAN MODE | 0.95 | 0.95 | 3.0 |

Slider: Deal Luck (0–100%, step 1), Cangkul Luck (0–100%, step 1), Reward Multiplier (0.1–5, step 0.1).

---

## 6. Verifikasi keseluruhan

1. `node --check` semua file yang diubah → tidak error.
2. `node -e "const d=require('./server/deckUtils'); ..."` test `applyHandLuck`/`drawForSuitBiased` (konservasi jumlah kartu; luck=1 → match cepat; luck=0 → narik banyak).
3. Jalankan server, login admin → buka `admin.html` → section Cangkul muncul, pilih user, geser slider, SAVE → toast sukses; reload → nilai tersimpan.
4. Login user biasa (yang luck-nya di-set tinggi) → main single-player → tangan awal jelas lebih bagus / cangkul cepat ketemu; menang → gems = `100 × rewardMultiplier`.
5. Set SULTAN vs KARMA BURUK pada 2 user, bandingkan pengalaman.

---

## 7. Yang TIDAK disentuh
Login/JWT, struktur tabel users/wallets, slot & gacha profile, ekonomi gems selain multiplier reward Cangkul, gameplay rules Cangkul (Fase 0–6 sebelumnya).
