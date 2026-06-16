/* ═══════════════════════════════════════════════════════════════════
   BASIKAL CANGKUL — Game Engine (Single Player + Multiplayer)
   ═══════════════════════════════════════════════════════════════════ */

/* ── AUTH ── */
const currentUser = localStorage.getItem("currentUser");
const authToken = localStorage.getItem("authToken");
if (!currentUser || !authToken) {
  localStorage.removeItem("currentUser");
  window.location.href = "../login.html";
}

let users = JSON.parse(localStorage.getItem("users")) || {};
let userData = users[currentUser] || { username: currentUser, gems: 0, coins: 0, fruit: 0 };

function isAdmin() { return userData && userData.isAdmin === true; }

function authHeaders(extra = {}) {
  return { ...extra, Authorization: `Bearer ${authToken}` };
}

function logout() {
  localStorage.removeItem("currentUser");
  localStorage.removeItem("authToken");
  window.location.href = "../login.html";
}

function applyRemoteUser(nextUserData) {
  userData = { ...userData, ...nextUserData };
  users[currentUser] = userData;
  localStorage.setItem("users", JSON.stringify(users));
}

async function syncWalletFromDatabase() {
  if (!currentUser || isAdmin()) return;
  try {
    const response = await fetch("/api/me", { headers: authHeaders() });
    const data = await response.json();
    if (!response.ok || !data.success) throw new Error(data.message || "Gagal sinkron wallet");
    applyRemoteUser(data.user);
    updateCurrencyUI();
  } catch (error) {
    console.warn("Gagal sinkron wallet card battle:", error.message);
  }
}

function saveUserData() {
  users[currentUser] = userData;
  localStorage.setItem("users", JSON.stringify(users));
}

async function requestCardBattleReward(action, payload = {}) {
  if (isAdmin()) return { delta: { gems: 0 }, user: userData };
  const response = await fetch("/api/cardbattle/reward", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ action, ...payload }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || "Gagal memproses Card Battle");
  applyRemoteUser(data.user);
  updateCurrencyUI();
  return data;
}

function updateCurrencyUI() {
  const gemsEl  = document.getElementById("gems-display");
  const coinsEl = document.getElementById("coins-display");
  if (isAdmin()) {
    gemsEl.textContent = "∞";
    coinsEl.textContent = "∞";
  } else {
    gemsEl.textContent  = (userData.gems  || 0).toLocaleString("id-ID");
    coinsEl.textContent = (userData.coins || 0).toLocaleString("id-ID");
  }
}

/* ── GAME CONSTANTS ── */
const DeckUtils = window.BasikalDeckUtils;
if (!DeckUtils) throw new Error("Deck utils gagal dimuat");
const { buildDeck, shuffle, dealHands, drawForSuit, rankValue, applyHandLuck, drawForSuitBiased } = DeckUtils;

let cbLuck = { dealLuck: 0.5, cangkulLuck: 0.5, rewardMultiplier: 1.0 };

const CONFIG = {
  STARTING_CHIPS: 1000,
  HAND_SIZE: 5,
  BASE_ANTE: 10,
  ANTE_INCREMENT: 5,
  ANTE_INCREASE_EVERY: 3,
  ROUND_TIMER: 15,
  MAX_ROUNDS: 20,
  ENTRY_FEE_GEMS: 50,
  PAYOUT_RATIO: 0.5,
  DEAL_COUNT: 7,
  BOT_NAMES: ["NeonBot", "CyberAI", "GlowKing", "PixelHunter", "ChromaX", "VoltLord"],
};

const BOT_AVATARS = ["🤖","👾","🎭","🧠","⚡","🦾"];

const SUIT_NAMES = { "♠": "Sekop", "♥": "Hati", "♦": "Wajik", "♣": "Keriting" };
function suitName(s) { return SUIT_NAMES[s] || s; }

/* ── GAME STATE ── */
const state = {
  mode: null,
  players: [],
  pot: 0,
  round: 1,
  ante: CONFIG.BASE_ANTE,
  carryOver: false,
  deck: [],
  phase: "waiting",
  selectedCardIdx: null,
  currentLeaderId: null,
  currentTurnId: null,
  turnOrder: [],
  turnIndex: 0,
  timer: 0,
  timerInterval: null,
  roundsPlayed: 0,
  // Cangkul additions
  currentSuit: null,
  pile: [],
  pileCount: 0,
  finishOrder: [],
  skipCount: 0,
};

let socket = null;
let mpRoomCode = null;
let mpIsHost = false;
let mpEntryCharged = false;

/* ═══════════════════════════════════════════════════
   MODE SELECTION
   ═══════════════════════════════════════════════════ */
async function selectMode(mode) {
  if (mode === "single") {
    if (!(await chargeEntryFee())) return;
    state.mode = "single";
    document.getElementById("mode-overlay").style.display = "none";
    document.getElementById("cb-main").style.display = "flex";
    initSinglePlayer();
  } else if (mode === "multi") {
    state.mode = "multi";
    mpEntryCharged = false;
    document.getElementById("mode-overlay").style.display = "none";
    document.getElementById("mp-overlay").style.display = "flex";
    initMultiplayer();
  }
}

async function chargeEntryFee() {
  if (isAdmin()) return true;
  if ((userData.gems || 0) < CONFIG.ENTRY_FEE_GEMS) {
    showToast(`Entry fee ${CONFIG.ENTRY_FEE_GEMS} 💎 — saldo gems kurang!`, "error");
    return false;
  }
  try {
    await requestCardBattleReward("entry_fee");
    return true;
  } catch (err) {
    showToast(err.message, "error");
    return false;
  }
}

function hasEntryFeeBalance() {
  return isAdmin() || (userData.gems || 0) >= CONFIG.ENTRY_FEE_GEMS;
}

async function chargeMultiplayerEntryFee() {
  if (mpEntryCharged) return true;
  if (!(await chargeEntryFee())) return false;
  mpEntryCharged = true;
  showToast(`Entry fee ${CONFIG.ENTRY_FEE_GEMS} 💎 dibayar.`, "success");
  return true;
}

/* ═══════════════════════════════════════════════════
   SINGLE PLAYER INIT
   ═══════════════════════════════════════════════════ */
function initSinglePlayer() {
  const dealt = dealHands(buildDeck(), 4, CONFIG.DEAL_COUNT);
  applyHandLuck(dealt.hands[0], dealt.pile, cbLuck.dealLuck);

  state.pile = dealt.pile;
  state.pileCount = dealt.pile.length;
  state.currentSuit = null;
  state.finishOrder = [];
  state.skipCount = 0;
  state.round = 1;
  state.roundsPlayed = 0;
  state.phase = "waiting";
  state.selectedCardIdx = null;
  state.currentTurnId = null;
  state.turnOrder = [];
  state.turnIndex = 0;

  state.players = [];

  // Human player
  state.players.push({
    id: "you",
    name: currentUser,
    avatar: (currentUser || "U").charAt(0).toUpperCase(),
    chips: CONFIG.STARTING_CHIPS,
    hand: dealt.hands[0],
    isBot: false,
    isYou: true,
    picked: null,
    pickedCard: null,
    eliminated: false,
    finishRank: null,
    drawnCount: 0,
    isCangkuling: false,
  });

  const shuffledNames = shuffle(CONFIG.BOT_NAMES).slice(0, 3);
  for (let i = 0; i < 3; i++) {
    state.players.push({
      id: `bot${i}`,
      name: shuffledNames[i],
      avatar: BOT_AVATARS[i],
      chips: CONFIG.STARTING_CHIPS,
      hand: dealt.hands[i + 1],
      isBot: true,
      isYou: false,
      picked: null,
      pickedCard: null,
      eliminated: false,
      finishRank: null,
      drawnCount: 0,
      isCangkuling: false,
    });
  }

  state.currentLeaderId = findFirstLeader();

  renderAll();
  startRound();
}

function findFirstLeader() {
  // Cari pemegang 7♦
  for (const p of state.players) {
    if (p.hand.some(c => c.rank === "7" && c.suit === "♦")) return p.id;
  }
  // Fallback: nilai kartu terendah
  let minVal = Infinity;
  let leaderId = state.players[0].id;
  for (const p of state.players) {
    for (const c of p.hand) {
      if (c.value < minVal) { minVal = c.value; leaderId = p.id; }
    }
  }
  return leaderId;
}

/* ═══════════════════════════════════════════════════
   ROUND FLOW (Single Player)
   ═══════════════════════════════════════════════════ */
function startRound() {
  state.phase = "leading";
  state.currentSuit = null;
  state.skipCount = 0;
  state.selectedCardIdx = null;
  state.players.forEach(p => { p.picked = null; p.pickedCard = null; });

  const active = state.players.filter(p => !p.eliminated);
  if (active.length <= 1) { checkGameOver(); return; }

  renderAll();
  buildSingleTurnOrder(active);
  advanceSingleTurn();
}

function buildSingleTurnOrder(alivePlayers) {
  let leader = alivePlayers.find(p => p.id === state.currentLeaderId);
  if (!leader) leader = alivePlayers[0];
  state.currentLeaderId = leader.id;

  const leaderIndex = alivePlayers.findIndex(p => p.id === leader.id);
  const ordered = alivePlayers.slice(leaderIndex).concat(alivePlayers.slice(0, leaderIndex));
  state.turnOrder = ordered.map(p => p.id);
  state.turnIndex = 0;
  state.currentTurnId = state.turnOrder[0] || null;
}

function getCurrentSingleTurnPlayer() {
  if (state.mode !== "single") return null;
  if (state.phase !== "leading" && state.phase !== "following") return null;
  const id = state.turnOrder[state.turnIndex];
  return state.players.find(p => p.id === id && !p.eliminated) || null;
}

function advanceSingleTurn() {
  if (state.mode !== "single") return;
  if (state.phase !== "leading" && state.phase !== "following") return;

  // Semua sudah giliran → resolve
  if (state.turnIndex >= state.turnOrder.length) {
    state.currentTurnId = null;
    return resolveRound();
  }

  const id = state.turnOrder[state.turnIndex];
  const player = state.players.find(p => p.id === id);

  // Lewati yang sudah picked atau eliminated
  if (!player || player.eliminated || player.picked != null) {
    state.turnIndex++;
    return advanceSingleTurn();
  }

  state.currentTurnId = player.id;
  state.selectedCardIdx = null;
  renderAll();
  updateCangkulBtn();

  const isFollowing = state.phase === "following";
  const hasSuit = isFollowing && player.hand.some(c => c.suit === state.currentSuit);

  if (player.isBot) {
    stopTimer();
    const delay = 700 + Math.random() * 600;
    setTimeout(() => {
      if (state.mode !== "single") return;
      if (state.currentTurnId !== player.id) return;
      if (player.eliminated || player.picked != null) return;

      if (isFollowing && !hasSuit) {
        botCangkul(player);
      } else {
        const idx = botChooseCard(player);
        if (idx >= 0) {
          botSubmitCard(player, idx);
        } else {
          skipTurn(player);
        }
      }
    }, delay);
    return;
  }

  // Human turn
  let phaseTxt;
  if (!isFollowing) {
    phaseTxt = "Giliran kamu LEAD — buang kartu bebas.";
  } else if (hasSuit) {
    phaseTxt = `Giliran kamu — ikuti suit ${state.currentSuit} (${suitName(state.currentSuit)})`;
  } else if (state.pile.length > 0) {
    phaseTxt = `Tidak punya ${state.currentSuit} — tekan ⛏️ CANGKUL`;
  } else {
    phaseTxt = "Tidak punya suit & pile habis — skip otomatis";
  }
  setPhaseText(phaseTxt);

  // Auto-skip jika pile habis dan tak punya suit
  if (isFollowing && !hasSuit && state.pile.length === 0) {
    setTimeout(() => {
      if (state.currentTurnId === player.id) skipTurn(player);
    }, 600);
    return;
  }

  startTimer(CONFIG.ROUND_TIMER);
}

function submitSingleCard(player, cardIdx) {
  if (!player || cardIdx < 0 || cardIdx >= player.hand.length) return;
  const card = player.hand[cardIdx];

  // Validasi following
  if (state.phase === "following" && card.suit !== state.currentSuit) {
    if (player.isYou) showToast(`Harus buang suit ${state.currentSuit}!`, "error");
    return;
  }

  // Keluarkan dari tangan
  player.hand.splice(cardIdx, 1);
  player.pickedCard = card;
  player.picked = cardIdx;

  // Lead → set suit & ganti phase
  if (state.phase === "leading") {
    state.currentSuit = card.suit;
    state.phase = "following";
  }

  state.selectedCardIdx = null;
  stopTimer();
  checkFinished(player);
  renderOpponents();
  renderHand();
  renderRevealSlots();
  updateCangkulBtn();

  state.turnIndex++;
  advanceSingleTurn();
}

function botChooseCard(bot) {
  const hand = bot.hand;
  if (hand.length === 0) return -1;

  if (state.phase === "leading") {
    // Suit terbanyak, value terendah dari suit itu
    const suitCount = {};
    hand.forEach(c => { suitCount[c.suit] = (suitCount[c.suit] || 0) + 1; });
    const bestSuit = Object.keys(suitCount).sort((a, b) => suitCount[b] - suitCount[a])[0];
    const suitCards = hand.map((c, i) => ({ c, i })).filter(x => x.c.suit === bestSuit);
    return suitCards.sort((a, b) => a.c.value - b.c.value)[0].i;
  }

  // Following
  const suitCards = hand.map((c, i) => ({ c, i })).filter(x => x.c.suit === state.currentSuit);
  if (suitCards.length === 0) return -1; // akan trigger botCangkul

  const sorted = suitCards.sort((a, b) => a.c.value - b.c.value);
  if (hand.length <= 4) return sorted[sorted.length - 1].i;  // agresif: tertinggi
  if (hand.length >= 8) return sorted[0].i;                   // defensif: terendah
  return sorted[Math.floor(sorted.length / 2)].i;             // median
}

function botSubmitCard(bot, cardIdx) {
  submitSingleCard(bot, cardIdx);
}

/* ── CANGKUL ── */
function doCangkul() {
  if (state.phase !== "following") return;
  const you = state.players.find(p => p.isYou);
  if (!you || state.currentTurnId !== you.id) return;
  if (you.hand.some(c => c.suit === state.currentSuit)) {
    showToast(`Kamu punya suit ${state.currentSuit}!`, "error");
    return;
  }

  // Multiplayer: kirim ke server
  if (state.mode === "multi") {
    if (!socket) return;
    stopTimer();
    updateCangkulBtn(false);
    setPhaseText("Mencangkul dari pile...");
    socket.emit("cbCangkul", { roomCode: mpRoomCode });
    return;
  }

  stopTimer();
  updateCangkulBtn(false);

  const result = drawForSuitBiased(state.pile, state.currentSuit, cbLuck.cangkulLuck);
  state.pileCount = state.pile.length;
  you.drawnCount += result.drawn.length + (result.matched ? 1 : 0);
  animateCangkulDraw([...result.drawn, ...(result.matched ? [result.matched] : [])]);
  you.hand.push(...result.drawn);

  if (result.matched) {
    showToast(`⛏️ Dapat ${result.matched.rank}${result.matched.suit}!`, "success");
    you.pickedCard = result.matched;
    you.picked = "cangkul";
    renderRevealSlots();
    renderOpponents();
    renderHand();
    renderAll(true);
    state.turnIndex++;
    advanceSingleTurn();
  } else {
    showToast("Pile habis — skip!", "error");
    renderAll(true);
    skipTurn(you);
  }
}

function botCangkul(bot) {
  bot.isCangkuling = true;
  renderOpponents();

  setTimeout(() => {
    if (state.currentTurnId !== bot.id) { bot.isCangkuling = false; return; }

    const result = drawForSuit(state.pile, state.currentSuit);
    state.pileCount = state.pile.length;
    bot.drawnCount += result.drawn.length + (result.matched ? 1 : 0);
    bot.hand.push(...result.drawn);
    bot.isCangkuling = false;

    if (result.matched) {
      bot.pickedCard = result.matched;
      bot.picked = "cangkul";
      renderRevealSlots();
      renderOpponents();
      renderAll(true);
      state.turnIndex++;
      advanceSingleTurn();
    } else {
      renderAll(true);
      skipTurn(bot);
    }
  }, 900);
}

function skipTurn(player) {
  player.picked = "skip";
  player.pickedCard = null;
  state.skipCount++;
  renderOpponents();
  state.turnIndex++;
  advanceSingleTurn();
}

function checkFinished(player) {
  if (player.eliminated || player.hand.length > 0) return;
  player.eliminated = true;
  player.finishRank = state.finishOrder.length + 1;
  state.finishOrder.push(player.id);
  showToast(`${player.isYou ? "Kamu" : player.name} selesai — Rank #${player.finishRank}!`, "success");
}

function checkGameOver() {
  const remaining = state.players.filter(p => !p.eliminated);
  if (remaining.length <= 1) {
    if (remaining.length === 1) {
      const last = remaining[0];
      last.finishRank = state.players.length;
      state.finishOrder.push(last.id);
    }
    const winner = state.players.find(p => p.finishRank === 1) || null;
    endGame(winner);
    return true;
  }
  return false;
}

/* ── RESOLVE ROUND ── */
function resolveRound() {
  state.phase = "resolving";
  renderRevealSlots();

  const slots = document.querySelectorAll(".reveal-slot");
  slots.forEach((s, i) => {
    setTimeout(() => s.classList.add("revealing"), 300 + i * 200);
  });

  // Semua skip? (sertakan pemain yang baru saja habis kartunya trick ini —
  // kartunya tetap ikut resolusi, design §2 kondisi 3. picked!=null hanya untuk
  // yang beraksi trick ini karena startRound mereset picked semua pemain.)
  const activePlayed = state.players.filter(p => p.picked != null);
  const allSkipped = activePlayed.length === 0 || activePlayed.every(p => p.picked === "skip");

  if (allSkipped) {
    setTimeout(() => {
      showRoundResult("tie", "Semua skip — trick batal. Leader tetap.");
      state.skipCount = 0;
      setTimeout(() => {
        hideRoundResult();
        document.querySelectorAll(".opponent-card.winner").forEach(c => c.classList.remove("winner"));
        if (!checkGameOver()) startRound();
      }, 2500);
    }, 300 + state.players.length * 200 + 400);
    return;
  }

  // Kartu yang masuk suit
  const suitPlayed = activePlayed.filter(
    p => p.picked !== "skip" && p.pickedCard && p.pickedCard.suit === state.currentSuit
  );

  setTimeout(() => {
    let winner = null;

    if (suitPlayed.length > 0) {
      const maxVal = Math.max(...suitPlayed.map(p => rankValue(p.pickedCard)));
      winner = suitPlayed.find(p => rankValue(p.pickedCard) === maxVal);
    } else {
      // Tidak ada yg follow suit (harusnya tidak terjadi dengan validasi) → treat all-skip
      showRoundResult("tie", "Tidak ada yang bisa follow suit — trick batal.");
      state.skipCount = 0;
      setTimeout(() => {
        hideRoundResult();
        document.querySelectorAll(".opponent-card.winner").forEach(c => c.classList.remove("winner"));
        if (!checkGameOver()) startRound();
      }, 2500);
      return;
    }

    // Highlight pemenang
    const winSlot = Array.from(slots).find(s => s.dataset.playerId === winner.id);
    if (winSlot) winSlot.classList.add("winner");
    const oppCard = document.querySelector(`.opponent-card[data-player-id="${winner.id}"]`);
    if (oppCard) oppCard.classList.add("winner");

    if (winner.isYou) {
      showRoundResult("win", `🏆 Kamu menang trick #${state.round}!`);
    } else {
      showRoundResult("lose", `${winner.name} menang trick #${state.round}.`);
    }

    // Leader berikutnya
    let nextLeaderId = winner.id;
    if (winner.eliminated) {
      // Pemenang baru saja habis kartunya → cari non-finished berikutnya
      const idx = state.turnOrder.indexOf(winner.id);
      for (let i = 1; i <= state.turnOrder.length; i++) {
        const cand = state.players.find(
          p => p.id === state.turnOrder[(idx + i) % state.turnOrder.length] && !p.eliminated
        );
        if (cand) { nextLeaderId = cand.id; break; }
      }
    }
    state.currentLeaderId = nextLeaderId;
    state.roundsPlayed++;
    state.round++;

    renderAll(true);

    setTimeout(() => {
      if (checkGameOver()) return;
      hideRoundResult();
      document.querySelectorAll(".opponent-card.winner").forEach(c => c.classList.remove("winner"));
      startRound();
    }, 3000);
  }, 300 + state.players.length * 200 + 500);
}

/* ── TIMER ── */
function startTimer(seconds) {
  state.timer = seconds;
  updateTimer();
  stopTimer();
  state.timerInterval = setInterval(() => {
    state.timer--;
    updateTimer();
    if (state.timer <= 0) {
      stopTimer();
      autoSubmitForLatePlayers();
    }
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function updateTimer() {
  const txt = document.getElementById("timer-text");
  const fill = document.getElementById("timer-fill");
  if (txt) txt.textContent = state.timer;
  if (fill) {
    const ratio = state.timer / CONFIG.ROUND_TIMER;
    const RING_LEN = 276.46;
    fill.style.strokeDashoffset = `${RING_LEN * (1 - ratio)}`;
    fill.classList.toggle("warn", state.timer <= 7 && state.timer > 3);
    fill.classList.toggle("danger", state.timer <= 3);
  }
}

function autoSubmitForLatePlayers() {
  if (state.mode === "single") {
    const current = getCurrentSingleTurnPlayer();
    if (!current) return;

    const isFollowing = state.phase === "following";
    const hasSuit = isFollowing && current.hand.some(c => c.suit === state.currentSuit);

    if (isFollowing && !hasSuit) {
      if (state.pile.length > 0) {
        // Auto cangkul untuk player (trigger doCangkul jika human)
        if (current.isYou) {
          doCangkul();
        } else {
          botCangkul(current);
        }
      } else {
        skipTurn(current);
      }
      return;
    }

    // Pilih kartu valid secara random
    const playable = current.hand
      .map((c, i) => ({ c, i }))
      .filter(x => !isFollowing || x.c.suit === state.currentSuit);

    if (playable.length === 0) { skipTurn(current); return; }

    const pick = playable[Math.floor(Math.random() * playable.length)];
    if (current.isYou) showToast("Waktu habis! Kartu dipilih random.", "error");
    submitSingleCard(current, pick.i);
    return;
  }

  // Multiplayer: auto-pick random
  state.players.forEach(p => {
    if (p.eliminated || p.picked != null) return;
    if (p.hand.length === 0) return;
    const idx = Math.floor(Math.random() * p.hand.length);
    p.pickedCard = p.hand[idx];
    p.picked = idx;
    if (p.isYou) showToast("Waktu habis! Kartu dipilih random.", "error");
  });
  renderHand();
  renderOpponents();
}

/* ── HAND SELECTION ── */
function selectHandCard(idx) {
  if (state.phase !== "leading" && state.phase !== "following") return;
  const you = state.players.find(p => p.isYou);
  if (!you || you.eliminated) return;
  if (state.currentTurnId !== you.id) return; // turn-based SP & MP

  // Validasi suit saat following
  if (state.phase === "following") {
    const card = you.hand[idx];
    if (card && card.suit !== state.currentSuit && you.hand.some(c => c.suit === state.currentSuit)) {
      showToast(`Harus buang suit ${state.currentSuit}!`, "error");
      return;
    }
  }

  if (state.selectedCardIdx === idx) {
    state.selectedCardIdx = null;
  } else {
    state.selectedCardIdx = idx;
  }
  renderHand();
}

function confirmPickedCard() {
  if (state.phase !== "leading" && state.phase !== "following") return;
  const you = state.players.find(p => p.isYou);
  if (!you || you.eliminated || state.selectedCardIdx == null) return;
  if (you.picked != null) return;

  if (state.mode === "multi") {
    if (!socket) return;
    if (state.currentTurnId !== you.id) { showToast("Bukan giliranmu!", "error"); return; }
    socket.emit("cbPlayCard", { roomCode: mpRoomCode, cardIdx: state.selectedCardIdx });
    setPhaseText("Mengirim kartu...");
    // Jangan optimistik ubah tangan — tunggu cbReveal dari server agar tak desync
    return;
  }

  if (state.currentTurnId !== you.id) return;
  submitSingleCard(you, state.selectedCardIdx);
}

/* ── UPDATE CANGKUL BTN ── */
function updateCangkulBtn(show) {
  const btn = document.getElementById("cangkul-btn");
  if (!btn) return;

  if (show === false) { btn.style.display = "none"; return; }

  const you = state.players.find(p => p.isYou);
  const visible = you
    && !you.eliminated
    && state.currentTurnId === you.id
    && state.phase === "following"
    && !you.hand.some(c => c.suit === state.currentSuit)
    && state.pileCount > 0; // pileCount dipertahankan di SP & MP (state.pile kosong di MP)

  btn.style.display = visible ? "inline-flex" : "none";
}

/* ── ANIMASI CANGKUL: kartu terbang dari #deck-pile ke #player-hand ── */
function animateCangkulDraw(cards) {
  const pile = document.getElementById("deck-pile");
  const hand = document.getElementById("player-hand");
  if (!hand || !cards || !cards.length) return;

  const pileRect = pile ? pile.getBoundingClientRect() : null;
  const handRect = hand.getBoundingClientRect();
  // Fallback ke tengah layar bila pile tak terlihat (mis. sudah habis)
  const startX = pileRect && pileRect.width ? pileRect.left : window.innerWidth / 2 - 30;
  const startY = pileRect && pileRect.height ? pileRect.top : window.innerHeight / 2;

  cards.slice(0, 6).forEach((card, i) => {
    const fly = document.createElement("div");
    fly.className = "cangkul-fly" + (card && card.isRed ? " red" : "");
    fly.innerHTML = card
      ? `<span class="card-rank">${card.rank}</span><span class="card-suit">${card.suit}</span>`
      : "";
    fly.style.left = `${startX}px`;
    fly.style.top = `${startY}px`;
    document.body.appendChild(fly);

    // Picu transisi pada frame berikutnya, beri stagger antar kartu
    const targetX = handRect.left + handRect.width / 2 - 30 + (i - cards.length / 2) * 14;
    const targetY = handRect.top + 16;
    setTimeout(() => {
      requestAnimationFrame(() => {
        fly.style.left = `${targetX}px`;
        fly.style.top = `${targetY}px`;
        fly.style.opacity = "0.15";
        fly.style.transform = "scale(0.7) rotate(8deg)";
      });
    }, i * 80);

    setTimeout(() => fly.remove(), 750 + i * 80);
  });
}

/* ═══════════════════════════════════════════════════
   END GAME
   ═══════════════════════════════════════════════════ */
async function endGame(winner) {
  state.phase = "gameover";
  stopTimer();
  updateCangkulBtn(false);

  const you = state.players.find(p => p.isYou);
  const youWon = winner && winner.isYou;
  let gemsReward = 0;

  if (youWon && !isAdmin()) {
    try {
      const rewardData = await requestCardBattleReward("single_reward");
      gemsReward = rewardData.delta ? rewardData.delta.gems : 0;
      userData.totalCBWins = (userData.totalCBWins || 0) + 1;
    } catch (err) {
      showToast(err.message, "error");
    }
  }
  userData.totalCBGames = (userData.totalCBGames || 0) + 1;
  saveUserData();
  updateCurrencyUI();

  const overlay = document.getElementById("game-over-overlay");
  const icon  = document.getElementById("go-icon");
  const title = document.getElementById("go-title");
  const sub   = document.getElementById("go-sub");

  if (youWon) {
    icon.textContent = "🏆";
    title.textContent = "VICTORY!";
    title.classList.remove("lose");
    sub.textContent = `Kamu pertama habiskan kartu dalam ${state.roundsPlayed} trick!`;
    spawnConfetti();
  } else if (you && you.finishRank && you.finishRank < state.players.length) {
    icon.textContent = "🥈";
    title.textContent = `RANK #${you.finishRank}`;
    title.classList.remove("lose");
    sub.textContent = winner ? `${winner.name} menang lebih dulu.` : "Game berakhir.";
  } else {
    icon.textContent = "💀";
    title.textContent = "JURU KUNCI";
    title.classList.add("lose");
    sub.textContent = "Kamu pemain terakhir yang habiskan kartu.";
  }

  // go-stats: tampilkan kartu cangkul & trick dimainkan
  const finalCardsDrawn = you ? you.drawnCount : 0;
  document.getElementById("go-final-chips").textContent = `${finalCardsDrawn} kartu`;
  document.getElementById("go-gems-reward").textContent = `${gemsReward.toLocaleString("id-ID")} 💎`;
  document.getElementById("go-rounds").textContent = state.roundsPlayed;

  renderFinalRanking(getLocalFinalRanking(), you ? you.id : null);
  overlay.style.display = "flex";
}

function getLocalFinalRanking() {
  return state.players
    .slice()
    .sort((a, b) => {
      const ra = a.finishRank != null ? a.finishRank : 999;
      const rb = b.finishRank != null ? b.finishRank : 999;
      return ra - rb;
    })
    .map(p => ({
      id: p.id,
      username: p.name || p.username || "Player",
      chips: p.hand ? p.hand.length : 0,
      eliminated: !!p.eliminated,
      finishRank: p.finishRank,
    }));
}

function renderFinalRanking(ranking, currentPlayerId) {
  const wrap = document.getElementById("go-ranking");
  const list = document.getElementById("go-ranking-list");
  if (!wrap || !list) return;

  const rows = (ranking || []).filter(Boolean);
  if (rows.length === 0) { wrap.hidden = true; list.innerHTML = ""; return; }

  list.innerHTML = rows.map((p, index) => {
    const name = escapeHtml(p.username || p.name || "Player");
    const isYou = p.id === currentPlayerId;
    const rankNum = p.finishRank || (index + 1);
    const status = rankNum === 1 ? "🥇 1ST" : rankNum === rows.length ? "💀 LAST" : `#${rankNum}`;
    return `
      <div class="go-rank-row ${isYou ? "you" : ""}">
        <span class="go-rank-pos">#${index + 1}</span>
        <span class="go-rank-name">${name}${isYou ? " (YOU)" : ""}</span>
        <span class="go-rank-status ${rankNum === rows.length ? "out" : ""}">${status}</span>
        <span class="go-rank-chips">${p.chips} kartu</span>
      </div>
    `;
  }).join("");
  wrap.hidden = false;
}

function spawnConfetti() {
  const container = document.getElementById("go-confetti");
  if (!container) return;
  container.innerHTML = "";
  const colors = ["#FFD700", "#D81B3A", "#a855f7", "#22d3ee", "#00ff80"];
  for (let i = 0; i < 60; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}%`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 2}s`;
    piece.style.animationDuration = `${2 + Math.random() * 2}s`;
    container.appendChild(piece);
  }
}

function restartGame() {
  if (state.mode === "multi" && socket) {
    socket.emit("cbLeaveRoom");
    socket.disconnect();
    socket = null;
  }
  mpRoomCode = null;
  mpIsHost = false;
  mpEntryCharged = false;
  document.getElementById("game-over-overlay").style.display = "none";
  document.getElementById("cb-main").style.display = "none";
  document.getElementById("mode-overlay").style.display = "flex";

  state.players = [];
  state.pot = 0; state.round = 1;
  state.ante = CONFIG.BASE_ANTE;
  state.carryOver = false;
  state.phase = "waiting";
  state.roundsPlayed = 0;
  state.currentLeaderId = null;
  state.currentTurnId = null;
  state.turnOrder = [];
  state.turnIndex = 0;
  state.currentSuit = null;
  state.pile = [];
  state.pileCount = 0;
  state.finishOrder = [];
  state.skipCount = 0;
  hideRoundResult();
  updateCangkulBtn(false);
}

async function surrender() {
  if (state.mode === "multi") {
    if (!socket || !mpRoomCode) return;
    if (!confirm("Yakin menyerah? Kamu akan dieliminasi dari permainan.")) return;
    socket.emit("cbSurrender", { roomCode: mpRoomCode });
    stopTimer();
    state.phase = "gameover";
    const you = state.players.find(p => p.isYou);
    const overlay = document.getElementById("game-over-overlay");
    const icon   = document.getElementById("go-icon");
    const title  = document.getElementById("go-title");
    const sub    = document.getElementById("go-sub");
    icon.textContent  = "🏳️";
    title.textContent = "MENYERAH";
    title.classList.add("lose");
    sub.textContent   = "Kamu menyerah dari permainan multiplayer.";
    document.getElementById("go-final-chips").textContent = "—";
    document.getElementById("go-gems-reward").textContent = "0 💎";
    document.getElementById("go-rounds").textContent = state.round;
    renderFinalRanking(getLocalFinalRanking(), you ? you.id : null);
    overlay.style.display = "flex";
    return;
  }

  if (!confirm("Yakin menyerah? Tidak ada refund gems.")) return;
  const you = state.players.find(p => p.isYou);
  if (!you) return;
  if (!isAdmin()) {
    try {
      const refundData = await requestCardBattleReward("surrender_refund");
      const refund = refundData.delta ? refundData.delta.gems : 0;
      if (refund > 0) showToast(`Refund: +${refund} 💎`, "success");
    } catch (err) {
      showToast(err.message, "error");
    }
  }
  stopTimer();
  state.phase = "gameover";
  setTimeout(() => endGame(null), 600);
}

/* ═══════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════ */
function renderAll(skipSlots = false) {
  document.getElementById("round-num").textContent = state.round;
  // Suit aktif di #pot-amount
  const potEl = document.getElementById("pot-amount");
  if (potEl) potEl.textContent = state.currentSuit || "—";
  // Sisa pile di #ante-amount
  const anteEl = document.getElementById("ante-amount");
  if (anteEl) anteEl.textContent = state.pileCount;

  document.getElementById("player-name").textContent = currentUser;
  const avatarEl = document.getElementById("player-avatar");
  if (avatarEl) avatarEl.textContent = (currentUser || "U").charAt(0).toUpperCase();

  renderOpponents();
  renderHand();
  if (!skipSlots) renderRevealSlots();
}

function renderOpponents() {
  const row = document.getElementById("opponents-row");
  if (!row) return;
  const opps = state.players.filter(p => !p.isYou);
  row.innerHTML = opps.map(p => {
    const isTurn = state.mode === "single" && state.currentTurnId === p.id;
    const dotClass = p.eliminated
      ? ""
      : p.isCangkuling
        ? "cangkuling"
        : isTurn
          ? "turn"
          : p.picked != null
            ? "picked"
            : "thinking";

    const rankBadge = p.finishRank
      ? `<span class="rank-badge rank-${p.finishRank === state.players.length ? "last" : p.finishRank}">#${p.finishRank}</span>`
      : "";

    return `
    <div class="opponent-card ${p.eliminated ? "eliminated" : ""} ${isTurn ? "turn" : ""}" data-player-id="${p.id}" style="position:relative;">
      ${rankBadge}
      <div class="opp-avatar">
        ${p.avatar}
        <span class="opp-status-dot ${dotClass}"></span>
      </div>
      <div class="opp-info">
        <div class="opp-name">${escapeHtml(p.name)}</div>
        <div class="opp-chips">🃏 ${p.hand.length} kartu${p.isCangkuling ? " ⛏️" : ""}${p.finishRank ? ` — Rank #${p.finishRank}` : ""}</div>
      </div>
    </div>
  `;
  }).join("");
}

function renderHand() {
  const handEl = document.getElementById("player-hand");
  if (!handEl) return;
  const you = state.players.find(p => p.isYou);
  if (!you) { handEl.innerHTML = ""; return; }
  if (you.eliminated) {
    handEl.innerHTML = `<div style="color:var(--text-secondary);padding:30px;font-style:italic;">Kartu kamu habis — Rank #${you.finishRank || "?"}!</div>`;
    return;
  }

  const hasPicked = you.picked != null;
  // Cangkul = turn-based di SP & MP: hanya bisa main saat giliranmu
  const isMyTurn = state.currentTurnId === you.id;
  const isLeading = state.phase === "leading";
  const isFollowing = state.phase === "following";

  handEl.innerHTML = you.hand.map((c, i) => {
    const selected = state.selectedCardIdx === i && !hasPicked && isMyTurn;
    const locked = hasPicked || !isMyTurn;

    const canPlay = isLeading || (isFollowing && c.suit === state.currentSuit);
    const playable = !locked && canPlay;
    const blocked = !locked && isFollowing && !canPlay;

    const classes = [
      "hand-card",
      c.isRed ? "red" : "",
      selected ? "selected" : "",
      locked ? "disabled" : "",
      playable ? "card-playable" : "",
      blocked ? "card-blocked" : "",
    ].filter(Boolean).join(" ");

    const onclickFn = locked || blocked
      ? ""
      : selected
        ? "confirmPickedCard()"
        : `selectHandCard(${i})`;

    return `
      <div class="${classes}"
        data-rank="${c.rank}${c.suit}"
        data-idx="${i}"
        onclick="${onclickFn}">
        <span class="card-rank">${c.rank}</span>
        <span class="card-suit">${c.suit}</span>
      </div>
    `;
  }).join("");

  // Phase text
  if (you.picked != null) {
    setPhaseText("Kartu kamu sudah dimainkan. Menunggu giliran lain...");
  } else if (isMyTurn && isFollowing && !you.hand.some(c => c.suit === state.currentSuit)) {
    // Cangkul button akan muncul — phase text dari advanceSingleTurn
  } else if (state.selectedCardIdx != null) {
    const card = you.hand[state.selectedCardIdx];
    if (card) setPhaseText(`Klik lagi kartu ${card.rank}${card.suit} untuk konfirmasi`);
  }
}

function renderRevealSlots() {
  const el = document.getElementById("reveal-slots");
  if (!el) return;

  const participants = state.players.filter(p => !p.eliminated || p.pickedCard != null);
  el.innerHTML = participants.map(p => {
    const card = p.pickedCard;
    const isSkip = p.picked === "skip";

    return `
      <div class="reveal-slot ${card ? "" : "empty"}" data-player-id="${p.id}">
        <div class="slot-card-back"></div>
        ${card ? `
          <div class="slot-card-face ${card.isRed ? "red" : ""}">
            <span class="card-rank">${card.rank}</span>
            <span class="card-suit">${card.suit}</span>
          </div>
        ` : isSkip ? `
          <div class="slot-card-face" style="font-size:12px;color:#888;">SKIP</div>
        ` : ""}
        <div class="slot-player-tag">${escapeHtml(p.name)}${p.isYou ? " (YOU)" : ""}</div>
      </div>
    `;
  }).join("");

  // Suit indicator
  const si = document.getElementById("suit-indicator");
  if (si) {
    if (state.currentSuit) {
      const isRed = ["♥", "♦"].includes(state.currentSuit);
      si.innerHTML = `
        <span class="suit-symbol ${isRed ? "red" : "black"}">${state.currentSuit}</span>
        <span class="suit-name">${suitName(state.currentSuit)}</span>
        <span class="suit-hint">ikuti suit ini</span>
      `;
    } else {
      si.innerHTML = "";
    }
  }

  // Deck pile
  const dp = document.getElementById("deck-pile");
  if (dp) {
    dp.innerHTML = state.pileCount > 0
      ? `<span class="pile-icon">🂠</span>
         <span class="pile-count">${state.pileCount}</span>
         <span class="pile-label">PILE</span>`
      : "";
  }
}

function setPhaseText(t) {
  const el = document.getElementById("phase-text");
  if (el) el.textContent = t;
}

function showRoundResult(type, msg) {
  const el = document.getElementById("round-result");
  if (!el) return;
  el.textContent = msg;
  el.className = `round-result show ${type}`;
}
function hideRoundResult() {
  const el = document.getElementById("round-result");
  if (!el) return;
  el.className = "round-result";
}

/* ═══════════════════════════════════════════════════
   MULTIPLAYER (Socket.IO)
   ═══════════════════════════════════════════════════ */
function updateMpStatus(status, text) {
  const box = document.getElementById("mp-connection-status");
  const label = document.getElementById("mp-status-text");
  if (!box || !label) return;
  box.className = `mp-status ${status}`;
  label.textContent = text;
}

function getSocketServerUrl() {
  if (window.location && window.location.protocol.startsWith("http")) {
    return window.location.origin;
  }
  return "http://localhost:3000";
}

function initMultiplayer() {
  if (socket && socket.connected) {
    updateMpStatus("online", "Server online");
    return;
  }
  if (socket && !socket.connected) {
    updateMpStatus("checking", "Menghubungkan ulang server...");
    socket.auth = { token: authToken };
    socket.connect();
    return;
  }
  updateMpStatus("checking", "Menghubungkan server...");
  try {
    socket = io(getSocketServerUrl(), {
      path: "/socket.io",
      transports: ["polling", "websocket"],
      reconnection: true,
      reconnectionAttempts: 5,
      reconnectionDelay: 800,
      timeout: 10000,
      auth: { token: authToken },
    });
  } catch (e) {
    updateMpStatus("offline", "Server offline");
    showMpError("Server tidak tersedia. Pastikan server multiplayer berjalan.");
    return;
  }

  socket.on("connect", () => {
    updateMpStatus("online", "Server online");
    showMpError("");
    console.log("MP connected", socket.id);
  });
  socket.on("connect_error", (err) => {
    updateMpStatus("offline", "Server offline");
    const detail = err && err.message ? ` (${err.message})` : "";
    showMpError(`Gagal terhubung ke server multiplayer${detail}.`);
  });
  socket.on("reconnect_attempt", () => {
    updateMpStatus("checking", "Menghubungkan ulang server...");
    showMpError("");
  });
  socket.on("disconnect", (reason) => {
    if (reason === "io client disconnect") return;
    updateMpStatus("offline", "Server terputus");
    showToast(`Disconnected dari server: ${reason}`, "error");
  });

  socket.on("cbRoomState", (data) => { handleMpRoomState(data); });
  socket.on("cbGameStart", async () => {
    if (!(await chargeMultiplayerEntryFee())) {
      if (socket && mpRoomCode) socket.emit("cbSurrender", { roomCode: mpRoomCode });
      document.getElementById("mp-overlay").style.display = "none";
      document.getElementById("mode-overlay").style.display = "flex";
      return;
    }
    document.getElementById("mp-overlay").style.display = "none";
    document.getElementById("cb-main").style.display = "flex";
  });
  socket.on("cbReveal",   (data) => { handleMpReveal(data); });
  socket.on("cbRoundEnd", (data) => { handleMpRoundEnd(data); });
  socket.on("cbGameOver", (data) => { handleMpGameOver(data); });
  socket.on("cbCardDrawn", (data) => { handleMpCardDrawn(data); });
  socket.on("cbPlayerSurrendered", (data) => {
    const me = state.players.find(p => p.isYou);
    if (me && data.playerId === me.id) return;
    showToast(`🏳️ ${data.username} menyerah / keluar dari permainan!`, "error");
    const p = state.players.find(x => x.id === data.playerId);
    if (p) { p.eliminated = true; p.picked = null; p.pickedCard = null; }
    renderOpponents();
  });
  socket.on("cbError", (msg) => showToast(msg, "error"));
}

function switchMpTab(tab) {
  const create = document.getElementById("panel-create");
  const join   = document.getElementById("panel-join");
  const tabC = document.getElementById("tab-create");
  const tabJ = document.getElementById("tab-join");
  if (tab === "create") {
    create.style.display = "block"; join.style.display = "none";
    tabC.classList.add("active"); tabJ.classList.remove("active");
  } else {
    create.style.display = "none"; join.style.display = "block";
    tabJ.classList.add("active"); tabC.classList.remove("active");
  }
  showMpError("");
}

function mpCreateRoom() {
  if (!socket) return showMpError("Tidak terhubung");
  if (!hasEntryFeeBalance()) return showMpError(`Entry fee ${CONFIG.ENTRY_FEE_GEMS} 💎 — saldo gems kurang.`);
  socket.emit("cbCreateRoom", { username: currentUser }, (resp) => {
    if (!resp || !resp.success) return showMpError(resp?.error || "Gagal buat room.");
    mpRoomCode = resp.roomCode;
    mpIsHost = true;
    document.getElementById("host-room-info").style.display = "block";
    document.getElementById("host-room-code").textContent = resp.roomCode;
  });
}

function mpJoinRoom() {
  if (!socket) return showMpError("Tidak terhubung");
  const code = document.getElementById("join-code-input").value.trim().toUpperCase();
  if (code.length < 4) return showMpError("Masukkan kode room valid.");
  if (!hasEntryFeeBalance()) return showMpError(`Entry fee ${CONFIG.ENTRY_FEE_GEMS} 💎 — saldo gems kurang.`);
  socket.emit("cbJoinRoom", { roomCode: code, username: currentUser }, (resp) => {
    if (!resp || !resp.success) return showMpError(resp?.error || "Gagal join room.");
    mpRoomCode = code;
    mpIsHost = false;
    document.getElementById("join-room-info").style.display = "block";
  });
}

function mpStartGame() {
  if (!socket || !mpIsHost) return;
  if (!hasEntryFeeBalance()) return showMpError(`Entry fee ${CONFIG.ENTRY_FEE_GEMS} 💎 — saldo gems kurang.`);
  socket.emit("cbStartGame", { roomCode: mpRoomCode });
}

function copyRoomCode() {
  if (!mpRoomCode) return;
  navigator.clipboard.writeText(mpRoomCode).then(() => {
    showToast("Kode room di-copy!", "success");
  }).catch(() => showToast("Gagal copy kode", "error"));
}

function getDisplayedRoomCode() {
  const roomCodeEl = document.getElementById("host-room-code");
  const displayedCode = roomCodeEl?.textContent?.trim();
  if (!displayedCode || displayedCode === "вЂ”вЂ”вЂ—" || displayedCode === "вЂ”вЂ”вЂ”") return "";
  return displayedCode;
}

function legacyCopyText(text) {
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.top = "-9999px";
  textArea.style.left = "-9999px";
  document.body.appendChild(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);

  let copied = false;
  try {
    copied = document.execCommand("copy");
  } catch (error) {
    copied = false;
  }

  document.body.removeChild(textArea);
  return copied;
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      console.warn("Clipboard API gagal, pakai fallback:", error);
    }
  }

  return legacyCopyText(text);
}

async function copyRoomCode() {
  const roomCode = (mpRoomCode || getDisplayedRoomCode()).trim();
  if (!roomCode) {
    showToast("Kode room belum tersedia.", "error");
    return;
  }

  const copied = await copyText(roomCode);
  if (copied) {
    mpRoomCode = roomCode;
    showToast(`Kode room ${roomCode} berhasil di-copy!`, "success");
    return;
  }

  showToast("Gagal copy kode room. Coba copy manual.", "error");
}

function mpBack() {
  if (socket) { socket.emit("cbLeaveRoom"); socket.disconnect(); socket = null; }
  mpRoomCode = null; mpIsHost = false; mpEntryCharged = false;
  document.getElementById("mp-overlay").style.display = "none";
  document.getElementById("mode-overlay").style.display = "flex";
}

function showMpError(msg) {
  const el = document.getElementById("mp-error");
  if (el) el.textContent = msg || "";
}

/* MP state handlers */
function handleMpRoomState(data) {
  if (data.phase === "lobby") {
    const listEl = mpIsHost ? document.getElementById("host-players") : document.getElementById("join-players");
    const countEl = document.getElementById("host-player-count");
    if (countEl) countEl.textContent = data.players.length;
    if (listEl) {
      listEl.innerHTML = data.players.map((p, i) => `
        <div class="mp-player-row ${i === 0 ? "host" : ""}">
          <div class="mp-player-avatar">${(p.username || "?").charAt(0).toUpperCase()}</div>
          <div class="mp-player-name">${escapeHtml(p.username)}</div>
          ${i === 0 ? '<span class="mp-player-host-badge">HOST</span>' : ""}
        </div>
      `).join("");
    }
    const startBtn = document.getElementById("btn-mp-start");
    if (startBtn) startBtn.disabled = data.players.length < 2 || !mpIsHost;
    return;
  }
  syncStateFromMp(data);
  renderAll();
  updateCangkulBtn();

  if (data.phase === "leading" || data.phase === "following") {
    const you = state.players.find(p => p.isYou);
    const myTurn = you && !you.eliminated && state.currentTurnId === you.id;
    if (myTurn) {
      if (data.phase === "leading") {
        setPhaseText("Giliranmu LEAD — buang kartu bebas.");
      } else if (you.hand.some(c => c.suit === state.currentSuit)) {
        setPhaseText(`Giliranmu — ikuti suit ${state.currentSuit} (${suitName(state.currentSuit)})`);
      } else if (state.pileCount > 0) {
        setPhaseText(`Tidak punya ${state.currentSuit} — tekan ⛏️ CANGKUL`);
      } else {
        setPhaseText("Tidak punya suit & pile habis — menunggu skip...");
      }
    } else {
      const turnPlayer = state.players.find(p => p.id === state.currentTurnId);
      setPhaseText(turnPlayer ? `Giliran ${turnPlayer.name}...` : "Menunggu pemain lain...");
    }

    if (typeof data.timeLeft === "number") {
      state.timer = data.timeLeft;
      updateTimer();
      stopTimer();
      state.timerInterval = setInterval(() => {
        state.timer = Math.max(0, state.timer - 1);
        updateTimer();
        if (state.timer <= 0) stopTimer();
      }, 1000);
    }
  }
}

function syncStateFromMp(data) {
  state.round = data.round || 1;
  state.pot = data.pot || 0;
  state.ante = data.ante || CONFIG.BASE_ANTE;
  state.carryOver = !!data.carryOver;
  state.phase = data.phase || "waiting";
  state.currentSuit = data.currentSuit || null;
  state.pileCount = data.pileCount || 0;
  state.finishOrder = data.finishOrder || [];
  state.currentLeaderId = data.currentLeaderId || null;
  state.currentTurnId = data.currentTurnId || null;

  state.players = (data.players || []).map(p => ({
    id: p.id,
    name: p.username,
    avatar: (p.username || "?").charAt(0).toUpperCase(),
    chips: p.chips || 0,
    hand: p.id === socket.id ? (p.hand || []) : Array(p.handCount || 0).fill(null),
    isBot: false,
    isYou: p.id === socket.id,
    picked: p.picked != null ? p.picked : null,
    pickedCard: p.pickedCard || null,
    eliminated: !!p.eliminated,
    finishRank: p.finishRank || null,
    drawnCount: p.drawnCount || 0,
    isCangkuling: false,
  }));
}

function handleMpReveal(data) {
  // data: { playerId, card, currentSuit, currentTrick, skipped? }
  if (data.currentSuit) state.currentSuit = data.currentSuit;

  const p = state.players.find(x => x.id === data.playerId);
  if (p) {
    p.pickedCard = data.card || null;
    p.picked = data.skipped ? "skip" : (data.card ? "played" : null);
  }

  // Hapus kartu dari tangan kita jika ini giliran kita (server sudah remove)
  if (data.card && socket && data.playerId === socket.id) {
    const you = state.players.find(x => x.isYou);
    if (you) {
      const idx = you.hand.findIndex(c => c.rank === data.card.rank && c.suit === data.card.suit);
      if (idx >= 0) you.hand.splice(idx, 1);
    }
  }

  renderRevealSlots();
  renderHand();
  renderOpponents();
  updateCangkulBtn();
}

function handleMpCardDrawn(data) {
  // data: { toPlayerId, drawn, matched, pileCount }
  state.pileCount = data.pileCount || 0;

  // Hanya update tangan jika ini data privat untuk kita
  if (socket && data.toPlayerId === socket.id && data.drawn !== null) {
    const you = state.players.find(p => p.isYou);
    if (you) {
      const incoming = [...(Array.isArray(data.drawn) ? data.drawn : []), ...(data.matched ? [data.matched] : [])];
      animateCangkulDraw(incoming);
      if (Array.isArray(data.drawn)) you.hand.push(...data.drawn);
      if (data.matched) you.hand.push(data.matched);
      renderHand();
    }
  }

  renderRevealSlots();
}

function handleMpRoundEnd(data) {
  // data: { winners, isTie, message, finishOrder, newLeaderId }
  if (data.finishOrder) state.finishOrder = data.finishOrder;
  if (data.newLeaderId) state.currentLeaderId = data.newLeaderId;

  // Update finishRank di state players
  (data.finishOrder || []).forEach((id, idx) => {
    const p = state.players.find(x => x.id === id);
    if (p) { p.finishRank = idx + 1; p.eliminated = true; }
  });

  const slots = document.querySelectorAll(".reveal-slot");
  if (data.isTie || !data.winners || data.winners.length === 0) {
    showRoundResult("tie", data.message || "Trick batal.");
  } else {
    const winnerId = data.winners[0];
    const slot = Array.from(slots).find(s => s.dataset.playerId === winnerId);
    if (slot) slot.classList.add("winner");
    const me = state.players.find(p => p.isYou);
    showRoundResult(
      me && winnerId === me.id ? "win" : "lose",
      data.message || (me && winnerId === me.id ? "🏆 Kamu menang trick!" : "Lawan menang trick ini.")
    );
  }

  renderOpponents();
}

async function handleMpGameOver(data) {
  state.phase = "gameover";
  stopTimer();
  const persistedReward = data.gemsReward || 0;
  if (persistedReward > 0 && !isAdmin()) {
    userData.totalCBWins = (userData.totalCBWins || 0) + 1;
  }
  userData.totalCBGames = (userData.totalCBGames || 0) + 1;
  saveUserData();
  updateCurrencyUI();

  // Update finishRank dari server
  if (data.finishOrder) {
    state.finishOrder = data.finishOrder;
    data.finishOrder.forEach((id, idx) => {
      const p = state.players.find(x => x.id === id);
      if (p) { p.finishRank = idx + 1; p.eliminated = true; }
    });
  }

  const me = state.players.find(p => p.isYou);
  const youWon = me && data.winner && data.winner.id === me.id;
  const overlay = document.getElementById("game-over-overlay");
  const icon  = document.getElementById("go-icon");
  const title = document.getElementById("go-title");
  const sub   = document.getElementById("go-sub");

  if (youWon) {
    icon.textContent = "🏆"; title.textContent = "VICTORY!";
    title.classList.remove("lose"); sub.textContent = "Kamu pertama habiskan kartu!";
    spawnConfetti();
  } else if (me && me.finishRank && me.finishRank < state.players.length) {
    icon.textContent = "🥈"; title.textContent = `RANK #${me.finishRank}`;
    title.classList.remove("lose");
    sub.textContent = data.winner ? `${data.winner.username} menang lebih dulu.` : "Game berakhir.";
  } else {
    icon.textContent = "💀"; title.textContent = "JURU KUNCI";
    title.classList.add("lose");
    sub.textContent = data.winner ? `${data.winner.username} menang lebih dulu.` : "Game berakhir.";
  }

  document.getElementById("go-final-chips").textContent = me ? `${me.drawnCount || 0} kartu` : "—";
  document.getElementById("go-gems-reward").textContent = `${persistedReward.toLocaleString("id-ID")} 💎`;
  document.getElementById("go-rounds").textContent = state.round;
  renderFinalRanking(data.finalRanking || getLocalFinalRanking(), socket ? socket.id : null);
  overlay.style.display = "flex";
}

/* ═══════════════════════════════════════════════════
   UTIL
   ═══════════════════════════════════════════════════ */
function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

let toastTimer = null;
function showToast(msg, type = "") {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.className = `toast show ${type || ""}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = `toast ${type || ""}`; }, 2800);
}

/* ═══════════════════════════════════════════════════
   PARTICLE BG
   ═══════════════════════════════════════════════════ */
function initParticles() {
  const canvas = document.getElementById("particles-canvas");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  let particles = [];
  function resize() { canvas.width = window.innerWidth; canvas.height = window.innerHeight; }
  resize();
  window.addEventListener("resize", resize);
  const COLORS = ["#FFD700", "#D81B3A", "#a855f7", "#22d3ee"];
  for (let i = 0; i < 40; i++) {
    particles.push({
      x: Math.random() * canvas.width, y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 0.2, vy: -Math.random() * 0.3 - 0.05,
      a: Math.random() * 0.4 + 0.1, s: Math.random() * 2 + 0.5,
      c: COLORS[Math.floor(Math.random() * COLORS.length)],
    });
  }
  function loop() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach(p => {
      p.x += p.vx; p.y += p.vy;
      if (p.y < 0) { p.y = canvas.height; p.x = Math.random() * canvas.width; }
      if (p.x < 0) p.x = canvas.width;
      if (p.x > canvas.width) p.x = 0;
      ctx.globalAlpha = p.a; ctx.fillStyle = p.c;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.s, 0, Math.PI * 2); ctx.fill();
    });
    ctx.globalAlpha = 1;
    requestAnimationFrame(loop);
  }
  loop();
}

/* ═══════════════════════════════════════════════════
   BOOT
   ═══════════════════════════════════════════════════ */
document.addEventListener("DOMContentLoaded", () => {
  updateCurrencyUI();
  syncWalletFromDatabase();
  fetch("/api/me/cardbattle-profile", { headers: authHeaders() })
    .then(r => r.json()).then(d => { if (d && d.cardBattleProfile) cbLuck = d.cardBattleProfile; })
    .catch(() => {});
  initParticles();

  const joinInput = document.getElementById("join-code-input");
  if (joinInput) {
    joinInput.addEventListener("keypress", (e) => { if (e.key === "Enter") mpJoinRoom(); });
    joinInput.addEventListener("input", (e) => {
      e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "");
    });
  }
});
