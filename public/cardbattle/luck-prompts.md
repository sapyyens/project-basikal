# Cangkul — Admin Luck Control (Prompt siap-pakai)

> Tiap blok = 1 sesi agent. Copy-paste apa adanya. Sudah berisi fakta kode agar agent tak perlu eksplor ulang (hemat token).
> Baca juga `public/cardbattle/luck-plans.md` untuk konteks.
> Urutan: **L0 → L1 → L2 → L3** (inti), **L4** opsional.

---

## FASE L0 — Storage + API + reward multiplier

```
Attach: @server/storage.js  @server/server.js

Tambahkan "cardBattleProfile" (luck Cangkul per-user) MENGIKUTI PERSIS pola slotProfile yang sudah ada. JANGAN sentuh slotProfile/gachaProfile.

Bentuk profil & range:
  cardBattleProfile = { dealLuck: 0.5 (0..1), cangkulLuck: 0.5 (0..1), rewardMultiplier: 1.0 (0.1..5) }

=== server/storage.js ===
Tiru semua yang dilakukan slotProfile (cari "slotProfile", "SLOT_PROFILE_DEFAULTS", "validateSlotProfile", "normalizeExistingSlotProfile", "ensureSlotProfileTable", "getSlotProfile", "setSlotProfile", "slot_profiles"). Buat padanannya:

1. Defaults (dekat SLOT_PROFILE_DEFAULTS):
   const CARDBATTLE_PROFILE_DEFAULTS = Object.freeze({ dealLuck:0.5, cangkulLuck:0.5, rewardMultiplier:1.0 });
   function defaultCardBattleProfile() { return { ...CARDBATTLE_PROFILE_DEFAULTS }; }

2. Validasi (tiru validateSlotProfile, pakai helper readNumberInRange yang sudah ada):
   function validateCardBattleProfile(p) {
     if (!p || typeof p!=="object" || Array.isArray(p)) throw new Error("cardBattleProfile must be an object");
     return {
       dealLuck: readNumberInRange(p, "dealLuck", 0, 1, "0 and 1"),
       cangkulLuck: readNumberInRange(p, "cangkulLuck", 0, 1, "0 and 1"),
       rewardMultiplier: readNumberInRange(p, "rewardMultiplier", 0.1, 5.0, "0.1 and 5.0"),
     };
   }
   // normalizeExistingCardBattleProfile(p): kembalikan default bila p null, selain itu clamp via validate-style (tiru normalizeExistingSlotProfile).

3. POSTGRES: tabel + ensure fn (tiru ensureSlotProfileTable):
   CREATE TABLE IF NOT EXISTS cardbattle_profiles (
     user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
     deal_luck DOUBLE PRECISION NOT NULL DEFAULT 0.5,
     cangkul_luck DOUBLE PRECISION NOT NULL DEFAULT 0.5,
     reward_multiplier DOUBLE PRECISION NOT NULL DEFAULT 1.0,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )
   Tambah getCardBattleProfile(username) & setCardBattleProfile(username, profile) untuk versi Postgres — TIRU PERSIS getSlotProfile/setSlotProfile (BEGIN/FOR UPDATE/INSERT..ON CONFLICT DO UPDATE/COMMIT). Kolom: deal_luck, cangkul_luck, reward_multiplier.

4. POSTGRES registerUser: setelah INSERT slot_profiles, tambahkan INSERT cardbattle_profiles default (tiru pola yang ada). Panggil ensureCardBattleProfileTable() di tempat ensureSlotProfileTable dipanggil.

5. POSTGRES getAdminOverview: LEFT JOIN cardbattle_profiles cbp ON cbp.user_id=u.id; sertakan cardBattleProfile di objek user (tiru slotProfile di overview). (Opsional jika ribet — tidak wajib untuk fitur ini.)

6. LOCAL JSON:
   - emptyState/user object: di registerUser lokal tambahkan `cardBattleProfile: defaultCardBattleProfile()` (sebaris dgn slotProfile).
   - getCardBattleProfile(username): return normalizeExistingCardBattleProfile(user.cardBattleProfile).
   - setCardBattleProfile(username, profile): user.cardBattleProfile = validateCardBattleProfile(profile); user.updatedAt=...; saveState.
   - Untuk user lama yang belum punya field: normalizeExistingCardBattleProfile harus fallback ke default bila undefined.

7. Daftarkan getCardBattleProfile & setCardBattleProfile di KEDUA objek return createStorage (postgres & local-json) — di sebelah getSlotProfile/setSlotProfile.

=== server/server.js ===
1. Endpoint baru (tiru blok slot-profile yang ada persis di atasnya):
   app.get("/api/me/cardbattle-profile", requireAuth, async (req,res) => {
     try { const cardBattleProfile = await storage.getCardBattleProfile(req.user.username);
           res.json({ username:req.user.username, cardBattleProfile }); }
     catch(err){ sendApiError(res,"me cardbattle profile error",err,"Gagal memuat cardbattle profile"); }
   });
   app.get("/api/admin/cardbattle-profile", requireAuth, requireAdmin, async (req,res) => {
     const username = cleanUsername(req.query.username);
     if(!username) return res.status(400).json({error:"Username is required"});
     try { const cardBattleProfile = await storage.getCardBattleProfile(username);
           res.json({ username, cardBattleProfile }); }
     catch(err){ if(err.statusCode===404) return res.status(404).json({error:"User not found"});
                 sendApiError(res,"admin cardbattle profile get error",err,"Gagal memuat cardbattle profile"); }
   });
   app.patch("/api/admin/cardbattle-profile", requireAuth, requireAdmin, async (req,res) => {
     const username = cleanUsername(req.body.username);
     if(!username) return res.status(400).json({error:"Username is required"});
     try { await storage.setCardBattleProfile(username, req.body.cardBattleProfile);
           const cardBattleProfile = await storage.getCardBattleProfile(username);
           res.json({ success:true, username, cardBattleProfile }); }
     catch(err){ if(err.statusCode===404) return res.status(404).json({error:"User not found"});
                 res.status(400).json({error: err.message || "Invalid cardbattle profile"}); }
   });

2. Reward multiplier (server-enforced). Di handler POST "/api/cardbattle/reward", pada action "single_reward":
   ambil profil & kalikan:
     const prof = await storage.getCardBattleProfile(req.user.username);
     const mult = (prof && prof.rewardMultiplier) || 1;
     change = { gemsDelta: Math.round(CB_CONFIG.SINGLE_PLAYER_WIN_GEMS * mult), type:"cardbattle_single_reward", note:"Reward Cangkul single player" };
   (Pastikan handler jadi async / sudah async.)

Verifikasi:
- node --check server/storage.js && node --check server/server.js
- node -e "const s=require('./server/storage').createStorage({dataFile:'./server/data/_t.json'}); s.registerUser('luitest','pw').then(async()=>{console.log(await s.getCardBattleProfile('luitest')); await s.setCardBattleProfile('luitest',{dealLuck:0.9,cangkulLuck:0.8,rewardMultiplier:2}); console.log(await s.getCardBattleProfile('luitest'));})"
  → cetak default {0.5,0.5,1} lalu {0.9,0.8,2}. Hapus file _t.json setelah tes.
JANGAN ubah perilaku slot/gacha.
```

---

## FASE L1 — Admin dashboard UI

```
Attach: @public/admin.html  @public/admin.js  @public/admin.css

Tambahkan section "🎴 Cangkul Luck Manager" di dashboard admin, MENIRU PERSIS section "🎰 Slot Luck Manager" yang sudah ada. 3 slider + presets + tombol save.

Profil & endpoint (dari Fase L0):
  cardBattleProfile = { dealLuck (0..1), cangkulLuck (0..1), rewardMultiplier (0.1..5) }
  GET  /api/admin/cardbattle-profile?username=...   -> { username, cardBattleProfile }
  PATCH /api/admin/cardbattle-profile  body { username, cardBattleProfile } -> { success, username, cardBattleProfile }

=== public/admin.html ===
Setelah section gacha (id="gachaLuckSection"), tambahkan (pakai class yg sama: panel/panel-head/panel-body/luck-select/luck-label/sliders-grid/slider-box/presets-row/btn-save-luck):

<section class="panel" id="cardbattleLuckSection">
  <div class="panel-head"><h2>🎴 Cangkul Luck Manager</h2></div>
  <div class="panel-body">
    <div style="margin-bottom:20px;">
      <label for="cardbattleLuckPlayerSelect" class="luck-label">Select Player:</label>
      <select id="cardbattleLuckPlayerSelect" class="luck-select"></select>
    </div>
    <div class="sliders-grid">
      <div class="slider-box">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px;">
          <span style="color:var(--muted);font-weight:700;">Deal Luck (tangan awal)</span>
          <span id="valDealLuck" style="color:var(--gold);font-weight:800;">50%</span>
        </div>
        <input type="range" id="sliderDealLuck" min="0" max="100" step="1" value="50">
      </div>
      <div class="slider-box">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px;">
          <span style="color:var(--muted);font-weight:700;">Cangkul Luck (narik pile)</span>
          <span id="valCangkulLuck" style="color:var(--gold);font-weight:800;">50%</span>
        </div>
        <input type="range" id="sliderCangkulLuck" min="0" max="100" step="1" value="50">
      </div>
      <div class="slider-box">
        <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:13px;">
          <span style="color:var(--muted);font-weight:700;">Reward Multiplier</span>
          <span id="valCbReward" style="color:var(--gold);font-weight:800;">1.0x</span>
        </div>
        <input type="range" id="sliderCbReward" min="0.1" max="5" step="0.1" value="1.0">
      </div>
    </div>
    <div class="presets-row">
      <button type="button" onclick="setCardBattlePreset(0.10,0.10,0.5)">💀 KARMA BURUK</button>
      <button type="button" onclick="setCardBattlePreset(0.50,0.50,1.0)">😐 NORMAL</button>
      <button type="button" onclick="setCardBattlePreset(0.70,0.70,1.5)">😊 HOKI</button>
      <button type="button" onclick="setCardBattlePreset(0.95,0.95,3.0)">🍀 SULTAN MODE</button>
    </div>
    <button type="button" class="btn-save-luck" id="btnSaveCardBattleProfile" onclick="saveCardBattleProfile()">💾 SAVE LUCK PROFILE</button>
  </div>
</section>

=== public/admin.js ===
1. Di setupSliders(): daftarkan label slider baru sama seperti slider slot. Format value:
   - sliderDealLuck  -> valDealLuck  : `${value}%`
   - sliderCangkulLuck -> valCangkulLuck : `${value}%`
   - sliderCbReward  -> valCbReward  : `${parseFloat(value).toFixed(1)}x`
   (Ikuti mekanisme update label yang dipakai slider slot — cari cara valJackpot/valMultiplier di-update, termasuk event "update" yang di-dispatch.)

2. Di populatePlayerDropdown(): tambahkan satu baris di samping yang slot/gacha:
   populateLuckSelect("cardbattleLuckPlayerSelect", users, loadCardBattleProfile);

3. Fungsi load (tiru loadSlotProfile):
   async function loadCardBattleProfile(username){
     if(!username) return;
     try{
       const r = await fetch(`/api/admin/cardbattle-profile?username=${encodeURIComponent(username)}`, { headers: authHeaders() });
       const data = await r.json().catch(()=>({}));
       if(!r.ok || !data.cardBattleProfile) throw new Error(data.error || "Gagal memuat cardbattle profile");
       const p = data.cardBattleProfile;
       document.getElementById("sliderDealLuck").value   = p.dealLuck*100;
       document.getElementById("sliderCangkulLuck").value= p.cangkulLuck*100;
       document.getElementById("sliderCbReward").value   = p.rewardMultiplier;
       ["valDealLuck","valCangkulLuck","valCbReward"].forEach(id=>document.getElementById(id)?.dispatchEvent(new Event("update")));
       const u=getDashboardUsers().find(x=>x.username===username); if(u) u.cardBattleProfile=p;
     }catch(err){ showToast(err.message); }
   }

4. Fungsi save (tiru saveSlotProfile):
   async function saveCardBattleProfile(){
     const sel=document.getElementById("cardbattleLuckPlayerSelect"); if(!sel) return;
     const username=sel.value;
     const profile={
       dealLuck: parseFloat(document.getElementById("sliderDealLuck").value)/100,
       cangkulLuck: parseFloat(document.getElementById("sliderCangkulLuck").value)/100,
       rewardMultiplier: parseFloat(document.getElementById("sliderCbReward").value),
     };
     try{
       const r=await fetch("/api/admin/cardbattle-profile",{ method:"PATCH", headers:authHeaders({"Content-Type":"application/json"}), body:JSON.stringify({username, cardBattleProfile:profile}) });
       const data=await r.json().catch(()=>({}));
       if(!r.ok || data.success!==true) throw new Error(data.error || "Gagal menyimpan cardbattle profile");
       const u=getDashboardUsers().find(x=>x.username===username); if(u) u.cardBattleProfile=data.cardBattleProfile||profile;
       showToast(`✅ Cangkul luck updated for ${username}`);
     }catch(err){ showToast(err.message); }
   }

5. Preset:
   function setCardBattlePreset(deal,cangkul,reward){
     document.getElementById("sliderDealLuck").value=deal*100;
     document.getElementById("sliderCangkulLuck").value=cangkul*100;
     document.getElementById("sliderCbReward").value=reward;
     ["valDealLuck","valCangkulLuck","valCbReward"].forEach(id=>document.getElementById(id)?.dispatchEvent(new Event("update")));
   }

=== public/admin.css ===
Tidak perlu style baru (pakai class existing). Tambah hanya jika ada yang kurang.

Verifikasi: buka admin.html sebagai admin → section Cangkul muncul di bawah Gacha, slider bergerak & label %/x update, pilih user → nilai ter-load, SAVE → toast, reload halaman → nilai persist.
```

---

## FASE L2 — deckUtils bias helpers (shared, identik 2 file)

```
Attach: @server/deckUtils.js  @public/cardbattle/deckUtils.js

Tambah 2 fungsi di KEDUA file (HARUS IDENTIK — keduanya satu sumber kebenaran), di dalam factory & di-return. JANGAN ubah buildDeck/shuffle/drawCard/dealHands/drawForSuit/rankValue yang lama.

1) applyHandLuck(hand, pile, luck)
   - luck dalam [0,1]; 0.5 = netral → return tanpa mengubah apa pun.
   - Mutasi `hand` & `pile` IN-PLACE via TUKAR (konservasi total kartu: tiap swap = 1 kartu hand <-> 1 kartu pile).
   - swaps = Math.round(Math.abs(luck - 0.5) * 2 * hand.length)  // 0..hand.length
   - Helper nilai: pakai card.value (A=1 .. K=13).
   - Jika luck > 0.5 (hoki):
       Ulang `swaps` kali: ambil index kartu TERENDAH di hand, dan index kartu TERTINGGI di pile; bila pileHigh.value > handLow.value, tukar keduanya. Berhenti bila tidak ada peningkatan.
       Bonus 7♦: bila luck >= 0.7 dan pile mengandung 7♦ dan hand belum punya, tukar 7♦ dari pile dengan kartu terendah hand (agar jadi leader pertama).
   - Jika luck < 0.5 (sial): kebalikannya — tukar kartu TERTINGGI hand dgn TERENDAH pile (buang kartu bagus).
   - Aman untuk pile kosong / hand kosong (guard).

2) drawForSuitBiased(pile, suit, luck)
   - luck 0.5 → langsung return drawForSuit(pile, suit) (perilaku lama).
   - luck > 0.5: dengan peluang p=(luck-0.5)*2, cari kartu ber-suit di pile, pindahkan ke INDEX TERAKHIR pile (karena drawForSuit pop dari akhir) SEBELUM memanggil drawForSuit → match instan (drawn=[]).
   - luck < 0.5: dengan peluang p=(0.5-luck)*2, pindahkan SEMUA/satu kartu ber-suit menjauh dari akhir (ke index 0) → narik lebih banyak. Lalu drawForSuit.
   - Selalu akhiri dengan `return drawForSuit(pile, suit)`.
   - Tidak reshuffle. Aman bila tak ada kartu ber-suit (drawForSuit handle → matched:null).

Return object: tambah applyHandLuck, drawForSuitBiased.

Verifikasi (node):
  const d=require('./server/deckUtils');
  // konservasi kartu
  let deck=d.buildDeck(); let r=d.dealHands(deck,4,7); let hand=r.hands[0], pile=r.pile; let before=hand.length+pile.length;
  d.applyHandLuck(hand,pile,1.0); console.log("konservasi:", (hand.length+pile.length)===before, "| pile:", pile.length);
  // luck tinggi → match cepat
  let pile2=[{rank:"3",value:3,suit:"♠",isRed:false},{rank:"9",value:9,suit:"♥",isRed:true},{rank:"4",value:4,suit:"♣",isRed:false}];
  let res=d.drawForSuitBiased(pile2,"♥",1.0); console.log("match cepat:", res.matched&&res.matched.suit==="♥", "| drawn:", res.drawn.length);
Pastikan public/cardbattle/deckUtils.js BYTE-IDENTIK pada kedua fungsi ini.
```

---

## FASE L3 — Wire luck ke single-player (client)

```
Attach: @public/cardbattle/cardbattle.js  @public/cardbattle/luck-plans.md

Terapkan luck profil pemain ke single-player Cangkul. Profil diambil dari endpoint read-only GET /api/me/cardbattle-profile (sudah ada dari Fase L0) → { cardBattleProfile: { dealLuck, cangkulLuck, rewardMultiplier } }. deckUtils sudah punya applyHandLuck & drawForSuitBiased (Fase L2).

1. State/var: tambah penampung profil, mis. `let cbLuck = { dealLuck:0.5, cangkulLuck:0.5, rewardMultiplier:1.0 };`
   Destructure helper baru dari DeckUtils: `const { applyHandLuck, drawForSuitBiased } = DeckUtils;` (di samping dealHands/drawForSuit yang sudah ada).

2. Fetch profil saat boot (di DOMContentLoaded, dekat syncWalletFromDatabase):
   fetch("/api/me/cardbattle-profile", { headers: authHeaders() })
     .then(r=>r.json()).then(d=>{ if(d && d.cardBattleProfile) cbLuck = d.cardBattleProfile; })
     .catch(()=>{});
   (Admin: isAdmin() boleh skip; default tetap netral.)

3. initSinglePlayer(): SETELAH `const dealt = dealHands(buildDeck(), 4, CONFIG.DEAL_COUNT);`, bias tangan human (hands[0]) memakai pile:
   applyHandLuck(dealt.hands[0], dealt.pile, cbLuck.dealLuck);
   // (pile sudah dipakai sebagai state.pile setelahnya — pastikan apply DILAKUKAN sebelum state.pile diisi, atau langsung pada dealt.pile lalu state.pile=dealt.pile).
   Catatan: leader pertama (findFirstLeader) dihitung SETELAH bias, jadi efek "pegang 7♦" otomatis berlaku.

4. doCangkul() (cabang single-player saja, JANGAN ubah cabang multiplayer): ganti
   `const result = drawForSuit(state.pile, state.currentSuit);`
   menjadi
   `const result = drawForSuitBiased(state.pile, state.currentSuit, cbLuck.cangkulLuck);`
   (botCangkul TIDAK pakai luck — biarkan bot netral pakai drawForSuit.)

Verifikasi:
- node --check public/cardbattle/cardbattle.js
- Manual: set user ke SULTAN MODE di admin, main SP → tangan awal jelas banyak kartu tinggi & sering pegang 7♦; cangkul nyaris selalu langsung dapat. Set KARMA BURUK → kebalikannya. rewardMultiplier sudah ditangani server (Fase L0).
JANGAN ubah multiplayer & gameplay rules.
```

---

## FASE L4 — (OPSIONAL) Wire luck ke multiplayer (server)

```
Attach: @server/server.js  @server/deckUtils.js

Terapkan luck per-pemain di multiplayer Cangkul (server-side, enforce). deckUtils server sudah punya applyHandLuck & drawForSuitBiased (Fase L2). storage punya getCardBattleProfile (Fase L0).

1. Import helper: di require deckUtils server, tambah applyHandLuck & drawForSuitBiased.
   const { buildDeck:cbBuildDeck, dealHands:cbDealHands, drawForSuit:cbDrawForSuit, rankValue:cbRankValue, applyHandLuck:cbApplyHandLuck, drawForSuitBiased:cbDrawForSuitBiased } = require("./deckUtils");

2. Simpan luck tiap pemain saat START. Di handler cbStartGame (jadikan async), SEBELUM/ SESUDAH cbDealHands:
   - Untuk tiap player p, ambil profil: const prof = await storage.getCardBattleProfile(p.username).catch(()=>null); p.luck = prof || {dealLuck:0.5,cangkulLuck:0.5,rewardMultiplier:1};
   - Setelah `room.pile = dealt.pile`, bias tiap tangan dari pile bersama:
       room.players.forEach((p,i)=> cbApplyHandLuck(dealt.hands[i], room.pile, p.luck.dealLuck));
     (urutan pemain sembarang; pile menyusut konservatif). Set room.pileCount = room.pile.length SETELAH bias.
   - Leader 7♦ dihitung SETELAH bias (kode existing setelahnya sudah cari 7♦).

3. cbHandleCangkul(room, player): ganti
   `const result = cbDrawForSuit(room.pile, room.currentSuit);`
   menjadi
   `const luck = (player.luck && player.luck.cangkulLuck) != null ? player.luck.cangkulLuck : 0.5;`
   `const result = cbDrawForSuitBiased(room.pile, room.currentSuit, luck);`

4. cbEndGame(room): saat payout pemenang, kalikan rewardMultiplier pemenang:
   const mult = (winner.luck && winner.luck.rewardMultiplier) || 1;
   gemsDelta: Math.round(CB_CONFIG.SINGLE_PLAYER_WIN_GEMS * mult)
   (winner.luck sudah tersimpan dari langkah 2; bila tak ada, fetch via storage.getCardBattleProfile(winner.username) sebagai fallback.)

Verifikasi: node --check server/server.js. Manual 2 tab: set 1 user SULTAN, 1 user KARMA BURUK → user SULTAN dapat tangan jauh lebih bagus & cangkul cepat; pemenang dapat gems × multiplier. Tangan lawan tetap tak bocor.
JANGAN ubah validasi suit / turn order / event names.
```

---

## Catatan eksekusi
- Backup file besar sebelum edit (bukan git repo): `cp server/server.js server/server.js.bak`.
- Setelah tiap fase: `node --check` file yang diubah.
- Inti selesai di L3. L4 hanya bila multiplayer ingin ikut di-rig.
