/******** Reddit AI Quality Filter — posts + comments (revised) ********/
const DEFAULTS = {
  enabled: true,
  threshold: 60,
  dimInsteadOfHide: false,
  requireSubFlair: false,
  minTitleChars: 25,
  myUsername: "",
  debug: false // set true to outline found posts + log counts
};

let settings = { ...DEFAULTS };
let currentUser = null;

/* ---------- utils ---------- */
const qs  = (root, sel) => root ? root.querySelector(sel) : null;
const qsa = (root, sel) => root ? Array.from(root.querySelectorAll(sel)) : [];

function words(s){ return (s||"").toLowerCase().match(/[a-z0-9’']+/g)||[]; }
function sentences(s){ return (s||"").match(/[^.!?]+[.!?]*/g) || ((s||"").length ? [s] : []); }
function syllables(w){
  const m=(w||"").toLowerCase().replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/,'').match(/[aeiouy]{1,2}/g);
  return m?m.length:1;
}
function fleschEase(text){
  const w=words(text), s=sentences(text);
  if (!w.length||!s.length) return 50;
  const syl=w.reduce((a,x)=>a+syllables(x),0);
  return 206.835 - 1.015*(w.length/s.length) - 84.6*(syl/w.length);
}
function extractNumeric(root, sel){
  const t = qs(root, sel)?.textContent || "";
  const n = parseInt(t.replace(/[^0-9]/g,""), 10);
  return Number.isFinite(n) ? n : 0;
}
function linkCount(root){ return qsa(root, 'a[href^="http"]').length; }

/* ---------- route helpers ---------- */
function isPermalinkView(){
  // Never hide the opened post on /comments/ pages
  return /\/comments\//i.test(location.pathname);
}

/* ---------- detect current user (store to local for popup) ---------- */
function detectCurrentUser(){
  const cands = [
    document.querySelector('header a[href^="/user/"]'),
    document.querySelector('a[data-click-id="user"]'),
    document.querySelector('button[aria-label*="profile"]'),
    document.querySelector('span.user a[href*="/user/"]'),
    document.querySelector('#header-bottom-right .user a')
  ].filter(Boolean);

  for (const el of cands){
    const href = el.getAttribute("href") || "";
    const text = el.textContent || "";
    const mHref = href.match(/\/user\/([^/?#]+)/i);
    if (mHref?.[1]) return mHref[1];
    const mTxt = text.match(/u\/([A-Za-z0-9_-]+)/) || text.match(/\b([A-Za-z0-9_-]{2,})\b/);
    if (mTxt?.[1]) return mTxt[1].replace(/^u\//i,'');
  }
  return null;
}

let lastDetect=0;
function ensureCurrentUser(){
  const now = Date.now();
  if (now - lastDetect < 2000) return;
  lastDetect = now;
  const u = detectCurrentUser();
  if (u && u !== currentUser){
    currentUser = u;
    try { chrome.runtime.sendMessage({ type:"aiq-current-user", user: currentUser }); } catch {}
    chrome.storage?.local?.set({ aiqCurrentUser: currentUser });
    if (settings.debug) console.log("[AIQ] detected user:", currentUser);
  }
}

/* ---------- post discovery (classic + Shadow DOM) ---------- */
function findClassicPostNodes(root=document){
  const a = qsa(root, 'div[data-testid="post-container"]');
  const b = qsa(root, 'article[data-testid="post-container"]');
  const c = qsa(root, 'div.thing.link'); // old reddit
  return [...new Set([...a, ...b, ...c])];
}
function findShredditPostNodes(root=document){
  return qsa(root, 'shreddit-post');
}

/* ---------- comment discovery (classic + Shadow DOM) ---------- */
function findClassicCommentNodes(root=document){
  const newReddit = qsa(root, 'div[data-test-id="comment"], div[data-testid="comment"]');
  const oldReddit = qsa(root, 'div.comment');
  return [...new Set([...newReddit, ...oldReddit])];
}
function findShredditCommentNodes(root=document){
  return qsa(root, 'shreddit-comment');
}

/* ---------- extract fields: POSTS ---------- */
function getFieldsFromClassic(node){
  const titleEl =
    qs(node,'h3[data-testid="post-title"]') ||
    qs(node,'[data-click-id="body"] h3') ||
    qs(node,'a.title') ||
    qs(node,'h1,h2,h3');

  const bodyEl =
    qs(node,'[data-click-id="text"]') ||
    qs(node,'div[data-test="post-content"]') ||
    qs(node,'p');

  const title = titleEl?.textContent?.trim() || "";
  const body  = bodyEl?.textContent?.trim()  || "";
  const flair = qs(node,'[data-testid="post-tag"], [data-testid="post-flair"]')?.textContent?.trim() || "";
  const author =
    qs(node,'a[href^="/user/"]')?.textContent?.trim() ||
    qs(node,'a.author')?.textContent?.trim() ||
    qs(node,'[data-testid="post-author-name"]')?.textContent?.trim() || "";

  // Hardened selectors (old + new)
  const comments = extractNumeric(node, 'a.comments, a[data-event-action="comments"], [data-click-id="comments"], a[data-click-id="comments"]');
  const upvotes  = extractNumeric(node, 'div.score.unvoted, div.unvoted, [aria-label*="upvote"] + div, [id*="vote"] + div');

  return { title, body, flair, author, comments, upvotes, titleEl, domForLinks: node };
}
function getFieldsFromShreddit(node){
  const sr = node.shadowRoot;
  if (!sr) return null;

  const titleEl =
    qs(sr,'h3, h2, h1, a[slot="title"]') ||
    qs(sr,'[data-testid="post-title"]');

  const bodyEl =
    qs(sr,'[data-test="post-content"], [slot="text"]') ||
    qs(sr,'p');

  const authorEl =
    qs(sr,'a[href^="/user/"]') ||
    qs(sr,'a[slot="author"]');

  const title = titleEl?.textContent?.trim() || node.getAttribute('data-title') || "";
  const body  = bodyEl?.textContent?.trim() || "";
  const author = authorEl?.textContent?.trim() || node.getAttribute('author') || "";
  const flair = (qs(sr,'[data-testid="post-tag"], [data-testid="post-flair"]')?.textContent?.trim())
                || node.getAttribute('linkflairtext') || "";

  // Shadow DOM: comments/upvotes not readily accessible
  const comments = 0;
  const upvotes  = 0;

  return { title, body, flair, author, comments, upvotes, titleEl, domForLinks: sr };
}

/* ---------- extract fields: COMMENTS ---------- */
function getFieldsFromClassicComment(node){
  const bodyEl =
    qs(node, '[data-testid="comment"] [data-click-id="text"]') ||
    qs(node, '.md') ||
    qs(node, '[data-test-id="comment"]') ||
    qs(node, '.Comment');

  const authorEl =
    qs(node, 'a[href^="/user/"]') ||
    qs(node, 'a.author') ||
    qs(node, '[data-testid="comment-author-link"]');

  const body = bodyEl?.textContent?.trim() || "";
  const author = authorEl?.textContent?.trim() || "";

  const upvotes =
    extractNumeric(node, '.score, .unvoted, [id*="vote"] + div, [aria-label*="upvote"] + div') ||
    extractNumeric(node, '[data-testid="upvote-button"] + div');

  const links = linkCount(node);

  return { title: "", body, flair: "", author, comments: 0, upvotes, titleEl: authorEl, domForLinks: node, links };
}
function getFieldsFromShredditComment(node){
  const sr = node.shadowRoot;
  if (!sr) return null;

  const bodyEl = qs(sr, '[slot="body"]') || qs(sr, 'p, div');
  const authorEl = qs(sr, 'a[href^="/user/"]') || qs(sr, '[slot="author"]');

  const body = bodyEl?.textContent?.trim() || node.getAttribute('body') || "";
  const author = authorEl?.textContent?.trim() || node.getAttribute('author') || "";
  const upvotes = 0;
  const links = linkCount(sr);

  return { title: "", body, flair: "", author, comments: 0, upvotes, titleEl: authorEl, domForLinks: sr, links };
}

/* ---------- scoring (shared) ---------- */
function scorePost({ title, body, flair, comments, upvotes, links }){
  let s = 0;
  if ((title||"").length >= settings.minTitleChars) s += 10;
  if (/\b(\d+|v\d+|params?|paper|arxiv|benchmark|SOTA|ROC|AUC|cross-?val|ablation|weights|checkpoint|LoRA|RAG|inference|latency|throughput|CUDA|TPU|Quant(ization)?|int8|fp16|fp8)\b/i.test(title + " " + body)) s += 15;
  if (links) s += Math.min(20, 5*links);
  const fre = fleschEase(title + ". " + body);
  s += Math.max(0, Math.min(20, (100 - Math.abs(fre - 55)*2)/5));
  if (/\b(why|because|therefore|however|whereas|evidence|limitations|trade[- ]offs?)\b/i.test(body)) s += 10;
  if (/\b(you won’t believe|shocking|insane|game[- ]changer|must[- ]see)\b/i.test(title)) s -= 10;
  if (flair) s += 5;
  if (comments > 10) s += 5;
  if (upvotes > 50) s += 5;
  return Math.max(0, Math.min(100, Math.round(s)));
}

/* ---------- badge / actions ---------- */
function ensureBadge(hostNode, nearEl){
  let badge = hostNode.querySelector(':scope .aiq-badge');
  if (!badge){
    badge = document.createElement('span');
    badge.className = 'aiq-badge';
    // If the title is an <a>, place badge AFTER it to avoid link styling overrides
    if (nearEl && nearEl.tagName === 'A' && nearEl.insertAdjacentElement) {
      nearEl.insertAdjacentElement('afterend', badge);
    } else if (nearEl) {
      nearEl.appendChild(badge);
    } else {
      hostNode.appendChild(badge);
    }
  }
  return badge;
}








/* ---------- processors: POSTS ---------- */
function processClassic(node){
  const f = getFieldsFromClassic(node); if (!f) return;
  const links = linkCount(f.domForLinks);
  const score = scorePost({ ...f, links });

  const authorNorm = (f.author||"").replace(/^u\//i,"").toLowerCase();
  const manualNorm = (settings.myUsername||"").replace(/^u\//i,"").toLowerCase();
  const autoNorm   = (currentUser||"").toLowerCase();
  const isMine = authorNorm && (authorNorm===autoNorm || (manualNorm && authorNorm===manualNorm));

  const badge = ensureBadge(node, f.titleEl);
  badge.textContent = isMine ? `AIQ ${score} (yours)` : `AIQ ${score}`;
  if (isMine) return;

  const low = score < settings.threshold || (settings.requireSubFlair && !f.flair);
  if (!isPermalinkView()){
    node.classList.toggle("aiq-hidden", settings.enabled && !settings.dimInsteadOfHide && low);
    node.classList.toggle("aiq-dim",   settings.enabled &&  settings.dimInsteadOfHide && low);
  }
  if (settings.debug) node.style.outline = "1px solid rgba(0,128,255,.4)";
}
function processShreddit(node){
  const f = getFieldsFromShreddit(node); if (!f) return;
  const links = linkCount(f.domForLinks);
  const score = scorePost({ ...f, links });

  const authorNorm = (f.author||"").replace(/^u\//i,"").toLowerCase();
  const manualNorm = (settings.myUsername||"").replace(/^u\//i,"").toLowerCase();
  const autoNorm   = (currentUser||"").toLowerCase();
  const isMine = authorNorm && (authorNorm===autoNorm || (manualNorm && authorNorm===manualNorm));

  const badge = ensureBadge(node, f.titleEl);
  badge.textContent = isMine ? `AIQ ${score} (yours)` : `AIQ ${score}`;
  if (isMine) return;

  const low = score < settings.threshold || (settings.requireSubFlair && !f.flair);
  if (!isPermalinkView()){
    node.classList.toggle("aiq-hidden", settings.enabled && !settings.dimInsteadOfHide && low);
    node.classList.toggle("aiq-dim",   settings.enabled &&  settings.dimInsteadOfHide && low);
  }
  if (settings.debug) node.style.outline = "1px dashed rgba(0,200,100,.5)";
}

/* ---------- processors: COMMENTS ---------- */
function processClassicComment(node){
  const f = getFieldsFromClassicComment(node); if (!f) return;
  const score = scorePost({ ...f, links: f.links });

  const authorNorm = (f.author||"").replace(/^u\//i,"").toLowerCase();
  const manualNorm = (settings.myUsername||"").replace(/^u\//i,"").toLowerCase();
  const autoNorm   = (currentUser||"").toLowerCase();
  const isMine = authorNorm && (authorNorm===autoNorm || (manualNorm && authorNorm===manualNorm));

  const badge = ensureBadge(node, f.titleEl || node);
  badge.textContent = isMine ? `AIQ ${score} (yours)` : `AIQ ${score}`;
  if (isMine) return;

  const low = score < settings.threshold;
  node.classList.toggle("aiq-hidden", settings.enabled && !settings.dimInsteadOfHide && low);
  node.classList.toggle("aiq-dim",   settings.enabled &&  settings.dimInsteadOfHide && low);

  if (settings.debug) node.style.outline = "1px dotted rgba(128,0,255,.35)";
}
function processShredditComment(node){
  const f = getFieldsFromShredditComment(node); if (!f) return;
  const score = scorePost({ ...f, links: f.links });

  const authorNorm = (f.author||"").replace(/^u\//i,"").toLowerCase();
  const manualNorm = (settings.myUsername||"").replace(/^u\//i,"").toLowerCase();
  const autoNorm   = (currentUser||"").toLowerCase();
  const isMine = authorNorm && (authorNorm===autoNorm || (manualNorm && authorNorm===manualNorm));

  const badge = ensureBadge(node, f.titleEl || node);
  badge.textContent = isMine ? `AIQ ${score} (yours)` : `AIQ ${score}`;
  if (isMine) return;

  const low = score < settings.threshold;
  node.classList.toggle("aiq-hidden", settings.enabled && !settings.dimInsteadOfHide && low);
  node.classList.toggle("aiq-dim",   settings.enabled &&  settings.dimInsteadOfHide && low);

  if (settings.debug) node.style.outline = "1px dashed rgba(200,100,0,.35)";
}

/* ---------- main scan (light throttle) ---------- */
let scanQueued = false;
function scan(){
  ensureCurrentUser();

  // POSTS
  const classics = findClassicPostNodes(document);
  const shreddits = findShredditPostNodes(document);
  classics.forEach(n => { if (!n.dataset.aiqProcessed){ n.dataset.aiqProcessed="1"; processClassic(n); } });
  shreddits.forEach(n => { if (!n.dataset.aiqProcessed){ n.dataset.aiqProcessed="1"; processShreddit(n); } });

  // COMMENTS
  const classicComments = findClassicCommentNodes(document);
  const shredditComments = findShredditCommentNodes(document);
  classicComments.forEach(n => { if (!n.dataset.aiqProcessedComment){ n.dataset.aiqProcessedComment="1"; processClassicComment(n); } });
  shredditComments.forEach(n => { if (!n.dataset.aiqProcessedComment){ n.dataset.aiqProcessedComment="1"; processShredditComment(n); } });

  if (settings.debug) {
    console.log(`[AIQ] scanned: posts classic=${classics.length}, shreddit=${shreddits.length}; comments classic=${classicComments.length}, shreddit=${shredditComments.length}; user=${currentUser||"?"}`);
  }
}
function scheduleScan(){
  if (scanQueued) return;
  scanQueued = true;
  setTimeout(() => { scanQueued = false; scan(); }, 300);
}

/* ---------- observers & init ---------- */
new MutationObserver(() => scheduleScan()).observe(
  document.documentElement,
  { childList: true, subtree: true }
);

chrome.storage.sync.get(DEFAULTS, (v) => {
  settings = { ...DEFAULTS, ...v };
  scan();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  for (const k of Object.keys(changes)) {
    if (changes[k].newValue !== undefined) settings[k] = changes[k].newValue;
  }
  scheduleScan();
});
