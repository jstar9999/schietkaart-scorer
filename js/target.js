/* Schijfdefinitie en schotwaardering.
   Bron: KNSA Schiet- en Wedstrijdreglement deel III (versie 01-10-2026), art. 3.2.1
   "Klein Kaliber Schijf KNSA 12-meter model 1986". */
(function (root) {
  'use strict';
  var KS = root.KS || (root.KS = {});

  var KNSA12M1986 = {
    id: 'knsa-12m-1986',
    name: 'KNSA 12-meter KKG model 1986',
    // Ringdiameters in mm (art. 3.2.1).
    ringDiameters: { 9: 2.7, 8: 6.8, 7: 10.9, 6: 15.0, 5: 20.0, 4: 25.0, 3: 30.0, 2: 35.0, 1: 40.0 },
    tenDotDiameter: 1.4,   // witte punt: 10 als de schotmaat de punt geheel bedekt
    blackDiameter: 25.0,   // zwart = ring 4 t/m 9
    moucheRing: 8,         // mouche: schot geheel binnen de ring van de 8
    lineWidth: 0.1,
    visualsPerCard: 5,
    visualSpacing: 84      // 83-85 mm tussen de 10-ringen
  };

  // Ringstralen (mm) zoals gedrukt, binnen het zwart (witte lijnen) en daarbuiten (zwarte lijnen).
  KNSA12M1986.innerRingRadii = [9, 8, 7, 6, 5].map(function (v) { return KNSA12M1986.ringDiameters[v] / 2; });
  KNSA12M1986.outerRingRadii = [3, 2, 1].map(function (v) { return KNSA12M1986.ringDiameters[v] / 2; });

  // Grenzen: hoogste waarde v waarvoor d <= maxDist(v). d = afstand schotmiddelpunt tot schijfmiddelpunt.
  function limits(gaugeDiameter, t) {
    var g = gaugeDiameter / 2, out = [{ value: 10, maxDist: g - t.tenDotDiameter / 2 }];
    for (var v = 9; v >= 1; v--) out.push({ value: v, maxDist: t.ringDiameters[v] / 2 + g });
    return out;
  }

  /* Schotwaarde volgens art. 3.2.1:
     1 t/m 9 : ring geraakt -> hoogste waarde (schotmaat raakt of snijdt de ringlijn)
     10      : schotmaat bedekt de witte punt geheel
     mouche  : schot geheel binnen de 8-ring */
  function scoreShot(d, gaugeDiameter, t) {
    t = t || KNSA12M1986;
    var L = limits(gaugeDiameter, t), idx = -1, i;
    for (i = 0; i < L.length; i++) if (d <= L[i].maxDist) { idx = i; break; }
    var value = idx >= 0 ? L[idx].value : 0;
    var toLower = idx >= 0 ? L[idx].maxDist - d : null;                  // mm speling voordat het een punt minder wordt
    var toHigher = idx > 0 ? d - L[idx - 1].maxDist : (idx === -1 ? d - L[L.length - 1].maxDist : null);
    var moucheLimit = t.ringDiameters[t.moucheRing] / 2 - gaugeDiameter / 2;
    var margin = Math.min(toLower === null ? Infinity : toLower, toHigher === null ? Infinity : toHigher);
    return {
      value: value,
      d: d,
      mouche: value === 10 && d <= moucheLimit,
      moucheMargin: Math.abs(moucheLimit - d),
      toLower: toLower,
      toHigher: toHigher,
      margin: margin
    };
  }

  // Standaard-normale verdelingsfunctie (Abramowitz & Stegun 7.1.26).
  function normCdf(x) {
    var t = 1 / (1 + 0.3275911 * Math.abs(x) / Math.SQRT2);
    var y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x / 2);
    return x >= 0 ? (1 + y) / 2 : (1 - y) / 2;
  }

  /* Zekerheid dat de waarde klopt: kans dat de werkelijke afstand binnen dezelfde ringband ligt,
     bij een meetfout met standaardafwijking sigma (mm), maal de kans dat het gat echt een schot is. */
  function certainty(d, sigma, gaugeDiameter, pDetect, t) {
    var sc = scoreShot(d, gaugeDiameter, t), p = 1;
    if (sigma > 0) {
      if (sc.toLower !== null) p -= 1 - normCdf(sc.toLower / sigma);
      if (sc.toHigher !== null) p -= 1 - normCdf(sc.toHigher / sigma);
    }
    return Math.max(0, Math.min(1, p)) * (pDetect == null ? 1 : pDetect);
  }

  KS.target = { KNSA12M1986: KNSA12M1986, scoreShot: scoreShot, limits: limits, certainty: certainty, normCdf: normCdf };
})(typeof window !== 'undefined' ? window : this);
