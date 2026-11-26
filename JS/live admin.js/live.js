// ==========================================
// PrepBox BD V2 — Scheduled Live Exams, Archive Practice & Merit List
// ==========================================

let liveCatFilter = 'ALL'; // ALL, BCS, Bank, Primary

async function loadLiveExams() {
  state.loading = true;
  render();
  try {
    const { data, error } = await sb
      .from('live_exams')
      .select('*')
      .order('start_time', { ascending: false })
      .limit(30);
    if (error) throw error;
    state.liveExams = data || [];
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

function getLiveExamStatus(exam) {
  const now = Date.now();
  const start = new Date(exam.start_time).getTime();
  const end = new Date(exam.end_time).getTime();
  if (now < start) return 'upcoming';
  if (now >= start && now <= end) return 'live';
  return 'ended';
}

function formatDurationSec(sec) {
  const s = Math.max(0, Number(sec) || 0);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m === 0) return `${rem} সে.`;
  return `${m} মি. ${rem} সে.`;
}

function startLiveExamById(examId) {
  const exam = state.liveExams.find((e) => Number(e.id) === Number(examId));
  if (!exam) return showToast('পরীক্ষাটি পাওয়া যায়নি।', true);
  if (typeof startScheduledLiveExam === 'function') {
    startScheduledLiveExam(exam);
  }
}

// সময় শেষ হয়ে যাওয়া লাইভ এক্সাম আর্কাইভ প্র্যাকটিস হিসেবে দেওয়া (মেধাতালিকা পরিবর্তন হবে না)
async function startArchivedLivePractice(examId) {
  const exam = state.liveExams.find((e) => Number(e.id) === Number(examId));
  if (!exam) return;
  if (exam.is_pro_only && !isProUser()) {
    showToast('এই আর্কাইভ পরীক্ষাটি শুধুমাত্র Pro মেম্বারদের জন্য!', true);
    setTab('profile');
    return;
  }

  state.loading = true;
  state.tab = 'preli';
  render();
  try {
    let qData = [];
    if (Array.isArray(exam.question_ids) && exam.question_ids.length > 0) {
      const { data, error } = await sb.from('preli_questions').select('*').in('id', exam.question_ids);
      if (error) throw error;
      const byId = new Map((data || []).map((q) => [Number(q.id), q]));
      qData = exam.question_ids.map((id) => byId.get(Number(id))).filter(Boolean);
    } else {
      let query = sb.from('preli_questions').select('*').limit(100);
      if (exam.exam_category && exam.exam_category !== 'ALL') {
        query = query.contains('exam_tags', [exam.exam_category]);
      }
      const { data, error } = await query;
      if (error) throw error;
      qData = shuffleArray(data || []).slice(0, 50);
    }

    if (!qData.length) {
      showToast('এই পরীক্ষায় কোনো প্রশ্ন পাওয়া যায়নি।', true);
      state.loading = false;
      state.tab = 'live';
      render();
      return;
    }

    const totalSec = (Number(exam.duration_minutes) || 30) * 60;
    state.preliMode = 'mixed_exam';
    state.questions = qData;
    state.questionsTotal = qData.length;
    state.modelTestNegMark = Number(exam.negative_mark ?? 0.5);
    state.modelTestTitle = `📖 আর্কাইভ: ${exam.title}`;
    state.activeLiveExamId = null; // আর্কাইভ প্র্যাকটিস মূল মেধাতালিকায় ঢুকবে না
    state.modelTestActive = true;
    state.modelTestSubmitted = false;
    state.modelTestAnswers = {};
    state.modelTestTotalSeconds = totalSec;
    state.modelTestSecondsLeft = totalSec;
    state.loading = false;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
    startExamCountdown();
  } catch (err) {
    state.loading = false;
    showToast(err.message, true);
    render();
  }
}

// ==========================================
// মেধাতালিকা (Merit List / Leaderboard)
// ==========================================
async function openLiveLeaderboard(examId) {
  state.tab = 'live';
  state.selectedLiveLeaderboardId = Number(examId);
  state.liveLeaderboard = [];
  state.loading = true;
  render();

  try {
    const { data, error } = await sb
      .from('exam_results')
      .select('*')
      .eq('live_exam_id', Number(examId))
      .order('net_score', { ascending: false })
      .order('time_taken_seconds', { ascending: true })
      .limit(100);
    if (error) throw error;
    state.liveLeaderboard = data || [];
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    render();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function closeLiveLeaderboard() {
  state.selectedLiveLeaderboardId = null;
  state.liveLeaderboard = [];
  render();
}

function renderLiveLeaderboardView() {
  const exam = state.liveExams.find((e) => Number(e.id) === Number(state.selectedLiveLeaderboardId));
  const list = state.liveLeaderboard || [];
  const myRankIdx = list.findIndex((r) => r.user_id === state.user.id);
  const myRow = myRankIdx >= 0 ? list[myRankIdx] : null;

  return `
    <div class="space-y-4">
      <div class="flex justify-between items-center">
        <button onclick="closeLiveLeaderboard()" class="text-xs font-bold text-teal-700 dark:text-teal-400">← লাইভ পরীক্ষার তালিকায় ফিরুন</button>
        <button onclick="openLiveLeaderboard(${state.selectedLiveLeaderboardId})" class="text-xs font-bold text-slate-500">↺ রিফ্রেশ</button>
      </div>

      <div class="bg-gradient-to-r from-teal-700 to-indigo-700 text-white p-5 rounded-2xl shadow-md space-y-1">
        <p class="text-[11px] font-bold text-teal-200 uppercase">🏆 অফিসিয়াল মেধাতালিকা (Top 100)</p>
        <h2 class="font-bold text-base">${escHtml(exam?.title || 'লাইভ এক্সাম মেধাতালিকা')}</h2>
        <p class="text-xs text-indigo-100">মোট অংশগ্রহণকারী: ${list.length} জন • টাই-ব্রেকার: কম সময়</p>
      </div>

      ${myRow ? `
        <div class="bg-amber-50 dark:bg-amber-950/40 border border-amber-300 dark:border-amber-700 p-4 rounded-2xl flex justify-between items-center">
          <div>
            <p class="text-[11px] font-bold text-amber-800 dark:text-amber-300">আপনার অবস্থান</p>
            <p class="font-bold text-base text-slate-900 dark:text-white">#${myRankIdx + 1} তম — ${escHtml(myRow.user_name)}</p>
            <p class="text-xs text-slate-600 dark:text-slate-300">সঠিক: ${myRow.correct_count} • ভুল: ${myRow.wrong_count} • সময়: ${formatDurationSec(myRow.time_taken_seconds)}</p>
          </div>
          <div class="text-right">
            <p class="text-[10px] text-amber-700 dark:text-amber-300 font-bold">নিট স্কোর</p>
            <p class="text-xl font-bold text-teal-700 dark:text-teal-300">${Number(myRow.net_score).toFixed(2)}</p>
          </div>
        </div>` : ''}

      ${state.loading ? `<p class="text-center text-xs text-slate-500 py-8">মেধাতালিকা লোড হচ্ছে...</p>` : ''}
      ${!state.loading && list.length === 0 ? `
        <div class="bg-white dark:bg-slate-900 p-8 rounded-2xl text-center text-sm text-slate-500">
          এখনো কেউ এই লাইভ পরীক্ষায় অংশগ্রহণ করেনি।
        </div>` : ''}

      <div class="space-y-2">
        ${list.map((r, idx) => {
          const rank = idx + 1;
          const medal = rank === 1 ? '🥇' : rank === 2 ? '🥈' : rank === 3 ? '🥉' : `#${rank}`;
          const isMe = r.user_id === state.user.id;
          return `
            <div class="p-3.5 rounded-xl border flex justify-between items-center gap-2 ${
              isMe
                ? 'bg-teal-50 dark:bg-teal-950/50 border-teal-400 dark:border-teal-600'
                : 'bg-white dark:bg-slate-900 border-slate-100 dark:border-slate-800'
            }">
              <div class="flex items-center gap-3 min-w-0">
                <span class="w-8 text-center font-bold text-sm shrink-0">${medal}</span>
                <div class="min-w-0">
                  <p class="font-bold text-sm truncate">${escHtml(r.user_name)} ${isMe ? '<span class="text-[10px] text-teal-600">(আপনি)</span>' : ''}</p>
                  <p class="text-[11px] text-slate-500">✓ ${r.correct_count} • ✕ ${r.wrong_count} • ⏱️ ${formatDurationSec(r.time_taken_seconds)}</p>
                </div>
              </div>
              <div class="text-right shrink-0">
                <p class="font-bold text-sm text-teal-700 dark:text-teal-300">${Number(r.net_score).toFixed(2)}</p>
                <p class="text-[10px] text-slate-400">/${r.total_questions}</p>
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ==========================================
// Main Render Live Exams View
// ==========================================
function renderLive() {
  if (state.selectedLiveLeaderboardId !== null) {
    return renderLiveLeaderboardView();
  }

  const isAdmin = isAdminUser();
  const cats = [
    { id: 'ALL', label: 'সব পরীক্ষা' },
    { id: 'BCS', label: '🏛️ বিসিএস' },
    { id: 'Bank', label: '🏦 ব্যাংক' },
    { id: 'Primary', label: '🏫 প্রাইমারি' },
  ];

  const filtered = state.liveExams.filter(
    (e) => liveCatFilter === 'ALL' || e.exam_category === liveCatFilter || e.exam_category === 'ALL'
  );

  // চলমান আগে, তারপর আসন্ন, তারপর সমাপ্ত
  const orderWeight = { live: 0, upcoming: 1, ended: 2 };
  const sorted = [...filtered].sort(
    (a, b) => orderWeight[getLiveExamStatus(a)] - orderWeight[getLiveExamStatus(b)]
  );

  return `
    <div class="space-y-4">
      <div class="flex justify-between items-center">
        <div>
          <h2 class="font-bold text-base">🔴 লাইভ এক্সাম ও মেধাতালিকা</h2>
          <p class="text-[11px] text-slate-500 dark:text-slate-400">নির্ধারিত সময়ে সবার সাথে পরীক্ষা দিয়ে নিজের অবস্থান যাচাই করুন</p>
        </div>
        ${isAdmin ? `
          <button onclick="state.adminSubTab='live_exams';setTab('admin')" class="px-3 py-1.5 bg-slate-900 dark:bg-teal-600 text-white text-xs font-bold rounded-lg shrink-0">
            + নতুন লাইভ
          </button>` : ''}
      </div>

      <div class="flex gap-2 overflow-x-auto no-scrollbar">
        ${cats.map((c) => `
          <button onclick="liveCatFilter='${c.id}';render()"
            class="px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${
              liveCatFilter === c.id
                ? 'bg-teal-600 text-white'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
            }">${c.label}</button>
        `).join('')}
      </div>

      ${state.loading ? `<p class="text-center text-xs text-slate-500 py-8">লোড হচ্ছে...</p>` : ''}

      ${!state.loading && sorted.length === 0 ? `
        <div class="bg-white dark:bg-slate-900 p-8 rounded-2xl border border-slate-100 dark:border-slate-800 text-center space-y-2">
          <p class="text-2xl">📅</p>
          <p class="font-bold text-sm">এখনো কোনো শিডিউল্ড লাইভ এক্সাম নেই</p>
          <p class="text-xs text-slate-500">আপনি চাইলে প্রিলি সেকশন থেকে যেকোনো সময় পূর্ণাঙ্গ মিক্সড মডেল টেস্ট দিতে পারেন।</p>
          <button onclick="setTab('preli');openMixedTestSetup()" class="mt-2 px-4 py-2 bg-indigo-600 text-white text-xs font-bold rounded-xl">🎯 মিক্সড মডেল টেস্ট দিন</button>
        </div>` : ''}

      <div class="space-y-3">
        ${sorted.map((exam) => {
          const status = getLiveExamStatus(exam);
          const attempted = state.myLiveAttempts.includes(Number(exam.id));
          const qCount = Array.isArray(exam.question_ids) && exam.question_ids.length ? exam.question_ids.length : 50;

          const badge =
            status === 'live'
              ? '<span class="px-2 py-0.5 rounded-full bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300 text-[10px] font-bold animate-pulse">🔴 লাইভ চলছে</span>'
              : status === 'upcoming'
                ? '<span class="px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[10px] font-bold">⏳ আসন্ন</span>'
                : '<span class="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-500 text-[10px] font-bold">✅ সমাপ্ত</span>';

          return `
            <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border ${status === 'live' ? 'border-rose-300 dark:border-rose-800' : 'border-slate-100 dark:border-slate-800'} shadow-sm space-y-3">
              <div class="flex flex-wrap justify-between items-center gap-1.5">
                <div class="flex flex-wrap gap-1.5 items-center">
                  ${badge}
                  <span class="px-2 py-0.5 rounded-full bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 text-[10px] font-bold">${escHtml(exam.exam_category || 'ALL')}</span>
                  ${exam.is_pro_only ? '<span class="px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-bold">👑 PRO</span>' : '<span class="px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[10px] font-bold">ফ্রি</span>'}
                </div>
                <span class="text-[11px] font-semibold text-slate-500">${qCount} প্রশ্ন • ${exam.duration_minutes} মি.</span>
              </div>

              <div>
                <h3 class="font-bold text-sm">${escHtml(exam.title)}</h3>
                ${exam.syllabus ? `<p class="text-xs text-slate-500 dark:text-slate-400 mt-1"><b>সিলেবাস:</b> ${escHtml(exam.syllabus)}</p>` : ''}
              </div>

              <div class="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/70 p-2.5 rounded-xl space-y-0.5">
                <p>🕒 শুরু: <b>${formatDateBD(exam.start_time)}</b></p>
                <p>🏁 শেষ: <b>${formatDateBD(exam.end_time)}</b> • নেগেটিভ: -${Number(exam.negative_mark ?? 0.5).toFixed(2)}</p>
              </div>

              <div class="flex flex-wrap gap-2">
                ${status === 'live' && !attempted ? `
                  <button onclick="startLiveExamById(${exam.id})" class="flex-1 py-2.5 bg-rose-600 text-white text-xs font-bold rounded-xl shadow-sm">
                    🔴 পরীক্ষায় অংশ নিন
                  </button>` : ''}
                ${status === 'live' && attempted ? `
                  <span class="flex-1 py-2.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-xl text-center">
                    ✅ অংশগ্রহণ সম্পন্ন
                  </span>` : ''}
                ${status === 'ended' ? `
                  <button onclick="startArchivedLivePractice(${exam.id})" class="flex-1 py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl">
                    📖 আর্কাইভ প্র্যাকটিস
                  </button>` : ''}
                ${status !== 'upcoming' ? `
                  <button onclick="openLiveLeaderboard(${exam.id})" class="flex-1 py-2.5 bg-amber-400 text-slate-950 text-xs font-bold rounded-xl">
                    🏆 মেধাতালিকা
                  </button>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}