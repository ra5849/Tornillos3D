/* Tornillos 3D - Generador de niveles con dificultad creciente */
(function () {
  var PALETTE = [
    { hex: 0xd64a3a, name: 'Rojo' },
    { hex: 0x2f8de0, name: 'Azul' },
    { hex: 0x2fbe6a, name: 'Verde' },
    { hex: 0xf2b824, name: 'Amarillo' },
    { hex: 0xe8782a, name: 'Naranja' },
    { hex: 0xd35bb8, name: 'Rosa' },
    { hex: 0x8a5cd6, name: 'Morado' },
    { hex: 0x2bb8b0, name: 'Cian' }
  ];

  /* 500 niveles: cada uno igual o más difícil que el anterior.
     - más colores (hasta 8): más cola esperando al completar cubos
     - más tornillos por color (hasta 12): más trabajo por cubo
     - más densidad de tornillos (hasta +60% agujeros en las tablas) */
  var MAX_LEVEL = 500;

  function randInt(n) { return Math.floor(Math.random() * n); }
  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = randInt(i + 1);
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  function colorsForLevel(n) {
    return Math.min(8, 3 + Math.floor((n - 1) / 40));
  }
  function perColorForLevel(n) {
    return Math.min(12, 4 + Math.floor((n - 1) / 60));
  }
  /* densidad de agujeros: 1.0 al inicio, +10% cada 30 niveles, max 1.6 */
  function densityForLevel(n) {
    return Math.min(1.6, 1 + (n - 1) / 300);
  }

  function buildLevel(num) {
    num = Math.max(1, Math.min(MAX_LEVEL, num));
    var themes = SJfigure.themes;
    var theme = themes[(num - 1) % themes.length];

    var colorsN = colorsForLevel(num);
    var perColor = perColorForLevel(num);

    var fig = SJfigure.build(theme, densityForLevel(num));

    // ajuste si no bastan los puntos (mantiene solucionable)
    var total = colorsN * perColor;
    if (fig.slots.length < total) {
      perColor = Math.max(3, Math.floor(fig.slots.length / colorsN));
      total = colorsN * perColor;
    }

    // paleta rotada segun nivel para variedad
    var offset = ((num - 1) * 3) % PALETTE.length;
    var palette = [];
    for (var i = 0; i < colorsN; i++) palette.push(PALETTE[(offset + i) % PALETTE.length]);

    // repartir tornillos entre los puntos: cada color exactamente perColor
    // Prioridad: tornillos de placas (suyos y escondidos) para que las placas siempre tengan tornillos
    var priority = [];
    for (var pi = 0; pi < fig.plates.length; pi++) {
      for (var oi = 0; oi < fig.plates[pi].own.length; oi++) priority.push(fig.plates[pi].own[oi]);
      for (var ci = 0; ci < fig.plates[pi].cover.length; ci++) priority.push(fig.plates[pi].cover[ci]);
    }
    var rest = [];
    for (var s = 0; s < fig.slots.length; s++) if (priority.indexOf(s) === -1) rest.push(s);
    var indices = priority.concat(rest);
    shuffle(priority);
    shuffle(rest);
    indices = priority.concat(rest);

    var needByColor = {};
    for (var ci2 = 0; ci2 < colorsN; ci2++) needByColor[ci2] = perColor;

    var specs = {}; // slotIdx -> colorIdx
    var placed = 0;
    for (var k = 0; k < indices.length && placed < total; k++) {
      var cand = [];
      for (var c = 0; c < colorsN; c++) if (needByColor[c] > 0) cand.push(c);
      if (!cand.length) break;
      var pick = cand[randInt(cand.length)];
      needByColor[pick]--;
      specs[indices[k]] = pick;
      placed++;
    }

    return {
      num: num,
      theme: theme,
      figure: fig,
      colors: palette,
      capacity: perColor,
      specs: specs,
      totalScrews: placed
    };
  }

  window.SJlevels = {
    buildLevel: buildLevel,
    palette: PALETTE,
    MAX_LEVEL: MAX_LEVEL
  };
})();