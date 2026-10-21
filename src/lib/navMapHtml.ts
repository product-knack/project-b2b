/* The navigation map page that runs inside the WebView (14 Oct 2026, Google-style
   since the same afternoon: user "same style map, the animation of Google Maps").
   MapLibre GL from jsDelivr with OpenFreeMap's "liberty" vector style (OpenStreetMap
   data, free, no key), a pitched heading-up camera that glides between fixes, the
   planned route as a cased blue line with the ridden part greyed, the client's pin,
   and the Odds bike badge for the assessor. The app drives it with
   window.__nav.apply(message) through injectJavaScript; the page reports back through
   ReactNativeWebView.postMessage. The page holds a screen wake lock while navigating. */

export const NAV_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

const BIKE_CSS = `
.ob-wrap{position:relative;width:64px;height:64px;pointer-events:none}
.ob-pulse{position:absolute;left:18.75%;top:18.75%;width:62.5%;height:62.5%;border-radius:50%;background:rgba(244,122,42,.45);transform:scale(.9);opacity:0;animation:ob-pulse 1.7s ease-out infinite}
.ob-rot{position:absolute;inset:0;transform:rotate(var(--h,0deg));transform-origin:50% 50%;will-change:transform}
.ob-rot svg{display:block;width:100%;height:100%;overflow:visible}
.ob-rider{transform-origin:32px 32px;transform:rotate(calc(-1 * var(--h,0deg)))}
.ob-wheel{transform-box:fill-box;transform-origin:center}
.ob-wrap.moving .ob-wheel{animation:ob-spin .55s linear infinite}
.ob-trail g{opacity:0}
.ob-wrap.moving .ob-trail g{animation:ob-trail .95s ease-out infinite}
.ob-wrap.moving .ob-trail .t2{animation-delay:.32s}
.ob-wrap.still .ob-trail g{opacity:0;animation:none}
.ob-wrap.still .ob-wheel{animation:none}
.ob-no-motion .ob-wrap *{animation:none!important}
.ob-no-motion .ob-pulse{opacity:.18;transform:scale(1.25)}
.ob-no-motion .ob-trail g{opacity:0!important}
@keyframes ob-pulse{0%{transform:scale(.85);opacity:.55}70%{opacity:.12}100%{transform:scale(2.2);opacity:0}}
@keyframes ob-spin{to{transform:rotate(360deg)}}
@keyframes ob-trail{0%{opacity:0;transform:translate(0,0)}25%{opacity:.95}100%{opacity:0;transform:translate(-3px,9px)}}
`;

const BIKE_SVG = `<svg viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
<g class="ob-trail"><g class="t1"><rect x="14" y="48" width="13" height="4.8" rx="2.4" transform="rotate(-45 20.5 50.4)" fill="#F47A2A" stroke="#fff" stroke-width="1.6" paint-order="stroke"/></g><g class="t2"><rect x="26" y="53" width="13" height="4.8" rx="2.4" transform="rotate(-45 32.5 55.4)" fill="#F47A2A" stroke="#fff" stroke-width="1.6" paint-order="stroke"/></g></g>
<path class="ob-head" d="M32 4.5 L38 12.5 L26 12.5 Z" fill="#F47A2A" stroke="#fff" stroke-width="1.8" stroke-linejoin="round" paint-order="stroke"/>
<circle cx="32" cy="32" r="20" fill="#fff"/><circle cx="32" cy="32" r="17" fill="#F47A2A"/>
<g class="ob-rider" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">
<g class="ob-wheel"><circle cx="23.5" cy="38.5" r="5.4"/><path d="M23.5 33.1v10.8M18.1 38.5h10.8" stroke-width="1.2"/></g>
<g class="ob-wheel"><circle cx="40.5" cy="38.5" r="5.4"/><path d="M40.5 33.1v10.8M35.1 38.5h10.8" stroke-width="1.2"/></g>
<path d="M23.5 38.5 L28 29.5 L37.5 29.5 L40.5 38.5 M28 29.5 L32 38.5 L37.5 29.5 M26.5 28.5 L29.5 28.5"/>
<path d="M29 29 L33.5 23 M33.5 23 L37.5 28.5 M29 29 L31.5 35"/>
<circle cx="35.6" cy="19.6" r="2.5" fill="#fff" stroke="none"/>
</g></svg>`;

export const NAV_MAP_HTML = `<!doctype html>
<html><head><meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"/>
<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.css"/>
<style>
html,body{margin:0;height:100%;background:#e8eaed;overflow:hidden;-webkit-user-select:none;user-select:none}
#map{position:absolute;inset:0;background:#e8eaed}
.maplibregl-ctrl{display:none!important} /* the OpenStreetMap credit is printed by the app's bottom sheet */
.dest{position:relative;width:96px;height:52px}
.dest .pin{position:absolute;left:39px;top:30px;width:20px;height:20px;border-radius:10px;background:#34A853;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.45);box-sizing:border-box}
.dest .lbl{position:absolute;left:0;top:0;width:94px;text-align:center;font:700 11px/1 system-ui;letter-spacing:.3px;color:#fff;background:#1A73E8;padding:6px 0;border-radius:8px;box-shadow:0 1px 4px rgba(0,0,0,.35);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dest.stale .pin{background:#F9AB00}.dest.stale .lbl{background:#B06000}
${BIKE_CSS}
</style></head>
<body><div id="map"></div>
<script src="https://cdn.jsdelivr.net/npm/maplibre-gl@4.7.1/dist/maplibre-gl.js"></script>
<script>
(function(){
  var post = function(m){ try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch(e){} };
  var map, me, meEl, dest, follow = true, mode = 'heading', routePts = [], loaded = false, pending = [], wake = null, lastPos = null, userGesture = false;
  var touching = 0, pinching = false;  // fingers on the map; while any is down the follow camera stays still (21 Oct 2026)
  function adoptZoom(){ if (map) cam.zoom = Math.max(12, Math.min(19, map.getZoom())); }
  var cam = { zoom: 17, pitch: 55 }; // the follow camera; arrival pulls it closer and flatter
  var easeUntil = 0;                 // while a programmatic easeTo plays, the frame loop leaves the camera alone
  var errors = [];                   // the last map errors, for window.__nav.debug()
  var frameNo = 0;
  var BIKE_SVG = ${JSON.stringify(BIKE_SVG)};
  function noMotion(on){ document.documentElement.classList.toggle('ob-no-motion', !!on); }
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduce = false;
  function applyMotion(){ noMotion(reduce || (mq && mq.matches) || document.visibilityState === 'hidden'); }
  if (mq && mq.addEventListener) mq.addEventListener('change', applyMotion);
  document.addEventListener('visibilitychange', function(){ applyMotion(); if (document.visibilityState === 'visible') requestWake(); });
  function requestWake(){ try { if (navigator.wakeLock && !wake) navigator.wakeLock.request('screen').then(function(w){ wake = w; w.addEventListener('release', function(){ wake = null; }); }).catch(function(){}); } catch(e){} }
  function releaseWake(){ try { if (wake) { wake.release(); wake = null; } } catch(e){} }
  function setBike(h, moving){ if(!meEl) return; var w = meEl.querySelector('.ob-wrap'); if(!w) return; if (typeof h === 'number' && isFinite(h)) w.style.setProperty('--h', h+'deg'); w.classList.toggle('moving', !!moving); w.classList.toggle('still', !moving); }
  function toLL(p){ return [p[1], p[0]]; }
  function lineFeature(pts){ return { type:'Feature', geometry:{ type:'LineString', coordinates: pts.map(toLL) }, properties:{} }; }
  function src(id, pts){ var s = map.getSource(id); if (s) s.setData(lineFeature(pts)); }

  function init(m){
    try {
      map = new maplibregl.Map({ container:'map', style:${JSON.stringify(NAV_STYLE)}, center:[m.dest.lng, m.dest.lat], zoom:13.5, pitch:0, bearing:0, attributionControl:false, pitchWithRotate:false, fadeDuration:0 });
    } catch (e) { post({ type:'error', message:'map: ' + String(e && e.message || e) }); return; }
    map.on('error', function(e){ var msg = String(e && e.error && e.error.message || ''); errors.push(msg.slice(0, 120)); if (errors.length > 20) errors.shift(); post({ type:'maperror', message: msg }); });
    var destEl = document.createElement('div');
    destEl.innerHTML = '<div class="dest'+(m.stale?' stale':'')+'"><div class="lbl">'+String(m.dest.name||'CLIENT').toUpperCase().slice(0,14)+'</div><div class="pin"></div></div>';
    dest = new maplibregl.Marker({ element: destEl.firstChild, anchor:'center', offset:[0,-14], pitchAlignment:'viewport', rotationAlignment:'viewport' }).setLngLat([m.dest.lng, m.dest.lat]).addTo(map);
    meEl = document.createElement('div');
    meEl.innerHTML = '<div class="ob-wrap still" style="--h:0deg;width:64px;height:64px;opacity:0"><div class="ob-pulse"></div><div class="ob-rot">'+BIKE_SVG+'</div></div>';
    me = new maplibregl.Marker({ element: meEl, anchor:'center', pitchAlignment:'viewport', rotationAlignment:'viewport' }).setLngLat([m.dest.lng, m.dest.lat]).addTo(map);
    map.on('load', function(){
      map.addSource('passed', { type:'geojson', data: lineFeature([]) });
      map.addSource('route', { type:'geojson', data: lineFeature([]) });
      map.addLayer({ id:'passed', type:'line', source:'passed', layout:{ 'line-cap':'round', 'line-join':'round' }, paint:{ 'line-color':'#9AA0A6', 'line-width':['interpolate',['linear'],['zoom'],12,4,17,9], 'line-opacity':.85 } });
      map.addLayer({ id:'route-casing', type:'line', source:'route', layout:{ 'line-cap':'round', 'line-join':'round' }, paint:{ 'line-color':'#1548A5', 'line-width':['interpolate',['linear'],['zoom'],12,7,17,14] } });
      map.addLayer({ id:'route', type:'line', source:'route', layout:{ 'line-cap':'round', 'line-join':'round' }, paint:{ 'line-color':'#4285F4', 'line-width':['interpolate',['linear'],['zoom'],12,4.5,17,9.5] } });
      loaded = true;
      pending.forEach(apply); pending = [];
      post({ type:'ready' });
    });
    // Touch rules (21 Oct 2026, Google Maps parity). A one-finger drag or a pitch pauses the follow camera
    // (the Re-centre pill). A pinch or a double tap only changes the zoom: the camera keeps following at
    // the new zoom. While any finger is on the map the frame loop never moves the camera, so a gesture is
    // never fought by the next GPS fix (the old loop re-applied zoom 17 every frame, which made pinch
    // zoom snap back and read as "cannot zoom").
    var el = map.getContainer();
    var touchDone = function(e){ touching = e.touches ? e.touches.length : 0; if (touching < 2 && pinching) { pinching = false; adoptZoom(); } };
    el.addEventListener('touchstart', function(e){ touching = e.touches.length; if (touching >= 2) pinching = true; }, { passive: true });
    el.addEventListener('touchend', touchDone, { passive: true });
    el.addEventListener('touchcancel', touchDone, { passive: true });
    ['dragstart','pitchstart','wheel'].forEach(function(ev){ map.on(ev, function(e){ if (e && e.originalEvent) { follow = false; userGesture = true; post({ type:'drag' }); } }); });
    map.on('rotatestart', function(e){ if (e && e.originalEvent && !pinching) { follow = false; userGesture = true; post({ type:'drag' }); } });
    map.on('zoomend', function(e){ if (e && e.originalEvent) adoptZoom(); });
    applyMotion();
  }

  /* ---- smooth motion: every fix is a target; the frame loop glides the badge, eases the
     heading along the shortest arc and keeps the camera on the badge (heading-up, pitched). */
  var anim = { cur:null, from:null, to:null, t0:0, dur:1200, headCur:0, gpsHead:null, compass:null, speed:0, moving:false, alongIndex:null, followOk:true, loop:false };
  function targetHeading(){
    var useGps = anim.moving && anim.speed > 2 && anim.gpsHead != null;
    if (useGps) return anim.gpsHead;
    if (anim.compass != null) return anim.compass;
    return anim.gpsHead != null ? anim.gpsHead : anim.headCur;
  }
  function drawAt(pos, head){
    me.setLngLat([pos[1], pos[0]]);
    meEl.querySelector('.ob-wrap').style.opacity = '1';
    var bearing = mode === 'heading' && follow && anim.followOk ? head : map.getBearing();
    // badge rotation is relative to the screen: the map already turned by the bearing
    setBike(head - bearing, anim.moving);
    if (anim.alongIndex != null && routePts.length && (frameNo++ % 4 === 0)) {
      // the ridden part in grey, the rest in blue, both cut at the badge (re-cut ~15 times a second)
      var i = Math.max(0, Math.min(routePts.length - 1, anim.alongIndex));
      src('passed', routePts.slice(0, i + 1).concat([pos]));
      src('route', [pos].concat(routePts.slice(i + 1)));
    }
    if (follow && anim.followOk && !touching && performance.now() > easeUntil) {
      var h = map.getContainer().clientHeight;
      map.jumpTo({ center:[pos[1], pos[0]], bearing: mode === 'heading' ? head : 0, pitch: cam.pitch, zoom: cam.zoom, offset:[0, h * 0.2] });
    }
  }
  function frame(){
    if (!anim.loop) return;
    var reduceNow = document.documentElement.classList.contains('ob-no-motion');
    var now = performance.now();
    if (anim.to) {
      var k = reduceNow ? 1 : Math.min(1, (now - anim.t0) / anim.dur);
      anim.cur = [anim.from[0] + (anim.to[0] - anim.from[0]) * k, anim.from[1] + (anim.to[1] - anim.from[1]) * k];
      if (k >= 1) { anim.from = anim.to; anim.to = null; }
    }
    var want = targetHeading();
    var diff = ((want - anim.headCur + 540) % 360) - 180;
    anim.headCur = reduceNow ? want : (anim.headCur + diff * 0.14 + 360) % 360;
    if (anim.cur && loaded) drawAt(anim.cur, anim.headCur);
    lastPos = anim.cur;
    requestAnimationFrame(frame);
  }
  function startLoop(){ if (!anim.loop) { anim.loop = true; requestAnimationFrame(frame); } }
  function setPos(m){
    var target = [m.lat, m.lng];
    var now = performance.now();
    if (!anim.cur) { anim.cur = target; anim.from = target; anim.headCur = typeof m.heading === 'number' ? m.heading : 0; }
    else { anim.from = anim.cur.slice(); }
    anim.to = target; anim.t0 = now;
    anim.dur = Math.min(2500, Math.max(350, m.intervalMs || 1200));
    if (typeof m.heading === 'number' && isFinite(m.heading)) anim.gpsHead = m.heading;
    anim.speed = typeof m.speed === 'number' ? m.speed : 0;
    anim.moving = !!m.moving;
    anim.alongIndex = m.alongIndex == null ? null : m.alongIndex;
    anim.followOk = m.follow !== false;
    startLoop();
  }
  function setCompass(m){ if (typeof m.deg === 'number' && isFinite(m.deg)) { anim.compass = m.deg; startLoop(); } }
  function setRoute(m){
    routePts = Array.isArray(m.points) ? m.points : [];
    src('route', routePts);
    map.setPaintProperty('route', 'line-opacity', m.dim ? .45 : 1);
    map.setPaintProperty('route-casing', 'line-opacity', m.dim ? .45 : 1);
    src('passed', []);
    if (m.overview) overview();
  }
  function overview(){
    if (!routePts.length) return;
    var b = new maplibregl.LngLatBounds();
    routePts.forEach(function(p){ b.extend([p[1], p[0]]); });
    if (lastPos) b.extend([lastPos[1], lastPos[0]]);
    follow = false;
    map.fitBounds(b, { padding:{ top:230, bottom:220, left:44, right:44 }, pitch:0, bearing:0, duration:600 });
  }
  function recenter(){
    follow = true; userGesture = false;
    if (lastPos) {
      var h = map.getContainer().clientHeight;
      easeUntil = performance.now() + 750;
      map.easeTo({ center:[lastPos[1], lastPos[0]], bearing: mode === 'heading' ? anim.headCur : 0, pitch: cam.pitch, zoom: cam.zoom, offset:[0, h * 0.2], duration: 700 });
    }
  }
  function apply(m){
    if (m.type === 'route') setRoute(m);
    else if (m.type === 'pos') setPos(m);
    else if (m.type === 'compass') setCompass(m);
    else if (m.type === 'start') { follow = true; touching = 0; pinching = false; cam = { zoom: 17, pitch: 55 }; requestWake(); recenter(); }
    else if (m.type === 'zoom') {
      // The + / - buttons: one zoom level a tap, 12 to 19, kept by the follow camera.
      cam.zoom = Math.max(12, Math.min(19, (follow ? cam.zoom : map.getZoom()) + (typeof m.delta === 'number' ? m.delta : 0)));
      easeUntil = performance.now() + 320;
      map.easeTo({ zoom: cam.zoom, duration: 260 });
    }
    else if (m.type === 'arrived') { cam = { zoom: 18, pitch: 35 }; recenter(); }
    else if (m.type === 'stop') { releaseWake(); anim.loop = false; }
    else if (m.type === 'recenter') recenter();
    else if (m.type === 'overview') overview();
    else if (m.type === 'camera') { mode = m.mode === 'north' ? 'north' : 'heading'; if (follow) recenter(); }
    else if (m.type === 'motion') { reduce = !!m.reduce; applyMotion(); }
  }
  window.__nav = { apply: function(m){ try {
    if (!m) return;
    if (m.type === 'init') { init(m); return; }
    if (!map) return;
    if (!loaded && m.type !== 'motion') { pending.push(m); return; }
    apply(m);
  } catch(e) { post({ type:'error', message: String(e && e.message || e) }); } },
    debug: function(){ if (!map) return null; var c = map.getCenter(); return { bearing: map.getBearing(), pitch: map.getPitch(), zoom: map.getZoom(), center: [c.lat, c.lng], follow: follow, mode: mode, headCur: anim.headCur, loaded: loaded, styleLoaded: map.isStyleLoaded(), tilesLoaded: map.areTilesLoaded(), pending: pending.length, errors: errors }; } };
  post({ type:'loaded' });
})();
</script></body></html>`;
