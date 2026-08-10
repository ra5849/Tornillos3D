/* Tornillos 3D - juego principal */
(function () {
  var renderer, scene, camera, controls, raycaster;
  var figureGroup, gameGroup, binLayer;
  var levelData;
  var screws = [];
  var screwBySlot = {};
  var bins = [];
  var flying = [];
  var falling = [];
  var history = [];
  var remaining = 0;
  var figureMeshes = [];
  var levelNum = 1;
  var hearts = 3;
  var maxHearts = 3;
  var combo = 0, comboT = 0;
  var lastLevelStars = 0;
  var hintTarget = null, hintT = 0;
  var lastBlockToast = 0;
  var unbusyTool = false;
  var plateTotals = {};
  /* inventario REAL por color al empezar el nivel: cuántos tornillos lleva
     cada color según el reparto del nivel (specs). Nunca puede "quedarse un
     tornillo sin cesta": los cubos se calculan contra este contador. */
  var invByColor = {};
  var removedCount = {};
  var screen = 'menu';
  var LEVEL_MAX = (window.SJlevels && SJlevels.MAX_LEVEL) || 500;
  /* `save` es la ficha del jugador activo */
  var save = { name: 'Jugador 1', unlocked: 1, coins: 0, stars: {} };
  var CMP = {
    hammer: 15, box: 25, hint: 5, undo: 5
  };
  /* usos de herramientas POR NIVEL: cada botón muestra cuántos quedan */
  var LIM = { hammer: 3, box: 2, hint: 3, undo: 4 };
  var uses = { hammer: 0, box: 0, hint: 0, undo: 0 };
  var clock = null;
  var completeT = 0;
  /* render bajo demanda: la GPU solo trabaja cuando algo cambia */
  var needsRender = true, lastRenderT = 0, rafId = 0, lastCamPos = null;

  function $(id) { return document.getElementById(id); }

  /* ---------- Perfiles de jugador ---------- */
  var PROF_KEY = 'tornillos3d_profiles';
  var DEL_KEY = 'tornillos3d_deleted';
  var profiles = { active: 'Jugador 1', list: [] };
  /* nombres borrados: aunque el borrado en la nube falle o llegue tarde,
     la fusion nunca vuelve a traer a un jugador eliminado */
  var deletedNames = [];
  function loadDeleted() {
    try { deletedNames = JSON.parse(localStorage.getItem(DEL_KEY) || '[]'); } catch (e) { deletedNames = []; }
    if (!Array.isArray(deletedNames)) deletedNames = [];
  }
  function persistDeleted() {
    try { localStorage.setItem(DEL_KEY, JSON.stringify(deletedNames)); } catch (e) {}
  }
  function isDeleted(name) { return deletedNames.indexOf(name) !== -1; }
  function markDeleted(name) {
    if (!isDeleted(name)) { deletedNames.push(name); persistDeleted(); }
  }
  function unmarkDeleted(name) {
    var i = deletedNames.indexOf(name);
    if (i !== -1) { deletedNames.splice(i, 1); persistDeleted(); }
  }

  /* migración del guardado antiguo (una sola partida) al primer perfil */
  function migrateOldSave() {
    try {
      var s = JSON.parse(localStorage.getItem('tornillos3d_save') || 'null');
      if (s && s.unlocked && !localStorage.getItem(PROF_KEY)) {
        profiles = {
          active: 'Jugador 1',
          list: [{
            name: 'Jugador 1',
            unlocked: Math.max(1, s.unlocked | 0),
            coins: Math.max(0, s.coins | 0),
            stars: s.stars || {}
          }]
        };
      }
    } catch (e) {}
    try { localStorage.removeItem('tornillos3d_save'); } catch (e) {}
  }
  function loadProfiles() {
    try {
      var p = JSON.parse(localStorage.getItem(PROF_KEY) || 'null');
      if (p && Array.isArray(p.list) && p.list.length) {
        profiles = { active: p.active, list: p.list };
        profiles.list = profiles.list.filter(function (u) { return u && u.name; });
      }
    } catch (e) {}
    /* Limpieza: 'Jugador 1' era un fantasma creado por versiones antiguas sin
       haberlo elegido. Se borra salvo que de verdad tenga progreso. */
    profiles.list = profiles.list.filter(function (u) {
      if (u.name !== 'Jugador 1') return true;
      var hasStars = u.stars && Object.keys(u.stars).length > 0;
      return hasStars || (u.unlocked | 0) > 1 || (u.coins | 0) > 0;
    });
    if (!profiles.list.length) {
      /* sin usuarios creados: nada de falsos jugadores por defecto */
      profiles.list = [];
      profiles.active = '';
    } else if (!profiles.list.some(function (u) { return u.name === profiles.active; })) {
      profiles.active = profiles.list[0].name;
    }
  }
  function persistProfiles() {
    try { localStorage.setItem(PROF_KEY, JSON.stringify(profiles)); } catch (e) {}
    syncCloudSave();
  }
  /* sube los perfiles locales a la nube (Supabase) para continuar la partida
     en otro navegador/dispositivo. Silencioso: si la nube falla, no pasa nada */
  function syncCloudSave() {
    if (!window.SJcloud || !SJcloud.enabled) return;
    for (var i = 0; i < profiles.list.length; i++) {
      (function (u) {
        SJcloud.upsert(u, function () {});
      })(profiles.list[i]);
    }
  }
  /* fusiona lo guardado en la nube con lo local: gana la versión más nueva.
     Si un perfil no existe localmente (creado en otro dispositivo), se adopta */
  function mergeCloudProfiles() {
    if (!window.SJcloud || !SJcloud.enabled) return;
    SJcloud.fetchAll(function (rows) {
      if (!rows || !rows.length) return;
      var changed = false;
      rows.forEach(function (r) {
        if (isDeleted(r.name)) return;
        var loc = null;
        for (var i = 0; i < profiles.list.length; i++) {
          if (profiles.list[i].name === r.name) { loc = profiles.list[i]; break; }
        }
        if (!loc) {
          if (r.name === 'Jugador 1' && !(r.stars && Object.keys(r.stars).length) && (r.unlocked | 0) <= 1 && (r.coins | 0) <= 0) return;
          loc = { name: r.name, unlocked: r.unlocked | 0, coins: r.coins | 0, stars: r.stars || {}, cloudT: +new Date(r.updated_at) };
          profiles.list.push(loc);
          changed = true;
        } else {
          var cloudT = +new Date(r.updated_at);
          var localT = loc.cloudT || 0;
          if (cloudT > localT) {
            loc.unlocked = r.unlocked | 0; loc.coins = r.coins | 0; loc.stars = r.stars || {};
            loc.cloudT = cloudT;
            changed = true;
          }
        }
      });
      if (changed) {
        persistProfiles();
        refreshUserUI();
      }
    });
  }
  function saveState() { persistProfiles(); }
  /* devuelve la ficha del jugador activo (null si no hay ninguno creado) */
  function activeUser() {
    if (!profiles.active) return null;
    var u = null;
    for (var i = 0; i < profiles.list.length; i++) {
      if (profiles.list[i].name === profiles.active) u = profiles.list[i];
    }
    if (!u) return null;
    u.unlocked = Math.max(1, Math.min(LEVEL_MAX, u.unlocked | 0));
    u.coins = Math.max(0, u.coins | 0);
    u.stars = u.stars || {};
    return u;
  }
  function refreshUserUI() {
    save = activeUser();
    persistProfiles();
    updateHUD();
    if (screen === 'levels') buildGrid();
    renderUserList();
  }
  function setActiveUser(name) {
    profiles.active = name;
    refreshUserUI();
    toast('Jugador: ' + name, 'good');
  }
  function createUser(name) {
    name = String(name || '').trim().slice(0, 14);
    if (!name) { toast('Escribe un nombre', 'warn'); return null; }
    if (profiles.list.some(function (u) { return u.name === name; })) {
      toast('Ese nombre ya existe', 'warn');
      return null;
    }
    profiles.list.push({ name: name, unlocked: 1, coins: 0, stars: {} });
    unmarkDeleted(name);
    profiles.active = name;
    refreshUserUI();
    toast('Bienvenido, ' + name + '!', 'good');
    return name;
  }
  function deleteUserByName(name) {
    markDeleted(name);
    profiles.list = profiles.list.filter(function (u) { return u.name !== name; });
    if (window.SJcloud && SJcloud.enabled) SJcloud.remove(name, function () {});
    if (profiles.active === name) profiles.active = profiles.list.length ? profiles.list[0].name : '';
    refreshUserUI();
    toast('Jugador eliminado', 'warn');
  }
  /* lista desplegable de jugadores en el menú */
  function renderUserList() {
    var list = $('userList');
    if (!list) return;
    $('userChip').textContent = profiles.active || 'Sin jugador';
    list.innerHTML = '';
    if (!profiles.list.length) {
      var hint = document.createElement('div');
      hint.className = 'userRow hint';
      hint.textContent = 'No hay jugadores creados. ¡Crea el primero!';
      list.appendChild(hint);
      $('userNew').classList.remove('hidden');
      return;
    }
    $('userNew').classList.add('hidden');
    profiles.list.forEach(function (u) {
      var totalStars = 0;
      for (var k in u.stars) totalStars += u.stars[k] | 0;
      var row = document.createElement('div');
      row.className = 'userRow' + (u.name === profiles.active ? ' sel' : '');
      row.innerHTML = '<span class="uName">' + u.name + '</span>' +
        '<span class="uStats">Nivel ' + (u.unlocked | 0) + ' · ' + (u.coins | 0) + ' monedas · ' + totalStars + ' estrellas</span>';
      var bSel = document.createElement('button');
      bSel.className = 'bigBtn ghost';
      bSel.textContent = u.name === profiles.active ? 'En juego' : 'Jugar';
      bSel.onclick = (function (nm) {
        return function () { SJaudio.sfx.click(); setActiveUser(nm); };
      })(u.name);
      row.appendChild(bSel);
      var bDel = document.createElement('button');
      bDel.className = 'bigBtn ghost del';
      bDel.textContent = 'Eliminar';
      bDel.onclick = (function (nm) {
        return function () { SJaudio.sfx.click(); deleteUserByName(nm); };
      })(u.name);
      row.appendChild(bDel);
      list.appendChild(row);
    });
  }
  function coinCount() { return save.coins; }
  function addCoins(n) {
    save.coins += n;
    updateHUD();
    saveState();
  }

  /* ---------- Toast ---------- */
  function toast(msg, kind) {
    var box = $('toastBox'), el = document.createElement('div');
    el.className = 'toast ' + (kind || 'good');
    el.textContent = msg;
    box.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 1500);
  }

  /* ---------- Escena ---------- */
  function initScene() {
    renderer = new THREE.WebGLRenderer({ canvas: $('c'), antialias: true, powerPreference: 'low-power' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x3b4a6e);
    scene.fog = new THREE.Fog(scene.background, 28, 62);

    camera = new THREE.PerspectiveCamera(52, window.innerWidth / window.innerHeight, 0.1, 200);
    camera.position.set(9, 7.5, 11);

    var hemi = new THREE.HemisphereLight(0xffffff, 0x2c3552, 0.95);
    scene.add(hemi);
    var key = new THREE.DirectionalLight(0xfff4dd, 1.2);
    key.position.set(6, 11, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(512, 512);
    key.shadow.camera.left = -11; key.shadow.camera.right = 11;
    key.shadow.camera.top = 13; key.shadow.camera.bottom = -6;
    key.shadow.camera.far = 45;
    scene.add(key);
    var fill = new THREE.DirectionalLight(0x9ecbff, 0.5);
    fill.position.set(-7, 4, -6);
    scene.add(fill);

    var ground = new THREE.Mesh(new THREE.CircleGeometry(120, 48),
      new THREE.MeshStandardMaterial({ color: 0x26304d, roughness: 0.95 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    ground.receiveShadow = true;
    scene.add(ground);

    var ped = new THREE.Mesh(new THREE.CylinderGeometry(3.9, 4.3, 0.42, 40),
      new THREE.MeshStandardMaterial({ color: 0x4a5a86, roughness: 0.6, metalness: 0.4 }));
    ped.position.y = -0.1;
    ped.castShadow = true; ped.receiveShadow = true;
    scene.add(ped);
    var pedT = new THREE.Mesh(new THREE.CylinderGeometry(3.7, 3.7, 0.08, 40),
      new THREE.MeshStandardMaterial({ color: 0x8aa0d8, roughness: 0.4, metalness: 0.6 }));
    pedT.position.y = 0.11;
    scene.add(pedT);

    binLayer = new THREE.Group();
    scene.add(binLayer);

    raycaster = new THREE.Raycaster();
    controls = new OrbitControls(camera);
    SJfx.init(scene, camera, $('game'));
  }

  /* ===================== CÁMARA ÓRBITA (ratón + táctil, zoom) ===================== */
  function OrbitControls(cam) {
    var target = new THREE.Vector3(0, 2.4, 0);
    var sph = new THREE.Spherical();
    sph.setFromVector3(cam.position.clone().add(new THREE.Vector3(0, -1, 0)));
    sph.theta = 0.6;
    sph.phi = Math.max(0.35, Math.min(1.45, sph.phi));
    sph.radius = Math.min(15, Math.max(4.5, sph.radius));

    var pointers = {};
    var pinchDist = 0, pinchAngle = 0, down = false;
    var downX = 0, downY = 0, downT = 0, moved = 0;

    function apply() {
      cam.position.set(
        target.x + sph.radius * Math.sin(sph.phi) * Math.sin(sph.theta),
        target.y + sph.radius * Math.cos(sph.phi),
        target.z + sph.radius * Math.sin(sph.phi) * Math.cos(sph.theta)
      );
      cam.lookAt(target);
    }
    apply();

    function getPos(e) {
      var r = renderer.domElement.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top, id: e.pointerId || 0 };
    }
    function dist2(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

    var el = renderer.domElement;

    function pdown(e) {
      SJaudio.init();
      var p = getPos(e);
      pointers[p.id] = p;
      downX = p.x; downY = p.y; downT = performance.now(); moved = 0;
      try { el.setPointerCapture(e.pointerId); } catch (err) {}
      down = true;
      el.classList.add('grabbing');
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        pinchDist = dist2(pointers[ids[0]], pointers[ids[1]]);
        pinchAngle = Math.atan2(pointers[ids[1]].y - pointers[ids[0]].y, pointers[ids[1]].x - pointers[ids[0]].x);
      }
    }
    function pmove(e) {
      var p = getPos(e);
      if (!pointers[e.pointerId]) return;
      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d0 = pinchDist || dist2(a, b);
        var d = dist2(a, b);
        if (d0 > 0.1 && d > 0.1) sph.radius = Math.max(4.5, Math.min(22, sph.radius * (d0 / d)));
        var na = Math.atan2(b.y - a.y, b.x - a.x);
        sph.theta -= (na - pinchAngle) * 1.4;
        pinchDist = d; pinchAngle = na;
        apply();
        return;
      }
      var prev = pointers[e.pointerId];
      var dx = p.x - prev.x, dy = p.y - prev.y;
      pointers[e.pointerId] = p;
      if (moved < 2) SJaudio.sfx.click();
      sph.theta -= dx * 0.007;
      sph.phi -= dy * 0.006;
      sph.phi = Math.max(0.2, Math.min(1.45, sph.phi));
      moved += Math.abs(dx) + Math.abs(dy);
      apply();
    }
    function pup(e) {
      var p = getPos(e);
      if (!down && !Object.keys(pointers).length) return;
      delete pointers[e.pointerId];
      el.classList.remove('grabbing');
      var dt = performance.now() - downT;
      if (dt < 480 && moved < 8 && !Object.keys(pointers).length) {
        handleTap(p.x, p.y);
      }
    }
    function pcancel(e) { delete pointers[e.pointerId]; }

    el.addEventListener('pointerdown', pdown);
    el.addEventListener('pointermove', pmove);
    el.addEventListener('pointerup', pup);
    el.addEventListener('pointercancel', pcancel);
    el.addEventListener('wheel', function (e) {
      e.preventDefault();
      sph.radius = Math.max(4.5, Math.min(22, sph.radius + e.deltaY * 0.012));
      apply();
    }, { passive: false });
    el.addEventListener('dblclick', function () { sph.radius = 13; apply(); });

    this.reset = function () {
      sph.theta = 0.6; sph.phi = 0.75; sph.radius = 12;
      apply();
    };
    this.apply = apply;
    this.shakeOffset = new THREE.Vector3();
    this.target = target;
    this.triggerShake = function (mag) {
      this.shakeOffset.set(
        (Math.random() - 0.5) * mag * 0.12,
        (Math.random() - 0.5) * mag * 0.12,
        (Math.random() - 0.5) * mag * 0.12
      );
    };
  }

  /* ===================== NIVEL ===================== */
  function enterLevel(n) {
    levelNum = Math.max(1, Math.min(LEVEL_MAX, n));
    hearts = maxHearts;
    combo = 0; comboT = 0;
    history = []; screws = []; screwBySlot = {};
    flying = []; falling = []; remaining = 0; plateTotals = {};
    invByColor = {}; removedCount = {};
    completeT = 0;
    uses.hammer = 0; uses.box = 0; uses.hint = 0; uses.undo = 0;

    if (gameGroup) scene.remove(gameGroup);
    levelData = SJlevels.buildLevel(levelNum);
    figureGroup = levelData.figure.group;
    gameGroup = new THREE.Group();
    gameGroup.add(figureGroup);
    scene.add(gameGroup);

    buildScrews();
    buildBins();
    syncBinsScreen();
    rebuildFigureMeshes();
    needsRender = true;

    remaining = screws.length;
    $('levelLabel').textContent = 'Nivel ' + levelNum;
    updateHUD();
    showScreen('play');
    SJaudio.init();
    toast('Toca un tornillo para sacarlo', 'good');
    comboReset();
  }

  /* ---------- Modelo y hueco ---------- */
  var screwMatCache = {};
  function screwMat(hex) {
    if (!screwMatCache[hex]) {
      screwMatCache[hex] = new THREE.MeshStandardMaterial({ color: hex, metalness: 0.5, roughness: 0.4 });
    }
    return screwMatCache[hex];
  }
  var shaftMat = new THREE.MeshStandardMaterial({ color: 0x20222a, metalness: 0.75, roughness: 0.35 });

  function makeScrew(hex) {
    var g = new THREE.Group();
    var col = screwMat(hex);
    // arandela / pie abocinado
    var washer = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.27, 0.05, 22), col);
    washer.position.y = 0.025;
    // cabeza tipo "pan" (más plana y ancha que un clavo)
    var head = new THREE.Mesh(new THREE.CylinderGeometry(0.185, 0.21, 0.13, 24), col);
    head.position.y = 0.095;
    // cruz Phillips
    var cross1 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.045), shaftMat);
    cross1.position.y = 0.155;
    var cross2 = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.02, 0.3), shaftMat);
    cross2.position.y = 0.155;
    // vástago con rosca
    var shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 12), shaftMat);
    shaft.position.y = -0.26;
    var threads = new THREE.Group();
    for (var t = 0; t < 4; t++) {
      var th = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.085, 0.022, 12), shaftMat);
      th.position.y = -0.1 - t * 0.09;
      threads.add(th);
    }
    var tip = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.13, 12), shaftMat);
    tip.position.y = -0.525;
    g.add(washer); g.add(head); g.add(cross1); g.add(cross2);
    g.add(shaft); g.add(threads); g.add(tip);
    g.traverse(function (m) { m.castShadow = true; m.userData.screwRoot = g; });
    return g;
  }
  function buildScrews() {
    var fig = levelData.figure;
    var specs = levelData.specs;
    var keys = Object.keys(specs);
    /* inventario contado UNA vez al principio: cada color sabe EXACTAMENTE
       cuántos tornillos tiene (visible o tapado), así los cubos nunca piden
       un tornillo que no existe ni un tornillo queda sin cubo */
    for (var ii = 0; ii < levelData.colors.length; ii++) invByColor[ii] = 0;
    for (var i = 0; i < keys.length; i++) {
      var si = parseInt(keys[i], 10);
      var ci2 = specs[si];
      invByColor[ci2] = (invByColor[ci2] || 0) + 1;
    }
    for (var i = 0; i < keys.length; i++) {
      var si = parseInt(keys[i], 10);
      var sl = fig.slots[si];
      var ci = specs[si];
      var col = levelData.colors[ci];

      var root = makeScrew(col.hex);
      root.position.copy(sl.p).addScaledVector(sl.n, 0.10);
      root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sl.n);
      figureGroup.add(root);

      var sc = {
        mesh: root, slotIdx: si, colorIdx: ci,
        plate: sl.plateId !== undefined ? sl.plateId : null,
        normal: sl.n.clone(),
        state: sl.hiddenBy === null ? 'available' : 'hidden',
        hammered: false
      };
      /* tapados: INVISIBLES hasta que salte la placa — esa es la dificultad
         (quitar la plancha revela el tornillo y lo hace pisable) */
      if (sc.state === 'hidden') root.visible = false;
      root.userData.screw = sc;
      screwBySlot[si] = sc;
      screws.push(sc);
      if (sc.plate !== null) plateTotals[sc.plate] = (plateTotals[sc.plate] || 0) + 1;
    }
    // en caso de placa sin tornillos: quitar ya al inicio
    for (var pi = 0; pi < levelData.figure.plates.length; pi++) {
      if (!plateTotals[pi] || plateTotals[pi] <= 0) {
        // quitar la placa "suelta" para que no estorbe
        popPlate(levelData.figure.plates[pi], true);
      }
    }
  }
  function comboReset() { combo = 0; comboT = 0; }

  /* recuento REAL: la cifra se recalcula desde el estado real de cada tornillo,
     así no puede desviarse aunque se deshaga, martillee o falle un aterrizaje */
  function countRemaining() {
    var c = 0;
    for (var i = 0; i < screws.length; i++) if (screws[i].state !== 'removing') c++;
    return c;
  }

  /* mallas de la figura para la oclusión del rayo, SIEMPRE al día: las planchas
     que saltan dejan de bloquear al instante (nunca una plancha "fantasma") */
  function rebuildFigureMeshes() {
    figureMeshes = [];
    if (!figureGroup) return;
    figureGroup.traverse(function (o) {
      if (o.geometry && o.material && !o.userData.screwRoot) figureMeshes.push(o);
    });
  }

  /* ===================== CUBOS (carritos dinámicos, máx 3 por color) ===================== */
  var slotCapacity = 3;

  function binMat(hex, opts) {
    opts = opts || {};
    var m = new THREE.MeshStandardMaterial({
      color: hex, metalness: opts.metal !== undefined ? opts.metal : 0.25,
      roughness: opts.rough !== undefined ? opts.rough : 0.45,
      transparent: opts.opaque ? false : true,
      opacity: opts.opaque ? 1 : (opts.op === undefined ? 0.35 : opts.op),
      side: opts.side || THREE.FrontSide
    });
    return m;
  }

  function makeLabel() {
    var canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    var tex = new THREE.CanvasTexture(canvas);
    var sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
    sp.scale.set(1.1, 0.55, 1);
    return { canvas: canvas, tex: tex, sp: sp };
  }

  function drawLabel(lbl, hex, count, cap) {
    var c = lbl.canvas, g = c.getContext('2d');
    var h = ('000000' + (hex & 0xffffff).toString(16)).slice(-6);
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = 'rgba(10,14,30,0.9)';
    g.beginPath(); g.rect(12, 10, 104, 44); g.fill();
    g.strokeStyle = '#' + h; g.lineWidth = 4; g.strokeRect(12, 10, 104, 44);
    g.fillStyle = '#' + h;
    g.font = 'bold 28px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText(count + '/' + (cap || slotCapacity), 64, 34);
    lbl.tex.needsUpdate = true;
  }

  function buildBins() {
    while (binLayer && binLayer.children.length) binLayer.remove(binLayer.children[0]);
    bins = [];
    /* menos cubos que colores: siempre hay un color bloqueado que se desbloquea
       al completar cubos (esa es la gestion: "quita X para abrir el siguiente") */
    var n = levelData.colors.length;
    var count = n <= 3 ? 2 : 3;
    var radius = 6.6;
    for (var i = 0; i < count; i++) {
      var a = -0.62 + (n === 1 ? 0.5 : i / (count - 1)) * 1.24;
      var x = Math.sin(a) * radius, z = Math.cos(a) * radius;

      var bg = new THREE.Group();
      /* cestas más compactas: se leen mejor en pantalla sin taparse */
      bg.scale.setScalar(0.78);
      var shellMat = binMat(0x3a4a6e, { op: 0.32, side: THREE.DoubleSide });
      var wall = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.56, 0.8, 26), shellMat);
      wall.position.y = 0.4;
      var base = new THREE.Mesh(new THREE.CircleGeometry(0.68, 26),
        new THREE.MeshStandardMaterial({ color: 0x202a45, roughness: 0.5 }));
      base.rotation.x = -Math.PI / 2;
      base.position.y = 0.02;
      var rimMat = new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.6, roughness: 0.3 });
      var rim = new THREE.Mesh(new THREE.TorusGeometry(0.6, 0.06, 10, 26), rimMat);
      rim.position.y = 0.8;
      rim.rotation.x = Math.PI / 2;
      var lbl = makeLabel();
      lbl.sp.position.set(0, 1.55, 0);
      bg.add(wall); bg.add(base); bg.add(rim); bg.add(lbl.sp);
      bg.position.set(x, 0, z);
      binLayer.add(bg);
      bins.push({
        mesh: bg, colorIdx: -1, count: 0, ext: 0,
        wall: wall, shellMat: shellMat, rim: rim, rimMat: rimMat,
        label: lbl, stash: [], resetT: 0, pendingColor: -1
      });
    }
    assignBinSlots();
  }

  /* tornillos que AÚN NO se han retirado, contando los que vuelan hacia un cubo.
     Se calcula contra el INVENTARIO del nivel + lo ya retirado, no contra el
     array de tornillos (que puede tener estados a medias): así un color jamás
     queda sin cubo mientras le quede un tornillo, ni un cubo espera a un
     tornillo que no existe.
     IMPORTANTE: los tornillos que están BAJO una placa (state 'hidden') NO
     cuentan: no se pueden retirar aún, así que no bloquean su color ni citan
     un cubo que nadie podrá usar. Al arrancar la placa, entran en el juego. */
  function remainingByColor() {
    var cnt = {}, hid = {};
    for (var i = 0; i < levelData.colors.length; i++) { cnt[i] = 0; hid[i] = 0; }
    for (var j = 0; j < screws.length; j++) {
      var s = screws[j];
      if (s.state === 'hidden') hid[s.colorIdx]++;
    }
    for (var i2 = 0; i2 < levelData.colors.length; i2++) {
      cnt[i2] = Math.max(0, (invByColor[i2] || 0) - (removedCount[i2] || 0) - hid[i2]);
    }
    return cnt;
  }
  /* tornillos que siguen EN LA ESCENA (excluye los que vuelan): informativo */
  function sceneByColor() {
    var cnt = remainingByColor();
    for (var k = 0; k < flying.length; k++) {
      var f = flying[k];
      if (f && !f.hammered && f.sc) cnt[f.sc.colorIdx] = Math.max(0, cnt[f.sc.colorIdx] - 1);
    }
    return cnt;
  }

  function colorQueue() {
    var cnt = remainingByColor();
    var arr = [];
    for (var i = 0; i < levelData.colors.length; i++) if (cnt[i] > 0) arr.push(i);
    arr.sort(function (a, b) { return (cnt[b] - cnt[a]) || (a - b); });
    return { list: arr, cnt: cnt };
  }

  /* cuántos recibirá un cubo de verdad: lo que queda de su color (nunca espera
       tornillos inexistentes). Si un color tiene 1 restante, marca 0/1. */
  function binNeed(bin) {
    if (bin.colorIdx === -1) return 0;
    var cnt = remainingByColor()[bin.colorIdx];
    return Math.max(1, Math.min(3 + (bin.ext || 0), bin.count + cnt));
  }

  function assignBinSlots() {
    var q = colorQueue(), cnt = q.cnt, used = {};
    var free = [];
    for (var i = 0; i < bins.length; i++) {
      var b = bins[i];
      /* seguridad: un cubo sin color con tornillos acumulados se purga */
      if (b.colorIdx === -1 && b.count > 0) { clearBinStash(b); b.count = 0; b.pendingColor = -1; }
      /* cubo cuyo color ya no tiene tornillos: LIBERARLO siempre (aunque esté
         vacío) para que su hueco sirva al siguiente color en cola */
      if (b.colorIdx !== -1 && cnt[b.colorIdx] === 0) {
        clearBinStash(b);
        b.colorIdx = -1; b.count = 0; b.pendingColor = -1;
        b.wall.visible = false; b.rim.visible = false;
      }
      if (b.count > 0) {
        if (cnt[b.colorIdx] > 0) used[b.colorIdx] = true;
        continue;
      }
      free.push(b);
    }
    for (var k = 0; k < free.length; k++) {
      var b2 = free[k];
      if (b2.colorIdx >= 0) continue;
      /* un cubo recién completado NO recibe un color repetido: forzamos el siguiente */
      var excl = b2.pendingColor;
      var pick = -1;
      for (var m = 0; m < q.list.length; m++) {
        if (!used[q.list[m]] && q.list[m] !== excl) { pick = q.list[m]; break; }
      }
      if (pick === -1) {
        for (var m2 = 0; m2 < q.list.length; m2++) {
          if (!used[q.list[m2]]) { pick = q.list[m2]; break; }
        }
      }
      /* bailout de emergencia: si hay tornillos pero ningún color con cubo
         (cubos atrapados), se recolorea uno aunque esté en uso: el nivel
         jamás puede quedarse sin cubos con tornillos pendientes */
      if (pick === -1) {
        for (var m3 = 0; m3 < q.list.length; m3++) {
          if (q.list[m3] !== excl) { pick = q.list[m3]; break; }
        }
        if (pick !== -1) {
          for (var rb = 0; rb < bins.length; rb++) {
            if (bins[rb].colorIdx === pick && bins[rb].count > 0) {
              clearBinStash(bins[rb]);
              bins[rb].colorIdx = -1; bins[rb].count = 0; bins[rb].pendingColor = -1;
              bins[rb].wall.visible = false; bins[rb].rim.visible = false;
            }
          }
        }
      }
      if (pick === -1) { if (b2.colorIdx !== -1) setBinColor(b2, -1); continue; }
      used[pick] = true;
      b2.pendingColor = -1;
      setBinColor(b2, pick);
    }
    /* protección visual: colores/etiquetas siempre al día con el color real */
    var seen = {};
    for (var r = 0; r < bins.length; r++) {
      var b3 = bins[r];
      if (b3.colorIdx < 0) { if (b3.label && b3.label.sp.visible) b3.label.sp.visible = false; continue; }
      /* auto-reparación: jamás dos cubos del mismo color */
      if (seen[b3.colorIdx]) { setBinColor(b3, -1); continue; }
      seen[b3.colorIdx] = true;
      var hx = levelData.colors[b3.colorIdx].hex;
      b3.shellMat.color.setHex(hx);
      b3.rimMat.color.setHex(hx);
      drawLabel(b3.label, hx, b3.count, binNeed(b3));
    }
  }

  function setBinColor(bin, ci) {
    if (bin.colorIdx === ci) return;
    bin.colorIdx = ci;
    bin.count = 0;
    clearBinStash(bin);
    if (ci === -1) {
      bin.wall.visible = false; bin.rim.visible = false;
      /* el cartel "x/y" no debe seguir flotando sobre un cubo liberado */
      if (bin.label) bin.label.sp.visible = false;
      return;
    }
    bin.wall.visible = true; bin.rim.visible = true;
    if (bin.label) bin.label.sp.visible = true;
    var hex = levelData.colors[ci].hex;
    bin.shellMat.color.setHex(hex);
    bin.rimMat.color.setHex(hex);
    drawLabel(bin.label, hex, 0, binNeed(bin));
  }

  function clearBinStash(bin) {
    while (bin.stash.length) {
      var m = bin.stash.pop();
      if (m.parent) m.parent.remove(m);
    }
  }

  function binForColor(ci) {
    for (var i = 0; i < bins.length; i++) if (bins[i].colorIdx === ci && bins[i].count < binNeed(bins[i])) return bins[i];
    return null;
  }
  function binWorld(bin) {
    var v = new THREE.Vector3();
    bin.mesh.getWorldPosition(v);
    return v;
  }
/* cestas FIJAS A PANTALLA: ancladas a la parte inferior de la vista,
     separadas en unidades de mundo (nunca se montan entre sí) */
  function syncBinsScreen() {
    if (!bins.length || !camera) return;
    var n = bins.length;
    /* dirección "hacia abajo de la pantalla": punto NDC de la zona baja */
    var anchor = new THREE.Vector3(0, -1.0, 0.5);
    anchor.unproject(camera);
    var base = anchor.sub(camera.position).normalize();
    var cd = new THREE.Vector3();
    camera.getWorldDirection(cd);
    var right = new THREE.Vector3().crossVectors(cd, new THREE.Vector3(0, 1, 0));
    if (right.lengthSq() < 1e-6) right.set(1, 0, 0);
    right.normalize();
    var spread = 1.0;
    for (var i = 0; i < n; i++) {
      var off = (i - (n - 1) / 2) * spread;
      var pos = camera.position.clone().addScaledVector(base, 9.5)
        .addScaledVector(right, off);
      if (pos.y < 0.15) pos.y = 0.15;
      bins[i].mesh.position.copy(pos);
    }
  }
  function binDropPos(bin, slotIdx) {
    var p = binWorld(bin);
    return new THREE.Vector3(p.x, 1.05 + Math.min(slotIdx, 3 + (bin.ext || 0) - 1) * 0.22, p.z);
  }

  /* deja el tornillo DENTRO del cubo para que se vea */
  function settleIntoBin(bin, sc) {
    if (!sc.mesh || sc.hammered) return;
    var m = sc.mesh;
    if (m.parent) m.parent.remove(m);
    bin.mesh.add(m);
    m.position.set((Math.random() - 0.5) * 0.34, 0.26 + bin.count * 0.17, (Math.random() - 0.5) * 0.34);
    m.rotation.set((Math.random() - 0.5) * 0.6, Math.random() * Math.PI, (Math.random() - 0.5) * 0.6);
    m.scale.set(0.82, 0.82, 0.82);
    bin.stash.push(m);
  }

  /* si el cubo del color se cerró en pleno vuelo, el tornillo regresa a la
     figura: no se puede retirar un color que quedó sin cubo */
  function restoreFlight(sc, m) {
    var hx = levelData.colors[sc.colorIdx].hex;
    if (m.parent) m.parent.remove(m);
    figureGroup.add(m);
    var sl = levelData.figure.slots[sc.slotIdx];
    if (sl) m.position.copy(sl.p).addScaledVector(sl.n, 0.10);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sc.normal);
    m.scale.set(1, 1, 1);
    sc.mesh = m;
    sc.state = 'available';
    sc.hammered = false;
    sc.destBin = null;
    var hi = history.indexOf(sc);
    if (hi >= 0) history.splice(hi, 1);
    SJfx.sparkle(m.position, hx, 8, 2.2);
    SJaudio.sfx.reveal();
    toast('Ese color se quedó sin cubo: el tornillo vuelve', 'warn');
    needsRender = true;
  }

  function completeBin(bin) {
    if (bin.colorIdx === -1) { setBinColor(bin, -1); return; }
    var wp = binWorld(bin);
    SJfx.sparkle(wp, levelData.colors[bin.colorIdx].hex, 14, 3);
    SJaudio.sfx.dropInto();
    clearBinStash(bin);
    /* la ampliación era para ese color: al completarse se reinicia */
    bin.ext = 0;
    bin.pendingColor = bin.colorIdx;
    setBinColor(bin, -1);      // color pendiente; assignBinSlots() (en addToBin) colocará el siguiente
  }

  /* ================== INTERACCIÓN ================== */
  function handleTap(sx, sy) {
    if (screen !== 'play') return;
    var nx = (sx / window.innerWidth) * 2 - 1;
    var ny = -(sy / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(new THREE.Vector2(nx, ny), camera);
    var targets = screws.filter(function (s) { return s.state !== 'removing'; }).map(function (s) { return s.mesh; });
    if (figureMeshes.length) targets = targets.concat(figureMeshes);
    var hits = raycaster.intersectObjects(targets, true);
    if (!hits.length) return;
    var obj = hits[0].object;
    /* si el primer golpe es la figura (y no un tornillo): físicamente hay
       una plancha delante, no se puede quitar sin quitarla antes */
    var root = obj.userData ? obj.userData.screwRoot : null;
    var sc = root ? root.userData.screw : null;
    if (!sc) {
      SJaudio.sfx.click();
      /* la plancha bloquea: dar a entender que hay algo detrás (no silencio) */
      var nowTap = performance.now();
      if (!lastBlockToast || nowTap - lastBlockToast > 900) {
        lastBlockToast = nowTap;
        toast('La plancha tapa algo: quita la plancha primero', 'warn');
      }
      return;
    }
    /* solo se quita si la cara donde está mira hacia la cámara:
       los de las tablas de canto no se pueden tocar (físicamente no se llega) */
    var camDir = new THREE.Vector3().subVectors(camera.position, sc.mesh.position).normalize();
    if (camDir.dot(sc.normal) < 0.15) {
      SJaudio.sfx.click();
      return;
    }
    attemptRemove(sc);
  }

  function attemptRemove(sc) {
    if (screen !== 'play' || sc.state !== 'available') {
      if (sc.state === 'hidden') {
        SJaudio.sfx.click();
        toast('Espera: esta tapado por una placa', 'warn');
        shake(0.15, 0.15);
      }
      return;
    }
    var bin = binForColor(sc.colorIdx);
    if (!bin) {
      loseHeart();
      return;
    }
    removeScrew(sc, false);
  }

  /* ---------- QUITAR TORNILLO ---------- */
  function removeScrew(sc, hammered) {
    if (screen !== 'play') return;
    SJaudio.sfx.unscrew();
    sc.state = 'removing';
    history.push(sc);
    var bin = hammered ? null : binForColor(sc.colorIdx);
    sc.destBin = bin;
    var dest;
    if (hammered) {
      dest = sc.mesh.position.clone().add(new THREE.Vector3((Math.random()-0.5)*1.2, 2.4, (Math.random()-0.5)*1.2));
    } else {
      dest = binDropPos(bin, bin.count);
    }
    SJfx.sparkle(sc.mesh.position, levelData.colors[sc.colorIdx].hex, 8, 2.2);

    flying.push({
      t: 0, dur: hammered ? 0.34 : 0.62, sc: sc,
      start: sc.mesh.position.clone(),
      out: sc.mesh.position.clone().addScaledVector(sc.normal, 0.7),
      dest: dest, hammered: hammered
    });
  }

function addToBin(sc) {
    var landed = false;
    /* el cubo pudo recolorarse mientras el tornillo volaba: buscar siempre uno
       real de su color (evita "verde en cesta amarilla" y cestas muertas) */
    var bin = (sc.destBin && sc.destBin.colorIdx === sc.colorIdx) ? sc.destBin : binForColor(sc.colorIdx);
    if (bin && bin.colorIdx !== -1 && !sc.hammered && bin.count < binNeed(bin)) {
      bin.count += 1;
      landed = true;
      var ci = bin.colorIdx;
      if (ci !== -1) drawLabel(bin.label, levelData.colors[ci].hex, bin.count, binNeed(bin));
      SJaudio.sfx.dropInto();
      var wp = binWorld(bin);
      SJfx.sparkle(wp, levelData.colors[sc.colorIdx].hex, 8, 2);
      if (bin.count >= binNeed(bin)) {
        toast('Cubo completo!', 'good');
        completeBin(bin);
      }
    }
    /* un tornillo que terminó su vuelo (en cubo o martillazo) consumió su
       sitio del inventario del nivel: se descuenta para que los cubos pidan
       solo lo que existe */
    if (sc.mesh && sc.state === 'removing') {
      removedCount[sc.colorIdx] = (removedCount[sc.colorIdx] || 0) + 1;
    }
    SJaudio.sfx.coin();
    combo += 1;
    var bonus = combo % 6 === 0 ? 5 : 0;
    var earned = 1 + bonus;
    addCoins(earned);
    if (sc.mesh) SJfx.label('+' + earned, '#ffe27a', sc.mesh.position.x, sc.mesh.position.y + 1.2, sc.mesh.position.z, 18);
    remaining = countRemaining();

    if (sc.plate !== null) {
      var pl = levelData.figure.plates[sc.plate];
      if (pl && !pl.popped) {
        plateTotals[sc.plate] -= 1;
        if (plateTotals[sc.plate] <= 0) popPlate(pl, false);
      }
    }
    assignBinSlots();
    updateHUD();
    saveState();
    /* victoria SOLO cuando ya no queda nada por retirar NI por aterrizar:
       si hay tornillos aún volando, el nivel espera a que lleguen */
    if (remaining <= 0 && !flying.length) win();
  }

  /* ---------- PLACA ---------- */
  function popPlate(pl, silent) {
    if (pl.popped) return;
    pl.popped = true;
    figureGroup.remove(pl.group);
    rebuildFigureMeshes();
    var dir = pl.popDir.clone().normalize();
    scene.add(pl.group);
    falling.push({
      mesh: pl.group, vel: dir.clone().multiplyScalar(silent ? 1.6 : 4.2).add(new THREE.Vector3(0, 1.6, 0)),
      vrot: new THREE.Vector3((Math.random()-0.5)*6, (Math.random()-0.5)*6, (Math.random()-0.5)*6),
      t: 0
    });
    if (!silent) {
      SJaudio.sfx.platePop();
      shake(0.3, 0.35);
      toast('Placa desarmada!', 'good');
      var wp = new THREE.Vector3(); pl.group.getWorldPosition(wp);
      SJfx.sparkle(wp, 0xffd166, 14, 3);
    }
    // revelar tornillos tapados
    pl.cover.forEach(function (si) {
      var sc = screwBySlot[si];
      if (sc && sc.state === 'hidden' && sc.mesh) {
        sc.state = 'available';
        sc.mesh.visible = true;
        var sl = levelData.figure.slots[si];
        if (sl) sc.mesh.position.copy(sl.p).addScaledVector(sl.n, 0.34);
        SJaudio.sfx.reveal();
        SJfx.sparkle(sc.mesh.position, levelData.colors[sc.colorIdx].hex, 10, 2.2);
        if (!silent) toast('Desbloqueado!', 'good');
      }
    });
    if (pl.cover.length) assignBinSlots();
  }

  /* ================== VIDAS ================== */
  var sShake = 0;
  function shake(i) { sShake = Math.max(sShake, i); }

  function loseHeart() {
    if (screen !== 'play') return;
    hearts -= 1;
    SJaudio.sfx.error();
    shake(0.4);
    toast('Sin cubo para ese color', 'bad');
    updateHUD();
    if (hearts <= 0) {
      SJaudio.sfx.heartLose();
      setTimeout(triggerLose, 750);
    }
  }

  function triggerLose() {
    if (screen === 'play') {
      screen = 'lose';
      SJaudio.sfx.lose();
      addCoins(2);
      showResult(false, 0, 0);
    }
  }

  /* ================== GANAR / RESULTADO ================== */
  function win() {
    if (screen === 'win') return;
    /* GUARD DEFINITIVO: si queda CUALQUIER tornillo sin retirar, no hay victoria.
       El nivel solo termina cuando el estado real de la escena lo confirma */
    for (var chk = 0; chk < screws.length; chk++) {
      if (screws[chk].state !== 'removing') {
        remaining = countRemaining();
        return;
      }
    }
    screen = 'win';
    /* limpieza del vuelo final: nada de tornillos/placas "a medias" en la escena */
    for (var fi = 0; fi < flying.length; fi++) {
      var fm = flying[fi].sc.mesh;
      if (fm && fm.parent && fm.parent !== binLayer) fm.parent.remove(fm);
    }
    flying = [];
    for (var fa = 0; fa < falling.length; fa++) {
      scene.remove(falling[fa].mesh);
    }
    falling = [];
    var stars = hearts >= 3 ? 3 : hearts >= 2 ? 2 : 1;
    var reward = levelData.totalScrews * 2 + hearts * 6;
    addCoins(reward);
    save.stars[levelNum] = Math.max(save.stars[levelNum] || 0, stars);
    if (levelNum >= save.unlocked && levelNum < LEVEL_MAX) save.unlocked = levelNum + 1;
    saveState();
    SJaudio.sfx.winFanfare();
    if (figureGroup) {
      var wp = new THREE.Vector3(0, levelData.figure.height / 2, 0);
      SJfx.sparkle(wp, 0xffd166, 26, 5);
      for (var k = 0; k < 3; k++) SJfx.sparkle(new THREE.Vector3((Math.random()-0.5)*2, levelData.figure.height*0.6, (Math.random()-0.5)*2), levelData.colors[k % levelData.colors.length].hex, 14, 4);
    }
    showResult(true, stars, reward);
  }

  function showResult(won, stars, reward) {
    $('resultTitle').textContent = won ? 'Nivel completado!' : 'Sin vidas...';
    var starsEl = $('stars');
    starsEl.className = won ? 'stars ' + (stars === 3 ? 'on' : stars === 2 ? 'two' : 'one') : '';
    for (var i = 0; i < 3; i++) {
      var s = starsEl.children[i];
      s.textContent = '★';
      s.style.color = won && i < stars ? '#ffd166' : '#3a4358';
    }
    $('resultText').innerHTML = won
      ? 'Ganaste ' + reward + ' monedas. ¡Placa tras placa sin anuncios!'
      : 'Intentalo de nuevo, tus monedas y herramientas se conservan.';
    var btns = $('resultButtons');
    var nxt = levelNum >= save.unlocked
    btns.innerHTML = '';
    var b1 = document.createElement('button');
    b1.className = 'bigBtn';
    b1.textContent = won && levelNum < LEVEL_MAX ? 'Siguiente nivel' : 'Reintentar';
    b1.onclick = function () {
      SJaudio.sfx.click();
      if (won && levelNum < LEVEL_MAX) enterLevel(levelNum + 1); else enterLevel(levelNum);
    };
    var b2 = document.createElement('button');
    b2.className = 'bigBtn ghost';
    b2.textContent = 'Menu';
    b2.onclick = function () { SJaudio.sfx.click(); showScreen('menu'); };
    btns.appendChild(b1); btns.appendChild(b2);
    showScreen(won ? 'win' : 'lose');
  }

  /* ================== HERRAMIENTAS ================== */
  function toolHammer() {
    if (screen !== 'play') return;
    if (uses.hammer >= LIM.hammer) { toast('Sin usos de martillo', 'warn'); return; }
    if (save.coins < CMP.hammer) { toast('Faltan monedas', 'bad'); SJaudio.sfx.error(); return; }
    /* el martillo rompe CUALQUIER tornillo, también los tapados o inalcanzables:
       garantiza que el nivel siempre se pueda terminar */
    var avail = [];
    for (var i = 0; i < screws.length; i++) if (screws[i].state !== 'removing') avail.push(screws[i]);
    if (!avail.length) { toast('Nada que romper', 'warn'); return; }
    var sc = avail[Math.floor(Math.random() * avail.length)];
    save.coins -= CMP.hammer;
    uses.hammer += 1;
    sc.hammered = true;
    if (sc.state === 'hidden') sc.state = 'available';
    updateHUD(); saveState();
    SJaudio.sfx.hammer();
    removeScrew(sc, true);
    toast('Martillazo!', 'bad');
  }

  function toolExtraBox() {
    if (screen !== 'play') return;
    if (uses.box >= LIM.box) { toast('Sin usos de caja', 'warn'); return; }
    if (save.coins < CMP.box) { toast('Faltan monedas', 'bad'); return; }
    var best = null, bestGain = 0;
    var remByColor = remainingByColor();
    for (var b = 0; b < bins.length; b++) {
      if (bins[b].colorIdx === -1) continue;
      /* tornillos REALES que le quedan a ese color (incluye los que vuelan) */
      var rem = remByColor[bins[b].colorIdx] || 0;
      /* ganancia REAL de ampliar: cuántos tornillos más entrarán que con 3 */
      var base = Math.min(3 + (bins[b].ext || 0), bins[b].count + rem);
      var up = Math.min(3 + (bins[b].ext || 0) + 1, bins[b].count + rem);
      var gain = up - base;
      if (gain > bestGain) { bestGain = gain; best = bins[b]; }
    }
    if (!best || bestGain < 1) {
      toast('Ningún cubo necesita la ampliación', 'warn');
      return;
    }
    best.ext = (best.ext || 0) + 1;
    if (best.colorIdx !== -1) drawLabel(best.label, levelData.colors[best.colorIdx].hex, best.count, binNeed(best));
    save.coins -= CMP.box;
    uses.box += 1;
    updateHUD(); saveState();
    SJaudio.sfx.buy();
    toast('Cubo extra (+' + bestGain + ') para ' + levelData.colors[best.colorIdx].name, 'warn');
  }

  function toolHint() {
    if (screen !== 'play') return;
    if (uses.hint >= LIM.hint) { toast('Sin usos de pista', 'warn'); return; }
    if (save.coins < CMP.hint) { toast('Faltan monedas', 'bad'); return; }
    var cand = [];
    for (var i = 0; i < screws.length; i++) {
      var s = screws[i];
      if (s.state !== 'available') continue;
      var bin = binForColor(s.colorIdx);
      if (bin && bin.count < binNeed(bin)) cand.push(s);
    }
    if (!cand.length) {
      if (remaining > 0) {
        var allHidden = 0;
        for (var h = 0; h < screws.length; h++) if (screws[h].state === 'hidden') allHidden++;
        if (allHidden >= remaining) toast('Todo lo que queda está bajo una placa: desarmala primero', 'warn');
        else toast('Completa un cubo para abrir el siguiente color', 'warn');
      } else toast('Nada que mostrar', 'warn');
      return;
    }
    var sc = cand[Math.floor(Math.random() * cand.length)];
    save.coins -= CMP.hint;
    uses.hint += 1;
    updateHUD(); saveState();
    SJaudio.sfx.buy();
    hintTarget = sc; hintT = 2.5;
    toast('Sigue el resplandor', 'good');
  }

  function toolUndo() {
    if (screen !== 'play') return;
    if (uses.undo >= LIM.undo) { toast('Sin usos de deshacer', 'warn'); return; }
    if (save.coins < CMP.undo) { toast('Faltan monedas', 'bad'); return; }
    // buscar el ultimo tornillo deshacible (que su placa no haya saltado)
    var idx = -1;
    for (var i = history.length - 1; i >= 0; i--) {
      var sc = history[i];
      var lockedPlate = (sc.plate !== null && levelData.figure.plates[sc.plate].popped);
      if (!lockedPlate) { idx = i; break; }
    }
    if (idx < 0) { toast('No se puede deshacer', 'warn'); return; }
    var sc = history[idx];
    save.coins -= CMP.undo;
    uses.undo += 1;
    history.splice(idx, 1);
    // restaurar en su caja
    if (!sc.hammered) {
      var bin = (sc.destBin && sc.destBin.colorIdx === sc.colorIdx) ? sc.destBin : binForColor(sc.colorIdx);
      if (bin && bin.count > 0) {
        bin.count -= 1;
        var st = bin.stash.pop();
        if (st && st.parent) st.parent.remove(st);
        if (bin.colorIdx !== -1) drawLabel(bin.label, levelData.colors[bin.colorIdx].hex, bin.count, binNeed(bin));
      }
    }
    // recolocar el tornillo
    var sl = levelData.figure.slots[sc.slotIdx];
    var col = levelData.colors[sc.colorIdx];
    var root = makeScrew(col.hex);
    root.position.copy(sl.p).addScaledVector(sl.n, 0.10);
    root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sl.n);
    root.userData.screw = sc;
    figureGroup.add(root);
    sc.mesh = root;
    sc.state = 'available';
    sc.mesh.visible = true;
    remaining = countRemaining();
    updateHUD(); saveState();
    SJaudio.sfx.click();
    SJfx.sparkle(root.position, col.hex, 8, 2.2);
    toast('Deshecho', 'good');
  }

  /* ================== HUD / UI ================== */
  function updateHUD() {
    if (!save) { $('coinCount').textContent = '—'; return; }
    $('coinCount').textContent = save.coins;
    var hs = $('hearts').children;
    for (var i = 0; i < hs.length; i++) {
      hs[i].classList.toggle('lost', i >= hearts);
      hs[i].classList.toggle('host', i < hearts);
    }
    $('btnHammer').classList.toggle('off', save.coins < CMP.hammer || uses.hammer >= LIM.hammer);
    $('btnBox').classList.toggle('off', save.coins < CMP.box || uses.box >= LIM.box);
    $('btnHint').classList.toggle('off', save.coins < CMP.hint || uses.hint >= LIM.hint);
    $('btnUndo').classList.toggle('off', save.coins < CMP.undo || uses.undo >= LIM.undo);
    /* cada botón muestra los usos que quedan en el nivel (va bajando) */
    var badge = function (id, left) {
      var el = $('btn' + id).querySelector('.toolCost');
      if (el) el.textContent = left;
    };
    badge('Hammer', Math.max(0, LIM.hammer - uses.hammer));
    badge('Box', Math.max(0, LIM.box - uses.box));
    badge('Hint', Math.max(0, LIM.hint - uses.hint));
    badge('Undo', Math.max(0, LIM.undo - uses.undo));
    if (screen === 'play' && levelData) {
      var cnt = sceneByColor();
      var cc = $('colorCount');
      var any = false;
      cc.innerHTML = '';
      for (var c = 0; c < levelData.colors.length; c++) {
        if (cnt[c] <= 0) continue;
        any = true;
        var hex = ('000000' + levelData.colors[c].hex.toString(16)).slice(-6);
        var el = document.createElement('span');
        el.className = 'chip';
        el.innerHTML = '<i style="background:#' + hex + '"></i>' + cnt[c];
        cc.appendChild(el);
      }
      cc.style.display = any ? 'flex' : 'none';
      var rl = $('remainCount');
      if (rl) rl.textContent = 'Quedan ' + remaining;
    }
  }

  function showScreen(which) {
    screen = (which === 'win' || which === 'lose') ? which : which;
    ['menuScreen', 'levelsScreen', 'aboutScreen', 'resultScreen'].forEach(function (id) {
      $(id).classList.add('hidden');
    });
    if (which === 'menu') $('menuScreen').classList.remove('hidden');
    else if (which === 'levels') $('levelsScreen').classList.remove('hidden');
    else if (which === 'about') $('aboutScreen').classList.remove('hidden');
    else if (which === 'win' || which === 'lose') $('resultScreen').classList.remove('hidden');
    $('overlay').style.pointerEvents = (which === 'play') ? 'none' : 'auto';
    $('hud').style.display = (which === 'play') ? 'flex' : 'none';
  }

  function buildGrid() {
    var g = $('grid'); g.innerHTML = '';
    for (var i = 1; i <= LEVEL_MAX; i++) {
      var cell = document.createElement('div');
      cell.className = 'lvls cell' + (i <= save.unlocked ? '' : ' locked');
      if (i === levelNum) cell.classList.add('current');
      var star = save.stars[i] || 0;
      cell.innerHTML = '<span>' + i + '</span>' + (star ? '<span class="st">' + '★'.repeat(star) + '</span>' : '');
      cell.onclick = function (n) {
        return function () {
          SJaudio.sfx.click();
          if (n <= save.unlocked) enterLevel(n); else toast('Aun bloqueado', 'warn');
        };
      }(i);
      g.appendChild(cell);
    }
  }

  /* ================== ANIMACIÓN ================== */
  function quadBezier(a, c, b, t) {
    var u = 1 - t;
    return new THREE.Vector3(
      a.x * u * u + 2 * c.x * u * t + b.x * t * t,
      a.y * u * u + 2 * c.y * u * t + b.y * t * t,
      a.z * u * u + 2 * c.z * u * t + b.z * t * t
    );
  }

  function updateFlying(dt) {
    for (var i = flying.length - 1; i >= 0; i--) {
      var f = flying[i];
      f.t += dt;
      var p = Math.min(1, f.t / f.dur);
      var m = f.sc.mesh;
      if (!m) { flying.splice(i, 1); continue; }
      /* destino vivo: la cesta es fija en pantalla, apuntar siempre a su posición actual.
         Si el color se quedó sin cesta, el tornillo vuela de vuelta a su hueco */
      if (!f.hammered) {
        var bTarget = (f.sc.destBin && f.sc.destBin.colorIdx === f.sc.colorIdx) ? f.sc.destBin : binForColor(f.sc.colorIdx);
        if (bTarget) f.dest.copy(binWorld(bTarget));
        else {
          var backSl = levelData.figure.slots[f.sc.slotIdx];
          if (backSl) f.dest.copy(backSl.p.clone().addScaledVector(backSl.n, 0.4));
        }
      }
      if (p < 0.55) {
        var q = p / 0.55; q = q * q * (3 - 2 * q);
        m.position.copy(f.start).lerp(f.out, q);
      } else {
        var q2 = (p - 0.55) / 0.45;
        var cnt = f.out.clone().lerp(f.dest, 0.5); cnt.y += 1.4;
        m.position.copy(quadBezier(f.out, cnt, f.dest, q2));
      }
      m.rotateY(dt * (8 + Math.PI * 2.6));
      if (p > 0.82) {
        var sc = 1 + (0.82 - p) * 4;
        m.scale.setScalar(Math.max(0.12, sc));
      }
      if (p >= 1) {
        var scObj = f.sc;
        if (f.hammered) {
          if (m.parent) m.parent.remove(m);
        } else {
          var binNow = (scObj.destBin && scObj.destBin.colorIdx === scObj.colorIdx) ? scObj.destBin : binForColor(scObj.colorIdx);
          if (binNow && binNow.count < binNeed(binNow)) {
            settleIntoBin(binNow, scObj);
          } else {
            /* el cubo de su color se cerró (o está lleno) mientras volaba:
               el tornillo NO se puede retirar así. Vuelve a la figura y
               sigue disponible (jamás desaparece ni se queda sin cesta) */
            restoreFlight(scObj, m);
            flying.splice(i, 1);
            continue;
          }
        }
        addToBin(scObj);
        flying.splice(i, 1);
      }
    }
    return flying.length > 0;
  }

  function updateFalling(dt) {
    for (var i = falling.length - 1; i >= 0; i--) {
      var f = falling[i];
      f.t += dt;
      f.vel.y -= 0.98 * dt * 6;
      f.mesh.position.addScaledVector(f.vel, dt * 3);
      f.mesh.rotation.x += f.vrot.x * dt;
      f.mesh.rotation.y += f.vrot.y * dt;
      f.mesh.rotation.z += f.vrot.z * dt;
      if (f.t > 2.6 || f.mesh.position.y < -7) {
        scene.remove(f.mesh);
        falling.splice(i, 1);
      }
    }
    return falling.length > 0;
  }

  function updateHint(dt) {
    if (!hintTarget) return;
    hintT -= dt;
    var sc = hintTarget;
    if (hintT <= 0 || !sc.mesh) {
      if (sc.hintRing) { sc.mesh.remove(sc.hintRing); sc.hintRing = null; }
      hintTarget = null;
      return;
    }
    if (!sc.hintRing) {
      sc.hintRing = new THREE.Mesh(
        new THREE.TorusGeometry(0.34, 0.045, 10, 22),
        new THREE.MeshBasicMaterial({ color: 0x6ef0ff, transparent: true })
      );
      sc.hintRing.userData = { screwRoot: sc.mesh };
      sc.mesh.add(sc.hintRing);
    }
    var k = (hintT * 4) % 1;
    sc.hintRing.scale.setScalar(0.8 + k * 0.5);
    sc.hintRing.material.opacity = 1 - k;
    return true;
  }

  /* ================== BUCLE + BOOT ================== */
  function animate() {
    rafId = requestAnimationFrame(animate);
    if (!clock) clock = new THREE.Clock();
    var dt = Math.min(0.05, clock.getDelta());
    var busy = false;
    controls.apply();
    /* cestas ancladas a la vista: se reposicionan cada frame aunque la cámara gire */
    if (screen === 'play' && bins.length) syncBinsScreen();
    var cp = camera.position;
    if (!lastCamPos) lastCamPos = cp.clone();
    else if (cp.distanceToSquared(lastCamPos) > 1e-7) { lastCamPos.copy(cp); busy = true; }
    if (updateFlying(dt)) busy = true;
    if (updateFalling(dt)) busy = true;
    if (updateHint(dt)) busy = true;
    if (SJfx.update(dt)) busy = true;
    /* red de seguridad: el contador SIEMPRE refleja el estado real de la escena.
       Si todo está retirado y no queda nada viajando, el nivel se gana (no puede
       quedarse colgado pase lo que pase con los vuelos) */
    if (screen === 'play') {
      var nowR = countRemaining();
      if (nowR !== remaining) { remaining = nowR; busy = true; }
      if (remaining === 0 && !flying.length && !falling.length) win();
    }
    comboT += dt;
    if (comboT > 1.2) combo = 0;
    if (sShake > 0) {
      busy = true;
      var m2 = sShake * 0.05;
      camera.position.x += (Math.random() * 2 - 1) * m2;
      camera.position.y += (Math.random() * 2 - 1) * m2;
      camera.position.z += (Math.random() * 2 - 1) * m2;
      sShake *= Math.pow(0.018, dt);
      if (sShake < 0.01) sShake = 0;
    }
    if (busy) needsRender = true;
    /* con la pestaña oculta no se pinta nada (alivia GPU/CPU para otras pestañas) */
    if (document.hidden) return;
    var now = performance.now();
    /* limita a ~60 fps y solo pinta si hay cambios (ahorro masivo en reposo) */
    if (needsRender && now - lastRenderT >= 16) {
      lastRenderT = now;
      needsRender = false;
      renderer.render(scene, camera);
    }
  }

  function wireUI() {
    var requireUser = function () {
      renderUserList();
      $('userNew').classList.remove('hidden');
      $('userList').classList.remove('hidden');
      toast('Crea un jugador primero', 'warn');
      SJaudio.sfx.error();
      return false;
    };
    $('btnPlay').addEventListener('click', function () {
      SJaudio.init(); SJaudio.sfx.start();
      if (!save) { requireUser(); return; }
      enterLevel(save.unlocked);
    });
    $('btnLevels').addEventListener('click', function () {
      SJaudio.sfx.click();
      if (!save) { requireUser(); return; }
      buildGrid(); showScreen('levels');
    });
    $('btnAbout').addEventListener('click', function () { SJaudio.sfx.click(); showScreen('about'); });
    $('btnBackMenu').addEventListener('click', function () { SJaudio.sfx.click(); showScreen('menu'); });
    $('btnBackAbout').addEventListener('click', function () { SJaudio.sfx.click(); showScreen('menu'); });
    $('btnMenu').addEventListener('click', function () { SJaudio.sfx.click(); showScreen('menu'); });
    $('btnRestart').addEventListener('click', function () {
      if (screen !== 'play') return;
      SJaudio.sfx.click(); enterLevel(levelNum);
    });
    $('btnHammer').addEventListener('click', toolHammer);
    $('btnBox').addEventListener('click', toolExtraBox);
    $('btnHint').addEventListener('click', toolHint);
    $('btnUndo').addEventListener('click', toolUndo);
    $('btnSelectUser').addEventListener('click', function () {
      SJaudio.sfx.click();
      renderUserList();
      $('userList').classList.toggle('hidden');
      if (profiles.list.length) $('userNew').classList.add('hidden');
    });
    $('btnAddUser').addEventListener('click', function () {
      var inp = $('userNameInput');
      if (createUser(inp.value)) inp.value = '';
    });
    $('userNameInput').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') $('btnAddUser').click();
    });
  }

  window.addEventListener('resize', function () {
    if (!camera) return;
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  function boot() {
    migrateOldSave();
    loadDeleted();
    loadProfiles();
    save = activeUser();
    initScene();
    wireUI();
    renderUserList();
    updateHUD();
    showScreen('menu');
    mergeCloudProfiles();
    animate();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();