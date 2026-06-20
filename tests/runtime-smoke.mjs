import fs from 'fs';
import vm from 'vm';

const APP_CONFIG = JSON.parse(fs.readFileSync('app.config.json', 'utf8'));
const DECK = JSON.parse(fs.readFileSync('src/data/deck.generated.json', 'utf8'));
const runtime = fs.readFileSync('scripts/runtime.js', 'utf8');

function ok(condition, message) {
  if (!condition) throw new Error(message);
}

function run(initialState = null) {
  const storage = new Map();
  if (initialState) storage.set('ru500', JSON.stringify(initialState));
  const main = { innerHTML: '', className: '' };
  const context = vm.createContext({
    APP_CONFIG,
    DECK,
    app: { innerHTML: '' },
    document: {
      querySelector: () => main,
      createElement: () => ({ click() {} }),
    },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key),
    },
    navigator: {},
    location: { reload() {} },
    alert() {},
    confirm: () => true,
    setTimeout,
    setInterval: () => 0,
    clearInterval() {},
    URL,
    Blob,
    console,
  });
  vm.runInContext(runtime, context);
  return { context, storage, main };
}

const fresh = run();
ok(fresh.context.app.innerHTML.includes(`App ${APP_CONFIG.appVersion}`), 'fresh app renders current version');

const legacy = run({
  cards: {
    'legacy:production': {
      cardId: 'legacy:production',
      itemId: 'legacy',
      cardType: 'production',
      reviewCount: 4,
    },
  },
  daily: { '2026-06-19': { date: '2026-06-19', studied: 4, ratings: {} } },
  settings: { targetDate: '2026-07-15', dailyNewTarget: 20 },
});
ok(legacy.context.app.innerHTML.includes('A clean study reset is required'), 'legacy data triggers migration screen');
vm.runInContext('startFreshAfterUpdate(false)', legacy.context);
ok(legacy.storage.has('ru500-pre-update-backup'), 'migration stores an on-device backup');
ok(JSON.parse(legacy.storage.get('ru500')).dataSchemaVersion === 2, 'migration creates schema-2 state');
ok(legacy.context.app.innerHTML.includes(`App ${APP_CONFIG.appVersion}`), 'app renders after migration');

console.log('runtime smoke tests passed');
