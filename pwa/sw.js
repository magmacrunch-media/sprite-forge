/* sw.js — offline for the PWA build.
 *
 * TWO FIELDS HERE ARE GENERATED. scripts/package-pwa.mjs replaces the
 * __CACHE__ and __PRECACHE__ tokens below as it assembles the bundle, so the
 * precache list is derived from the tree that actually shipped rather than
 * kept by hand beside it. That is the same argument kit/ is vendored wholesale
 * on: a glob cannot drift the way a hand-kept list can, and a sprite editor
 * loads forty-odd files, which is far past the count a human keeps correct.
 * Opening this file in the source tree therefore shows the tokens, not a list;
 * the assembled copy in the bundle is the real one.
 *
 * __CACHE__ carries a digest of those files' contents, so a changed build gets
 * a new cache name and the activate handler below drops the old one. Nothing
 * needs a version bumped by hand.
 *
 * IT DOES NOT CALL skipWaiting, AND THAT IS DELIBERATE. A sprite editor holds
 * unsaved frames. Taking over an open page mid-session could serve it a mix of
 * old and new assets, and the one thing worse than a stale cache in a drawing
 * tool is a reload that eats the drawing. A new worker therefore waits, and
 * takes over the next time the app is launched, which for an installed PWA is
 * the next time the window is opened. Cache staleness here lasts one session;
 * the alternative risks the work.
 *
 * Cache-first, because every asset in this bundle is immutable for the life of
 * the cache name: the digest changes when any of them do, so a hit can never
 * be stale with respect to its own build. There is no backend to be fresher
 * than. A LITE build has no network dependency at all once it is cached, which
 * is the whole reason it is worth installing.
 */

var CACHE = "__CACHE__";
var PRECACHE = __PRECACHE__;

self.addEventListener("install", function (e) {
    e.waitUntil(
        caches.open(CACHE).then(function (cache) {
            return cache.addAll(PRECACHE);
        })
    );
});

self.addEventListener("activate", function (e) {
    e.waitUntil(
        caches.keys().then(function (names) {
            return Promise.all(
                names.filter(function (n) { return n !== CACHE; })
                     .map(function (n) { return caches.delete(n); })
            ).then(function () { return self.clients.claim(); });
        })
    );
});

self.addEventListener("fetch", function (e) {
    var req = e.request;

    /* Only GET, and only our own origin. A POST is not cacheable and a
       cross-origin request is somebody else's to answer; passing both straight
       through means this worker never becomes the reason a request failed. */
    if (req.method !== "GET") return;
    if (new URL(req.url).origin !== self.location.origin) return;

    e.respondWith(
        caches.match(req).then(function (cached) {
            if (cached) return cached;

            return fetch(req).then(function (resp) {
                /* Opaque and error responses are not worth keeping: caching a
                   404 would make it permanent for this cache name. */
                if (resp && resp.ok && resp.type === "basic") {
                    var copy = resp.clone();
                    caches.open(CACHE).then(function (cache) {
                        cache.put(req, copy);
                    });
                }
                return resp;
            }).catch(function () {
                /* Offline and not precached. A navigation still has somewhere
                   sensible to land, because the page itself is always in
                   PRECACHE; anything else legitimately fails. */
                if (req.mode === "navigate") return caches.match("./index.html");
                return Response.error();
            });
        })
    );
});
