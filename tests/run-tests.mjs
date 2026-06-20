import fs from 'fs';

const deck = JSON.parse(fs.readFileSync('src/data/deck.generated.json', 'utf8'));
const config = JSON.parse(fs.readFileSync('app.config.json', 'utf8'));
const runtimeSource = fs.readFileSync('scripts/runtime.js', 'utf8');
const buildSource = fs.readFileSync('scripts/build.mjs', 'utf8');

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

function hash(value) {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function createStates() {
  const states = {};
  for (const item of deck.items) {
    for (const cardType of item.enabledCardTypes) {
      const cardId = `${item.id}:${cardType}`;
      states[cardId] = {
        cardId,
        itemId: item.id,
        cardType,
        reviewCount: 0,
        due: '1970-01-01T00:00:00.000Z',
        successCount: 0,
        intervalDays: 0,
        lapses: 0,
      };
    }
  }
  return states;
}

function freshQueue(states, day, limit = 20) {
  const cardsByItem = new Map();
  for (const card of Object.values(states).filter(card => card.reviewCount === 0)) {
    const cards = cardsByItem.get(card.itemId) || [];
    cards.push(card);
    cardsByItem.set(card.itemId, cards);
  }
  const orderedItems = [...cardsByItem.keys()]
    .map(id => deck.items.find(item => item.id === id))
    .sort((a, b) => a.tier - b.tier || a.rank - b.rank);
  const itemWindows = [];
  for (const tier of [1, 2]) {
    const tierItems = orderedItems.filter(item => item.tier === tier);
    for (let start = 0; start < tierItems.length; start += config.queueNoiseWindow) {
      const window = tierItems.slice(start, start + config.queueNoiseWindow);
      window.sort((a, b) => hash(a.id + day) - hash(b.id + day) || a.rank - b.rank);
      itemWindows.push(window);
    }
  }
  const candidates = [];
  for (const window of itemWindows) {
    const groups = window.map(item => cardsByItem.get(item.id) || []);
    const rounds = Math.max(...groups.map(cards => cards.length));
    for (let round = 0; round < rounds; round += 1) {
      for (const cards of groups) if (cards[round]) candidates.push(cards[round]);
    }
  }
  const result = [];
  const groups = [
    candidates.filter(card => deck.items.find(item => item.id === card.itemId).tier === 1),
    candidates.filter(card => deck.items.find(item => item.id === card.itemId).tier === 2),
  ];
  for (const group of groups) {
    while (group.length && result.length < limit) {
      let index = 0;
      if (result.at(-1)?.itemId === group[0].itemId) {
        const alternative = group.findIndex(card => card.itemId !== result.at(-1).itemId);
        if (alternative >= 0) index = alternative;
      }
      result.push(group.splice(index, 1)[0]);
    }
  }
  return result;
}

ok(deck.items.length === 500, 'curriculum contains 500 items');
ok(deck.items.every(item => item.english !== item.russian), 'English prompts do not repeat Russian');
ok(
  deck.items.filter(item => item.rank >= 386).every(item => !/[А-Яа-яЁё]/.test(item.english)),
  'ranks 386-500 contain real English glosses',
);

const states = createStates();
const dayOne = freshQueue(states, '2026-06-20');
const dayTwo = freshQueue(createStates(), '2026-06-21');
const fullFreshQueue = freshQueue(createStates(), '2026-06-20', 1000);
const ranks = dayOne.map(card => deck.items.find(item => item.id === card.itemId).rank);

ok(dayOne.every((card, index) => index === 0 || card.itemId !== dayOne[index - 1].itemId), 'sibling cards are separated');
ok(Math.max(...ranks) <= config.queueNoiseWindow * 2, 'first session remains inside the first two chronological windows');
ok(ranks.some((rank, index) => index > 0 && rank < ranks[index - 1]), 'session includes gentle local variation');
ok(dayOne.map(card => card.cardId).join('|') !== dayTwo.map(card => card.cardId).join('|'), 'local variation changes by day');
const firstTierTwo = fullFreshQueue.findIndex(card => deck.items.find(item => item.id === card.itemId).tier === 2);
ok(
  fullFreshQueue.slice(firstTierTwo).every(card => deck.items.find(item => item.id === card.itemId).tier === 2),
  'gentle noise never crosses the tier boundary',
);

ok(config.dataSchemaVersion === 2, 'breaking update increments the data schema');
ok(runtimeSource.includes('ru500-pre-update-backup'), 'legacy progress is backed up locally');
ok(runtimeSource.includes('Download snapshot and start fresh'), 'migration offers export before reset');
ok(runtimeSource.includes("APP_CONFIG.migration === 'preserve-compatible'"), 'future compatible migrations can preserve matching progress');
ok(runtimeSource.includes("registration.update()"), 'app explicitly checks for updates');
ok(buildSource.includes("name.startsWith('ru500-')"), 'service worker removes obsolete caches');
ok(buildSource.includes('self.skipWaiting()'), 'service worker activates updates promptly');
ok(buildSource.includes("event.request.mode==='navigate'"), 'navigation uses a network-first update path');

console.log('tests passed');
