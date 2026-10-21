// ==UserScript==
// @name         LeadFinder: homes.com agent capture
// @namespace    leadfinder
// @version      1.0
// @description  Sends the agent profile page you're viewing to LeadFinder, so it can pick up their volume, price range and license. Nothing is scraped automatically — this only fires on a page you actually open.
// @match        https://www.homes.com/real-estate-agents/*/*
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// @grant        GM_notification
// ==/UserScript==

(function () {
  "use strict";

  // Set once via Tampermonkey's menu (the icon in the toolbar → this script
  // → "Set LeadFinder capture key"). Ask Lukas for HOMES_CAPTURE_SECRET,
  // or generate one and set it as an env var on the app.
  const ENDPOINT = "https://gallery.lukashahn.art/api/agent-profile-capture";

  GM_registerMenuCommand("Set LeadFinder capture key", () => {
    const key = prompt("Paste the HOMES_CAPTURE_SECRET value:");
    if (key) GM_setValue("key", key.trim());
  });

  function send() {
    const key = GM_getValue("key");
    if (!key) return; // not set up yet; use the menu command above
    // A beat for the page's client-side bits to settle, though the data
    // we want is already server-rendered into the initial HTML.
    GM_xmlhttpRequest({
      method: "POST",
      url: ENDPOINT,
      headers: { "Content-Type": "application/json", "x-capture-secret": key },
      data: JSON.stringify({ html: document.documentElement.outerHTML, url: location.href }),
      onload: (res) => {
        try {
          const body = JSON.parse(res.responseText);
          if (body.matched) GM_notification({ title: "LeadFinder", text: `Saved: ${body.agentName}`, timeout: 3000 });
        } catch {
          /* ignore */
        }
      },
    });
  }

  setTimeout(send, 1500);
})();
