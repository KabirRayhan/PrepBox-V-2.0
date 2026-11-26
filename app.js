// ==========================================
// PrepBox BD V2 — Main App Shell, Home, Profile, Payments & Bootstrap
// ==========================================

let selectedPlanId = PAYMENT_CONFIG.plans[0]?.id || 'monthly';
let showProfileEditForm = false;

// ==========================================
// Navigation & Tab Data Loader
// ==========================================
async function setTab(tabName) {
  if (state.tab === tabName) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    return;
  }

  // চলমান পরীক্ষা চলাকালীন অন্য ট্যাবে গেলে কনফার্মেশন
  if (state.modelTestActive && !state.modelTestSubmitted) {
    if (typeof exitModelTest === 'function') {
      const confirmed = exitModelTest(false);
      if (!confirmed) return;
    }
  }

  state.tab = tabName;
  state.editing = null;
  if (tabName !== 'live') state.selectedLiveLeaderboardId = null;

  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
  verifyActiveSession();

  try {
    if (tabName === 'live' && typeof loadLiveExams === 'function') {
      await loadLiveExams();
    } else if (tabName === 'vocab' && state.vocabItems.length === 0 && typeof loadVocabItems === 'function') {
      await loadVocabItems();
    } else if (tabName === 'columns' && state.columnItems.length === 0 && typeof loadColumnItems === 'function') {
      await loadColumnItems();
    } else if (tabName === 'viva' && state.vivaItems.length === 0 && typeof loadVivaItems === 'function') {
      await loadVivaItems();
    } else if (tabName === 'profile') {
      await loadProfileExtras();
    } else if (tabName === 'admin' && typeof loadAdminData === 'function') {
      await loadAdminData();
    } else if (tabName === 'home') {
      await loadMyRecentResults();
    }
  } catch (err) {
    showToast(err.message, true);
  }
}

async function loadMyRecentResults() {
  if (!state.user) return;
  const { data } = await sb
    .from('exam_results')
    .select('*')
    .eq('user_id', state.user.id)
    .order('created_at', { ascending: false })
    .limit(10);
  state.myRecentResults = data || [];
  render();
}

async function loadProfileExtras() {
  if (!state.user) return;
  state.loading = true;
  render();
  try {
    const [payRes, resRes] = await Promise.all([
      sb.from('payment_requests').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(15),
      sb.from('exam_results').select('*').eq('user_id', state.user.id).order('created_at', { ascending: false }).limit(10),
    ]);
    state.myPayments = payRes.data || [];
    state.myRecentResults = resRes.data || [];
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

// ==========================================
// Profile Update & bKash/Nagad Payment Request
// ==========================================
async function updateOwnProfile(e) {
  e.preventDefault();
  if (state.saving) return;

  const full_name = e.target.full_name.value.trim();
  const phone = e.target.phone.value.trim();
  if (!full_name) return showToast('আপনার নাম লিখুন।', true);

  state.saving = true;
  render();
  try {
    const { error } = await sb
      .from('profiles')
      .update({ full_name, phone })
      .eq('id', state.user.id);
    if (error) throw error;
    state.profile.full_name = full_name;
    state.profile.phone = phone;
    showProfileEditForm = false;
    showToast('✅ প্রোফাইল আপডেট হয়েছে!');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
    render();
  }
}

function selectPaymentPlan(planId) {
  selectedPlanId = planId;
  render();
}

async function submitPaymentRequest(e) {
  e.preventDefault();
  if (state.saving) return;

  const plan = PAYMENT_CONFIG.plans.find((p) => p.id === selectedPlanId) || PAYMENT_CONFIG.plans[0];
  const method = e.target.method.value;
  const sender_number = e.target.sender_number.value.trim();
  const trx_id = e.target.trx_id.value.trim().toUpperCase();

  if (!/^01\d{9}$/.test(sender_number)) {
    return showToast('সঠিক ১১ সংখ্যার মোবাইল নম্বর দিন (যেমন: 017XXXXXXXX)।', true);
  }
  if (trx_id.length < 6) {
    return showToast('সঠিক Transaction ID (TrxID) লিখুন।', true);
  }

  state.saving = true;
  render();
  try {
    const { error } = await sb.from('payment_requests').insert({
      user_id: state.user.id,
      user_email: state.profile?.email || state.user.email || '',
      plan_name: plan.name,
      plan_days: plan.days,
      amount: plan.amount,
      method,
      sender_number,
      trx_id,
    });

    if (error) {
      if (error.code === '23505') {
        throw new Error('এই TrxID দিয়ে আগেই পেমেন্ট রিকোয়েস্ট পাঠানো হয়েছে!');
      }
      throw error;
    }

    e.target.reset();
    showToast('✅ পেমেন্ট রিকোয়েস্ট জমা হয়েছে! যাচাই করে দ্রুত Pro চালু করা হবে।');
    await loadProfileExtras();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
    render();
  }
}

function shareReferralWhatsApp() {
  const code = state.profile?.referral_code || '';
  const link = `${window.location.origin}/?ref=${encodeURIComponent(code)}`;
  const text = `বিসিএস, ব্যাংক ও প্রাইমারি চাকরির স্মার্ট প্রস্তুতি নিন PrepBox BD-তে! আমার রেফারাল লিংক দিয়ে ফ্রি অ্যাকাউন্ট খুলুন: ${link}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
}

// ==========================================
// Home Dashboard View
// ==========================================
function renderHome() {
  const isPro = isProUser();
  const isAdmin = isAdminUser();
  const name = state.profile?.full_name || 'Student';
  const streak = state.profile?.streak_days || 1;
  const totalBookmarks =
    (state.bookmarks.preli?.length || 0) +
    (state.bookmarks.written?.length || 0) +
    (state.bookmarks.vocab?.length || 0) +
    (state.bookmarks.column?.length || 0);

  // চলমান বা আসন্ন লাইভ এক্সাম খোঁজা
  const activeLive = (state.liveExams || []).find(
    (ex) => typeof getLiveExamStatus === 'function' && getLiveExamStatus(ex) === 'live'
  );
  const upcomingLive = !activeLive
    ? (state.liveExams || []).find(
        (ex) => typeof getLiveExamStatus === 'function' && getLiveExamStatus(ex) === 'upcoming'
      )
    : null;
  const featuredLive = activeLive || upcomingLive;

  const filters = [
    { id: 'ALL', label: 'সব লক্ষ্য' },
    { id: 'BCS', label: '🏛️ বিসিএস' },
    { id: 'Bank', label: '🏦 ব্যাংক' },
    { id: 'Primary', label: '🏫 প্রাইমারি' },
  ];

  const recentThree = (state.myRecentResults || []).slice(0, 3);

  return `
    <div class="space-y-4">
      <!-- স্বাগতম হিরো কার্ড -->
      <div class="bg-gradient-to-br from-teal-700 via-teal-800 to-slate-900 text-white p-5 rounded-3xl shadow-lg space-y-3.5">
        <div class="flex justify-between items-start gap-2">
          <div>
            <p class="text-xs text-teal-200 font-medium">আসসালামু আলাইকুম,</p>
            <h1 class="text-xl font-bold leading-tight mt-0.5">${escHtml(name)}</h1>
          </div>
          <div class="flex flex-col items-end gap-1 shrink-0">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-bold ${isPro ? 'bg-amber-400 text-slate-950' : 'bg-white/20 text-white'}">
              ${isAdmin ? '🛡️ ADMIN' : isPro ? `👑 PRO (${getProDaysLeft()} দিন)` : 'FREE PLAN'}
            </span>
            <span class="text-xs font-bold text-amber-300">🔥 ${streak} দিন স্ট্রিক</span>
          </div>
        </div>

        <!-- পরীক্ষার লক্ষ্য নির্বাচন -->
        <div class="flex gap-1.5 overflow-x-auto no-scrollbar pt-1">
          ${filters.map((f) => `
            <button onclick="setExamFilter('${f.id}')"
              class="px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition ${
                state.examFilter === f.id
                  ? 'bg-white text-teal-900 shadow-sm'
                  : 'bg-white/15 text-teal-100 hover:bg-white/25'
              }">${f.label}</button>
          `).join('')}
        </div>
      </div>

      <!-- PWA অ্যাপ ইনস্টল ব্যানার -->
      ${window.__deferredInstallPrompt ? `
        <div class="bg-indigo-600 text-white p-3.5 rounded-2xl shadow-sm flex justify-between items-center gap-3">
          <div class="text-xs">
            <p class="font-bold">📲 ফোনে অ্যাপ হিসেবে ইনস্টল করুন</p>
            <p class="text-indigo-100 text-[11px]">প্লে-স্টোর ছাড়াই ১ ক্লিকে হোম স্ক্রিনে পাবেন</p>
          </div>
          <button onclick="triggerInstallPWA()" class="px-3 py-1.5 bg-white text-indigo-700 text-xs font-bold rounded-xl shrink-0">ইনস্টল</button>
        </div>` : ''}

      <!-- অ্যাডমিন নোটিশ বোর্ড -->
      ${state.notices.length > 0 ? `
        <div class="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 p-3.5 rounded-2xl space-y-1.5">
          <p class="text-[11px] font-bold text-amber-800 dark:text-amber-300">📢 জরুরি নোটিশ</p>
          ${state.notices.slice(0, 2).map((n) => `
            <div class="text-xs">
              <p class="font-bold text-slate-900 dark:text-white">${escHtml(n.title)}</p>
              <p class="text-slate-600 dark:text-slate-300 text-[11px]">${escHtml(n.body)}</p>
            </div>
          `).join('')}
        </div>` : ''}

      <!-- লাইভ এক্সাম অ্যালার্ট কার্ড -->
      ${featuredLive ? `
        <div onclick="setTab('live')" class="p-4 rounded-2xl border shadow-sm cursor-pointer flex justify-between items-center gap-3 ${
          activeLive
            ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-300 dark:border-rose-800'
            : 'bg-indigo-50 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800'
        }">
          <div class="min-w-0">
            <span class="text-[10px] font-bold uppercase ${activeLive ? 'text-rose-600 animate-pulse' : 'text-indigo-600 dark:text-indigo-300'}">
              ${activeLive ? '🔴 লাইভ পরীক্ষা চলছে!' : '⏳ আসন্ন লাইভ পরীক্ষা'}
            </span>
            <h3 class="font-bold text-sm truncate mt-0.5">${escHtml(featuredLive.title)}</h3>
            <p class="text-[11px] text-slate-500 dark:text-slate-400">
              ${activeLive ? `শেষ হবে: ${formatDateBD(featuredLive.end_time)}` : `শুরু: ${formatDateBD(featuredLive.start_time)}`}
            </p>
          </div>
          <span class="px-3 py-1.5 rounded-xl text-xs font-bold shrink-0 ${activeLive ? 'bg-rose-600 text-white' : 'bg-indigo-600 text-white'}">
            ${activeLive ? 'অংশ নিন →' : 'রুটিন →'}
          </span>
        </div>` : ''}

      <!-- কুইক স্ট্যাটস -->
      <div class="grid grid-cols-3 gap-2.5">
        <button onclick="setTab('preli');openPreliSpecial('mistakes')" class="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
          <p class="text-lg font-bold text-rose-600">${state.mistakes.length}</p>
          <p class="text-[11px] text-slate-500 font-semibold">ভুলের ঝুড়ি</p>
        </button>
        <button onclick="setTab('preli');openPreliSpecial('bookmarks')" class="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
          <p class="text-lg font-bold text-amber-500">${totalBookmarks}</p>
          <p class="text-[11px] text-slate-500 font-semibold">মোট বুকমার্ক</p>
        </button>
        <button onclick="setTab('profile')" class="bg-white dark:bg-slate-900 p-3 rounded-2xl border border-slate-100 dark:border-slate-800 text-center">
          <p class="text-lg font-bold text-teal-600">${state.myRecentResults.length}</p>
          <p class="text-[11px] text-slate-500 font-semibold">দেওয়া টেস্ট</p>
        </button>
      </div>

      <!-- ৬টি মূল লার্নিং মডিউল -->
      <div>
        <h2 class="font-bold text-sm mb-2.5">📚 প্রস্তুতির সব মডিউল</h2>
        <div class="grid grid-cols-2 gap-3">
          <button onclick="setTab('preli')" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm text-left space-y-1.5">
            <span class="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 flex items-center justify-center text-lg">📘</span>
            <p class="font-bold text-sm">প্রিলি প্রশ্নব্যাংক</p>
            <p class="text-[11px] text-slate-500">বিষয়, টপিক ও VVI ব্যাখ্যা</p>
          </button>

          <button onclick="setTab('preli');openMixedTestSetup()" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm text-left space-y-1.5">
            <span class="w-9 h-9 rounded-xl bg-indigo-50 dark:bg-indigo-950 text-indigo-700 dark:text-indigo-300 flex items-center justify-center text-lg">🎯</span>
            <p class="font-bold text-sm">মডেল টেস্ট</p>
            <p class="text-[11px] text-slate-500">২৫–২০০ প্রশ্নের লাইভ টেস্ট</p>
          </button>

          <button onclick="setTab('written')" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm text-left space-y-1.5">
            <span class="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 flex items-center justify-center text-lg">✍️</span>
            <p class="font-bold text-sm">রিটেন স্টুডিও</p>
            <p class="text-[11px] text-slate-500">বিসিএস ও ব্যাংক লিখিত নোট</p>
          </button>

          <button onclick="setTab('vocab')" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm text-left space-y-1.5">
            <span class="w-9 h-9 rounded-xl bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-300 flex items-center justify-center text-lg">🃏</span>
            <p class="font-bold text-sm">Magoosh ভোকাব</p>
            <p class="text-[11px] text-slate-500">ফ্ল্যাশকার্ড, অডিও ও কুইজ</p>
          </button>

          <button onclick="setTab('columns')" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm text-left space-y-1.5">
            <span class="w-9 h-9 rounded-xl bg-sky-50 dark:bg-sky-950 text-sky-700 dark:text-sky-300 flex items-center justify-center text-lg">📰</span>
            <p class="font-bold text-sm">সম্পাদকীয় ও সাম্প্রতিক</p>
            <p class="text-[11px] text-slate-500">বাংলা-ইংরেজি কলাম ও অনুবাদ</p>
          </button>

          <button onclick="setTab('viva')" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm text-left space-y-1.5">
            <span class="w-9 h-9 rounded-xl bg-purple-50 dark:bg-purple-950 text-purple-700 dark:text-purple-300 flex items-center justify-center text-lg">🎙️</span>
            <p class="font-bold text-sm">ভাইভা বোর্ড</p>
            <p class="text-[11px] text-slate-500">কাস্টম AI ও আসল অভিজ্ঞতা</p>
          </button>
        </div>
      </div>

      <!-- সাম্প্রতিক পরীক্ষার ফলাফল -->
      ${recentThree.length > 0 ? `
        <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2.5">
          <div class="flex justify-between items-center">
            <h3 class="font-bold text-xs text-slate-700 dark:text-slate-300">📈 সাম্প্রতিক মডেল টেস্ট স্কোর</h3>
            <button onclick="setTab('profile')" class="text-[11px] font-bold text-teal-600">সব দেখুন →</button>
          </div>
          ${recentThree.map((r) => `
            <div class="flex justify-between items-center text-xs py-1.5 border-b last:border-0 border-slate-100 dark:border-slate-800 gap-2">
              <div class="min-w-0">
                <p class="font-semibold truncate">${escHtml(r.exam_title)}</p>
                <p class="text-[10px] text-slate-400">✓ ${r.correct_count} • ✕ ${r.wrong_count} • ${formatDateBD(r.created_at)}</p>
              </div>
              <span class="font-bold text-teal-700 dark:text-teal-300 shrink-0">${Number(r.net_score).toFixed(2)}/${r.total_questions}</span>
            </div>
          `).join('')}
        </div>` : ''}

      <!-- ফ্রি Pro রেফারাল কার্ড -->
      <div class="bg-gradient-to-r from-amber-50 to-teal-50 dark:from-slate-900 dark:to-slate-900 border border-amber-200 dark:border-slate-700 p-4 rounded-2xl flex justify-between items-center gap-3">
        <div>
          <p class="font-bold text-xs text-slate-900 dark:text-white">🎁 বন্ধুকে আমন্ত্রণ জানান, ৩ দিন ফ্রি Pro পান!</p>
          <p class="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">আপনার কোড: <b class="font-mono text-teal-700 dark:text-teal-300">${escHtml(state.profile?.referral_code || '')}</b></p>
        </div>
        <button onclick="setTab('profile')" class="px-3 py-1.5 bg-teal-600 text-white text-xs font-bold rounded-xl shrink-0">শেয়ার</button>
      </div>
    </div>`;
}

// ==========================================
// Profile, Referral & Pro Subscription View
// ==========================================
function renderProfile() {
  const isPro = isProUser();
  const isAdmin = isAdminUser();
  const prof = state.profile || {};
  const refCode = prof.referral_code || '';
  const refLink = `${window.location.origin}/?ref=${refCode}`;
  const selectedPlan = PAYMENT_CONFIG.plans.find((p) => p.id === selectedPlanId) || PAYMENT_CONFIG.plans[0];

  return `
    <div class="space-y-4">
      <!-- ইউজার প্রোফাইল কার্ড -->
      <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-3">
        <div class="flex justify-between items-start gap-2">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-12 h-12 rounded-2xl bg-teal-600 text-white flex items-center justify-center font-bold text-xl shrink-0">
              ${escHtml((prof.full_name || 'S').charAt(0).toUpperCase())}
            </div>
            <div class="min-w-0">
              <h2 class="font-bold text-base truncate">${escHtml(prof.full_name || 'Student')}</h2>
              <p class="text-xs text-slate-500 truncate">${escHtml(prof.email || '')}</p>
              ${prof.phone ? `<p class="text-[11px] text-slate-400">📞 ${escHtml(prof.phone)}</p>` : ''}
            </div>
          </div>
          <button onclick="showProfileEditForm=!showProfileEditForm;render()" class="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-xs font-bold rounded-lg shrink-0">✏️ এডিট</button>
        </div>

        <div class="flex flex-wrap gap-2 pt-1">
          <span class="px-2.5 py-1 rounded-full text-xs font-bold ${isPro ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'}">
            ${isAdmin ? '🛡️ Admin Account' : isPro ? `👑 Pro Active (${getProDaysLeft()} দিন বাকি)` : '🆓 Free Account'}
          </span>
          <span class="px-2.5 py-1 rounded-full text-xs font-bold bg-orange-50 dark:bg-orange-950/50 text-orange-700 dark:text-orange-300">
            🔥 ${prof.streak_days || 1} দিন স্ট্রিক
          </span>
        </div>

        ${isPro && !isAdmin && prof.pro_expires_at ? `
          <p class="text-[11px] text-slate-500">Pro মেয়াদ শেষ হবে: <b>${formatDateBD(prof.pro_expires_at)}</b></p>` : ''}

        ${showProfileEditForm ? `
          <form onsubmit="updateOwnProfile(event)" class="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2.5">
            <input name="full_name" required value="${escHtml(prof.full_name || '')}" placeholder="আপনার পূর্ণ নাম" class="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl" />
            <input name="phone" value="${escHtml(prof.phone || '')}" placeholder="মোবাইল নম্বর (ঐচ্ছিক)" class="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl" />
            <div class="flex gap-2">
              <button type="submit" ${state.saving ? 'disabled' : ''} class="flex-1 py-2 bg-teal-600 text-white text-xs font-bold rounded-xl">সেভ করুন</button>
              <button type="button" onclick="showProfileEditForm=false;render()" class="px-3 py-2 bg-slate-200 dark:bg-slate-700 text-xs font-bold rounded-xl">বাতিল</button>
            </div>
          </form>` : ''}
      </div>

      <!-- রেফারাল ও ফ্রি Pro বোনাস কার্ড -->
      <div class="bg-gradient-to-br from-teal-700 to-emerald-800 text-white p-5 rounded-2xl shadow-md space-y-3">
        <div class="flex justify-between items-center">
          <h3 class="font-bold text-sm">🎁 রেফার করে ফ্রি Pro জিতুন</h3>
          <span class="px-2 py-0.5 bg-white/20 rounded-full text-[11px] font-bold">সফল রেফার: ${prof.referral_count || 0}/20</span>
        </div>
        <p class="text-xs text-teal-100">প্রতিটি বন্ধু আপনার লিংকে অ্যাকাউন্ট খুললেই আপনি অটোমেটিক <b>৩ দিন ফ্রি Pro</b> পাবেন!</p>
        <div class="bg-black/20 p-2.5 rounded-xl flex justify-between items-center gap-2">
          <code class="text-xs font-mono font-bold text-amber-300 truncate">${escHtml(refCode)}</code>
          <div class="flex gap-1.5 shrink-0">
            <button onclick="copyToClipboard('${escHtml(refLink)}','রেফারাল লিংক কপি হয়েছে!')" class="px-2.5 py-1 bg-white text-teal-900 text-[11px] font-bold rounded-lg">🔗 লিংক কপি</button>
            <button onclick="shareReferralWhatsApp()" class="px-2.5 py-1 bg-emerald-400 text-slate-950 text-[11px] font-bold rounded-lg">WhatsApp</button>
          </div>
        </div>
      </div>

      <!-- Pro সাবস্ক্রিপশন ও বিকাশ/নগদ পেমেন্ট ফর্ম -->
      ${!isAdmin ? `
        <div class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-amber-200 dark:border-amber-800 shadow-sm space-y-4">
          <div>
            <h3 class="font-bold text-base text-amber-700 dark:text-amber-300">👑 ${isPro ? 'Pro মেয়াদ বাড়ান' : 'PrepBox Pro আনলক করুন'}</h3>
            <p class="text-xs text-slate-500 mt-0.5">আনলিমিটেড প্রশ্নব্যাংক, ২০০ নম্বরের মডেল টেস্ট, সব রিটেন নোট, Magoosh ভোকাব, সম্পাদকীয় ও আনলিমিটেড কাস্টম AI ভাইভা!</p>
          </div>

          <!-- প্যাকেজ সিলেকশন -->
          <div class="grid grid-cols-3 gap-2">
            ${PAYMENT_CONFIG.plans.map((plan) => `
              <button type="button" onclick="selectPaymentPlan('${plan.id}')"
                class="p-2.5 rounded-xl border-2 text-center transition ${
                  selectedPlanId === plan.id
                    ? 'border-amber-500 bg-amber-50 dark:bg-amber-950/40'
                    : 'border-slate-200 dark:border-slate-700'
                }">
                <p class="text-[11px] font-bold">${escHtml(plan.name)}</p>
                <p class="text-base font-bold text-teal-700 dark:text-teal-300 mt-0.5">৳${plan.amount}</p>
              </button>
            `).join('')}
          </div>

          <!-- পেমেন্ট নম্বর বক্স -->
          <div class="bg-slate-50 dark:bg-slate-800 p-3.5 rounded-xl space-y-2 text-xs">
            <p class="font-bold text-slate-700 dark:text-slate-200">ধাপ ১: নিচের যেকোনো নম্বরে <b>৳${selectedPlan.amount}</b> Send Money করুন:</p>
            <div class="flex justify-between items-center bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
              <span><b class="text-pink-600">bKash (Personal):</b> ${escHtml(PAYMENT_CONFIG.bkash)}</span>
              <button type="button" onclick="copyToClipboard('${escHtml(PAYMENT_CONFIG.bkash)}','বিকাশ নম্বর কপি হয়েছে!')" class="px-2 py-0.5 bg-pink-50 text-pink-700 font-bold rounded text-[11px]">কপি</button>
            </div>
            <div class="flex justify-between items-center bg-white dark:bg-slate-900 p-2 rounded-lg border border-slate-200 dark:border-slate-700">
              <span><b class="text-orange-600">Nagad (Personal):</b> ${escHtml(PAYMENT_CONFIG.nagad)}</span>
              <button type="button" onclick="copyToClipboard('${escHtml(PAYMENT_CONFIG.nagad)}','নগদ নম্বর কপি হয়েছে!')" class="px-2 py-0.5 bg-orange-50 text-orange-700 font-bold rounded text-[11px]">কপি</button>
            </div>
          </div>

          <!-- TrxID সাবমিট ফর্ম -->
          <form onsubmit="submitPaymentRequest(event)" class="space-y-2.5">
            <p class="text-xs font-bold text-slate-700 dark:text-slate-200">ধাপ ২: টাকা পাঠানোর পর তথ্য সাবমিট করুন:</p>
            <div class="grid grid-cols-2 gap-2">
              <select name="method" class="px-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl">
                <option value="bKash">bKash</option>
                <option value="Nagad">Nagad</option>
              </select>
              <input name="sender_number" required placeholder="যে নম্বর থেকে পাঠিয়েছেন" class="px-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl" />
            </div>
            <input name="trx_id" required placeholder="Transaction ID (যেমন: BJK7829XYZ)" class="w-full px-3 py-2.5 text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl uppercase font-mono" />
            <button type="submit" ${state.saving ? 'disabled' : ''} class="w-full py-3 bg-amber-500 text-slate-950 font-bold text-xs rounded-xl shadow-md disabled:opacity-60">
              ${state.saving ? 'জমা হচ্ছে...' : `✅ ৳${selectedPlan.amount} (${selectedPlan.name}) রিকোয়েস্ট পাঠান`}
            </button>
          </form>

          <a href="https://wa.me/${escHtml(PAYMENT_CONFIG.whatsapp)}" target="_blank" rel="noopener"
            class="block w-full py-2.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-xl text-center">
            💬 জরুরি সাপোর্ট: WhatsApp-এ মেসেজ দিন
          </a>
        </div>` : ''}

      <!-- আমার পেমেন্ট হিস্ট্রি -->
      ${state.myPayments.length > 0 ? `
        <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2.5">
          <h3 class="font-bold text-xs">💳 আমার পেমেন্ট হিস্ট্রি</h3>
          ${state.myPayments.map((p) => `
            <div class="flex justify-between items-center text-xs py-2 border-b last:border-0 border-slate-100 dark:border-slate-800">
              <div>
                <p class="font-bold">${escHtml(p.plan_name)} (৳${p.amount})</p>
                <p class="text-[10px] text-slate-400">${escHtml(p.method)} • TrxID: ${escHtml(p.trx_id)}</p>
              </div>
              <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                p.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : p.status === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'
              }">${escHtml(p.status)}</span>
            </div>
          `).join('')}
        </div>` : ''}

      <!-- আমার পরীক্ষার রেজাল্ট হিস্ট্রি -->
      ${state.myRecentResults.length > 0 ? `
        <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2.5">
          <h3 class="font-bold text-xs">🏆 আমার সাম্প্রতিক পরীক্ষার রেজাল্ট</h3>
          ${state.myRecentResults.map((r) => `
            <div class="flex justify-between items-center text-xs py-2 border-b last:border-0 border-slate-100 dark:border-slate-800 gap-2">
              <div class="min-w-0">
                <p class="font-semibold truncate">${escHtml(r.exam_title)}</p>
                <p class="text-[10px] text-slate-400">✓ ${r.correct_count} • ✕ ${r.wrong_count} • ${formatDateBD(r.created_at)}</p>
              </div>
              <span class="font-bold text-teal-700 dark:text-teal-300 shrink-0">${Number(r.net_score).toFixed(2)}/${r.total_questions}</span>
            </div>
          `).join('')}
        </div>` : ''}

      <!-- অ্যাপ সেটিংস ও লগআউট -->
      <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2.5">
        <button onclick="toggleDarkMode()" class="w-full py-2.5 px-3 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold flex justify-between items-center">
          <span>${state.darkMode ? '☀️ লাইট মোড চালু করুন' : '🌙 ডার্ক মোড চালু করুন'}</span>
          <span class="text-slate-400">${state.darkMode ? 'ON' : 'OFF'}</span>
        </button>
        ${window.__deferredInstallPrompt ? `
          <button onclick="triggerInstallPWA()" class="w-full py-2.5 px-3 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-700 dark:text-indigo-300 rounded-xl text-xs font-bold text-left">
            📲 PrepBox BD অ্যাপ ইনস্টল করুন
          </button>` : ''}
        <button onclick="handleLogout()" class="w-full py-2.5 px-3 bg-rose-50 dark:bg-rose-950/50 text-rose-600 rounded-xl text-xs font-bold text-center">
          🚪 লগআউট করুন
        </button>
      </div>
    </div>`;
}

// ==========================================
// Main Layout & Render Engine
// ==========================================
function renderActiveTabContent() {
  if (state.tab === 'home') return renderHome();
  if (state.tab === 'preli') return typeof renderPreli === 'function' ? renderPreli() : '';
  if (state.tab === 'live') return typeof renderLive === 'function' ? renderLive() : '';
  if (state.tab === 'written') return typeof renderWritten === 'function' ? renderWritten() : '';
  if (state.tab === 'vocab') return typeof renderVocab === 'function' ? renderVocab() : '';
  if (state.tab === 'columns') return typeof renderColumns === 'function' ? renderColumns() : '';
  if (state.tab === 'viva') return typeof renderViva === 'function' ? renderViva() : '';
  if (state.tab === 'profile') return renderProfile();
  if (state.tab === 'admin') return typeof renderAdmin === 'function' ? renderAdmin() : '';
  return renderHome();
}

function render() {
  const root = document.getElementById('app');
  if (!root) return;

  if (state.passwordRecoveryMode) {
    root.innerHTML = renderPasswordRecoveryView();
    return;
  }

  if (!state.user || !state.profile) {
    root.innerHTML = renderAuthView();
    return;
  }

  const isAdmin = isAdminUser();
  const hasActiveLive = (state.liveExams || []).some(
    (ex) => typeof getLiveExamStatus === 'function' && getLiveExamStatus(ex) === 'live'
  );

  const quickNavItems = [
    { id: 'home', label: 'হোম' },
    { id: 'preli', label: 'প্রিলি' },
    { id: 'live', label: hasActiveLive ? '🔴 লাইভ' : 'লাইভ' },
    { id: 'written', label: 'রিটেন' },
    { id: 'vocab', label: 'ভোকাব' },
    { id: 'columns', label: 'সম্পাদকীয়' },
    { id: 'viva', label: 'ভাইভা' },
  ];
  if (isAdmin) quickNavItems.push({ id: 'admin', label: '🛠️ অ্যাডমিন' });

  const bottomNav = [
    { id: 'home', label: 'হোম', icon: 'home' },
    { id: 'preli', label: 'প্রিলি', icon: 'book-open' },
    { id: 'live', label: 'লাইভ', icon: 'radio', dot: hasActiveLive },
    { id: 'vocab', label: 'ভোকাব', icon: 'layers' },
    { id: 'profile', label: 'প্রোফাইল', icon: 'user' },
  ];

  const hideQuickStrip = state.modelTestActive && !state.modelTestSubmitted;

  root.innerHTML = `
    <!-- Top Sticky Header -->
    <header class="sticky top-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-b border-slate-200 dark:border-slate-800">
      <div class="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between gap-2">
        <button onclick="setTab('home')" class="flex items-center gap-2 text-left">
          <span class="w-8 h-8 rounded-xl bg-teal-600 text-white font-bold text-base flex items-center justify-center shadow-sm">P</span>
          <div>
            <span class="font-bold text-sm block leading-none">PrepBox BD</span>
            <span class="text-[10px] text-slate-400">BCS • Bank • Primary</span>
          </div>
        </button>

        <div class="flex items-center gap-1.5">
          ${isAdmin ? `
            <button onclick="setTab('admin')" class="px-2.5 py-1.5 rounded-xl text-xs font-bold ${state.tab === 'admin' ? 'bg-teal-600 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200'}">
              🛠️ Admin
            </button>` : ''}
          <button onclick="toggleDarkMode()" class="w-9 h-9 rounded-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-sm" title="ডার্ক/লাইট মোড">
            ${state.darkMode ? '☀️' : '🌙'}
          </button>
          <button onclick="setTab('profile')" class="w-9 h-9 rounded-xl bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 font-bold text-xs flex items-center justify-center border border-teal-200 dark:border-teal-800">
            ${escHtml((state.profile.full_name || 'S').charAt(0).toUpperCase())}
          </button>
        </div>
      </div>

      <!-- ১-ট্যাপ মডিউল সুইচার স্ট্রিপ -->
      ${!hideQuickStrip ? `
        <div class="max-w-2xl mx-auto px-4 pb-2 flex gap-1.5 overflow-x-auto no-scrollbar">
          ${quickNavItems.map((item) => `
            <button onclick="setTab('${item.id}')"
              class="px-3 py-1 rounded-full text-[11px] font-bold whitespace-nowrap transition ${
                state.tab === item.id
                  ? 'bg-teal-600 text-white shadow-sm'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
              }">${item.label}</button>
          `).join('')}
        </div>` : ''}
    </header>

    <!-- Main Page Container -->
    <main class="flex-1 max-w-2xl w-full mx-auto px-4 pt-4 pb-6">
      ${renderActiveTabContent()}
    </main>

    <!-- Fixed Mobile Bottom Navigation -->
    <nav class="fixed bottom-0 inset-x-0 z-30 bg-white/95 dark:bg-slate-900/95 backdrop-blur border-t border-slate-200 dark:border-slate-800 safe-pb">
      <div class="max-w-2xl mx-auto grid grid-cols-5 h-16">
        ${bottomNav.map((item) => {
          const active = state.tab === item.id;
          return `
            <button onclick="setTab('${item.id}')"
              class="relative flex flex-col items-center justify-center gap-0.5 transition ${active ? 'text-teal-600 dark:text-teal-400' : 'text-slate-400 dark:text-slate-500'}">
              ${item.dot ? '<span class="w-2 h-2 rounded-full bg-rose-500 absolute top-2 right-1/3 animate-pulse"></span>' : ''}
              <i data-lucide="${item.icon}" class="w-5 h-5"></i>
              <span class="text-[10px] font-bold">${item.label}</span>
            </button>`;
        }).join('')}
      </div>
    </nav>
  `;

  // Lucide Icons ও KaTeX গণিতের সূত্র রেন্ডারিং
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
  if (typeof window.renderMathInElement === 'function') {
    try {
      window.renderMathInElement(root, {
        delimiters: [
          { left: '$$', right: '$$', display: true },
          { left: '$', right: '$', display: false },
          { left: '\\(', right: '\\)', display: false },
          { left: '\\[', right: '\\]', display: true },
        ],
        throwOnError: false,
      });
    } catch (_) {}
  }
}
window.render = render;

// পরীক্ষা চলাকালীন ব্রাউজার রিলোড বা ক্লোজ সতর্কতা
window.addEventListener('beforeunload', (e) => {
  if (state.modelTestActive && !state.modelTestSubmitted) {
    e.preventDefault();
    e.returnValue = '';
  }
});

// ==========================================
// App Bootstrap & Auth Event Listener
// ==========================================
sb.auth.onAuthStateChange((event, session) => {
  if (event === 'PASSWORD_RECOVERY') {
    state.user = session?.user || state.user;
    state.passwordRecoveryMode = true;
    render();
  }
});

async function initApp() {
  document.documentElement.classList.toggle('dark', state.darkMode);

  try {
    const hash = window.location.hash || '';
    if (hash.includes('type=recovery')) {
      state.passwordRecoveryMode = true;
    }

    const { data, error } = await sb.auth.getSession();
    if (error) throw error;

    if (data?.session?.user) {
      state.user = data.session.user;
      if (!state.passwordRecoveryMode) {
        const ok = await loadProfile();
        if (ok) {
          await Promise.all([loadInitialData(), loadMyRecentResults()]);
        }
      }
    }
  } catch (err) {
    showToast(err.message || 'সেশন লোড করতে সমস্যা হয়েছে।', true);
  } finally {
    window.__APP_READY__ = true;
    render();
  }
}

initApp();