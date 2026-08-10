/* Tornillos 3D - Figuras de TABLONES/PLACAS planas.
   Filosofia: cada nivel son 2-5 tablones apoyados/erguidos como en la vida real.
   Los tornillos cuya cara queda tapada por OTRA plancha nacen OCULTOS:
   no se ven ni se pueden quitar hasta que la plancha que los tapa salta.
   Devuelve:
     group : Object3D del cuerpo (incluye placas)
     slots : [{p, n, hiddenBy:plateId|null, plateId}] puntos de tornillo
     plates: [{id, group, popDir, own:[slotIdx], cover:[slotIdx tapados]}]
*/
(function () {
  var matCache = {};

  function mat(hex, opts) {
    opts = opts || {};
    var k = hex + '_' + (opts.metal ? 'm' : '') + (opts.rough ? 'r' : '');
    if (!matCache[k]) {
      matCache[k] = new THREE.MeshStandardMaterial({
        color: hex,
        metalness: opts.metal ? 0.5 : 0.05,
        roughness: opts.rough === false ? 0.35 : 0.78
      });
    }
    return matCache[k];
  }

  function addBox(g, w, h, d, x, y, z, m) {
    var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  }
  function addCyl(g, rT, rB, h, x, y, z, m, segs) {
    var mesh = new THREE.Mesh(new THREE.CylinderGeometry(rT, rB, h, segs || 20), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    g.add(mesh);
    return mesh;
  }

  var THEMES = [];
  function defineTheme(name, builder) { THEMES.push({ name: name, builder: builder }); }

  function build(themeName, density, rng) {
    var slots = [];
    var plates = [];
    var group = new THREE.Group();
    var dense = (typeof density === 'number' && density > 0) ? density : 1;
    /* rng opcional (semilla del nivel): sin el, Math.random (comportamiento antiguo) */
    var R = (typeof rng === 'function') ? rng : Math.random;
    var rnd = function (min, max) { return min + R() * (max - min); };

    function slot(x, y, z, nx, ny, nz, plateId) {
      var s = { p: new THREE.Vector3(x, y, z), n: new THREE.Vector3(nx, ny, nz).normalize(), hiddenBy: null };
      if (plateId !== undefined) s.plateId = plateId;
      slots.push(s);
      return slots.length - 1;
    }

    function registerOwnPlate(mesh, ownList, popArr) {
      var id = plates.length;
      var own = [];
      for (var j = 0; j < ownList.length; j++) {
        var l = ownList[j];
        own.push(slot(l[0], l[1], l[2], l[3], l[4], l[5], id));
      }
      var popV;
      if (popArr && popArr.isVector3) popV = popArr.clone();
      else if (Array.isArray(popArr)) popV = new THREE.Vector3(popArr[0] || 0, popArr[1] || 1, popArr[2] || 0);
      else popV = new THREE.Vector3(0, 1, 0);
      if (popV.y < 0.15) popV.y += 0.4;
      popV.normalize();
      plates.push({ id: id, group: mesh, popDir: popV, own: own, cover: [] });
      return id;
    }

    /* ===== tablon =====
       c : { x,y,z,w,h,t, rx,ry,rz, m, cols, rows }
       Los tornillos van en la cara de la placa que mira al frente (+Z local).
    */
    function addPlank(c) {
      var w = (c.w || 3) * rnd(0.92, 1.08), h = (c.h || 3) * rnd(0.92, 1.08), t = c.t || 0.18;
      var q = new THREE.Quaternion();
      if (c.q) q.copy(c.q);
      else q.setFromEuler(new THREE.Euler(
        (c.rx || 0) + rnd(-0.03, 0.03),
        (c.ry || 0) + rnd(-0.03, 0.03),
        (c.rz || 0) + rnd(-0.03, 0.03), 'YXZ'));
      var mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, t), c.m || mat(0x9a8a6a));
      mesh.position.set(c.x || 0, c.y || 0, c.z || 0);
      mesh.quaternion.copy(q);
      mesh.castShadow = true;
      group.add(mesh);

      var cols = c.cols ? Math.max(2, Math.min(6, Math.round(c.cols * dense * rnd(0.85, 1.15)))) : 3;
      var rows = c.rows ? Math.max(2, Math.min(7, Math.round(c.rows * dense * rnd(0.85, 1.15)))) : 3;
      var d = 0.44;
      var iw = w - 2 * d, ih = h - 2 * d;
      var nrm = new THREE.Vector3(0, 0, 1).applyQuaternion(q).normalize();
      var list = [];
      for (var r = 0; r < rows; r++) {
        for (var cc = 0; cc < cols; cc++) {
          var lx = (cols > 1) ? (-(cols - 1) / 2 + cc) * iw / (cols - 1) : 0;
          var ly = (rows > 1) ? (-(rows - 1) / 2 + r) * ih / (rows - 1) : 0;
          var p = new THREE.Vector3(lx, ly, t / 2).applyQuaternion(q).add(mesh.position);
          list.push([p.x, p.y, p.z, nrm.x, nrm.y, nrm.z]);
        }
      }
      registerOwnPlate(mesh, list, new THREE.Vector3(nrm.x, nrm.y + 0.6, nrm.z));
      return mesh;
    }

    /* tablon horizontal con tornillos hacia ARRIBA (cara superior visible) */
    function addDeck(c) {
      c.rx = -Math.PI / 2;
      addPlank(c);
    }

    var ctx = {
      group: group,
      mat: mat, addBox: addBox, addCyl: addCyl,
      addPlank: addPlank, addDeck: addDeck
    };

    for (var tt = 0; tt < THEMES.length; tt++) if (THEMES[tt].name === themeName) { THEMES[tt].builder(ctx); break; }

    /* ===== Cobertura REAL: tornillos tapados por planchas =====
       Un tornillo queda OCULTO si su punto está dentro del grosor de OTRA
       plancha y su normal apunta hacia ella (la plancha está delante).
       Solo se destapa cuando esa plancha salta. */
    var boxes = [];
    for (var pI = 0; pI < plates.length; pI++) {
      var bb = new THREE.Box3().setFromObject(plates[pI].group).expandByScalar(0.03);
      var cc = new THREE.Vector3(); bb.getCenter(cc);
      boxes.push({ box: bb, center: cc });
    }
    var covered = 0;
    for (var sI = 0; sI < slots.length; sI++) {
      var s = slots[sI];
      if (s.plateId === undefined) continue;
      var bestQ = -1, bestD = 0.04;
      for (var qI = 0; qI < plates.length; qI++) {
        if (qI === s.plateId) continue;
        if (!boxes[qI].box.containsPoint(s.p)) continue;
        var d = new THREE.Vector3().subVectors(boxes[qI].center, s.p);
        var dot = d.dot(s.n);
        if (dot > bestD) { bestD = dot; bestQ = qI; }
      }
      if (bestQ >= 0) {
        s.hiddenBy = bestQ;
        plates[bestQ].cover.push(sI);
        covered++;
      }
    }
    /* anti-bloqueo: toda plancha debe conservar al menos un tornillo visible
       propio; si todos los suyos quedaron tapados por otras, destapar uno */
    for (var vI = 0; vI < plates.length; vI++) {
      var ownAllHidden = true, firstIdx = -1;
      for (var wI = 0; wI < plates[vI].own.length; wI++) {
        var sIdx = plates[vI].own[wI];
        if (slots[sIdx].hiddenBy !== null) { if (firstIdx === -1) firstIdx = sIdx; }
        else ownAllHidden = false;
      }
      if (ownAllHidden && firstIdx !== -1) {
        var hq = slots[firstIdx].hiddenBy;
        slots[firstIdx].hiddenBy = null;
        var cv = plates[hq].cover;
        for (var cI = 0; cI < cv.length; cI++) if (cv[cI] === firstIdx) { cv.splice(cI, 1); break; }
      }
    }

    var b = new THREE.Box3().setFromObject(group);
    var height = b.max.y - b.min.y || 3;

    /* rotacion aleatoria de TODA la figura (0/90/180/270): misma estructura,
       aspecto completamente distinto segun la semilla del nivel */
    var qRot = new THREE.Quaternion();
    qRot.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.floor(R() * 4) * Math.PI / 2);
    if (qRot.w < 0.9999) {
      for (var ri = 0; ri < slots.length; ri++) {
        slots[ri].p.applyQuaternion(qRot);
        slots[ri].n.applyQuaternion(qRot);
      }
    }
    group.quaternion.premultiply(qRot);

    return { group: group, slots: slots, plates: plates, height: height };
  }

  function addPoles(c, m, xs, z) {
    var list = Array.isArray(xs) ? xs : [xs];
    for (var i = 0; i < list.length; i++) {
      c.addCyl(c.group, 0.16, 0.2, 1.5, list[i], 0.7, z || 0, m, 10);
    }
  }

  /* ==================== PARED (vallado de tablones) ==================== */
  defineTheme('pared', function (c) {
    var wood = [c.mat(0xb98a5e), c.mat(0xc9a06b), c.mat(0x8f6b44), c.mat(0xd0b083)];
    var frame = c.mat(0x4c5676, { metal: true });
    var nw = 1.9, gap = 0.14, n = 5;
    var total = nw * n + gap * (n - 1);
    var xs = [];
    for (var i = 0; i < n; i++) {
      var x = -total / 2 + nw / 2 + i * (nw + gap);
      xs.push(x);
      c.addPlank({ x: x, y: 2.7, z: 0, w: nw, h: 3.1, m: wood[i % 4], cols: 2, rows: 4 });
    }
    addPoles(c, frame, xs, 0);
    c.addCyl(c.group, 1.0, 1.2, 0.28, 0, 0.02, 0, frame, 24);
  });

  /* ==================== MOLINETE (aspas radiales) ==================== */
  defineTheme('molinete', function (c) {
    var wood = [c.mat(0xbfa26f), c.mat(0x9a8a5a), c.mat(0xb98a5e), c.mat(0x8f7a52), c.mat(0xc9a06b)];
    var frame = c.mat(0x4c5676, { metal: true });
    var n = 5;
    for (var i = 0; i < n; i++) {
      var a = i / n * Math.PI * 2;
      var x = Math.cos(a) * 1.3, z = Math.sin(a) * 1.3;
      c.addPlank({ x: x, y: 2.3, z: z, w: 1.7, h: 2.9, m: wood[i % 5], ry: Math.PI / 2 - a, cols: 2, rows: 4 });
    }
    c.addCyl(c.group, 0.22, 0.3, 1.9, 0, 0.95, 0, frame, 12);
    c.addCyl(c.group, 0.42, 0.42, 0.5, 0, 2.3, 0, c.mat(0xffd166, { metal: true }), 14);
  });

  /* ==================== CRUZ (dos verticales + tabla superior) ==================== */
  defineTheme('cruz', function (c) {
    var wood = [c.mat(0x9a8a6a), c.mat(0xc9a06b), c.mat(0x6f8fc4, { metal: true }), c.mat(0x8f6b44)];
    c.addPlank({ x: 0, y: 2.7, z: 0, w: 2.9, h: 3.3, m: wood[0], cols: 3, rows: 4 });
    c.addPlank({ x: 0, y: 2.7, z: 0, w: 2.9, h: 3.3, m: wood[1], ry: Math.PI / 2, cols: 3, rows: 4 });
    c.addDeck({ x: 0, y: 4.55, z: 0, w: 3.4, h: 3.4, m: wood[2], cols: 4, rows: 4 });
    addPoles(c, wood[3], [1.5, -1.5], 0);
  });

  /* ==================== TIENDA (dos aguas + paredes) ==================== */
  defineTheme('tienda', function (c) {
    var roof = c.mat(0xd96b4d);
    var wall = c.mat(0xf2c879);
    c.addPlank({ x: 0, y: 3.5, z: 1.5, w: 3.4, h: 2.9, rx: -0.62, m: roof, cols: 3, rows: 4 });
    c.addPlank({ x: 0, y: 3.5, z: -1.5, w: 3.4, h: 2.9, rx: 0.62, m: roof, cols: 3, rows: 4 });
    c.addPlank({ x: 1.75, y: 2.2, z: 0, w: 1.4, h: 3.2, m: wall, ry: Math.PI / 2, cols: 2, rows: 4 });
    c.addPlank({ x: -1.75, y: 2.2, z: 0, w: 1.4, h: 3.2, m: wall, ry: Math.PI / 2, cols: 2, rows: 4 });
  });

  /* ==================== ESCALERA (tablones horizontales escalonados) ==================== */
  defineTheme('escalera', function (c) {
    var wood = [c.mat(0x9a8a6a), c.mat(0xb98a5e), c.mat(0xc9a06b), c.mat(0x8f6b44)];
    for (var i = 0; i < 5; i++) {
      c.addDeck({ x: 0, y: 0.8 + i * 1.0, z: 0, w: 3.4, h: 2.8, m: wood[i % 4], cols: 3, rows: 3 });
    }
    var frame = c.mat(0x4c5676, { metal: true });
    addPoles(c, frame, [1.6], -1.7);
    addPoles(c, frame, [0.65], 1.7);
  });

  /* ==================== MOLDE (tablones inclinados en piramide abierta) ==================== */
  defineTheme('molde', function (c) {
    var wood = [c.mat(0x8f6b44), c.mat(0xb98a5e), c.mat(0xc9a06b), c.mat(0x9a8a6a)];
    for (var i = 0; i < 4; i++) {
      var a = Math.PI / 2 * i + Math.PI / 4;
      var x = Math.cos(a) * 1.45, z = Math.sin(a) * 1.45;
      c.addPlank({
        x: x, y: 3.2, z: z,
        w: 3.0, h: 2.9,
        m: wood[i % 4],
        ry: a, rx: -0.45,
        cols: 3, rows: 4
      });
    }
    c.addCyl(c.group, 0.2, 0.26, 2.0, 0, 1.0, 0, c.mat(0x4c5676, { metal: true }), 12);
    c.addDeck({ x: 0, y: 4.55, z: 0, w: 1.5, h: 1.5, m: c.mat(0xffd166, { metal: true }), cols: 2, rows: 2 });
  });

  window.SJfigure = {
    build: build,
    themes: THEMES.map(function (t) { return t.name; })
  };
})();