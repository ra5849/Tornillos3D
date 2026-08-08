/* ============================================================
   Sincronizacion en la nube con Supabase (REST, clave anonima)
   El juego sigue siendo 100% estatico en GitHub Pages.
   ------------------------------------------------------------
   CONFIGURACION: rellena SUPA_URL y SUPA_ANON a continuacion
   (las obtienes en supabase.com -> tu proyecto -> Settings ->
   API).
   ============================================================ */
var SUPA_URL = 'PEGA_AQUI_LA_URL_DEL_PROYECTO';   /* ej. https://abcd1234.supabase.co */
var SUPA_ANON = 'PEGA_AQUI_LA_CLAVE_ANON_PUBLICA';

/* tabla: profiles (crearla en el SQL editor de Supabase)
   create table public.profiles (
     id uuid primary key default gen_random_uuid(),
     name text not null unique,
     unlocked int not null default 1,
     coins int not null default 0,
     stars jsonb not null default '{}'::jsonb,
     updated_at timestamptz not null default now()
   );
   alter table public.profiles enable row level security;
   create policy "anon read"  on public.profiles for select using (true);
   create policy "anon write" on public.profiles for insert with check (true);
   create policy "anon update" on public.profiles for update using (true);
*/

var SJcloud = (function () {
  if (!SUPA_URL || SUPA_URL.indexOf('PEGA_AQUI') === 0 || !SUPA_ANON || SUPA_ANON.indexOf('PEGA_AQUI') === 0) {
    return { enabled: false, fetchAll: function (cb) { cb && cb([]); }, upsert: function (p, cb) { cb && cb(); }, remove: function (name, cb) { cb && cb(); } };
  }
  function noop1(cb) { cb && cb(); }

  function headers() {
    return {
      'apikey': SUPA_ANON,
      'Authorization': 'Bearer ' + SUPA_ANON,
      'Content-Type': 'application/json'
    };
  }
  var hasWin = (typeof window !== 'undefined');
  function makeXHR() {
    if (hasWin && window.XMLHttpRequest) return new window.XMLHttpRequest();
    return null;
  }
  function req(method, url, body, cb) {
    var x = makeXHR();
    if (!x) { cb && cb(new Error('no xhr')); return; }
    x.open(method, url, true);
    x.setRequestHeader('apikey', SUPA_ANON);
    x.setRequestHeader('Authorization', 'Bearer ' + SUPA_ANON);
    x.setRequestHeader('Content-Type', 'application/json');
    if (body) x.setRequestHeader('Prefer', 'resolution=merge-duplicates,return=minimal');
    x.onreadystatechange = function () {
      if (x.readyState !== 4) return;
      if (x.status >= 200 && x.status < 300) {
        var data = {};
        try { data = x.responseText ? JSON.parse(x.responseText) : {}; } catch (e) { data = null; }
        cb && cb(data);
      } else cb && cb(null);
    };
    x.send(body || null);
  }

  /* descarga todos los perfiles guardados en la nube */
  function fetchAll(cb) {
    req('GET', SUPA_URL + '/rest/v1/profiles?select=id,name,unlocked,coins,stars,updated_at&order=updated_at', null, function (rows) {
      cb && cb(Array.isArray(rows) ? rows : []);
    });
  }
  /* crea o actualiza un perfil (name es la clave) */
  function upsert(p, cb) {
    var row = {
      name: p.name,
      unlocked: p.unlocked | 0,
      coins: p.coins | 0,
      stars: (p.stars || {}),
      updated_at: new Date().toISOString()
    };
    req('POST', SUPA_URL + '/rest/v1/profiles?on_conflict=name', JSON.stringify(row), function () { cb && cb(); });
  }
  function remove(name, cb) {
    req('DELETE', SUPA_URL + '/rest/v1/profiles?name=eq.' + encodeURIComponent(name), null, function () { cb && cb(); });
  }
  return { enabled: true, fetchAll: fetchAll, upsert: upsert, remove: remove };
})();