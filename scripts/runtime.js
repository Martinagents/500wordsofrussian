const $ = selector => document.querySelector(selector);
const STATE_KEY = 'ru500';
const BACKUP_KEY = 'ru500-pre-update-backup';
const CARD_TYPE_ORDER = ['production', 'listening', 'reading'];
const today = () => new Date().toISOString().slice(0, 10);

let pendingMigration = null;
let state = loadState();
let tab = 'today';
let currentCard = 0;
let queue = [];
let answerVisible = false;

function defaultState() {
  return {
    dataSchemaVersion: APP_CONFIG.dataSchemaVersion,
    appVersion: APP_CONFIG.appVersion,
    deckVersion: DECK.deckVersion,
    cards: {},
    daily: {},
    settings: { targetDate: '2026-07-15', dailyNewTarget: 20 },
  };
}

function hasProgress(candidate) {
  return Object.values(candidate?.cards || {}).some(card => card.reviewCount > 0)
    || Object.keys(candidate?.daily || {}).length > 0;
}

function hydrateCards(candidate) {
  for (const item of DECK.items) {
    for (const cardType of item.enabledCardTypes) {
      const id = cardId(item, cardType);
      candidate.cards[id] ??= {
        cardId: id,
        itemId: item.id,
        cardType,
        due: '1970-01-01T00:00:00.000Z',
        intervalDays: 0,
        reviewCount: 0,
        successCount: 0,
        lapses: 0,
      };
    }
  }
  return candidate;
}

function preserveCompatibleState(stored) {
  const migrated = hydrateCards(defaultState());
  for (const [id, card] of Object.entries(stored.cards || {})) {
    if (migrated.cards[id]) migrated.cards[id] = card;
  }
  migrated.daily = stored.daily || {};
  migrated.settings = stored.settings || migrated.settings;
  return migrated;
}

function loadState() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(STATE_KEY) || 'null');
  } catch {
    stored = null;
  }

  if (stored && stored.dataSchemaVersion !== APP_CONFIG.dataSchemaVersion) {
    if (APP_CONFIG.migration === 'preserve-compatible') {
      return preserveCompatibleState(stored);
    }
    if (hasProgress(stored)) {
      pendingMigration = stored;
      return null;
    }
  }

  const candidate = stored?.dataSchemaVersion === APP_CONFIG.dataSchemaVersion
    ? stored
    : defaultState();
  candidate.appVersion = APP_CONFIG.appVersion;
  candidate.deckVersion = DECK.deckVersion;
  candidate.cards ||= {};
  candidate.daily ||= {};
  candidate.settings ||= defaultState().settings;
  return hydrateCards(candidate);
}

function save() {
  state.appVersion = APP_CONFIG.appVersion;
  state.deckVersion = DECK.deckVersion;
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
}

function cardId(item, cardType) {
  return `${item.id}:${cardType}`;
}

function itemFor(card) {
  return DECK.items.find(item => item.id === card.itemId);
}

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function freshCardsWithGentleNoise(day) {
  const cardsByItem = new Map();
  for (const card of Object.values(state.cards).filter(card => card.reviewCount === 0)) {
    const cards = cardsByItem.get(card.itemId) || [];
    cards.push(card);
    cardsByItem.set(card.itemId, cards);
  }

  const orderedItems = [...cardsByItem.keys()]
    .map(id => DECK.items.find(item => item.id === id))
    .filter(Boolean)
    .sort((a, b) => a.tier - b.tier || a.rank - b.rank);

  const itemWindows = [];
  for (const tier of [1, 2]) {
    const tierItems = orderedItems.filter(item => item.tier === tier);
    for (let start = 0; start < tierItems.length; start += APP_CONFIG.queueNoiseWindow) {
      const window = tierItems.slice(start, start + APP_CONFIG.queueNoiseWindow);
      window.sort((a, b) => hash(a.id + day) - hash(b.id + day) || a.rank - b.rank);
      itemWindows.push(window);
    }
  }

  const result = [];
  for (const window of itemWindows) {
    const cardGroups = window.map(item =>
      (cardsByItem.get(item.id) || []).sort(
        (a, b) => CARD_TYPE_ORDER.indexOf(a.cardType) - CARD_TYPE_ORDER.indexOf(b.cardType),
      ),
    );
    const rounds = Math.max(0, ...cardGroups.map(cards => cards.length));
    for (let round = 0; round < rounds; round += 1) {
      for (const cards of cardGroups) {
        if (cards[round]) result.push(cards[round]);
      }
    }
  }
  return result;
}

function takePriorityGroupsWithoutAdjacentSiblings(groups, limit) {
  const result = [];
  for (const group of groups) {
    const remaining = [...group];
    while (remaining.length && result.length < limit) {
      let index = 0;
      if (result.at(-1)?.itemId === remaining[0].itemId) {
        const alternative = remaining.findIndex(card => card.itemId !== result.at(-1).itemId);
        if (alternative >= 0) index = alternative;
      }
      result.push(remaining.splice(index, 1)[0]);
    }
  }
  return result;
}

function makeQueue() {
  const now = new Date();
  const day = today();
  const dueCards = Object.values(state.cards)
    .filter(card => card.reviewCount > 0 && new Date(card.due) <= now)
    .sort((a, b) => a.due.localeCompare(b.due) || hash(a.cardId + day) - hash(b.cardId + day));
  const fresh = freshCardsWithGentleNoise(day);
  return takePriorityGroupsWithoutAdjacentSiblings([
    dueCards,
    fresh.filter(card => itemFor(card)?.tier === 1),
    fresh.filter(card => itemFor(card)?.tier === 2),
  ], state.settings.dailyNewTarget);
}

function learned(card) {
  return card
    && card.successCount >= 2
    && card.lastRating !== 'again'
    && new Date(card.due) - Date.now() >= 3 * 864e5;
}

function dueCount() {
  return Object.values(state.cards)
    .filter(card => card.reviewCount > 0 && new Date(card.due) <= new Date()).length;
}

function play(text) {
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ru-RU';
  speechSynthesis.speak(utterance);
}

function rate(rating) {
  const card = queue[currentCard];
  const multiplier = { hard: 1, good: 2.5, easy: 4 }[rating] || 0;
  const interval = rating === 'again'
    ? 0.02
    : Math.max(1, Math.ceil((card.intervalDays || 1) * multiplier));
  Object.assign(card, {
    intervalDays: interval,
    due: new Date(Date.now() + interval * 864e5).toISOString(),
    reviewCount: card.reviewCount + 1,
    successCount: card.successCount + (rating === 'again' ? 0 : 1),
    lapses: card.lapses + (rating === 'again' ? 1 : 0),
    lastRating: rating,
    lastReviewedAt: new Date().toISOString(),
  });
  const day = today();
  state.daily[day] ??= { date: day, studied: 0, ratings: {} };
  state.daily[day].studied += 1;
  state.daily[day].ratings[rating] = (state.daily[day].ratings[rating] || 0) + 1;
  save();
  currentCard += 1;
  answerVisible = false;
  render();
}

function downloadJson(data, filename) {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function exportProgress() {
  downloadJson({
    schemaVersion: APP_CONFIG.dataSchemaVersion,
    exportedAt: new Date().toISOString(),
    appVersion: APP_CONFIG.appVersion,
    deckVersion: DECK.deckVersion,
    cardStates: state.cards,
    dailyActivity: state.daily,
    settings: state.settings,
  }, 'russian-progress.json');
}

function downloadLegacyProgress() {
  downloadJson({
    schemaVersion: pendingMigration.dataSchemaVersion || 1,
    exportedAt: new Date().toISOString(),
    deckVersion: pendingMigration.deckVersion || 'legacy',
    cardStates: pendingMigration.cards || {},
    dailyActivity: pendingMigration.daily || {},
    settings: pendingMigration.settings || {},
  }, 'russian-progress-before-update.json');
}

function startFreshAfterUpdate(downloadFirst = false) {
  if (downloadFirst) downloadLegacyProgress();
  localStorage.setItem(BACKUP_KEY, JSON.stringify({
    backedUpAt: new Date().toISOString(),
    reason: 'Reset required for data schema 2',
    state: pendingMigration,
  }));
  localStorage.removeItem(STATE_KEY);
  pendingMigration = null;
  state = hydrateCards(defaultState());
  save();
  render();
}

function downloadStoredBackup() {
  const backup = JSON.parse(localStorage.getItem(BACKUP_KEY) || 'null');
  if (backup) downloadJson(backup, 'russian-progress-pre-update-backup.json');
}

async function importData(file) {
  try {
    const imported = JSON.parse(await file.text());
    if (imported.schemaVersion !== APP_CONFIG.dataSchemaVersion) {
      throw new Error(`This app accepts schema ${APP_CONFIG.dataSchemaVersion} exports only.`);
    }
    const validCardIds = new Set(Object.keys(state.cards));
    let importedCount = 0;
    for (const [id, card] of Object.entries(imported.cardStates || {})) {
      if (validCardIds.has(id)) {
        state.cards[id] = card;
        importedCount += 1;
      }
    }
    state.daily = { ...state.daily, ...(imported.dailyActivity || {}) };
    state.settings = imported.settings || state.settings;
    save();
    alert(`Imported ${importedCount} matching card records.`);
    render();
  } catch (error) {
    alert(error.message);
  }
}

function renderNavigation() {
  return ['today', 'study', 'progress', 'library', 'data']
    .map(name => `<button onclick="tab='${name}';render()" class="${tab === name ? 'active' : ''}">${name}</button>`)
    .join('');
}

function renderMigration() {
  const reviews = Object.values(pendingMigration.cards || {})
    .reduce((total, card) => total + (card.reviewCount || 0), 0);
  app.innerHTML = `<main class="update-panel">
    <p class="eyebrow">App update ${APP_CONFIG.appVersion}</p>
    <h1>A clean study reset is required</h1>
    <p>This release repairs the curriculum and changes how study sessions are ordered. Your previous data contains ${reviews} reviews and cannot be safely applied to the new data schema.</p>
    <p>Your old progress will be backed up on this device automatically. You can also download a JSON snapshot before continuing.</p>
    <button class="cta" onclick="startFreshAfterUpdate(true)">Download snapshot and start fresh</button>
    <button onclick="startFreshAfterUpdate(false)">Start fresh without downloading</button>
  </main>`;
}

function render() {
  if (pendingMigration) {
    renderMigration();
    return;
  }

  const encountered = DECK.items.filter(item =>
    item.enabledCardTypes.some(type => state.cards[cardId(item, type)].reviewCount),
  ).length;
  const learnedItems = DECK.items.filter(item =>
    item.enabledCardTypes.some(type => learned(state.cards[cardId(item, type)])),
  ).length;

  app.innerHTML = `<header><h1>500 Words of Russian</h1><nav>${renderNavigation()}</nav><p class="status">App ${APP_CONFIG.appVersion} · offline ready</p></header><main id="main"></main>`;
  const main = $('#main');

  if (tab === 'today') {
    const days = Math.ceil((new Date(state.settings.targetDate) - Date.now()) / 864e5);
    const studied = state.daily[today()]?.studied || 0;
    main.innerHTML = `<section class="hero"><h2>Today</h2><p>${Math.max(0, days)} days to target</p><progress value="${studied}" max="${state.settings.dailyNewTarget}"></progress><button class="cta" onclick="tab='study';queue=makeQueue();currentCard=0;render()">Start Study</button></section><div class="grid"><section class="card">Reviews due <b>${dueCount()}</b></section><section class="card">Encountered <b>${encountered}</b></section><section class="card">Learned <b>${learnedItems}</b></section><section class="card">Tier 1 <b>${DECK.items.filter(item => item.tier === 1 && item.enabledCardTypes.some(type => state.cards[cardId(item, type)].reviewCount)).length}/300</b></section></div>`;
  }

  if (tab === 'study') {
    if (!queue.length) queue = makeQueue();
    const card = queue[currentCard];
    const item = card && itemFor(card);
    main.className = 'study';
    main.innerHTML = !card
      ? '<h2>Empty study queue.</h2>'
      : `<p>${card.cardType} · ${queue.length - currentCard} left</p>${card.cardType === 'listening' ? `<button onclick="play('${item.russian}')">Play audio</button>` : `<h2>${card.cardType === 'reading' ? item.russian : item.english}</h2>`}${!answerVisible ? '<button class="cta" onclick="answerVisible=true;render()">Reveal</button>' : `<section><h2>${item.russian}</h2><p>${item.english}</p><button onclick="play('${item.russian}')">Play Audio</button><div class="ratings">${['again', 'hard', 'good', 'easy'].map(rating => `<button onclick="rate('${rating}')">${rating}</button>`).join('')}</div></section>`}`;
  }

  if (tab === 'progress') {
    const reviews = Object.values(state.cards).reduce((total, card) => total + card.reviewCount, 0);
    main.innerHTML = `<h2>Progress</h2><div class="grid"><section class="card">Total reviews <b>${reviews}</b></section><section class="card">Encountered <b>${encountered}</b></section><section class="card">Learned <b>${learnedItems}</b></section></div>`;
  }

  if (tab === 'library') {
    main.innerHTML = '<h2>Library</h2><input oninput="renderLibrary(this.value)" placeholder="Search"><div id="list"></div>';
    renderLibrary('');
  }

  if (tab === 'data') {
    const backupButton = localStorage.getItem(BACKUP_KEY)
      ? '<button onclick="downloadStoredBackup()">Download pre-update backup</button>'
      : '';
    main.innerHTML = `<h2>Data and settings</h2><button onclick="exportProgress()">Export Progress</button><input type="file" onchange="importData(this.files[0])">${backupButton}<button onclick="if(confirm('Reset progress?')){localStorage.removeItem(STATE_KEY);location.reload()}">Reset Progress</button><p>App ${APP_CONFIG.appVersion} · data schema ${APP_CONFIG.dataSchemaVersion} · deck ${DECK.deckVersion}</p>`;
  }
}

function renderLibrary(query) {
  $('#list').innerHTML = DECK.items
    .filter(item => (item.english + item.russian).toLowerCase().includes(query.toLowerCase()))
    .map(item => `<details class="item"><summary>${item.rank}. ${item.english} — ${item.russian}</summary><p>${item.tags.join(', ')}</p><p>Sources: ${item.provenance.sources.join(', ')}</p><button onclick="play('${item.russian}')">Audio</button></details>`)
    .join('');
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').then(registration => {
    registration.update();
    setInterval(() => registration.update(), 30 * 60 * 1000);
    registration.addEventListener('updatefound', () => {
      registration.installing?.postMessage('SKIP_WAITING');
    });
  });
}

render();
