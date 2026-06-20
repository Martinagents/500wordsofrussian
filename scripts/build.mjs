import fs from 'fs';

const config = JSON.parse(fs.readFileSync('app.config.json', 'utf8'));
const deck = fs.readFileSync('src/data/deck.generated.json', 'utf8');
const cacheName = `ru500-${config.appVersion}`;

fs.rmSync('dist', { recursive: true, force: true });
fs.mkdirSync('dist/assets', { recursive: true });
fs.writeFileSync('dist/manifest.webmanifest', JSON.stringify({
  name: '500 Words of Russian',
  short_name: 'Russian500',
  display: 'standalone',
  start_url: './',
  scope: './',
  theme_color: '#14324a',
  background_color: '#f7fbff',
  icons: [{ src: 'assets/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
}));
fs.writeFileSync(
  'dist/assets/icon.svg',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" fill="#14324a"/><text x="80" y="285" font-size="130" fill="white">RU</text></svg>',
);

fs.writeFileSync('dist/sw.js', `
const CACHE_NAME=${JSON.stringify(cacheName)};
const SHELL=['./','./index.html','./manifest.webmanifest','./assets/icon.svg'];
self.addEventListener('install',event=>event.waitUntil(
  caches.open(CACHE_NAME).then(cache=>cache.addAll(SHELL)).then(()=>self.skipWaiting())
));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const names=await caches.keys();
  const oldNames=names.filter(name=>name.startsWith('ru500-')&&name!==CACHE_NAME);
  await Promise.all(oldNames.map(name=>caches.delete(name)));
  await self.clients.claim();
  if(oldNames.length){
    const clients=await self.clients.matchAll({type:'window'});
    await Promise.allSettled(clients.map(client=>client.navigate?client.navigate(client.url):Promise.resolve()));
  }
})()));
self.addEventListener('fetch',event=>{
  if(event.request.method!=='GET')return;
  if(event.request.mode==='navigate'){
    event.respondWith(fetch(event.request).then(response=>{
      const copy=response.clone();
      caches.open(CACHE_NAME).then(cache=>cache.put('./index.html',copy));
      return response;
    }).catch(()=>caches.match('./index.html')));
    return;
  }
  event.respondWith(caches.match(event.request).then(cached=>cached||fetch(event.request).then(response=>{
    if(response.ok){const copy=response.clone();caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));}
    return response;
  })));
});
self.addEventListener('message',event=>{if(event.data==='SKIP_WAITING')self.skipWaiting();});
`.trim());

fs.writeFileSync(
  'dist/index.html',
  `<!doctype html><meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover"><link rel=manifest href=manifest.webmanifest><title>500 Words of Russian</title><style>${fs.readFileSync('src/style.css', 'utf8')}</style><div id=app></div><script>const APP_CONFIG=${JSON.stringify(config)};const DECK=${deck};${fs.readFileSync('scripts/runtime.js', 'utf8')}</script>`,
);
console.log(`built dist for ${config.appVersion}`);
