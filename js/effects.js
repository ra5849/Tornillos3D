/* Tornillos 3D - Efectos visuales: particulas, anillos, shake, etiquetas */
(function () {
  var scene = null, camera = null, container = null;
  var parts = [], rings = [];
  var shakeT = 0, shakeMag = 0;

  function init(s, c, el) { scene = s; camera = c; container = el; }

  function sparkle(pos, hex, count, spread) {
    count = count || 8; spread = spread || 3;
    for (var i = 0; i < count; i++) {
      var geo = new THREE.SphereGeometry(0.045 + Math.random() * 0.04, 6, 6);
      var mat = new THREE.MeshBasicMaterial({ color: hex });
      var p = new THREE.Mesh(geo, mat);
      p.position.copy(pos);
      scene.add(p);
      parts.push({
        mesh: p, t: 0, ttl: 0.5 + Math.random() * 0.4,
        vel: new THREE.Vector3(
          (Math.random() - 0.5) * spread,
          Math.random() * spread + 0.6,
          (Math.random() - 0.5) * spread)
      });
    }
  }

  function ring(pos, color, maxScale) {
    var geo = new THREE.RingGeometry(0.12, 0.3, 32);
    var mat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
    var r = new THREE.Mesh(geo, mat);
    r.position.copy(pos);
    scene.add(r);
    rings.push({ mesh: r, t: 0, max: maxScale || 1.6 });
  }

  function label(text, hexColor, x3, y3, z3, size) {
    if (!camera || !container) return;
    var v = new THREE.Vector3(x3, y3, z3).project(camera);
    if (v.z > 1) return;
    var el = document.createElement('div');
    el.className = 'fxlabel';
    el.textContent = text;
    el.style.color = hexColor || '#ffe27a';
    el.style.fontSize = (size || 20) + 'px';
    el.style.left = ((v.x + 1) / 2 * window.innerWidth) + 'px';
    el.style.top = ((1 - v.y) / 2 * window.innerHeight) + 'px';
    container.appendChild(el);
    setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 950);
  }

  function shake(intensity, time) {
    shakeMag = Math.max(shakeMag, intensity);
    shakeT = Math.max(shakeT, time === undefined ? 0.3 : time);
  }

  window.SJfx = {
    init: init, sparkle: sparkle, ring: ring, label: label, shake: shake,
    update: function (dt) {
      var active = false;
      for (var i = parts.length - 1; i >= 0; i--) {
        var p = parts[i];
        p.t += dt;
        if (p.t > p.ttl) { scene.remove(p.mesh); parts.splice(i, 1); continue; }
        p.mesh.position.addScaledVector(p.vel, dt);
        p.mesh.material.opacity = Math.max(0, 1 - p.t / p.ttl);
        active = true;
      }
      for (var j = rings.length - 1; j >= 0; j--) {
        var r = rings[j];
        r.t += dt * 2.6;
        if (r.t >= 1) { scene.remove(r.mesh); rings.splice(j, 1); continue; }
        var s = 0.4 + r.t * r.max;
        r.mesh.scale.set(s, s, 1);
        r.mesh.material.opacity = 0.9 * (1 - r.t);
        active = true;
      }
      if (shakeT > 0) {
        shakeT -= dt;
        if (shakeT <= 0) { shakeT = 0; shakeMag = 0; }
        active = true;
      }
      return active;
    },
    hasShake: function () { return shakeT > 0; }
  };
})();