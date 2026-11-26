// ==========================================
// PrepBox BD V2 — Newspaper Editorials (BN/EN) & Current Affairs Module
// ==========================================

const EDITORIAL_SUBCATS = ['🇧🇩 বাংলা সম্পাদকীয়', '🇬🇧 ইংরেজি সম্পাদকীয়'];
const CA_SUBCATS = [
  'বাংলাদেশ',
  'আন্তর্জাতিক',
  'অর্থনীতি ও ব্যাংকিং',
  'বিজ্ঞান ও খেলাধুলা',
  'রিপোর্ট ও সূচক',
];

let columnSubFilter = 'ALL';
let columnMonthFilter = 'ALL';
let columnBookmarkOnly = false;
let columnReadingId = null;
let showAddColumnForm = false;

function getDefaultEditionLabel() {
  try {
    return new Date().toLocaleDateString('bn-BD', {
      timeZone: 'Asia/Dhaka',
      month: 'long',
      year: 'numeric',
    });
  } catch (_) {
    return 'নভেম্বর ২০২৬';
  }
}

function getColumnSubcats(type) {
  return type === 'editorial' ? EDITORIAL_SUBCATS : CA_SUBCATS;
}

function speakColumnWord(word) {
  if (!word || !('speechSynthesis' in window)) return;
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(word);
    utter.lang = 'en-US';
    utter.rate = 0.92;
    window.speechSynthesis.speak(utter);
  } catch (_) {}
}

function switchColumnType(type) {
  state.columnType = type;
  columnSubFilter = 'ALL';
  columnMonthFilter = 'ALL';
  columnBookmarkOnly = false;
  columnReadingId = null;
  showAddColumnForm = false;
  state.editing = null;
  state.showBulk.columns = false;
  state.columnSearch = '';
  loadColumnItems();
}

async function loadColumnItems() {
  state.loading = true;
  render();
  try {
    const { data, error } = await sb
      .from('columns_items')
      .select('*')
      .eq('item_type', state.columnType)
      .order('created_at', { ascending: false })
      .limit(150);
    if (error) throw error;
    state.columnItems = data || [];
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

function getColumnMonthList() {
  const set = new Set();
  state.columnItems.forEach((c) => {
    if (c.edition_label && c.edition_label.trim()) set.add(c.edition_label.trim());
  });
  return ['ALL', ...Array.from(set)];
}

function getFilteredColumnItems() {
  const isPro = isProUser();
  const base = isPro ? state.columnItems : state.columnItems.slice(0, FREE_LIMITS.columnsTotal);
  const q = normText(state.columnSearch);
  const bmSet = new Set(state.bookmarks.column || []);

  return base.filter((c) => {
    if (columnBookmarkOnly && !bmSet.has(Number(c.id))) return false;
    if (columnSubFilter !== 'ALL' && c.sub_category !== columnSubFilter) return false;
    if (columnMonthFilter !== 'ALL' && c.edition_label !== columnMonthFilter) return false;
    if (q) {
      const hay = normText(`${c.title} ${c.summary} ${c.key_data} ${c.sub_category} ${c.edition_label}`);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function searchColumns(e) {
  e.preventDefault();
  state.columnSearch = e.target.q.value.trim();
  render();
}

function clearColumnSearch() {
  state.columnSearch = '';
  render();
}

function openColumnReader(id) {
  columnReadingId = Number(id);
  state.editing = null;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeColumnReader() {
  columnReadingId = null;
  render();
}

function parseLinePairs(rawText, keyA, keyB) {
  return String(rawText || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split('|').map((s) => s.trim());
      if (parts.length < 2) return null;
      return { [keyA]: parts[0], [keyB]: parts.slice(1).join(' | ') };
    })
    .filter(Boolean);
}

function formatLinePairs(list, keyA, keyB) {
  if (!Array.isArray(list)) return '';
  return list.map((x) => `${x[keyA] || ''} | ${x[keyB] || ''}`).join('\n');
}

// ==========================================
// Admin: Manual Add, Edit, Bulk JSON & AI
// ==========================================
function toggleAddColumnForm() {
  showAddColumnForm = !showAddColumnForm;
  state.showBulk.columns = false;
  state.editing = null;
  render();
}

async function saveManualColumn(e) {
  e.preventDefault();
  if (state.saving) return;
  state.saving = true;
  try {
    const f = e.target;
    const title = f.title.value.trim();
    const summary = f.summary.value.trim();
    if (!title || !summary) throw new Error('শিরোনাম ও সারসংক্ষেপ অবশ্যই লিখতে হবে।');

    const vocab_list = parseLinePairs(f.vocab_lines?.value, 'word', 'meaning');
    const translation_list = parseLinePairs(f.trans_lines?.value, 'en', 'bn');

    const { error } = await sb.from('columns_items').insert({
      item_type: state.columnType,
      sub_category: f.sub_category.value,
      edition_label: f.edition_label.value.trim() || getDefaultEditionLabel(),
      title,
      summary,
      key_data: f.key_data.value.trim(),
      vocab_list,
      translation_list,
    });
    if (error) throw error;
    e.target.reset();
    showAddColumnForm = false;
    showToast('নতুন কন্টেন্ট সফলভাবে সেভ হয়েছে!');
    await loadColumnItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

function openEditColumn(id) {
  const item = state.columnItems.find((c) => String(c.id) === String(id));
  if (!item) return;
  columnReadingId = null;
  showAddColumnForm = false;
  state.showBulk.columns = false;
  state.editing = { type: 'column', item };
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveEditColumn(e) {
  e.preventDefault();
  if (!state.editing || state.saving) return;
  state.saving = true;
  try {
    const f = e.target;
    const vocab_list = parseLinePairs(f.vocab_lines?.value, 'word', 'meaning');
    const translation_list = parseLinePairs(f.trans_lines?.value, 'en', 'bn');

    const { error } = await sb
      .from('columns_items')
      .update({
        sub_category: f.sub_category.value,
        edition_label: f.edition_label.value.trim(),
        title: f.title.value.trim(),
        summary: f.summary.value.trim(),
        key_data: f.key_data.value.trim(),
        vocab_list,
        translation_list,
      })
      .eq('id', state.editing.item.id);
    if (error) throw error;
    state.editing = null;
    showToast('কন্টেন্ট আপডেট হয়েছে!');
    await loadColumnItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function importColumnsJSON(e) {
  e.preventDefault();
  if (state.saving) return;
  state.saving = true;
  try {
    const parsed = parseBulkJSON(e.target.json_data.value);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const defaultSub = columnSubFilter !== 'ALL' ? columnSubFilter : getColumnSubcats(state.columnType)[0];
    const defaultEdition = getDefaultEditionLabel();

    const seen = new Set(state.columnItems.map((c) => normText(c.title)));
    const rows = [];
    let skipped = 0;

    items.forEach((it, i) => {
      if (!it?.title || !it?.summary) {
        throw new Error(`${i + 1} নম্বর আইটেমে title বা summary নেই।`);
      }
      const key = normText(it.title);
      if (seen.has(key)) { skipped++; return; }
      seen.add(key);
      rows.push({
        item_type: state.columnType,
        sub_category: String(it.sub_category || defaultSub).trim(),
        edition_label: String(it.edition_label || defaultEdition).trim(),
        title: String(it.title).trim(),
        summary: String(it.summary).trim(),
        key_data: String(it.key_data || '').trim(),
        vocab_list: Array.isArray(it.vocab_list) ? it.vocab_list : [],
        translation_list: Array.isArray(it.translation_list) ? it.translation_list : [],
      });
    });

    if (!rows.length) return showToast('সবগুলো আইটেম আগে থেকেই ডাটাবেজে আছে!', true);

    const { error } = await sb.from('columns_items').insert(rows);
    if (error) throw error;
    e.target.reset();
    state.showBulk.columns = false;
    showToast(skipped ? `${rows.length}টি সেভ হয়েছে (${skipped}টি ডুপ্লিকেট বাদ)` : `${rows.length}টি নতুন আইটেম সেভ হয়েছে!`);
    await loadColumnItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function generateColumnsAI() {
  if (state.saving) return;
  state.saving = true;
  const subCat = columnSubFilter !== 'ALL' ? columnSubFilter : getColumnSubcats(state.columnType)[0];
  const edition = getDefaultEditionLabel();
  showToast(`AI দিয়ে ৫টি নতুন ${state.columnType === 'editorial' ? 'সম্পাদকীয়' : 'সাম্প্রতিক'} তৈরি হচ্ছে...`);

  try {
    const existingTitles = state.columnItems.map((c) => c.title);
    const items = await callAI('column', {
      item_type: state.columnType,
      sub_category: subCat,
      edition_label: edition,
      existingTitles,
    });
    const list = Array.isArray(items) ? items : [];
    const seen = new Set(existingTitles.map((t) => normText(t)));
    const rows = [];

    list.forEach((it) => {
      if (!it?.title || !it?.summary) return;
      const key = normText(it.title);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        item_type: state.columnType,
        sub_category: String(it.sub_category || subCat).trim(),
        edition_label: String(it.edition_label || edition).trim(),
        title: String(it.title).trim(),
        summary: String(it.summary).trim(),
        key_data: String(it.key_data || '').trim(),
        vocab_list: Array.isArray(it.vocab_list) ? it.vocab_list : [],
        translation_list: Array.isArray(it.translation_list) ? it.translation_list : [],
      });
    });

    if (!rows.length) return showToast('নতুন ইউনিক কন্টেন্ট পাওয়া যায়নি, আবার চেষ্টা করুন।', true);

    const { error } = await sb.from('columns_items').insert(rows);
    if (error) throw error;
    showToast(`${rows.length}টি নতুন AI কন্টেন্ট যুক্ত হয়েছে!`);
    await loadColumnItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

// ==========================================
// Render Columns & Current Affairs View
// ==========================================
function renderColumns() {
  const isAdmin = isAdminUser();
  const isPro = isProUser();
  const isEditorial = state.columnType === 'editorial';
  const subcats = getColumnSubcats(state.columnType);
  const months = getColumnMonthList();
  const visibleItems = getFilteredColumnItems();
  const lockedCount = !isPro ? Math.max(0, state.columnItems.length - FREE_LIMITS.columnsTotal) : 0;

  // ১. ডিস্ট্র্যাকশন-ফ্রি ফুল রিডার ভিউ
  if (columnReadingId !== null) {
    const item = visibleItems.find((c) => Number(c.id) === Number(columnReadingId));
    if (!item) {
      columnReadingId = null;
    } else {
      const bookmarked = isBookmarked('column', item.id);
      const vocabList = Array.isArray(item.vocab_list) ? item.vocab_list : [];
      const transList = Array.isArray(item.translation_list) ? item.translation_list : [];

      return `
        <div class="space-y-4">
          <div class="flex justify-between items-center gap-2">
            <button onclick="closeColumnReader()" class="text-xs font-bold text-teal-700 dark:text-teal-400">← তালিকায় ফিরুন</button>
            <div class="flex items-center gap-1.5">
              <button onclick="toggleBookmark('column','${item.id}')" class="px-2.5 py-1.5 rounded-lg text-xs font-bold ${bookmarked ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}">⭐ ${bookmarked ? 'সেভড' : 'সেভ'}</button>
              <button onclick="submitErrorReport('column','${item.id}')" class="px-2 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-lg text-xs">🚩</button>
              ${isAdmin ? `
                <button onclick="openEditColumn('${item.id}')" class="px-2 py-1.5 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs">✏️</button>
                <button onclick="deleteItem('columns_items','${item.id}',()=>{columnReadingId=null;return loadColumnItems()})" class="px-2 py-1.5 bg-rose-50 dark:bg-rose-950/50 text-rose-600 rounded-lg text-xs">🗑️</button>` : ''}
            </div>
          </div>

          <article class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-4">
            <div class="flex flex-wrap gap-1.5">
              ${item.sub_category ? `<span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300">${escHtml(item.sub_category)}</span>` : ''}
              ${item.edition_label ? `<span class="text-[10px] font-bold px-2.5 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300">📅 ${escHtml(item.edition_label)}</span>` : ''}
            </div>

            <h1 class="font-bold text-lg leading-snug">${escHtml(item.title)}</h1>

            <div class="text-sm leading-relaxed whitespace-pre-line text-slate-800 dark:text-slate-200">
              ${escHtml(item.summary)}
            </div>

            ${item.key_data ? `
              <div class="p-3.5 rounded-xl bg-teal-50 dark:bg-teal-950/40 border border-teal-200 dark:border-teal-800 text-xs leading-relaxed whitespace-pre-line text-teal-950 dark:text-teal-200">
                <p class="font-bold mb-1">📊 পরীক্ষার জন্য মূল তথ্য ও পরিসংখ্যান</p>
                ${escHtml(item.key_data)}
              </div>` : ''}

            ${transList.length > 0 ? `
              <div class="p-3.5 rounded-xl bg-indigo-50 dark:bg-indigo-950/40 border border-indigo-200 dark:border-indigo-800 space-y-2.5">
                <p class="text-xs font-bold text-indigo-900 dark:text-indigo-300">🔄 অনুবাদ অনুশীলন (Translation Practice)</p>
                ${transList.map((t) => `
                  <div class="bg-white dark:bg-slate-900 p-3 rounded-xl text-xs space-y-1 border border-indigo-100 dark:border-slate-800">
                    <p class="font-semibold text-slate-900 dark:text-white">${escHtml(t.en || '')}</p>
                    <p class="text-teal-700 dark:text-teal-300">→ ${escHtml(t.bn || '')}</p>
                  </div>
                `).join('')}
              </div>` : ''}

            ${vocabList.length > 0 ? `
              <div class="space-y-2">
                <p class="text-xs font-bold text-slate-700 dark:text-slate-300">🔤 গুরুত্বপূর্ণ ভোকাবুলারি (ট্যাপ করে উচ্চারণ শুনুন)</p>
                <div class="flex flex-wrap gap-2">
                  ${vocabList.map((v) => `
                    <button type="button" onclick="speakColumnWord('${escHtml(v.word || '')}')"
                      class="px-3 py-1.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs text-left hover:bg-teal-50 dark:hover:bg-teal-950 transition">
                      <span class="font-bold text-teal-700 dark:text-teal-300">🔊 ${escHtml(v.word || '')}</span>
                      <span class="text-slate-600 dark:text-slate-300"> — ${escHtml(v.meaning || '')}</span>
                    </button>
                  `).join('')}
                </div>
              </div>` : ''}
          </article>
        </div>`;
    }
  }

  // ২. মূল তালিকা ভিউ
  const editItem = state.editing?.type === 'column' ? state.editing.item : null;

  return `
    <div class="space-y-3.5">
      <!-- সম্পাদকীয় / সাম্প্রতিক সুইচার -->
      <div class="grid grid-cols-2 bg-slate-200/70 dark:bg-slate-800 p-1 rounded-xl gap-1">
        <button onclick="switchColumnType('editorial')"
          class="py-2 text-xs font-bold rounded-lg transition ${isEditorial ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'}">
          📰 পত্রিকা সম্পাদকীয়
        </button>
        <button onclick="switchColumnType('current_affairs')"
          class="py-2 text-xs font-bold rounded-lg transition ${!isEditorial ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'}">
          🌍 সাম্প্রতিক বুলেটিন
        </button>
      </div>

      <!-- সাব-ক্যাটাগরি ফিল্টার -->
      <div class="flex gap-2 overflow-x-auto no-scrollbar">
        <button onclick="columnSubFilter='ALL';render()"
          class="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${columnSubFilter === 'ALL' ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}">
          সব
        </button>
        ${subcats.map((sc) => `
          <button onclick="columnSubFilter='${escHtml(sc)}';render()"
            class="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${columnSubFilter === sc ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'}">
            ${escHtml(sc)}
          </button>
        `).join('')}
      </div>

      <!-- বুকমার্ক, মাস ফিল্টার ও অ্যাডমিন বাটন -->
      <div class="flex flex-wrap justify-between items-center gap-2">
        <div class="flex items-center gap-1.5">
          <button onclick="columnBookmarkOnly=!columnBookmarkOnly;render()"
            class="px-2.5 py-1.5 rounded-lg text-xs font-bold border ${columnBookmarkOnly ? 'bg-amber-500 text-slate-950 border-amber-500' : 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-slate-700'}">
            ⭐ বুকমার্ক
          </button>
          ${months.length > 1 ? `
            <select onchange="columnMonthFilter=this.value;render()" class="px-2.5 py-1.5 text-xs font-bold rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
              ${months.map((m) => `<option value="${escHtml(m)}" ${columnMonthFilter === m ? 'selected' : ''}>${m === 'ALL' ? '📅 সব মাস' : escHtml(m)}</option>`).join('')}
            </select>` : ''}
        </div>

        ${isAdmin ? `
          <div class="flex flex-wrap gap-1.5">
            <button onclick="toggleAddColumnForm()" class="px-2.5 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg">+ নতুন</button>
            <button onclick="toggleBulk('columns')" class="px-2.5 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-lg">📋 JSON</button>
            <button onclick="generateColumnsAI()" ${state.saving ? 'disabled' : ''} class="px-2.5 py-1.5 bg-teal-600 text-white text-xs font-bold rounded-lg disabled:opacity-50">+৫ AI</button>
          </div>` : ''}
      </div>

      <form onsubmit="searchColumns(event)" class="flex gap-2">
        <input name="q" value="${escHtml(state.columnSearch)}" placeholder="শিরোনাম বা তথ্য খুঁজুন..." class="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl" />
        <button type="submit" class="px-3 py-2 bg-teal-600 text-white text-xs font-bold rounded-xl">খুঁজুন</button>
        ${state.columnSearch ? `<button type="button" onclick="clearColumnSearch()" class="px-2.5 py-2 bg-slate-200 dark:bg-slate-700 text-xs font-bold rounded-xl">✕</button>` : ''}
      </form>

      ${isAdmin && showAddColumnForm ? `
        <form onsubmit="saveManualColumn(event)" class="bg-indigo-50 dark:bg-slate-900 border border-indigo-200 dark:border-slate-700 p-4 rounded-2xl space-y-2.5">
          <div class="flex justify-between items-center">
            <p class="text-xs font-bold text-indigo-900 dark:text-indigo-300">✍️ নতুন ${isEditorial ? 'সম্পাদকীয়' : 'সাম্প্রতিক'} যোগ করুন</p>
            <button type="button" onclick="toggleAddColumnForm()" class="text-xs text-slate-500 font-bold">বন্ধ ✕</button>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <select name="sub_category" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl">
              ${subcats.map((sc) => `<option value="${escHtml(sc)}" ${columnSubFilter === sc ? 'selected' : ''}>${escHtml(sc)}</option>`).join('')}
            </select>
            <input name="edition_label" value="${escHtml(getDefaultEditionLabel())}" placeholder="মাস (যেমন: নভেম্বর ২০২৬)" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
          </div>
          <input name="title" required placeholder="শিরোনাম..." class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
          <textarea name="summary" required rows="4" placeholder="পয়েন্ট আকারে মূল সারসংক্ষেপ..." class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl"></textarea>
          <textarea name="key_data" rows="2" placeholder="গুরুত্বপূর্ণ তথ্য ও পরিসংখ্যান (ঐচ্ছিক)..." class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl"></textarea>
          <textarea name="trans_lines" rows="2" placeholder="অনুবাদ অনুশীলন — প্রতি লাইনে: English Sentence | বাংলা অনুবাদ (ঐচ্ছিক)" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl"></textarea>
          <textarea name="vocab_lines" rows="2" placeholder="ভোকাবুলারি — প্রতি লাইনে: Word | বাংলা অর্থ (ঐচ্ছিক)" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl"></textarea>
          <button type="submit" class="w-full py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl">সেভ করুন</button>
        </form>` : ''}

      ${editItem ? `
        <form onsubmit="saveEditColumn(event)" class="bg-amber-50 dark:bg-slate-900 border border-amber-300 dark:border-amber-700 p-4 rounded-2xl space-y-2.5">
          <div class="flex justify-between items-center">
            <p class="text-xs font-bold text-amber-900 dark:text-amber-300">✏️ কন্টেন্ট এডিট করুন</p>
            <button type="button" onclick="cancelEdit()" class="text-xs text-slate-500 font-bold">বাতিল ✕</button>
          </div>
          <div class="grid grid-cols-2 gap-2">
            <select name="sub_category" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl">
              ${subcats.map((sc) => `<option value="${escHtml(sc)}" ${editItem.sub_category === sc ? 'selected' : ''}>${escHtml(sc)}</option>`).join('')}
            </select>
            <input name="edition_label" value="${escHtml(editItem.edition_label || '')}" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
          </div>
          <input name="title" required value="${escHtml(editItem.title)}" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
          <textarea name="summary" required rows="4" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(editItem.summary)}</textarea>
          <textarea name="key_data" rows="2" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(editItem.key_data || '')}</textarea>
          <textarea name="trans_lines" rows="2" placeholder="English | বাংলা" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(formatLinePairs(editItem.translation_list, 'en', 'bn'))}</textarea>
          <textarea name="vocab_lines" rows="2" placeholder="Word | অর্থ" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(formatLinePairs(editItem.vocab_list, 'word', 'meaning'))}</textarea>
          <button type="submit" class="w-full py-2.5 bg-amber-500 text-slate-950 text-xs font-bold rounded-xl">পরিবর্তন সেভ করুন</button>
        </form>` : ''}

      ${isAdmin && state.showBulk.columns ? `
        <form onsubmit="importColumnsJSON(event)" class="bg-slate-900 text-white p-4 rounded-2xl space-y-2.5">
          <div class="flex justify-between items-center">
            <p class="text-xs font-bold text-teal-300">📋 বাল্ক JSON পেস্ট করুন</p>
            <button type="button" onclick="toggleBulk('columns')" class="text-xs text-slate-400">বন্ধ ✕</button>
          </div>
          <textarea name="json_data" required rows="5" placeholder='[{"title":"শিরোনাম","sub_category":"বাংলাদেশ","edition_label":"নভেম্বর ২০২৬","summary":"সারসংক্ষেপ...","key_data":"মূল তথ্য...","translation_list":[{"en":"...","bn":"..."}],"vocab_list":[{"word":"Inflation","meaning":"মুদ্রাস্ফীতি"}]}]' class="w-full p-3 text-xs font-mono text-slate-900 bg-white rounded-xl"></textarea>
          <button type="submit" class="w-full py-2.5 bg-teal-500 text-slate-950 text-xs font-bold rounded-xl">ডাটাবেজে সেভ করুন</button>
        </form>` : ''}

      ${state.loading ? `<p class="text-center text-xs text-slate-500 py-6">লোড হচ্ছে...</p>` : ''}
      ${!state.loading && visibleItems.length === 0 ? `<div class="bg-white dark:bg-slate-900 p-6 rounded-xl text-center text-sm text-slate-500">কোনো কন্টেন্ট পাওয়া যায়নি।</div>` : ''}

      <div class="space-y-3">
        ${visibleItems.map((item) => {
          const bookmarked = isBookmarked('column', item.id);
          return `
            <div onclick="openColumnReader(${item.id})" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm cursor-pointer space-y-2">
              <div class="flex justify-between items-start gap-2">
                <div class="flex flex-wrap gap-1">
                  ${item.sub_category ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300">${escHtml(item.sub_category)}</span>` : ''}
                  ${item.edition_label ? `<span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500">${escHtml(item.edition_label)}</span>` : ''}
                </div>
                <div class="flex items-center gap-1 shrink-0" onclick="event.stopPropagation()">
                  <button onclick="toggleBookmark('column','${item.id}')" class="px-1.5 py-1 rounded-lg text-xs ${bookmarked ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}">⭐</button>
                  ${isAdmin ? `
                    <button onclick="openEditColumn('${item.id}')" class="px-1.5 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs">✏️</button>
                    <button onclick="deleteItem('columns_items','${item.id}',loadColumnItems)" class="px-1.5 py-1 bg-rose-50 dark:bg-rose-950/50 text-rose-600 rounded-lg text-xs">🗑️</button>` : ''}
                </div>
              </div>
              <h3 class="font-bold text-sm leading-snug">${escHtml(item.title)}</h3>
              <p class="text-xs text-slate-500 dark:text-slate-400 line-clamp-2">${escHtml(item.summary)}</p>
              <p class="text-xs font-bold text-teal-600 dark:text-teal-400">বিস্তারিত, অনুবাদ ও ভোকাব পড়ুন →</p>
            </div>`;
        }).join('')}
      </div>

      ${lockedCount > 0 ? renderProLockCard(`আরও ${lockedCount}টি গুরুত্বপূর্ণ সম্পাদকীয় ও সাম্প্রতিক নোট রয়েছে। সবগুলো আনলক করতে Pro চালু করুন।`) : ''}
    </div>`;
}