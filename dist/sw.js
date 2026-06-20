const CACHE_NAME="ru500-2026.06.20.2";
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