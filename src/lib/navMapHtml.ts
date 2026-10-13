/* The navigation map page that runs inside the WebView (14 Oct 2026). Leaflet from
   cdnjs, CARTO's dark basemap on OpenStreetMap data (free, no key), the planned
   route as a cased line, the client's pin, and the Odds bike marker for the
   assessor. The app drives it with window.__nav.apply(message) through
   injectJavaScript; the page reports back through ReactNativeWebView.postMessage.
   The page also holds a screen wake lock while navigating (no native module). */

/* OpenStreetMap's own tiles (no key). CARTO's dark basemap stamps "API KEY REQUIRED" on
   tiles requested from an app (seen on the phone, 14 Oct 2026), so the night look comes
   from a CSS filter on the tile pane instead: invert + hue-rotate keeps water blue and
   parks green while streets go dark. Markers and the route sit in other panes, unfiltered. */
export const NAV_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

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
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css"/>
<style>
html,body{margin:0;height:100%;background:#0b0b0f;overflow:hidden;-webkit-user-select:none;user-select:none}
#map{position:absolute;inset:0;background:#0b0b0f}
.leaflet-tile-pane{filter:invert(1) hue-rotate(180deg) brightness(.82) contrast(.92) saturate(.55)}
.leaflet-control-zoom{display:none}
.leaflet-control-attribution{font:10px system-ui;background:rgba(8,6,6,.55)!important;color:#9A938C!important}
.leaflet-control-attribution a{color:#C8C2BC!important}
.dest{position:relative;width:84px;height:46px}
.dest .pin{position:absolute;left:33px;top:26px;width:18px;height:18px;border-radius:9px;background:#57C98A;border:3px solid #fff;box-shadow:0 0 0 1.5px rgba(0,0,0,.6);box-sizing:border-box}
.dest .lbl{position:absolute;left:0;top:0;width:82px;text-align:center;font:700 10px/1 system-ui;letter-spacing:1px;color:#fff;background:rgba(8,6,6,.9);padding:4px 0;border-radius:6px;border:1px solid rgba(87,201,138,.6);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dest.stale .pin{background:#E0A53C}.dest.stale .lbl{border-color:rgba(224,165,60,.7)}
${BIKE_CSS}
</style></head>
<body><div id="map"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js"></script>
<script>
(function(){
  var post = function(m){ try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(JSON.stringify(m)); } catch(e){} };
  var map, tiles, routeCase, routeLine, passedLine, me, dest, follow = true, followResumeAt = 0, zoomNav = 16, lastPos = null, routePts = [], wake = null;
  var BIKE_SVG = ${JSON.stringify(BIKE_SVG)};
  function bikeIcon(){ return L.divIcon({ className:'', html:'<div class="ob-wrap still" style="--h:0deg;width:64px;height:64px"><div class="ob-pulse"></div><div class="ob-rot">'+BIKE_SVG+'</div></div>', iconSize:[64,64], iconAnchor:[32,32] }); }
  function setBike(h, moving){ var el = me && me.getElement && me.getElement(); if(!el) return; var w = el.querySelector('.ob-wrap'); if(!w) return; if (typeof h === 'number' && isFinite(h)) w.style.setProperty('--h', h+'deg'); w.classList.toggle('moving', !!moving); w.classList.toggle('still', !moving); }
  function noMotion(on){ document.documentElement.classList.toggle('ob-no-motion', !!on); }
  var mq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  var reduce = false;
  function applyMotion(){ noMotion(reduce || (mq && mq.matches) || document.visibilityState === 'hidden'); }
  if (mq && mq.addEventListener) mq.addEventListener('change', applyMotion);
  document.addEventListener('visibilitychange', function(){ applyMotion(); if (document.visibilityState === 'visible') requestWake(); });
  function requestWake(){ try { if (navigator.wakeLock && !wake) navigator.wakeLock.request('screen').then(function(w){ wake = w; w.addEventListener('release', function(){ wake = null; }); }).catch(function(){}); } catch(e){} }
  function releaseWake(){ try { if (wake) { wake.release(); wake = null; } } catch(e){} }
  function centerWithOffset(latlng, zoom){ var z = zoom == null ? map.getZoom() : zoom; var h = map.getSize().y; var p = map.project(latlng, z).subtract([0, h*0.14]); map.setView(map.unproject(p, z), z, { animate:false }); }
  function init(m){
    map = L.map('map', { zoomControl:false, attributionControl:true, zoomAnimation:false, fadeAnimation:false, markerZoomAnimation:false, inertia:true, tap:false });
    tiles = L.tileLayer(${JSON.stringify(NAV_TILES)}, { maxZoom:19, attribution:'&copy; OpenStreetMap' }).addTo(map);
    dest = L.marker([m.dest.lat, m.dest.lng], { icon: L.divIcon({ className:'', html:'<div class="dest'+(m.stale?' stale':'')+'"><div class="lbl">'+String(m.dest.name||'CLIENT').toUpperCase().slice(0,14)+'</div><div class="pin"></div></div>', iconSize:[84,46], iconAnchor:[42,35] }), zIndexOffset: 500 }).addTo(map);
    passedLine = L.polyline([], { color:'#8A847E', weight:5, opacity:.55 }).addTo(map);
    routeCase = L.polyline([], { color:'#ffffff', weight:10, opacity:.95 }).addTo(map);
    routeLine = L.polyline([], { color:'#4F8BFF', weight:6, opacity:1 }).addTo(map);
    me = L.marker([m.dest.lat, m.dest.lng], { icon: bikeIcon(), zIndexOffset: 1000, opacity: 0 }).addTo(map);
    map.setView([m.dest.lat, m.dest.lng], 14, { animate:false });
    map.on('dragstart', function(){ follow = false; followResumeAt = Date.now() + 10000; post({ type:'drag' }); });
    map.on('zoomend', function(){ if (!follow) zoomNav = map.getZoom(); });
    applyMotion();
    post({ type:'ready' });
  }
  function setRoute(m){
    routePts = Array.isArray(m.points) ? m.points : [];
    routeLine.setLatLngs(routePts); routeCase.setLatLngs(routePts);
    var op = m.dim ? .45 : 1; routeLine.setStyle({ opacity: op }); routeCase.setStyle({ opacity: op * .95 });
    passedLine.setLatLngs([]);
    if (m.overview && routePts.length) { var b = L.latLngBounds(routePts); if (lastPos) b.extend(lastPos); map.fitBounds(b, { paddingTopLeft:[36, 230], paddingBottomRight:[36, 120], animate:false }); }
  }
  /* Smooth motion (14 Oct 2026, user: "make it smooth like Google Maps"): every GPS fix
     becomes a target; a frame loop glides the badge from where it is drawn to the target
     over the fix interval, eases the heading along the shortest arc, keeps the camera on
     the badge, and extends the ridden line. The compass drives the heading while standing
     still or slow (under 2 m/s); the GPS course takes over once moving. Under reduce
     motion everything jumps instead. */
  var anim = { cur:null, from:null, to:null, t0:0, dur:1200, headCur:0, headTo:0, gpsHead:null, compass:null, speed:0, moving:false, alongIndex:null, followOk:true, loop:false };
  function targetHeading(){
    var useGps = anim.moving && anim.speed > 2 && anim.gpsHead != null;
    if (useGps) return anim.gpsHead;
    if (anim.compass != null) return anim.compass;
    return anim.gpsHead != null ? anim.gpsHead : anim.headCur;
  }
  function drawAt(pos, head){
    me.setLatLng(pos); me.setOpacity(1);
    setBike(head, anim.moving);
    if (anim.alongIndex != null && routePts.length) passedLine.setLatLngs(routePts.slice(0, Math.max(0, anim.alongIndex)).concat([pos]));
    if (!follow && followResumeAt && Date.now() > followResumeAt) { follow = true; followResumeAt = 0; }
    if (follow && anim.followOk) centerWithOffset(pos, zoomNav);
  }
  function frame(){
    if (!anim.loop) return;
    var reduce = document.documentElement.classList.contains('ob-no-motion');
    var now = performance.now();
    if (anim.to) {
      var k = reduce ? 1 : Math.min(1, (now - anim.t0) / anim.dur);
      anim.cur = [anim.from[0] + (anim.to[0] - anim.from[0]) * k, anim.from[1] + (anim.to[1] - anim.from[1]) * k];
      if (k >= 1) { anim.from = anim.to; anim.to = null; }
    }
    var want = targetHeading();
    var diff = ((want - anim.headCur + 540) % 360) - 180;
    anim.headCur = reduce ? want : (anim.headCur + diff * 0.18 + 360) % 360;
    if (anim.cur) drawAt(anim.cur, anim.headCur);
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
  window.__nav = { apply: function(m){ try {
    if (!m) return;
    if (m.type === 'init') init(m);
    else if (m.type === 'route') setRoute(m);
    else if (m.type === 'pos') setPos(m);
    else if (m.type === 'compass') setCompass(m);
    else if (m.type === 'start') { follow = true; requestWake(); }
    else if (m.type === 'arrived') { follow = true; if (lastPos) map.setView(lastPos, 17, { animate:false }); }
    else if (m.type === 'stop') { releaseWake(); anim.loop = false; }
    else if (m.type === 'recenter') { follow = true; followResumeAt = 0; if (lastPos) centerWithOffset(lastPos, zoomNav); }
    else if (m.type === 'motion') { reduce = !!m.reduce; applyMotion(); }
  } catch(e) { post({ type:'error', message: String(e && e.message || e) }); } } };
  post({ type:'loaded' });
})();
</script></body></html>`;
