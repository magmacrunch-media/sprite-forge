/* register.js — turn the service worker on, and never break the page doing it.
 *
 * A separate file rather than an inline <script> so the bundle stays servable
 * under a CSP without 'unsafe-inline'. The desktop build's CSP is Tauri's
 * business and this file is not in it; the PWA's is whatever its host sends,
 * and the point is that a strict one needs no exception made for us.
 *
 * Every failure here is swallowed on purpose. Service workers are unavailable
 * in a plain file:// open, in a private window on some browsers, and over
 * plain http from anything but localhost. The editor works in all of those
 * cases, just without offline, so a registration failure must stay a missing
 * feature rather than becoming a broken tool. This is the same shape as the
 * kit's capability rule: the absence of a thing is the feature switch, and
 * nothing downstream asks whether it is there.
 */
(function () {
    'use strict';

    if (!('serviceWorker' in navigator)) return;

    window.addEventListener('load', function () {
        /* Scope is the directory this file was served from, which is the
           bundle root, which is what manifest.json declares. Passing it
           explicitly would add a way for the two to disagree. */
        navigator.serviceWorker.register('sw.js').catch(function () {
            /* Offline support did not turn on. The app is unaffected. */
        });
    });
}());
