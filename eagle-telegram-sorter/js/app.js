// Telegram Sorter: walk through an exported channel post by post and send
// each one where the user chooses. Nothing is sent automatically.
const fs = require('fs');
const path = require('path');
const os = require('os');
const { pathToFileURL } = require('url');
const core = globalThis.TelegramSorterCore;
const net = globalThis.TelegramSorterNet;

const SETTINGS_FILE = path.join(os.homedir(), '.eagle-telegram-sorter.json');
// Progress lives next to the export, so it travels with it.
const STATE_FILE = 'telegram-sorter-state.json';

const $ = selector => document.querySelector(selector);
let settings = readJson(SETTINGS_FILE) || {};
let exportDir = '';
let chats = [];
let chat = null;
let posts = [];
let state = { version: 1, posts: {}, folders: {} };
let view = 'todo';
let currentKey = '';
let busy = false;

// --- files -----------------------------------------------------------------
function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, value) {
  // Write then rename, so a crash never leaves half a file behind.
  const temporary = `${file}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  fs.renameSync(temporary, file);
}
const saveSettings = () => writeJson(SETTINGS_FILE, settings);
const saveState = () => writeJson(path.join(exportDir, STATE_FILE), state);

// --- loading ---------------------------------------------------------------
async function chooseExport() {
  let folder = '';
  if (globalThis.eagle?.dialog?.showOpenDialog) {
    const result = await eagle.dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Select the Telegram export folder' });
    if (result?.canceled) return;
    folder = result?.filePaths?.[0] || '';
  } else {
    folder = prompt('Path to the Telegram export folder (with result.json):', settings.lastExport || '') || '';
  }
  if (folder) loadExport(folder);
}

function loadExport(folder) {
  const json = readJson(path.join(folder, 'result.json'));
  const found = json ? core.readChats(json) : [];
  if (!found.length) {
    toast('No result.json with messages in that folder. Export with format JSON.', true);
    return;
  }
  exportDir = folder;
  chats = found;
  state = readJson(path.join(folder, STATE_FILE)) || { version: 1, posts: {}, folders: {} };
  state.folders ||= {};
  settings.lastExport = folder;
  saveSettings();
  const select = $('#chat-select');
  select.hidden = chats.length < 2;
  select.innerHTML = chats.map((item, index) => `<option value="${index}">${escapeHtml(item.name || 'Chat')}</option>`).join('');
  selectChat(0);
}

function selectChat(index) {
  chat = chats[index];
  posts = core.buildPosts(chat);
  $('#chat-name').textContent = chats.length < 2 ? chat.name || '' : '';
  view = 'todo';
  currentKey = (visiblePosts()[0] || posts[0])?.key || '';
  render();
}

// --- state helpers ---------------------------------------------------------
const stateKey = post => `${chat.id}:${post.key}`;
const entryOf = post => state.posts[stateKey(post)] || {};
const isSorted = post => { const entry = entryOf(post); return Boolean(entry.eagle || entry.karakeep || entry.trash); };
function update(post, changes) {
  state.posts[stateKey(post)] = { ...entryOf(post), ...changes, at: new Date().toISOString() };
  saveState();
}

function visiblePosts() {
  if (view === 'trash') return posts.filter(post => entryOf(post).trash);
  if (view === 'todo') return posts.filter(post => !isSorted(post));
  return posts.filter(post => !entryOf(post).trash);
}
const currentPost = () => posts.find(post => post.key === currentKey) || null;
const editedPost = post => core.edited(chat, post, entryOf(post).edits);
function setEdits(post, changes, { save = true } = {}) {
  const edits = { ...(entryOf(post).edits || {}), ...changes };
  state.posts[stateKey(post)] = { ...entryOf(post), edits };
  if (save) saveSoon();
}
// Typing saves at most a few times a second.
let saveTimer;
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveState, 400); }

// Moves within the current view. The post on screen stays until the user
// moves on, so one post can go to Eagle and to Karakeep.
function move(step) {
  // Back walks every post that is not in Trash, so a post sorted a moment ago
  // can be revisited (to send it to the other app as well, for example).
  const list = step < 0 && view === 'todo' ? posts.filter(post => !entryOf(post).trash) : visiblePosts();
  const order = posts.findIndex(post => post.key === currentKey);
  const candidates = step > 0
    ? list.filter(post => posts.indexOf(post) > order)
    : list.filter(post => posts.indexOf(post) < order).reverse();
  if (candidates[0]) currentKey = candidates[0].key;
  else if (step > 0 && view === 'todo') toast(list.length ? 'That was the last unsorted post. Use ← to go back.' : 'Everything in this channel is sorted.');
  render();
}

// --- actions ---------------------------------------------------------------
async function eagleFolderId() {
  if (state.folders[chat.id]) return state.folders[chat.id];
  const name = `Telegram · ${chat.name || chat.id}`;
  const folders = await net.eagle.folders();
  const existing = (folders || []).find(folder => folder.name === name);
  const id = existing?.id || (await net.eagle.createFolder(name))?.id;
  state.folders[chat.id] = id;
  saveState();
  return id;
}

async function sendToEagle(post) {
  const items = core.eagleItems(chat, editedPost(post), relative => path.join(exportDir, relative));
  if (!items.length) { toast(post.missing ? 'This post\'s files were not included in the export.' : 'No photos, videos or files in this post.', true); return; }
  if (entryOf(post).eagle) { toast('Already in Eagle.'); return; }
  const folderId = await eagleFolderId();
  let added = 0;
  const problems = [];
  for (const item of items) {
    if (!fs.existsSync(item.path)) { problems.push(`missing ${path.basename(item.path)}`); continue; }
    try { await net.eagle.addFromPath({ ...item, folderId }); added++; }
    catch (error) { problems.push(error.message); }
  }
  if (added) update(post, { eagle: added });
  toast(added ? `Added to Eagle: ${added} file${added > 1 ? 's' : ''}${problems.length ? ` (${problems.length} failed)` : ''}.` : `Eagle: ${problems[0]}`, !added);
}

async function sendToKarakeep(post) {
  const bookmarks = core.karakeepBookmarks(chat, editedPost(post));
  if (!bookmarks.length) { toast('Nothing for Karakeep: no links and no text.', true); return; }
  if (entryOf(post).karakeep) { toast('Already in Karakeep.'); return; }
  const client = net.karakeep(settings);
  let added = 0;
  let duplicates = 0;
  for (const bookmark of bookmarks) {
    const result = await client.addBookmark(bookmark.body, bookmark.tags);
    added++;
    if (result.alreadyExists) duplicates++;
  }
  update(post, { karakeep: added });
  toast(`Saved to Karakeep: ${added} bookmark${added > 1 ? 's' : ''}${duplicates ? ` (${duplicates} already there)` : ''}.`);
}

function toggleTrash(post) {
  const trash = !entryOf(post).trash;
  update(post, { trash });
  toast(trash ? 'Moved to Trash. Restore it from the Trash tab.' : 'Restored.');
  if (trash && view !== 'trash') move(1);
  else render();
}

async function run(action) {
  const post = currentPost();
  if (!post || busy) return;
  busy = true;
  setActionsDisabled(true);
  try { await action(post); }
  catch (error) { toast(error.message || String(error), true); }
  finally { busy = false; setActionsDisabled(false); render(); }
}

// --- rendering -------------------------------------------------------------
function render() {
  const loaded = Boolean(chat);
  $('#empty').hidden = loaded;
  const counts = { todo: posts.filter(post => !isSorted(post)).length, all: posts.filter(post => !entryOf(post).trash).length, trash: posts.filter(post => entryOf(post).trash).length };
  for (const [name, value] of Object.entries(counts)) $(`#count-${name}`).textContent = loaded ? value : '';
  document.querySelectorAll('.tab').forEach(tab => tab.classList.toggle('active', tab.dataset.view === view));
  $('#progress span').style.width = posts.length ? `${100 * (posts.length - counts.todo) / posts.length}%` : '0';
  const inTrash = view === 'trash';
  $('#trash-list').hidden = !loaded || !inTrash;
  if (inTrash) renderTrash();
  const list = visiblePosts();
  if (!list.some(post => post.key === currentKey) && view !== 'todo') currentKey = list[0]?.key || '';
  const post = currentPost();
  $('#card').hidden = !loaded || inTrash || !post;
  $('#actions').hidden = !loaded || inTrash || !post;
  if (post && !inTrash) renderPost(post, list);
}

function renderPost(post, list) {
  const position = list.indexOf(post);
  $('#post-date').textContent = new Date(post.unix * 1000).toLocaleString();
  $('#post-position').textContent = position >= 0 ? `${position + 1} of ${list.length}` : 'sorted';
  $('#post-forwarded').textContent = post.forwardedFrom ? `Forwarded from ${post.forwardedFrom}` : '';
  $('#post-media').innerHTML = post.media.map(item => {
    const file = path.join(exportDir, item.path);
    const url = pathToFileURL(file).href;
    if (item.kind === 'image') return `<img src="${url}" alt="" loading="lazy">`;
    if (item.kind === 'video') return `<video src="${url}" controls preload="metadata" muted></video>`;
    return `<div class="file" data-file="${escapeHtml(file)}">📄 ${escapeHtml(item.name || path.basename(item.path))}</div>`;
  }).join('') + (post.missing ? `<div class="missing">${post.missing} file${post.missing > 1 ? 's' : ''} not included in the export</div>` : '');
  const shown = editedPost(post);
  const entry = entryOf(post);
  // Do not overwrite a field the user is typing in.
  if (document.activeElement !== $('#edit-title')) $('#edit-title').value = shown.title;
  if (document.activeElement !== $('#edit-text')) $('#edit-text').value = shown.text;
  fitText();
  renderTags(shown);
  renderLinks(post, shown);
  $('#edit-reset').hidden = !entry.edits || !Object.keys(entry.edits).length;
  $('#post-status').innerHTML = [
    entry.eagle && `<span>✓ Eagle · ${entry.eagle}</span>`,
    entry.karakeep && `<span>✓ Karakeep · ${entry.karakeep}</span>`,
    entry.trash && '<span class="trashed">In Trash</span>'
  ].filter(Boolean).join('');
  $('#act-eagle').disabled = !post.media.length || Boolean(entry.eagle);
  $('#act-karakeep').disabled = (!shown.links.length && !shown.text) || Boolean(entry.karakeep);
  $('#act-trash').innerHTML = entry.trash ? 'Restore <kbd>Del</kbd>' : 'Trash <kbd>Del</kbd>';
  for (const id of ['#act-trash', '#act-next', '#act-prev']) $(id).disabled = false;
}

function renderTags(shown) {
  $('#edit-tags').innerHTML = shown.tags.map(tag =>
    `<span class="tag">${escapeHtml(tag)}<button data-remove-tag="${escapeHtml(tag)}" title="Remove tag" aria-label="Remove tag ${escapeHtml(tag)}">×</button></span>`).join('');
}
function renderLinks(post, shown) {
  const kept = new Set(shown.links);
  $('#post-links').innerHTML = post.links.map(link => {
    const removed = !kept.has(link);
    return `<span class="link${removed ? ' removed' : ''}"><a href="${escapeHtml(link)}" data-external>${escapeHtml(link)}</a>`
      + `<button data-toggle-link="${escapeHtml(link)}" title="${removed ? 'Keep this link' : 'Do not send this link'}">${removed ? '↺' : '×'}</button></span>`;
  }).join('');
}
function fitText() {
  const area = $('#edit-text');
  area.style.height = 'auto';
  area.style.height = `${area.scrollHeight + 2}px`;
}

function renderTrash() {
  const trashed = posts.filter(post => entryOf(post).trash);
  $('#trash-list').innerHTML = trashed.length ? `
    <div class="tools"><span class="hint">Trash only hides posts here. To delete them from Telegram, copy the links and remove the posts there.</span>
      <button class="secondary" id="copy-links">Copy Telegram links</button></div>
    ${trashed.map(post => `<div class="item"><small>${core.formatDate(post)}</small>
      <p>${escapeHtml(core.firstLine(post.text) || `${post.media.length} media`)}</p>
      <a href="${escapeHtml(core.postLink(chat, post))}" data-external>Open</a>
      <button class="secondary" data-restore="${escapeHtml(post.key)}">Restore</button></div>`).join('')}`
    : '<p class="hint">Trash is empty.</p>';
}

function setActionsDisabled(disabled) {
  document.querySelectorAll('#actions button').forEach(button => { if (disabled) button.disabled = true; });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

let toastTimer;
function toast(message, error = false) {
  const node = $('#toast');
  node.textContent = message;
  node.classList.toggle('error', error);
  node.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => node.classList.remove('show'), error ? 5000 : 2500);
}

function openExternal(url) {
  if (globalThis.eagle?.shell?.openExternal) eagle.shell.openExternal(url);
  else window.open(url, '_blank');
}

// --- theme -----------------------------------------------------------------
// "Match Eagle" follows Eagle's own theme (LIGHT, LIGHTGRAY, GRAY, DARK…);
// outside Eagle it follows the system.
function applyTheme(eagleTheme) {
  const choice = settings.theme || 'auto';
  const fromEagle = eagleTheme || globalThis.eagle?.app?.theme;
  const theme = choice !== 'auto' ? choice
    : fromEagle ? (/^(light|lightgray)$/i.test(String(fromEagle)) ? 'light' : 'dark')
    : '';
  if (theme) document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

// --- settings --------------------------------------------------------------
function openSettings() {
  $('#kk-url').value = settings.url || '';
  $('#kk-key').value = settings.apiKey || '';
  $('#kk-insecure').checked = Boolean(settings.insecure);
  $('#theme-select').value = settings.theme || 'auto';
  $('#settings-status').textContent = '';
  $('#settings').showModal();
}
function readSettingsForm() {
  settings.url = $('#kk-url').value.trim();
  settings.apiKey = $('#kk-key').value.trim();
  settings.insecure = $('#kk-insecure').checked;
  settings.theme = $('#theme-select').value;
  saveSettings();
  applyTheme();
}

// --- wiring ----------------------------------------------------------------
$('#open-export').addEventListener('click', chooseExport);
$('#chat-select').addEventListener('change', event => selectChat(Number(event.target.value)));
document.querySelectorAll('.tab').forEach(tab => tab.addEventListener('click', () => {
  view = tab.dataset.view;
  if (!visiblePosts().some(post => post.key === currentKey)) currentKey = visiblePosts()[0]?.key || currentKey;
  render();
}));
$('#act-eagle').addEventListener('click', () => run(sendToEagle));
$('#act-karakeep').addEventListener('click', () => run(sendToKarakeep));
$('#act-trash').addEventListener('click', () => run(async post => toggleTrash(post)));
$('#act-next').addEventListener('click', () => move(1));
$('#act-prev').addEventListener('click', () => move(-1));
$('#open-settings').addEventListener('click', openSettings);
$('#theme-select').addEventListener('change', () => { settings.theme = $('#theme-select').value; saveSettings(); applyTheme(); });

// Editing: title and text save as you type; tags and links on click.
$('#edit-title').addEventListener('input', event => { const post = currentPost(); if (post) { setEdits(post, { title: event.target.value }); $('#edit-reset').hidden = false; } });
$('#edit-text').addEventListener('input', event => { const post = currentPost(); if (post) { setEdits(post, { text: event.target.value }); fitText(); $('#edit-reset').hidden = false; } });
$('#add-tag').addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ',') return;
  event.preventDefault();
  const post = currentPost();
  const tag = event.target.value.replace(/^#/, '').trim();
  if (!post || !tag) return;
  setEdits(post, { tags: [...editedPost(post).tags, tag] });
  event.target.value = '';
  render();
});
$('#edit-reset').addEventListener('click', () => {
  const post = currentPost();
  if (!post) return;
  const { edits, ...rest } = entryOf(post);
  state.posts[stateKey(post)] = rest;
  saveState();
  $('#edit-title').blur(); $('#edit-text').blur();
  render();
  toast('Edits reset to the exported post.');
});
$('#settings').addEventListener('close', readSettingsForm);
$('#test-karakeep').addEventListener('click', async () => {
  readSettingsForm();
  $('#settings-status').textContent = 'Checking Karakeep…';
  try { $('#settings-status').textContent = `✓ Karakeep: ${await net.karakeep(settings).test()}`; }
  catch (error) { $('#settings-status').textContent = `✗ Karakeep: ${error.message}`; }
});
$('#test-eagle').addEventListener('click', async () => {
  $('#settings-status').textContent = 'Checking Eagle…';
  try { await net.eagle.folders(); $('#settings-status').textContent = '✓ Eagle is reachable.'; }
  catch (error) { $('#settings-status').textContent = `✗ Eagle: ${error.message}`; }
});

document.addEventListener('click', event => {
  const link = event.target.closest('a[data-external]');
  if (link) { event.preventDefault(); openExternal(link.getAttribute('href')); return; }
  const file = event.target.closest('[data-file]');
  if (file) { openExternal(pathToFileURL(file.dataset.file).href); return; }
  const removeTag = event.target.closest('[data-remove-tag]');
  if (removeTag) { const post = currentPost(); if (post) { setEdits(post, { tags: editedPost(post).tags.filter(tag => tag !== removeTag.dataset.removeTag) }); render(); } return; }
  const toggleLink = event.target.closest('[data-toggle-link]');
  if (toggleLink) {
    const post = currentPost();
    if (post) {
      const removed = new Set(entryOf(post).edits?.removedLinks || []);
      const link = toggleLink.dataset.toggleLink;
      removed.has(link) ? removed.delete(link) : removed.add(link);
      setEdits(post, { removedLinks: [...removed] });
      render();
    }
    return;
  }
  const restore = event.target.closest('[data-restore]');
  if (restore) { const post = posts.find(item => item.key === restore.dataset.restore); if (post) { update(post, { trash: false }); render(); } return; }
  if (event.target.id === 'copy-links') {
    const links = posts.filter(post => entryOf(post).trash).map(post => core.postLink(chat, post)).filter(Boolean).join('\n');
    const write = globalThis.eagle?.clipboard?.writeText ? eagle.clipboard.writeText(links) : navigator.clipboard.writeText(links);
    Promise.resolve(write).then(() => toast('Telegram links copied.'), () => toast('Could not copy the links.', true));
  }
});

// Physical keys (event.code), so E and K also work in the Ukrainian layout.
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && event.target.closest('#card input, #card textarea')) { event.target.blur(); return; }
  if (!chat || view === 'trash' || $('#settings').open || event.target.closest('input, textarea, select')) return;
  if (event.metaKey || event.ctrlKey || event.altKey) return;
  const actions = {
    KeyE: () => run(sendToEagle),
    KeyK: () => run(sendToKarakeep),
    Delete: () => run(async post => toggleTrash(post)),
    Backspace: () => run(async post => toggleTrash(post)),
    Space: () => move(1),
    ArrowRight: () => move(1),
    ArrowLeft: () => move(-1)
  };
  if (actions[event.code]) { event.preventDefault(); actions[event.code](); }
});

const start = () => {
  applyTheme();
  globalThis.eagle?.onThemeChanged?.(theme => applyTheme(theme));
  render();
  if (settings.lastExport && fs.existsSync(path.join(settings.lastExport, 'result.json'))) loadExport(settings.lastExport);
};
if (globalThis.eagle?.onPluginCreate) eagle.onPluginCreate(start);
else start();
