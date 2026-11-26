// ==========================================
// PrepBox BD V2 — Core Config, Auth, Session Lock & Cloud Sync
// ==========================================

// ডিপ্লয়ের আগে এই ৪টি লাইনে আপনার আসল তথ্য বসিয়ে নেবেন
const SUPABASE_URL = 'https://mxvggwxfrohlymfbkblm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_HK-CFXqa-n2abnLp0dekVw_JSyWB44f';

const PAYMENT_CONFIG = {
  bkash: '01755341486',
  nagad: '01755341486',
  whatsapp: '8801755341486',
  plans: [
    { id: 'monthly', name: '১ মাস (Pro)', amount: 99, days: 30 },
    { id: 'half_yearly', name: '৬ মাস (Pro)', amount: 399, days: 180 },
    { id: 'yearly', name: '১ বছর (Pro)', amount: 699, days: 365 },
  ],
};

const FREE_LIMITS = {
  preliPerTopic: 10,
  writtenPerFolder: 3,
  vocabTotal: 25,
  columnsTotal: 3,
  vivaCurated: 2,
  vivaDailyAI: 1,
};

const sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// URL থেকে রেফারাল কোড (?ref=PB-XXXXXX) থাকলে ধরে রাখা
const initialUrlRef = (() => {
  try {
    const code = new URLSearchParams(window.location.search).get('ref');
    return code ? code.trim().toUpperCase().slice(0, 20) : '';
  } catch (_) {
    return '';
  }
})();

const state = {
  user: null,
  profile: null,
  tab: 'home', // home, preli, live, written, vocab, columns, viva, profile, admin
  authMode: initialUrlRef ? 'signup' : 'login', // login, signup
  pendingRefCode: initialUrlRef,
  passwordRecoveryMode: false,

  darkMode: localStorage.getItem('pb_dark') === '1',
  loading: false,
  saving: false,

  // Master Data
  subjects: [],
  topics: [],
  notices: [],
  liveExams: [],

  // User Cloud Data
  bookmarks: { preli: [], written: [], vocab: [], column: [] },
  mistakes: [],
  myLiveAttempts: [], // যে লাইভ পরীক্ষাগুলো ইউজার ইতিমধ্যে দিয়েছে (live_exam_id তালিকা)
  myPayments: [],
  myRecentResults: [],

  // Preli & Model Test States
  examFilter: localStorage.getItem('pb_exam_filter') || 'ALL', // ALL, BCS, Bank, Primary
  preliMode: 'browse', // browse, mixed_setup, mixed_exam, live_exam, bookmarks, mistakes
  selectedSubject: null,
  selectedTopic: null,
  questions: [],
  questionsTotal: 0,
  preliSearch: '',
  preliOnlyImportant: false,
  answered: {},
  modelTestActive: false,
  modelTestSubmitted: false,
  modelTestAnswers: {},
  modelTestSecondsLeft: 0,
  modelTestTotalSeconds: 0,
  modelTestNegMark: 0.5,
  modelTestTitle: '',
  activeLiveExamId: null,

  // Written States
  writtenType: 'bcs', // bcs, bank
  selectedWrittenFolder: null,
  writtenItems: [],
  writtenSearch: '',

  // Vocab States
  vocabCategory: 'ALL',
  vocabItems: [],
  vocabSearch: '',
  vocabFlashMode: false,
  vocabFlashIndex: 0,
  vocabFlashFlipped: false,

  // Columns & Current Affairs States
  columnType: 'editorial', // editorial, current_affairs
  columnItems: [],
  columnSearch: '',

  // Viva States
  vivaSubTab: 'curated', // curated, custom
  vivaItems: [],

  // Live Exam & Leaderboard States
  selectedLiveLeaderboardId: null,
  liveLeaderboard: [],

  // Admin Studio States
  adminSubTab: 'payments', // payments, live_exams, notices, reports
  paymentRequests: [],
  errorReports: [],
  adminNotices: [],
  adminStats: { users: 0, proUsers: 0, questions: 0, pendingPayments: 0 },

  // Shared Form/Modal Flags
  showAddSubject: false,
  showAddTopic: false,
  showBulk: { preli: false, written: false, vocab: false, columns: false, viva: false },
  editing: null,
};

let lastSessionCheckAt = 0;

// ==========================================
// Helpers & Utilities
// ==========================================
function isAdminUser() {
  return state.profile?.role === 'admin';
}

function isProUser() {
  if (isAdminUser()) return true;
  if (!state.profile?.is_pro) return false;
  if (!state.profile.pro_expires_at) return true;
  return new Date(state.profile.pro_expires_at) > new Date();
}

function getProDaysLeft() {
  if (isAdminUser()) return '∞';
  if (!isProUser() || !state.profile?.pro_expires_at) return 0;
  const diffMs = new Date(state.profile.pro_expires_at).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / 86400000));
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normText(s) {
  return String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function formatDateBD(iso) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleString('bn-BD', {
      timeZone: 'Asia/Dhaka',
      day: 'numeric',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch (_) {
    return String(iso).slice(0, 16);
  }
}

function generateSessionId() {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return window.crypto.randomUUID();
  }
  return 'sid-' + Date.now() + '-' + Math.random().toString(36).slice(2, 12);
}

function showToast(msg, isError = false) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.className = `fixed top-4 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-xl text-xs font-bold text-white max-w-[92vw] text-center ${
    isError ? 'bg-rose-600' : 'bg-slate-900 dark:bg-teal-600'
  }`;
  el.classList.remove('hidden');
  clearTimeout(window._toastTimer);
  window._toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}
window.showToast = showToast;

async function copyToClipboard(text, label = 'কপি হয়েছে!') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(label);
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    showToast(label);
  }
}

function toggleDarkMode() {
  state.darkMode = !state.darkMode;
  localStorage.setItem('pb_dark', state.darkMode ? '1' : '0');
  document.documentElement.classList.toggle('dark', state.darkMode);
  render();
}

async function triggerInstallPWA() {
  const promptEvt = window.__deferredInstallPrompt;
  if (!promptEvt) {
    showToast('ব্রাউজারের মেনু থেকে "Add to Home Screen" চাপুন।');
    return;
  }
  promptEvt.prompt();
  const { outcome } = await promptEvt.userChoice;
  window.__deferredInstallPrompt = null;
  if (outcome === 'accepted') showToast('অ্যাপটি আপনার ফোনে ইনস্টল হচ্ছে!');
  render();
}

function setExamFilter(filterId) {
  state.examFilter = filterId;
  localStorage.setItem('pb_exam_filter', filterId);
  render();
}

function parseBulkJSON(raw) {
  let cleaned = String(raw || '').trim();
  cleaned = cleaned.replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/i, '').trim();
  return JSON.parse(cleaned);
}

function toggleBulk(key) {
  state.showBulk[key] = !state.showBulk[key];
  state.editing = null;
  render();
}

function cancelEdit() {
  state.editing = null;
  render();
}

// ==========================================
// Secure AI Caller (Supabase JWT Token সহ)
// ==========================================
async function callAI(action, payload) {
  const { data: sessionData } = await sb.auth.getSession();
  const token = sessionData?.session?.access_token;
  if (!token) {
    throw new Error('আপনার লগইন সেশন পাওয়া যায়নি। পুনরায় লগইন করুন।');
  }

  const res = await fetch('/api/ai', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ action, payload }),
  });

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `AI সার্ভার ত্রুটি (HTTP ${res.status})`);
  }
  return json.data;
}

async function deleteItem(table, id, reloadFn) {
  if (!confirm('নিশ্চিতভাবে এটি ডিলিট করতে চান?')) return;
  const { error } = await sb.from(table).delete().eq('id', id);
  if (error) return showToast(error.message, true);
  showToast('সফলভাবে ডিলিট হয়েছে!');
  if (reloadFn) await reloadFn();
}

// ==========================================
// Cloud Bookmarks, Batch Mistakes & Error Reports
// ==========================================
function isBookmarked(type, id) {
  return (state.bookmarks[type] || []).includes(Number(id));
}

async function toggleBookmark(type, id) {
  const numId = Number(id);
  const exists = isBookmarked(type, numId);
  try {
    if (exists) {
      const { error } = await sb
        .from('user_bookmarks')
        .delete()
        .eq('user_id', state.user.id)
        .eq('item_type', type)
        .eq('item_id', numId);
      if (error) throw error;
      state.bookmarks[type] = state.bookmarks[type].filter((x) => x !== numId);
      showToast('বুকমার্ক সরানো হয়েছে');
    } else {
      const { error } = await sb
        .from('user_bookmarks')
        .upsert(
          { user_id: state.user.id, item_type: type, item_id: numId },
          { onConflict: 'user_id,item_type,item_id' }
        );
      if (error) throw error;
      if (!state.bookmarks[type].includes(numId)) state.bookmarks[type].push(numId);
      showToast('⭐ বুকমার্ক সেভ হয়েছে');
    }
    render();
  } catch (err) {
    showToast(err.message, true);
  }
}

// প্র্যাকটিস মোডে একক প্রশ্নের ভুল/সঠিক সিঙ্ক
async function recordMistake(questionId, isWrong) {
  const qId = Number(questionId);
  try {
    if (isWrong) {
      await sb
        .from('user_mistakes')
        .upsert(
          { user_id: state.user.id, question_id: qId, updated_at: new Date().toISOString() },
          { onConflict: 'user_id,question_id' }
        );
      if (!state.mistakes.includes(qId)) state.mistakes.push(qId);
    } else if (state.mistakes.includes(qId)) {
      await sb
        .from('user_mistakes')
        .delete()
        .eq('user_id', state.user.id)
        .eq('question_id', qId);
      state.mistakes = state.mistakes.filter((x) => x !== qId);
    }
  } catch (_) {}
}

// ২০০ প্রশ্নের মডেল টেস্টে মাত্র ১-২টি কলে সব ভুল/সঠিক ব্যাচ সিঙ্ক
async function syncMistakesBatch(wrongIds = [], correctIds = []) {
  const uniqueWrong = [...new Set(wrongIds.map(Number).filter(Boolean))];
  const uniqueCorrectToRemove = [...new Set(correctIds.map(Number).filter((id) => state.mistakes.includes(id)))];
  const tasks = [];

  if (uniqueWrong.length > 0) {
    const nowIso = new Date().toISOString();
    const rows = uniqueWrong.map((qId) => ({
      user_id: state.user.id,
      question_id: qId,
      updated_at: nowIso,
    }));
    tasks.push(
      sb.from('user_mistakes').upsert(rows, { onConflict: 'user_id,question_id' }).then(() => {
        uniqueWrong.forEach((id) => {
          if (!state.mistakes.includes(id)) state.mistakes.push(id);
        });
      })
    );
  }

  if (uniqueCorrectToRemove.length > 0) {
    tasks.push(
      sb
        .from('user_mistakes')
        .delete()
        .eq('user_id', state.user.id)
        .in('question_id', uniqueCorrectToRemove)
        .then(() => {
          const rmSet = new Set(uniqueCorrectToRemove);
          state.mistakes = state.mistakes.filter((id) => !rmSet.has(id));
        })
    );
  }

  if (tasks.length) await Promise.allSettled(tasks);
}

async function submitErrorReport(itemType, itemId) {
  const msg = prompt('কী ভুল আছে সংক্ষেপে লিখুন (যেমন: সঠিক উত্তর খ হবে):');
  if (!msg || !msg.trim()) return;
  const { error } = await sb.from('error_reports').insert({
    user_id: state.user.id,
    item_type: itemType,
    item_id: Number(itemId) || null,
    message: msg.trim().slice(0, 500),
  });
  if (error) return showToast(error.message, true);
  showToast('🚩 রিপোর্ট জমা হয়েছে! অ্যাডমিন দ্রুত যাচাই করে ঠিক করবেন।');
}

// ==========================================
// Initial Data, Streak & Single-Device Session Lock
// ==========================================
async function loadInitialData() {
  const [subRes, topRes, notRes, liveRes, bmRes, misRes, attRes] = await Promise.all([
    sb.from('subjects').select('*').order('sort_order', { ascending: true }),
    sb.from('topics').select('*').order('id', { ascending: true }),
    sb.from('notices').select('*').eq('is_active', true).order('created_at', { ascending: false }).limit(5),
    sb.from('live_exams').select('*').order('start_time', { ascending: false }).limit(20),
    sb.from('user_bookmarks').select('item_type, item_id').eq('user_id', state.user.id),
    sb.from('user_mistakes').select('question_id').eq('user_id', state.user.id),
    sb.from('exam_results').select('live_exam_id').eq('user_id', state.user.id).not('live_exam_id', 'is', null),
  ]);

  state.subjects = subRes.data || [];
  state.topics = topRes.data || [];
  state.notices = notRes.data || [];
  state.liveExams = liveRes.data || [];

  state.bookmarks = { preli: [], written: [], vocab: [], column: [] };
  (bmRes.data || []).forEach((b) => {
    if (state.bookmarks[b.item_type]) state.bookmarks[b.item_type].push(Number(b.item_id));
  });

  state.mistakes = (misRes.data || []).map((m) => Number(m.question_id));
  state.myLiveAttempts = (attRes.data || []).map((r) => Number(r.live_exam_id));
}

async function syncDailyStreak() {
  if (!state.profile) return;
  const bdNow = new Date(Date.now() + 6 * 60 * 60 * 1000);
  const today = bdNow.toISOString().slice(0, 10);
  if (state.profile.last_active_date === today) return;

  const bdYesterday = new Date(bdNow.getTime() - 86400000).toISOString().slice(0, 10);
  const newStreak =
    state.profile.last_active_date === bdYesterday ? (state.profile.streak_days || 0) + 1 : 1;

  const { error } = await sb
    .from('profiles')
    .update({ streak_days: newStreak, last_active_date: today })
    .eq('id', state.user.id);

  if (!error) {
    state.profile.streak_days = newStreak;
    state.profile.last_active_date = today;
  }
}

async function loadProfile() {
  const { data, error } = await sb.from('profiles').select('*').eq('id', state.user.id).single();
  if (error || !data) throw new Error('প্রোফাইল লোড করা যায়নি।');
  state.profile = data;

  // সাধারণ ইউজারের জন্য ১-ডিভাইস সেশন লক যাচাই
  if (!isAdminUser()) {
    const localSid = localStorage.getItem('pb_session_id');
    if (data.active_session_id && localSid && data.active_session_id !== localSid) {
      await handleLogout('অন্য ডিভাইসে লগইন করায় এই ডিভাইস থেকে লগআউট করা হয়েছে।');
      return false;
    }
    if (!data.active_session_id) {
      const sid = localSid || generateSessionId();
      localStorage.setItem('pb_session_id', sid);
      await sb.from('profiles').update({ active_session_id: sid }).eq('id', state.user.id);
      state.profile.active_session_id = sid;
    }
  }

  await syncDailyStreak();
  return true;
}

// ব্যাকগ্রাউন্ডে সেশন লক চেক (প্রতি ৬০ সেকেন্ডে সর্বোচ্চ ১ বার)
async function verifyActiveSession() {
  if (!state.user || !state.profile || isAdminUser()) return;
  const now = Date.now();
  if (now - lastSessionCheckAt < 60000) return;
  lastSessionCheckAt = now;

  const localSid = localStorage.getItem('pb_session_id');
  if (!localSid) return;

  const { data } = await sb
    .from('profiles')
    .select('active_session_id')
    .eq('id', state.user.id)
    .single();

  if (data?.active_session_id && data.active_session_id !== localSid) {
    await handleLogout('অন্য একটি ডিভাইস থেকে আপনার অ্যাকাউন্টে লগইন করা হয়েছে।');
  }
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') verifyActiveSession();
});

// ==========================================
// Authentication (Login, Signup + Referral, Password Reset)
// ==========================================
function setAuthMode(mode) {
  state.authMode = mode;
  render();
}

async function handleAuth(e, mode) {
  e.preventDefault();
  if (state.loading) return;

  const email = e.target.email.value.trim();
  const password = e.target.password.value;
  const fullName = e.target.full_name?.value.trim() || 'Student';
  const refCode = e.target.referred_by?.value.trim().toUpperCase() || '';

  state.loading = true;
  render();

  try {
    let authedUser = null;

    if (mode === 'signup') {
      const { data: signUpData, error: signUpErr } = await sb.auth.signUp({
        email,
        password,
        options: {
          data: { full_name: fullName, referred_by: refCode },
        },
      });
      if (signUpErr) throw signUpErr;

      if (signUpData?.session?.user) {
        authedUser = signUpData.session.user;
      } else {
        // যদি Supabase-এ Confirm Email চালু থাকে
        showToast('অ্যাকাউন্ট তৈরি হয়েছে! ইমেইল ভেরিফাই করে লগইন করুন।');
        state.authMode = 'login';
        state.loading = false;
        render();
        return;
      }
    } else {
      const { data, error } = await sb.auth.signInWithPassword({ email, password });
      if (error) throw error;
      authedUser = data.user;
    }

    state.user = authedUser;

    // নতুন সেশন আইডি সেট করে আগের ডিভাইস লক করা
    const newSid = generateSessionId();
    localStorage.setItem('pb_session_id', newSid);
    await sb.from('profiles').update({ active_session_id: newSid }).eq('id', state.user.id);

    const ok = await loadProfile();
    if (ok) {
      await loadInitialData();
      if (window.location.search.includes('ref=')) {
        window.history.replaceState({}, document.title, window.location.pathname);
      }
      showToast(mode === 'signup' ? 'স্বাগতম! অ্যাকাউন্ট তৈরি সফল হয়েছে।' : 'স্বাগতম PrepBox BD-তে!');
    }
  } catch (err) {
    showToast(err.message || 'লগইন ব্যর্থ হয়েছে।', true);
  } finally {
    state.loading = false;
    render();
  }
}

async function handleResetPassword() {
  const email = prompt('আপনার রেজিস্টার্ড ইমেইল ঠিকানা লিখুন:');
  if (!email || !email.trim()) return;
  try {
    const { error } = await sb.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    if (error) throw error;
    showToast('পাসওয়ার্ড রিসেট লিংক আপনার ইমেইলে পাঠানো হয়েছে!');
  } catch (err) {
    showToast(err.message, true);
  }
}

async function handleUpdatePassword(e) {
  e.preventDefault();
  const newPassword = e.target.new_password.value;
  if (newPassword.length < 6) return showToast('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে।', true);

  state.loading = true;
  render();
  try {
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw error;
    state.passwordRecoveryMode = false;
    showToast('পাসওয়ার্ড সফলভাবে পরিবর্তন হয়েছে!');
    if (state.user) {
      await loadProfile();
      await loadInitialData();
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

async function handleLogout(customMsg = '') {
  if (typeof stopExamTimer === 'function') stopExamTimer();
  localStorage.removeItem('pb_session_id');
  await sb.auth.signOut().catch(() => {});
  state.user = null;
  state.profile = null;
  state.tab = 'home';
  state.modelTestActive = false;
  state.modelTestSubmitted = false;
  if (customMsg) showToast(customMsg, true);
  render();
}

// ==========================================
// Shared UI Components (Pro Lock, Auth, Recovery)
// ==========================================
function renderProLockCard(msg) {
  return `
    <div class="bg-gradient-to-r from-amber-50 to-orange-50 dark:from-amber-950/40 dark:to-orange-950/30 border border-amber-200 dark:border-amber-800 p-4 rounded-2xl text-center space-y-2">
      <p class="text-xs font-bold text-amber-900 dark:text-amber-300">🔒 Pro ফিচার আনলক করুন</p>
      <p class="text-xs text-amber-800 dark:text-amber-200">${escHtml(msg)}</p>
      <button onclick="setTab('profile')" class="px-4 py-2 bg-amber-500 text-slate-950 text-xs font-bold rounded-xl shadow-sm">
        Pro সাবস্ক্রিপশন নিন →
      </button>
    </div>`;
}

function renderPasswordRecoveryView() {
  return `
    <div class="min-h-screen flex flex-col justify-center px-5 py-10 bg-gradient-to-b from-teal-700 to-teal-950">
      <div class="max-w-md w-full mx-auto bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl space-y-4">
        <div class="text-center">
          <h1 class="text-xl font-bold text-slate-900 dark:text-white">নতুন পাসওয়ার্ড সেট করুন</h1>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">কমপক্ষে ৬ অক্ষরের নতুন পাসওয়ার্ড দিন</p>
        </div>
        <form onsubmit="handleUpdatePassword(event)" class="space-y-3.5">
          <input name="new_password" type="password" required minlength="6" placeholder="নতুন পাসওয়ার্ড" class="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 text-sm" />
          <button type="submit" class="w-full py-3 bg-teal-600 text-white font-bold rounded-xl shadow-md">
            ${state.loading ? 'সেভ হচ্ছে...' : 'পাসওয়ার্ড আপডেট করুন'}
          </button>
        </form>
      </div>
    </div>`;
}

function renderAuthView() {
  const isLogin = state.authMode === 'login';
  return `
    <div class="min-h-screen flex flex-col justify-center px-5 py-10 bg-gradient-to-b from-teal-700 to-teal-950">
      <div class="max-w-md w-full mx-auto bg-white dark:bg-slate-900 rounded-3xl p-6 shadow-2xl">
        <div class="text-center mb-6">
          <div class="w-14 h-14 bg-teal-600 text-white rounded-2xl flex items-center justify-center mx-auto mb-3 font-bold text-2xl shadow-md">P</div>
          <h1 class="text-2xl font-bold text-slate-900 dark:text-white">PrepBox BD</h1>
          <p class="text-xs text-slate-500 dark:text-slate-400 mt-1">বিসিএস, ব্যাংক ও প্রাইমারি প্রস্তুতির স্মার্ট প্ল্যাটফর্ম</p>
        </div>

        <div class="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl mb-5">
          <button type="button" onclick="setAuthMode('login')"
            class="flex-1 py-2 text-xs font-bold rounded-lg transition ${isLogin ? 'bg-white dark:bg-slate-700 shadow-sm text-teal-700 dark:text-teal-300' : 'text-slate-500 dark:text-slate-400'}">
            লগইন
          </button>
          <button type="button" onclick="setAuthMode('signup')"
            class="flex-1 py-2 text-xs font-bold rounded-lg transition ${!isLogin ? 'bg-white dark:bg-slate-700 shadow-sm text-teal-700 dark:text-teal-300' : 'text-slate-500 dark:text-slate-400'}">
            নতুন অ্যাকাউন্ট
          </button>
        </div>

        ${isLogin ? `
          <form onsubmit="handleAuth(event,'login')" class="space-y-3.5">
            <input name="email" type="email" required placeholder="আপনার ইমেইল" class="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 text-sm" />
            <input name="password" type="password" required placeholder="পাসওয়ার্ড" class="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 text-sm" />
            <button type="submit" ${state.loading ? 'disabled' : ''} class="w-full py-3 bg-teal-600 text-white font-bold rounded-xl shadow-md disabled:opacity-60">
              ${state.loading ? 'লগইন হচ্ছে...' : 'লগইন করুন'}
            </button>
            <button type="button" onclick="handleResetPassword()" class="w-full text-center text-xs font-semibold text-teal-700 dark:text-teal-400 pt-1">
              পাসওয়ার্ড ভুলে গেছেন? রিসেট করুন
            </button>
          </form>
        ` : `
          <form onsubmit="handleAuth(event,'signup')" class="space-y-3.5">
            <input name="full_name" type="text" required placeholder="আপনার পূর্ণ নাম" class="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 text-sm" />
            <input name="email" type="email" required placeholder="আপনার ইমেইল" class="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 text-sm" />
            <input name="password" type="password" required minlength="6" placeholder="পাসওয়ার্ড (কমপক্ষে ৬ অক্ষর)" class="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 text-sm" />
            <input name="referred_by" type="text" value="${escHtml(state.pendingRefCode)}" placeholder="রেফারাল কোড (ঐচ্ছিক, যেমন: PB-123ABC)" class="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 dark:bg-slate-800 text-sm uppercase" />
            <button type="submit" ${state.loading ? 'disabled' : ''} class="w-full py-3 bg-teal-600 text-white font-bold rounded-xl shadow-md disabled:opacity-60">
              ${state.loading ? 'অ্যাকাউন্ট তৈরি হচ্ছে...' : 'ফ্রি অ্যাকাউন্ট তৈরি করুন'}
            </button>
          </form>
        `}
      </div>
    </div>`;
}