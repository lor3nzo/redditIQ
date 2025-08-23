/******** Reddit AI Quality Filter — Shadow-DOM robust ********/
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

/* ---------- extract fields ---------- */
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
  const comments = extractNumeric(node, '[data-click-id="comments"], a[data-click-id="comments"]');
  const upvotes  = extractNumeric(node, '[aria-label*="upvote"] + div, [id*="vote"] + div');

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

  // comments/upvotes not easily accessible in shadow; treat as 0
  const comments = 0;
  const upvotes  = 0;

  return { title, body, flair, author, comments, upvotes, titleEl, domForLinks: sr };
}

/* ---------- scoring ---------- */
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
function ensureBadge(hostNode, titleEl){
  let badge = hostNode.querySelector(':scope .aiq-badge');
  if (!badge){
    badge = document.createElement('span');
    badge.className = 'aiq-badge';
    (titleEl || hostNode).appendChild(badge);
  }
  return badge;
}

function processClassic(node){
  const f = getFieldsFromClassic(node);
  if (!f) return;
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
  node.classList.toggle("aiq-hidden", settings.enabled && !settings.dimInsteadOfHide && low);
  if (settings.debug) node.style.outline = "1px solid rgba(0,128,255,.4)";
}

function processShreddit(node){
  const f = getFieldsFromShreddit(node);
  if (!f) return;
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
  node.classList.toggle("aiq-hidden", settings.enabled && !settings.dimInsteadOfHide && low);
  if (settings.debug) node.style.outline = "1px dashed rgba(0,200,100,.5)";
}

/* ---------- main scan ---------- */
function scan(){
  ensureCurrentUser();

  const classics = findClassicPostNodes(document);
  const shreddits = findShredditPostNodes(document);

  classics.forEach(n => { if (!n.dataset.aiqProcessed){ n.dataset.aiqProcessed="1"; processClassic(n); } });
  shreddits.forEach(n => { if (!n.dataset.aiqProcessed){ n.dataset.aiqProcessed="1"; processShreddit(n); } });

  if (settings.debug) {
    console.log(`[AIQ] scanned: classic=${classics.length}, shreddit=${shreddits.length}, user=${currentUser||"?"}`);
  }
}

/* ---------- observers & init ---------- */
new MutationObserver(() => scan()).observe(document.documentElement, { childList: true, subtree: true });

chrome.storage.sync.get(DEFAULTS, (v) => {
  settings = { ...DEFAULTS, ...v };
  scan();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  for (const k of Object.keys(changes)) {
    if (changes[k].newValue !== undefined) settings[k] = changes[k].newValue;
  }
  scan();
});
