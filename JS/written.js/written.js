// ==========================================
// PrepBox BD V2 — BCS & Bank Written Notes Module
// ==========================================

const WRITTEN_FOLDERS = {
  bcs: [
    'বাংলা (রচনা, অনুবাদ ও সাহিত্য)',
    'English (Essay, Translation & Summary)',
    'বাংলাদেশ বিষয়াবলি (সংবিধান, অর্থনীতি ও ইতিহাস)',
    'আন্তর্জাতিক বিষয়াবলি (ভূরাজনীতি ও কূটনীতি)',
    'গাণিতিক যুক্তি ও মানসিক দক্ষতা',
    'সাধারণ বিজ্ঞান ও তথ্যপ্রযুক্তি',
  ],
  bank: [
    'Focus Writing (English & Bangla)',
    'Bank Written Math (Step-by-Step)',
    'Translation (Bangla ↔ English)',
    'Comprehension, Precis & Business Letter',
    'Banking, Economics & Recent Issues',
  ],
};

let writtenBookmarkMode = false;
let writtenReadingId = null;
let showAddWrittenForm = false;

function getWrittenFolders(examType) {
  return WRITTEN_FOLDERS[examType] || WRITTEN_FOLDERS.bcs;
}

function normalizeWrittenContent(raw) {
  if (raw && typeof raw === 'object') {
    return {
      overview: String(raw.overview || '').trim(),
      body: String(raw.body || '').trim(),
      tips: String(raw.tips || '').trim(),
    };
  }
  return { overview: '', body: String(raw || '').trim(), tips: '' };
}

function switchWrittenType(type) {
  state.writtenType = type;
  state.selectedWrittenFolder = null;
  state.writtenItems = [];
  state.writtenSearch = '';
  writtenBookmarkMode = false;
  writtenReadingId = null;
  showAddWrittenForm = false;
  state.editing = null;
  state.showBulk.written = false;
  render();
}

function openWrittenFolderByIndex(idx) {
  const folders = getWrittenFolders(state.writtenType);
  const folderName = folders[idx];
  if (!folderName) return;
  writtenBookmarkMode = false;
  writtenReadingId = null;
  showAddWrittenForm = false;
  state.editing = null;
  state.showBulk.written = false;
  state.selectedWrittenFolder = folderName;
  state.writtenSearch = '';
  loadWrittenItems();
}

async function openWrittenBookmarks() {
  writtenBookmarkMode = true;
  writtenReadingId = null;
  showAddWrittenForm = false;
  state.editing = null;
  state.showBulk.written = false;
  state.selectedWrittenFolder = null;
  state.writtenSearch = '';

  const ids = state.bookmarks.written || [];
  state.loading = true;
  render();
  try {
    if (!ids.length) {
      state.writtenItems = [];
      return;
    }
    const { data, error } = await sb
      .from('written_items')
      .select('*')
      .in('id', ids.slice(0, 100))
      .order('created_at', { ascending: false });
    if (error) throw error;
    state.writtenItems = data || [];
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

async function loadWrittenItems() {
  if (!state.selectedWrittenFolder) return;
  state.loading = true;
  render();
  try {
    let query = sb
      .from('written_items')
      .select('*')
      .eq('exam_type', state.writtenType)
      .eq('folder', state.selectedWrittenFolder)
      .order('created_at', { ascending: false })
      .limit(100);

    if (state.writtenSearch) {
      query = query.ilike('title', `%${state.writtenSearch}%`);
    }

    const { data, error } = await query;
    if (error) throw error;
    state.writtenItems = data || [];
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

function searchWritten(e) {
  e.preventDefault();
  state.writtenSearch = e.target.q.value.trim();
  loadWrittenItems();
}

function clearWrittenSearch() {
  state.writtenSearch = '';
  loadWrittenItems();
}

function openWrittenReader(id) {
  writtenReadingId = Number(id);
  state.editing = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeWrittenReader() {
  writtenReadingId = null;
  render();
}

function goBackWrittenFolders() {
  state.selectedWrittenFolder = null;
  writtenBookmarkMode = false;
  writtenReadingId = null;
  showAddWrittenForm = false;
  state.editing = null;
  state.showBulk.written = false;
  render();
}

// ==========================================
// Admin: Manual Add, Edit, Bulk JSON & AI
// ==========================================
function toggleAddWrittenForm() {
  showAddWrittenForm = !showAddWrittenForm;
  state.showBulk.written = false;
  state.editing = null;
  render();
}

async function saveManualWritten(e) {
  e.preventDefault();
  if (!state.selectedWrittenFolder || state.saving) return;
  state.saving = true;
  try {
    const f = e.target;
    const title = f.title.value.trim();
    const content = {
      overview: f.overview.value.trim(),
      body: f.body.value.trim(),
      tips: f.tips.value.trim(),
    };
    if (!title || !content.body) throw new Error('শিরোনাম এবং মূল উত্তর অবশ্যই লিখতে হবে।');

    const { error } = await sb.from('written_items').insert({
      exam_type: state.writtenType,
      folder: state.selectedWrittenFolder,
      title,
      content,
    });
    if (error) throw error;
    e.target.reset();
    showAddWrittenForm = false;
    showToast('নতুন রিটেন নোট সেভ হয়েছে!');
    await loadWrittenItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

function openEditWritten(id) {
  const item = state.writtenItems.find((w) => String(w.id) === String(id));
  if (!item) return;
  writtenReadingId = null;
  showAddWrittenForm = false;
  state.showBulk.written = false;
  state.editing = { type: 'written', item };
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveEditWritten(e) {
  e.preventDefault();
  if (!state.editing || state.saving) return;
  state.saving = true;
  try {
    const f = e.target;
    const title = f.title.value.trim();
    const content = {
      overview: f.overview.value.trim(),
      body: f.body.value.trim(),
      tips: f.tips.value.trim(),
    };
    const { error } = await sb
      .from('written_items')
      .update({ title, content })
      .eq('id', state.editing.item.id);
    if (error) throw error;
    state.editing = null;
    showToast('রিটেন নোট আপডেট হয়েছে!');
    if (writtenBookmarkMode) await openWrittenBookmarks();
    else await loadWrittenItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function importWrittenJSON(e) {
  e.preventDefault();
  if (!state.selectedWrittenFolder || state.saving) return;
  state.saving = true;
  try {
    const parsed = parseBulkJSON(e.target.json_data.value);
    const items = Array.isArray(parsed) ? parsed : [parsed];

    const seen = new Set(state.writtenItems.map((w) => normText(w.title)));
    const rows = [];
    let skipped = 0;

    items.forEach((it, i) => {
      if (!it?.title || !it?.content) {
        throw new Error(`${i + 1} নম্বর নোটে title বা content নেই।`);
      }
      const key = normText(it.title);
      if (seen.has(key)) { skipped++; return; }
      seen.add(key);
      rows.push({
        exam_type: state.writtenType,
        folder: state.selectedWrittenFolder,
        title: String(it.title).trim(),
        content: normalizeWrittenContent(it.content),
      });
    });

    if (!rows.length) return showToast('সবগুলো নোট আগে থেকেই এই ফোল্ডারে আছে!', true);

    const { error } = await sb.from('written_items').insert(rows);
    if (error) throw error;
    e.target.reset();
    state.showBulk.written = false;
    showToast(skipped ? `${rows.length}টি নোট সেভ হয়েছে (${skipped}টি ডুপ্লিকেট বাদ)` : `${rows.length}টি নতুন রিটেন নোট সেভ হয়েছে!`);
    await loadWrittenItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function generateWrittenAI() {
  if (!state.selectedWrittenFolder || state.saving) return;
  state.saving = true;
  showToast('AI দিয়ে ৫টি নতুন রিটেন নোট তৈরি হচ্ছে...');
  try {
    const existingTitles = state.writtenItems.map((w) => w.title);
    const items = await callAI('written', {
      exam_type: state.writtenType,
      folder: state.selectedWrittenFolder,
      existingTitles,
    });
    const list = Array.isArray(items) ? items : [];
    const seen = new Set(existingTitles.map((t) => normText(t)));
    const rows = [];

    list.forEach((it) => {
      if (!it?.title || !it?.content) return;
      const key = normText(it.title);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        exam_type: state.writtenType,
        folder: state.selectedWrittenFolder,
        title: String(it.title).trim(),
        content: normalizeWrittenContent(it.content),
      });
    });

    if (!rows.length) return showToast('নতুন ইউনিক নোট পাওয়া যায়নি, আবার চেষ্টা করুন।', true);

    const { error } = await sb.from('written_items').insert(rows);
    if (error) throw error;
    showToast(`${rows.length}টি নতুন AI রিটেন নোট যুক্ত হয়েছে!`);
    await loadWrittenItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

// ==========================================
// Render Written View
// ==========================================
function renderWritten() {
  const isAdmin = isAdminUser();
  const isPro = isProUser();

  // ১. ফোল্ডার তালিকা ভিউ
  if (!state.selectedWrittenFolder && !writtenBookmarkMode) {
    const folders = getWrittenFolders(state.writtenType);
    return `
      <div class="space-y-4">
        <div class="flex bg-slate-200/70 dark:bg-slate-800 p-1 rounded-xl">
          <button onclick="switchWrittenType('bcs')"
            class="flex-1 py-2 text-xs font-bold rounded-lg transition ${state.writtenType === 'bcs' ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'}">
            🏛️ বিসিএস রিটেন
          </button>
          <button onclick="switchWrittenType('bank')"
            class="flex-1 py-2 text-xs font-bold rounded-lg transition ${state.writtenType === 'bank' ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'}">
            🏦 ব্যাংক রিটেন
          </button>
        </div>

        <button onclick="openWrittenBookmarks()" class="w-full bg-amber-50 dark:bg-slate-900 border border-amber-200 dark:border-slate-700 p-3.5 rounded-xl flex items-center justify-between text-left">
          <div>
            <p class="text-xs font-bold text-amber-900 dark:text-amber-300">⭐ বুকমার্ক করা রিটেন নোট</p>
            <p class="text-[11px] text-amber-700 dark:text-slate-400">${(state.bookmarks.written || []).length}টি নোট সেভ করা আছে</p>
          </div>
          <i data-lucide="chevron-right" class="w-4 h-4 text-amber-600"></i>
        </button>

        <h2 class="font-bold text-sm">
          ${state.writtenType === 'bcs' ? 'বিসিএস লিখিত ফোল্ডারসমূহ' : 'ব্যাংক লিখিত ফোল্ডারসমূহ'} (${folders.length}টি)
        </h2>

        <div class="space-y-2.5">
          ${folders.map((folder, idx) => `
            <button onclick="openWrittenFolderByIndex(${idx})"
              class="w-full bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex justify-between items-center text-left">
              <div class="flex items-center gap-3">
                <span class="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 flex items-center justify-center font-bold text-sm shrink-0">📁</span>
                <span class="font-semibold text-sm">${escHtml(folder)}</span>
              </div>
              <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400 shrink-0"></i>
            </button>
          `).join('')}
        </div>
      </div>`;
  }

  // দৃশ্যমান নোট ও ফ্রি/প্রো লক হিসাব
  const visibleItems = !writtenBookmarkMode && !isPro
    ? state.writtenItems.slice(0, FREE_LIMITS.writtenPerFolder)
    : state.writtenItems;
  const lockedCount = !writtenBookmarkMode && !isPro
    ? Math.max(0, state.writtenItems.length - FREE_LIMITS.writtenPerFolder)
    : 0;

  // ২. ডিস্ট্র্যাকশন-ফ্রি ফুল রিডার ভিউ
  if (writtenReadingId !== null) {
    const activeIdx = visibleItems.findIndex((w) => Number(w.id) === Number(writtenReadingId));
    const item = visibleItems[activeIdx];
    if (!item) {
      writtenReadingId = null;
    } else {
      const c = normalizeWrittenContent(item.content);
      const bookmarked = isBookmarked('written', item.id);
      const prevItem = activeIdx > 0 ? visibleItems[activeIdx - 1] : null;
      const nextItem = activeIdx < visibleItems.length - 1 ? visibleItems[activeIdx + 1] : null;

      return `
        <div class="space-y-4">
          <div class="flex justify-between items-center gap-2">
            <button onclick="closeWrittenReader()" class="text-xs font-bold text-teal-700 dark:text-teal-400">← নোট তালিকায় ফিরুন</button>
            <div class="flex items-center gap-1.5">
              <button onclick="toggleBookmark('written','${item.id}')" class="px-2.5 py-1.5 rounded-lg text-xs font-bold ${bookmarked ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}">⭐ ${bookmarked ? 'সেভড' : 'সেভ'}</button>
              <button onclick="submitErrorReport('written','${item.id}')" class="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-lg text-xs" title="ভুল রিপোর্ট">🚩</button>
              ${isAdmin ? `
                <button onclick="openEditWritten('${item.id}')" class="px-2 py-1.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs">✏️</button>
                <button onclick="deleteItem('written_items','${item.id}',()=>{writtenReadingId=null;return ${writtenBookmarkMode ? 'openWrittenBookmarks()' : 'loadWrittenItems()'}})" class="px-2 py-1.5 bg-rose-50 dark:bg-rose-950/50 text-rose-600 rounded-lg text-xs">🗑️</button>` : ''}
            </div>
          </div>

          <article class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-4">
            <div>
              <span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 uppercase">
                ${item.exam_type === 'bank' ? 'ব্যাংক রিটেন' : 'বিসিএস রিটেন'} • ${escHtml(item.folder)}
              </span>
              <h1 class="font-bold text-lg mt-2 leading-snug">${escHtml(item.title)}</h1>
            </div>

            ${c.overview ? `
              <div class="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border-l-4 border-teal-600 text-xs sm:text-sm leading-relaxed whitespace-pre-line">
                <p class="font-bold text-teal-700 dark:text-teal-300 text-xs mb-1">📌 সংক্ষিপ্ত ধারণা</p>
                ${escHtml(c.overview)}
              </div>` : ''}

            <div class="text-sm leading-relaxed whitespace-pre-line text-slate-800 dark:text-slate-200">
              ${escHtml(c.body)}
            </div>

            ${c.tips ? `
              <div class="p-3.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs leading-relaxed whitespace-pre-line text-amber-900 dark:text-amber-200">
                <p class="font-bold mb-1">💡 পরীক্ষার হলে লেখার টিপস</p>
                ${escHtml(c.tips)}
              </div>` : ''}
          </article>

          <div class="flex justify-between gap-2">
            ${prevItem
              ? `<button onclick="openWrittenReader(${prevItem.id})" class="flex-1 py-2.5 px-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-left truncate">← ${escHtml(prevItem.title)}</button>`
              : '<div class="flex-1"></div>'}
            ${nextItem
              ? `<button onclick="openWrittenReader(${nextItem.id})" class="flex-1 py-2.5 px-3 bg-teal-600 text-white rounded-xl text-xs font-bold text-right truncate">${escHtml(nextItem.title)} →</button>`
              : '<div class="flex-1"></div>'}
          </div>
        </div>`;
    }
  }

  // ৩. ফোল্ডারের ভেতরের নোট তালিকা ভিউ
  const editItem = state.editing?.type === 'written' ? state.editing.item : null;
  const editContent = editItem ? normalizeWrittenContent(editItem.content) : null;

  return `
    <div class="space-y-3">
      <div class="flex flex-wrap justify-between items-center gap-2">
        <button onclick="goBackWrittenFolders()" class="text-xs font-bold text-teal-700 dark:text-teal-400">← ফোল্ডারে ফিরুন</button>
        ${isAdmin && !writtenBookmarkMode ? `
          <div class="flex flex-wrap gap-1.5">
            <button onclick="toggleAddWrittenForm()" class="px-2.5 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg">+ নোট</button>
            <button onclick="toggleBulk('written')" class="px-2.5 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-lg">📋 JSON</button>
            <button onclick="generateWrittenAI()" ${state.saving ? 'disabled' : ''} class="px-2.5 py-1.5 bg-teal-600 text-white text-xs font-bold rounded-lg disabled:opacity-50">+৫ AI</button>
          </div>` : ''}
      </div>

      <h2 class="font-bold text-base">
        ${writtenBookmarkMode ? '⭐ বুকমার্ক করা রিটেন নোট' : escHtml(state.selectedWrittenFolder)} (${state.writtenItems.length}টি)
      </h2>

      ${!writtenBookmarkMode ? `
        <form onsubmit="searchWritten(event)" class="flex gap-2">
          <input name="q" value="${escHtml(state.writtenSearch)}" placeholder="নোটের শিরোনাম খুঁজুন..." class="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl" />
          <button type="submit" class="px-3 py-2 bg-teal-600 text-white text-xs font-bold rounded-xl">খুঁজুন</button>
          ${state.writtenSearch ? `<button type="button" onclick="clearWrittenSearch()" class="px-2.5 py-2 bg-slate-200 dark:bg-slate-700 text-xs font-bold rounded-xl">✕</button>` : ''}
        </form>` : ''}

      ${isAdmin && showAddWrittenForm && !writtenBookmarkMode ? `
        <form onsubmit="saveManualWritten(event)" class="bg-indigo-50 dark:bg-slate-900 border border-indigo-200 dark:border-slate-700 p-4 rounded-2xl space-y-2.5">
          <div class="flex justify-between items-center">
            <p class="text-xs font-bold text-indigo-900 dark:text-indigo-300">✍️ নতুন রিটেন নোট যোগ করুন</p>
            <button type="button" onclick="toggleAddWrittenForm()" class="text-xs text-slate-500 font-bold">বন্ধ ✕</button>
          </div>
          <input name="title" required placeholder="নোটের শিরোনাম..." class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
          <textarea name="overview" rows="2" placeholder="সংক্ষিপ্ত ভূমিকা (ঐচ্ছিক)..." class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl"></textarea>
          <textarea name="body" required rows="5" placeholder="মূল উত্তর বা গণিতের ধাপে ধাপে সমাধান (LaTeX ব্যবহার করতে পারবেন যেমন: $x^2+y^2$)..." class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl"></textarea>
          <textarea name="tips" rows="2" placeholder="পরীক্ষার টিপস (ঐচ্ছিক)..." class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl"></textarea>
          <button type="submit" class="w-full py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl">নোট সেভ করুন</button>
        </form>` : ''}

      ${editItem ? `
        <form onsubmit="saveEditWritten(event)" class="bg-amber-50 dark:bg-slate-900 border border-amber-300 dark:border-amber-700 p-4 rounded-2xl space-y-2.5">
          <div class="flex justify-between items-center">
            <p class="text-xs font-bold text-amber-900 dark:text-amber-300">✏️ রিটেন নোট এডিট করুন</p>
            <button type="button" onclick="cancelEdit()" class="text-xs text-slate-500 font-bold">বাতিল ✕</button>
          </div>
          <input name="title" required value="${escHtml(editItem.title)}" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
          <textarea name="overview" rows="2" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(editContent.overview)}</textarea>
          <textarea name="body" required rows="6" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(editContent.body)}</textarea>
          <textarea name="tips" rows="2" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(editContent.tips)}</textarea>
          <button type="submit" class="w-full py-2.5 bg-amber-500 text-slate-950 text-xs font-bold rounded-xl">পরিবর্তন সেভ করুন</button>
        </form>` : ''}

      ${isAdmin && !writtenBookmarkMode && state.showBulk.written ? `
        <form onsubmit="importWrittenJSON(event)" class="bg-slate-900 text-white p-4 rounded-2xl space-y-2.5">
          <div class="flex justify-between items-center">
            <p class="text-xs font-bold text-teal-300">📋 রিটেন নোটের JSON পেস্ট করুন</p>
            <button type="button" onclick="toggleBulk('written')" class="text-xs text-slate-400">বন্ধ ✕</button>
          </div>
          <textarea name="json_data" required rows="5" placeholder='[{"title":"শিরোনাম","content":{"overview":"ভূমিকা","body":"মূল উত্তর","tips":"টিপস"}}]' class="w-full p-3 text-xs font-mono text-slate-900 bg-white rounded-xl"></textarea>
          <button type="submit" class="w-full py-2.5 bg-teal-500 text-slate-950 text-xs font-bold rounded-xl">ডাটাবেজে সেভ করুন</button>
        </form>` : ''}

      ${state.loading ? `<p class="text-center text-xs text-slate-500 py-6">লোড হচ্ছে...</p>` : ''}
      ${!state.loading && visibleItems.length === 0 ? `<div class="bg-white dark:bg-slate-900 p-6 rounded-xl text-center text-sm text-slate-500">এখনো কোনো রিটেন নোট যুক্ত হয়নি।</div>` : ''}

      <div class="space-y-3">
        ${visibleItems.map((item, idx) => {
          const c = normalizeWrittenContent(item.content);
          const bookmarked = isBookmarked('written', item.id);
          return `
            <div onclick="openWrittenReader(${item.id})" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm cursor-pointer space-y-2">
              <div class="flex justify-between items-start gap-2">
                <h3 class="font-bold text-sm leading-snug">${idx + 1}. ${escHtml(item.title)}</h3>
                <div class="flex items-center gap-1 shrink-0" onclick="event.stopPropagation()">
                  <button onclick="toggleBookmark('written','${item.id}')" class="px-1.5 py-1 rounded-lg text-xs ${bookmarked ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}">⭐</button>
                  ${isAdmin ? `
                    <button onclick="openEditWritten('${item.id}')" class="px-1.5 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs">✏️</button>
                    <button onclick="deleteItem('written_items','${item.id}',()=>${writtenBookmarkMode ? 'openWrittenBookmarks()' : 'loadWrittenItems()'})" class="px-1.5 py-1 bg-rose-50 dark:bg-rose-950/50 text-rose-600 rounded-lg text-xs">🗑️</button>` : ''}
                </div>
              </div>
              ${c.overview ? `<p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">${escHtml(c.overview)}</p>` : ''}
              <p class="text-xs font-bold text-teal-600 dark:text-teal-400">বিস্তারিত পড়ুন →</p>
            </div>`;
        }).join('')}
      </div>

      ${lockedCount > 0 ? renderProLockCard(`এই ফোল্ডারে আরও ${lockedCount}টি গুরুত্বপূর্ণ রিটেন নোট রয়েছে। সব নোট আনলক করতে Pro চালু করুন।`) : ''}
    </div>`;
}