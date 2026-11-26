// ==========================================
// PrepBox BD V2 — 3-Tab Viva Board (Curated + Custom AI + Real Experiences)
// ==========================================

let vivaReadingId = null;
let showAddVivaForm = false;
let showExpForm = false;
let vivaSearch = '';

function switchVivaSubTab(subTab) {
  state.vivaSubTab = subTab; // 'curated' | 'custom' | 'experience'
  vivaReadingId = null;
  showAddVivaForm = false;
  showExpForm = false;
  state.showBulk.viva = false;
  render();
}

async function loadVivaItems() {
  state.loading = true;
  render();
  try {
    const { data, error } = await sb
      .from('viva_items')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) throw error;
    state.vivaItems = data || [];
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

function openVivaReader(id) {
  vivaReadingId = Number(id);
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function closeVivaReader() {
  vivaReadingId = null;
  render();
}

function parseVivaQALines(rawText) {
  const lines = String(rawText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const qa = [];
  lines.forEach((line) => {
    const parts = line.split('|').map((s) => s.trim());
    if (parts.length >= 2) {
      qa.push({ q: parts[0], a: parts.slice(1).join(' | ') });
    } else {
      qa.push({ q: 'বোর্ডের প্রশ্ন / অভিজ্ঞতা', a: parts[0] });
    }
  });
  return qa;
}

// ==========================================
// 1. Curated Viva (Admin: Manual, Bulk JSON, AI)
// ==========================================
async function saveManualCuratedViva(e) {
  e.preventDefault();
  if (state.saving) return;
  state.saving = true;
  try {
    const f = e.target;
    const title = f.title.value.trim();
    const qa_list = parseVivaQALines(f.qa_lines.value);
    if (!title || !qa_list.length) throw new Error('শিরোনাম ও কমপক্ষে ১টি প্রশ্নোত্তর দিন।');

    const { error } = await sb.from('viva_items').insert({
      user_id: state.user.id,
      is_public: true,
      viva_type: 'curated',
      title,
      district: f.district?.value.trim() || '',
      subject_name: f.subject_name?.value.trim() || '',
      qa_list,
    });
    if (error) throw error;
    e.target.reset();
    showAddVivaForm = false;
    showToast('নতুন ভাইভা সাজেশন সেট সেভ হয়েছে!');
    await loadVivaItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function importVivaJSON(e) {
  e.preventDefault();
  if (state.saving) return;
  state.saving = true;
  try {
    const parsed = parseBulkJSON(e.target.json_data.value);
    const items = Array.isArray(parsed) ? parsed : [parsed];

    const rows = items.map((it, i) => {
      if (!it?.title || !Array.isArray(it?.qa_list) || !it.qa_list.length) {
        throw new Error(`${i + 1} নম্বর সেটে title বা qa_list নেই।`);
      }
      return {
        user_id: state.user.id,
        is_public: true,
        viva_type: it.viva_type === 'experience' ? 'experience' : 'curated',
        title: String(it.title).trim(),
        district: String(it.district || '').trim(),
        subject_name: String(it.subject_name || '').trim(),
        qa_list: it.qa_list.map((x) => ({
          q: String(x.q || '').trim(),
          a: String(x.a || '').trim(),
        })),
      };
    });

    const { error } = await sb.from('viva_items').insert(rows);
    if (error) throw error;
    e.target.reset();
    state.showBulk.viva = false;
    showToast(`${rows.length}টি ভাইভা সেট সেভ হয়েছে!`);
    await loadVivaItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function generateCuratedVivaAI() {
  if (state.saving) return;
  state.saving = true;
  showToast('AI দিয়ে বোর্ড-স্ট্যান্ডার্ড ভাইভা সেট তৈরি হচ্ছে...');
  try {
    const existingTitles = state.vivaItems
      .filter((v) => v.viva_type === 'curated' || (v.is_public && v.viva_type === 'general'))
      .map((v) => v.title);

    const res = await callAI('viva_curated', {
      viva_type: 'BCS / Bank / Primary Board Standard',
      existingTitles,
    });

    if (!res?.title || !Array.isArray(res?.qa_list) || !res.qa_list.length) {
      throw new Error('AI থেকে সঠিক ভাইভা সেট পাওয়া যায়নি।');
    }

    const { error } = await sb.from('viva_items').insert({
      user_id: state.user.id,
      is_public: true,
      viva_type: 'curated',
      title: String(res.title).trim(),
      qa_list: res.qa_list,
    });
    if (error) throw error;
    showToast('নতুন AI ভাইভা সাজেশন যুক্ত হয়েছে!');
    await loadVivaItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

// ==========================================
// 2. Custom AI Viva (Student: District & Subject)
// ==========================================
async function generateCustomVivaAI(e) {
  e.preventDefault();
  if (state.saving) return;

  const district = e.target.district.value.trim();
  const subject_name = e.target.subject_name.value.trim();
  const target_job = e.target.target_job.value;

  if (!district || !subject_name) {
    return showToast('আপনার নিজ জেলা এবং পড়াশোনার বিষয় লিখুন।', true);
  }

  state.saving = true;
  render();
  showToast('আপনার জেলা ও বিষয়ের ওপর কাস্টম ভাইভা তৈরি হচ্ছে...');

  try {
    const res = await callAI('viva', { district, subject_name, target_job });
    if (!res?.title || !Array.isArray(res?.qa_list) || !res.qa_list.length) {
      throw new Error('AI থেকে সঠিক উত্তর পাওয়া যায়নি, আবার চেষ্টা করুন।');
    }

    const { data, error } = await sb
      .from('viva_items')
      .insert({
        user_id: state.user.id,
        is_public: false,
        viva_type: 'custom',
        title: String(res.title).trim(),
        district,
        subject_name,
        qa_list: res.qa_list,
      })
      .select()
      .single();

    if (error) throw error;
    e.target.reset();
    showToast('আপনার কাস্টম ভাইভা সেট তৈরি ও সেভ হয়েছে!');
    await loadVivaItems();
    if (data?.id) openVivaReader(data.id);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
    render();
  }
}

// ==========================================
// 3. Real Viva Experience (Submit & Admin Approve)
// ==========================================
async function submitVivaExperience(e) {
  e.preventDefault();
  if (state.saving) return;
  state.saving = true;
  try {
    const f = e.target;
    const title = f.title.value.trim();
    const district = f.district.value.trim();
    const subject_name = f.subject_name.value.trim();
    const qa_list = parseVivaQALines(f.qa_lines.value);

    if (!title || !qa_list.length) {
      throw new Error('পরীক্ষার নাম ও কমপক্ষে ১টি প্রশ্নোত্তর/অভিজ্ঞতা লিখুন।');
    }

    const autoApprove = isAdminUser();
    const { error } = await sb.from('viva_items').insert({
      user_id: state.user.id,
      is_public: autoApprove,
      viva_type: 'experience',
      title,
      district,
      subject_name,
      qa_list,
    });
    if (error) throw error;

    e.target.reset();
    showExpForm = false;
    showToast(
      autoApprove
        ? 'ভাইভা অভিজ্ঞতা পাবলিশ হয়েছে!'
        : 'ধন্যবাদ! আপনার অভিজ্ঞতা জমা হয়েছে। অ্যাডমিন অ্যাপ্রুভ করলেই সবাই দেখতে পাবে।'
    );
    await loadVivaItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function approveVivaExperience(id) {
  if (!isAdminUser()) return;
  const { error } = await sb.from('viva_items').update({ is_public: true }).eq('id', id);
  if (error) return showToast(error.message, true);
  showToast('✅ ভাইভা অভিজ্ঞতা সবার জন্য পাবলিশ করা হয়েছে!');
  await loadVivaItems();
}

// ==========================================
// Render Viva View
// ==========================================
function renderViva() {
  const isAdmin = isAdminUser();
  const isPro = isProUser();
  const sub = state.vivaSubTab || 'curated';

  // রিডার ভিউ
  if (vivaReadingId !== null) {
    const item = state.vivaItems.find((v) => Number(v.id) === Number(vivaReadingId));
    if (!item) {
      vivaReadingId = null;
    } else {
      const qaList = Array.isArray(item.qa_list) ? item.qa_list : [];
      const canDelete = isAdmin || item.user_id === state.user.id;
      return `
        <div class="space-y-4">
          <div class="flex justify-between items-center gap-2">
            <button onclick="closeVivaReader()" class="text-xs font-bold text-teal-700 dark:text-teal-400">← ভাইভা তালিকায় ফিরুন</button>
            <div class="flex items-center gap-1.5">
              ${isAdmin && item.viva_type === 'experience' && !item.is_public ? `
                <button onclick="approveVivaExperience(${item.id})" class="px-2.5 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg">✅ পাবলিশ</button>` : ''}
              ${canDelete ? `
                <button onclick="deleteItem('viva_items','${item.id}',()=>{vivaReadingId=null;return loadVivaItems()})" class="px-2.5 py-1.5 bg-rose-50 dark:bg-rose-950/50 text-rose-600 text-xs font-bold rounded-lg">🗑️ ডিলিট</button>` : ''}
            </div>
          </div>

          <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-2">
            <div class="flex flex-wrap gap-1.5">
              ${item.district ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 font-bold">📍 ${escHtml(item.district)}</span>` : ''}
              ${item.subject_name ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 font-bold">🎓 ${escHtml(item.subject_name)}</span>` : ''}
              ${item.viva_type === 'experience' && !item.is_public ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">⏳ Pending Approval</span>` : ''}
            </div>
            <h1 class="font-bold text-lg leading-snug">${escHtml(item.title)}</h1>
          </div>

          <div class="space-y-3">
            ${qaList.map((qa, i) => `
              <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-2">
                <p class="font-bold text-sm text-teal-700 dark:text-teal-300">প্রশ্ন ${i + 1}: ${escHtml(qa.q || '')}</p>
                <div class="text-xs sm:text-sm leading-relaxed whitespace-pre-line text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800/70 p-3 rounded-xl">
                  ${escHtml(qa.a || '')}
                </div>
              </div>
            `).join('')}
          </div>
        </div>`;
    }
  }

  // ৩টি ট্যাবের জন্য ডেটা আলাদা করা
  const curatedAll = state.vivaItems.filter(
    (v) => v.is_public && (v.viva_type === 'curated' || v.viva_type === 'general')
  );
  const customAll = state.vivaItems.filter(
    (v) => v.viva_type === 'custom' && v.user_id === state.user.id
  );
  const expAll = state.vivaItems.filter((v) => v.viva_type === 'experience');
  const pendingExpCount = expAll.filter((v) => !v.is_public).length;

  const q = normText(vivaSearch);
  const filterBySearch = (list) =>
    !q ? list : list.filter((v) => normText(`${v.title} ${v.district} ${v.subject_name}`).includes(q));

  const curatedVisible = isPro ? filterBySearch(curatedAll) : filterBySearch(curatedAll).slice(0, FREE_LIMITS.vivaCurated);
  const curatedLocked = !isPro ? Math.max(0, curatedAll.length - FREE_LIMITS.vivaCurated) : 0;
  const customVisible = filterBySearch(customAll);
  const expVisible = filterBySearch(expAll);

  return `
    <div class="space-y-4">
      <!-- ৩টি ট্যাব সুইচার -->
      <div class="grid grid-cols-3 bg-slate-200/70 dark:bg-slate-800 p-1 rounded-xl gap-1">
        <button onclick="switchVivaSubTab('curated')"
          class="py-2 text-xs font-bold rounded-lg transition ${sub === 'curated' ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'}">
          🎯 সাজেশন
        </button>
        <button onclick="switchVivaSubTab('custom')"
          class="py-2 text-xs font-bold rounded-lg transition ${sub === 'custom' ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'}">
          🤖 কাস্টম AI
        </button>
        <button onclick="switchVivaSubTab('experience')"
          class="py-2 text-xs font-bold rounded-lg transition relative ${sub === 'experience' ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'}">
          🗣️ অভিজ্ঞতা ${isAdmin && pendingExpCount > 0 ? `<span class="ml-0.5 px-1.5 py-0.5 bg-rose-500 text-white rounded-full text-[9px]">${pendingExpCount}</span>` : ''}
        </button>
      </div>

      <!-- ট্যাব ১: বোর্ড সাজেশন -->
      ${sub === 'curated' ? `
        ${isAdmin ? `
          <div class="flex flex-wrap justify-between items-center gap-2">
            <h2 class="font-bold text-sm">বোর্ড সাজেশন সেট (${curatedAll.length}টি)</h2>
            <div class="flex gap-1.5">
              <button onclick="showAddVivaForm=!showAddVivaForm;state.showBulk.viva=false;render()" class="px-2.5 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg">+ সেট</button>
              <button onclick="toggleBulk('viva')" class="px-2.5 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-lg">📋 JSON</button>
              <button onclick="generateCuratedVivaAI()" ${state.saving ? 'disabled' : ''} class="px-2.5 py-1.5 bg-teal-600 text-white text-xs font-bold rounded-lg disabled:opacity-50">+১ AI</button>
            </div>
          </div>` : ''}

        ${isAdmin && showAddVivaForm ? `
          <form onsubmit="saveManualCuratedViva(event)" class="bg-indigo-50 dark:bg-slate-900 border border-indigo-200 dark:border-slate-700 p-4 rounded-2xl space-y-2.5">
            <div class="flex justify-between items-center">
              <p class="text-xs font-bold text-indigo-900 dark:text-indigo-300">✍️ নতুন বোর্ড সাজেশন সেট</p>
              <button type="button" onclick="showAddVivaForm=false;render()" class="text-xs text-slate-500 font-bold">বন্ধ ✕</button>
            </div>
            <input name="title" required placeholder="সেটের শিরোনাম (যেমন: বিসিএস সংবিধান ও মুক্তিযুদ্ধ)" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            <textarea name="qa_lines" required rows="5" placeholder="প্রতি লাইনে লিখুন: প্রশ্ন | উত্তর&#10;যেমন: সংবিধানের কত অনুচ্ছেদে মৌলিক অধিকার আছে? | ২৭ থেকে ৪৪ নং অনুচ্ছেদে।" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl"></textarea>
            <button type="submit" class="w-full py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl">সেভ করুন</button>
          </form>` : ''}

        ${isAdmin && state.showBulk.viva ? `
          <form onsubmit="importVivaJSON(event)" class="bg-slate-900 text-white p-4 rounded-2xl space-y-2.5">
            <div class="flex justify-between items-center">
              <p class="text-xs font-bold text-teal-300">📋 ভাইভা বাল্ক JSON পেস্ট করুন</p>
              <button type="button" onclick="toggleBulk('viva')" class="text-xs text-slate-400">বন্ধ ✕</button>
            </div>
            <textarea name="json_data" required rows="5" placeholder='[{"title":"ব্যাংক ভাইভা স্পেশাল","qa_list":[{"q":"মুদ্রাস্ফীতি কী?","a":"..."}]}]' class="w-full p-3 text-xs font-mono text-slate-900 bg-white rounded-xl"></textarea>
            <button type="submit" class="w-full py-2.5 bg-teal-500 text-slate-950 text-xs font-bold rounded-xl">সেভ করুন</button>
          </form>` : ''}

        ${state.loading ? `<p class="text-center text-xs text-slate-500 py-6">লোড হচ্ছে...</p>` : ''}
        ${!state.loading && curatedVisible.length === 0 ? `<div class="bg-white dark:bg-slate-900 p-6 rounded-xl text-center text-sm text-slate-500">এখনো কোনো ভাইভা সাজেশন সেট যুক্ত হয়নি।</div>` : ''}

        <div class="space-y-3">
          ${curatedVisible.map((v) => `
            <div onclick="openVivaReader(${v.id})" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex justify-between items-center gap-2 cursor-pointer">
              <div>
                <h3 class="font-bold text-sm">${escHtml(v.title)}</h3>
                <p class="text-[11px] text-slate-400 mt-0.5">${(v.qa_list || []).length}টি বোর্ড প্রশ্ন ও স্মার্ট উত্তর</p>
              </div>
              <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400 shrink-0"></i>
            </div>
          `).join('')}
        </div>

        ${curatedLocked > 0 ? renderProLockCard(`আরও ${curatedLocked}টি গুরুত্বপূর্ণ ভাইভা সাজেশন সেট রয়েছে। সব সেট ও আনলিমিটেড কাস্টম AI ভাইভা পেতে Pro চালু করুন।`) : ''}
      ` : ''}

      <!-- ট্যাব ২: কাস্টম AI ভাইভা -->
      ${sub === 'custom' ? `
        <form onsubmit="generateCustomVivaAI(event)" class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-indigo-100 dark:border-slate-800 shadow-sm space-y-3.5">
          <div class="flex items-center gap-3">
            <div class="w-10 h-10 rounded-xl bg-indigo-600 text-white flex items-center justify-center text-lg">🤖</div>
            <div>
              <h2 class="font-bold text-sm">নিজের জেলা ও বিষয়ভিত্তিক AI ভাইভা</h2>
              <p class="text-[11px] text-slate-500 dark:text-slate-400">${isPro ? 'Pro: আনলিমিটেড কাস্টম সেট' : 'ফ্রি: দিনে ১টি কাস্টম সেট'}</p>
            </div>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <input name="district" required placeholder="আপনার নিজ জেলা (যেমন: দিনাজপুর)" class="w-full px-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl" />
            <input name="subject_name" required placeholder="অনার্স/পড়াশোনার বিষয় (যেমন: কৃষি / অর্থনীতি)" class="w-full px-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl" />
          </div>

          <select name="target_job" class="w-full px-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
            <option value="বিসিএস (BCS)">বিসিএস (BCS ক্যাডার)</option>
            <option value="সরকারি ব্যাংক (Bank Officer)">সরকারি ও সমন্বিত ব্যাংক (Officer)</option>
            <option value="প্রাথমিক সহকারী শিক্ষক (Primary)">প্রাথমিক সহকারী শিক্ষক (Primary)</option>
            <option value="অন্যান্য সরকারি চাকরি">অন্যান্য সরকারি চাকরি</option>
          </select>

          <button type="submit" ${state.saving ? 'disabled' : ''} class="w-full py-3 bg-indigo-600 text-white text-xs font-bold rounded-xl shadow-md disabled:opacity-60">
            ${state.saving ? 'AI প্রশ্নোত্তর তৈরি করছে...' : '✨ আমার কাস্টম ভাইভা তৈরি করুন'}
          </button>
        </form>

        <h3 class="font-bold text-xs text-slate-500 pt-1">আমার তৈরি করা কাস্টম সেট (${customVisible.length}টি)</h3>
        <div class="space-y-2.5">
          ${customVisible.length === 0 ? `<p class="text-center text-xs text-slate-500 py-5 bg-white dark:bg-slate-900 rounded-xl">এখনো কোনো কাস্টম ভাইভা তৈরি করেননি। ওপরের ফর্ম থেকে তৈরি করুন!</p>` : ''}
          ${customVisible.map((v) => `
            <div onclick="openVivaReader(${v.id})" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm flex justify-between items-center gap-2 cursor-pointer">
              <div>
                <h4 class="font-bold text-sm">${escHtml(v.title)}</h4>
                <p class="text-[11px] text-slate-400 mt-0.5">${formatDateBD(v.created_at)} • ${(v.qa_list || []).length}টি প্রশ্ন</p>
              </div>
              <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400 shrink-0"></i>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- ট্যাব ৩: রিয়েল ভাইভা অভিজ্ঞতা -->
      ${sub === 'experience' ? `
        <div class="flex justify-between items-center gap-2">
          <h2 class="font-bold text-sm">বোর্ডের আসল ভাইভা অভিজ্ঞতা (${expVisible.length}টি)</h2>
          <button onclick="showExpForm=!showExpForm;render()" class="px-3 py-1.5 bg-teal-600 text-white text-xs font-bold rounded-lg shadow-sm">
            ${showExpForm ? '✕ বন্ধ' : '+ অভিজ্ঞতা শেয়ার করুন'}
          </button>
        </div>

        ${showExpForm ? `
          <form onsubmit="submitVivaExperience(event)" class="bg-teal-50 dark:bg-slate-900 border border-teal-200 dark:border-slate-700 p-4 rounded-2xl space-y-2.5">
            <p class="text-xs font-bold text-teal-900 dark:text-teal-300">🗣️ আপনার ভাইভা অভিজ্ঞতা অন্যদের সাথে শেয়ার করুন</p>
            <input name="title" required placeholder="পরীক্ষার নাম (যেমন: ৪৬তম বিসিএস / সোনালী ব্যাংক ভাইভা)" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            <div class="grid grid-cols-2 gap-2">
              <input name="district" placeholder="জেলা (যেমন: দিনাজপুর)" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
              <input name="subject_name" placeholder="বিষয় (যেমন: ইংরেজি)" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            </div>
            <textarea name="qa_lines" required rows="5" placeholder="প্রতি লাইনে লিখুন: বোর্ডের প্রশ্ন | আপনার উত্তর&#10;যেমন: আপনার জেলার বিখ্যাত কী? | লিচু ও কাটারিভোগ চাল।" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl"></textarea>
            <button type="submit" ${state.saving ? 'disabled' : ''} class="w-full py-2.5 bg-teal-600 text-white text-xs font-bold rounded-xl">অভিজ্ঞতা জমা দিন</button>
          </form>` : ''}

        ${expVisible.length === 0 ? `<div class="bg-white dark:bg-slate-900 p-6 rounded-xl text-center text-sm text-slate-500">এখনো কোনো ভাইভা অভিজ্ঞতা শেয়ার করা হয়নি। প্রথম অভিজ্ঞতাটি আপনিই শেয়ার করুন!</div>` : ''}

        <div class="space-y-3">
          ${expVisible.map((v) => `
            <div onclick="openVivaReader(${v.id})" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border ${!v.is_public ? 'border-amber-300 dark:border-amber-700' : 'border-slate-100 dark:border-slate-800'} shadow-sm space-y-2 cursor-pointer">
              <div class="flex justify-between items-start gap-2">
                <div class="flex flex-wrap gap-1">
                  ${!v.is_public ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 font-bold">⏳ Pending</span>` : ''}
                  ${v.district ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 font-bold">📍 ${escHtml(v.district)}</span>` : ''}
                  ${v.subject_name ? `<span class="text-[10px] px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-semibold">🎓 ${escHtml(v.subject_name)}</span>` : ''}
                </div>
                ${isAdmin && !v.is_public ? `
                  <button onclick="event.stopPropagation();approveVivaExperience(${v.id})" class="px-2.5 py-1 bg-emerald-600 text-white text-[11px] font-bold rounded-lg shrink-0">✅ পাবলিশ</button>` : ''}
              </div>
              <h3 class="font-bold text-sm">${escHtml(v.title)}</h3>
              <p class="text-[11px] text-slate-400">${(v.qa_list || []).length}টি প্রশ্নোত্তর • পড়তে ট্যাপ করুন →</p>
            </div>
          `).join('')}
        </div>
      ` : ''}
    </div>`;
}