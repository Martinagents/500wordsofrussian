import fs from 'fs';
import vm from 'vm';

const source = fs.readFileSync('dist/sw.js', 'utf8');
const listeners = {};
const cacheNames = new Set(['ru500-v1', 'ru500-2026.06.20.2']);
let skippedWaiting = false;
let claimedClients = false;
let navigatedClient = false;

const context = vm.createContext({
  self: {
    addEventListener: (name, listener) => { listeners[name] = listener; },
    skipWaiting: async () => { skippedWaiting = true; },
    clients: {
      claim: async () => { claimedClients = true; },
      matchAll: async () => [{
        url: 'https://example.test/500wordsofrussian/',
        navigate: async () => { navigatedClient = true; },
      }],
    },
  },
  caches: {
    keys: async () => [...cacheNames],
    delete: async name => cacheNames.delete(name),
    open: async () => ({ addAll: async () => {}, put: async () => {} }),
    match: async () => null,
  },
  fetch: async () => ({ ok: true, clone() { return this; } }),
  Promise,
});
vm.runInContext(source, context);

let installPromise;
listeners.install({ waitUntil: promise => { installPromise = promise; } });
await installPromise;
if (!skippedWaiting) throw new Error('service worker did not skip waiting');

let activatePromise;
listeners.activate({ waitUntil: promise => { activatePromise = promise; } });
await activatePromise;
if (cacheNames.has('ru500-v1')) throw new Error('legacy cache was not deleted');
if (!claimedClients) throw new Error('service worker did not claim clients');
if (!navigatedClient) throw new Error('stale client was not reloaded');

console.log('service worker smoke tests passed');
