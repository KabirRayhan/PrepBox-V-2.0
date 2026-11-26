// ==========================================
// PrepBox BD V2 — Ultimate Complete Admin Studio (Final Audited)
// (Revenue Stats, Atomic Payment RPC, Subject-Wise Live Exam + Edit,
//  Inline Report Fixer, Pending Viva Moderation, Notices & User Support)
// ==========================================

let adminPaymentFilter = 'pending'; // pending | all
let adminReportFilter = 'open'; // open | resolved
let adminUserSearch = '';
let adminUsersList = [];
let adminPendingVivas = [];
let editingLiveExam = null;
let inspectingReport = null; // { report, itemType, item }

function toDateTimeLocalValue(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function sanitizeOrFilter(text) {
  return String(text || '').replace(/[,()%*]/g, ' ').trim();
}

function getReportTable(itemType) {
  const map = {
    preli: 'preli_questions',
    written: 'written_items',
    vocab: 'vocab_items',
    column: 'columns_items',
  };
  return map[itemType] || null;
}

async function loadAdminData() {
  if (!isAdminUser()) return;
  state.loading = true;
  render();

  try {
    const nowIso = new Date().toISOString();
    const [
      payRes,
      approvedRevRes,
      repRes,
      notRes,
      liveRes,
      vivaPendRes,
      totalUsersRes,
      proUsersRes,
      totalQRes,
    ] = await Promise.all([
      sb.from('payment_requests').select('*').order('created_at', { ascending: false }).limit(100),
      sb.from('payment_requests').select('amount').eq('status', 'approved'),
      sb.from('error_reports').select('*').order('created_at', { ascending: false }).limit(100),
      sb.from('notices').select('*').order('created_at', { ascending: false }).limit(30),
      sb.from('live_exams').select('*').order('start_time', { ascending: false }).limit(30),
      sb.from('viva_items').select('*').eq('viva_type', 'experience').eq('is_public', false).order('created_at', { ascending: false }).limit(50),
      sb.from('profiles').select('id', { count: 'exact', head: true }),
      sb.from('profiles').select('id', { count: 'exact', head: true }).eq('is_pro', true).or(`pro_expires_at.is.null,pro_expires_at.gt.${nowIso}`),
      sb.from('preli_questions').select('id', { count: 'exact', head: true }),
    ]);

    state.paymentRequests = payRes.data || [];
    state.errorReports = repRes.data || [];
    state.adminNotices = notRes.data || [];
    state.liveExams = liveRes.data || [];
    adminPendingVivas = vivaPendRes.data || [];

    const totalRevenue = (approvedRevRes.data || []).reduce((sum, r) => sum + (Number(r.amount) || 0), 0);
    const pendingCount = state.paymentRequests.filter((p) => p.status === 'pending').length;

    state.adminStats = {
      users: totalUsersRes.count || 0,
      proUsers: proUsersRes.count || 0,
      questions: totalQRes.count || 0,
      pendingPayments: pendingCount,
      revenue: totalRevenue,
    };

    if (state.adminSubTab === 'users') {
      await loadAdminUsers();
    }
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

async function switchAdminSubTab(tabName) {
  state.adminSubTab = tabName;
  editingLiveExam = null;
  inspectingReport = null;
  if (tabName === 'users') {
    state.loading = true;
    render();
    await loadAdminUsers();
    state.loading = false;
  }
  render();
}

// ==========================================
// 1. Payment Requests (Atomic RPC Approve / Reject)
// ==========================================
async function handlePaymentAction(requestId, approve) {
  if (state.saving) return;
  const label = approve ? 'Approve করে Pro চালু করতে' : 'Reject করতে';
  if (!confirm(`নিশ্চিতভাবে এই পেমেন্টটি ${label} চান?`)) return;

  state.saving = true;
  render();
  try {
    const { error } = await sb.rpc('process_payment_request', {
      p_request_id: Number(requestId),
      p_approve: Boolean(approve),
    });
    if (error) throw error;
    adminUsersList = []; // ইউজার ট্যাবে গেলে ফ্রেশ স্ট্যাটাস লোড হবে
    showToast(approve ? '✅ পেমেন্ট Approve হয়েছে এবং Pro চালু হয়েছে!' : '❌ পেমেন্ট Reject করা হয়েছে।');
    await loadAdminData();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
    render();
  }
}

// ==========================================
// 2. Scheduled Live Exam Creator (Subject/Category Auto-Pick) & Editor
// ==========================================
async function createLiveExam(e) {
  e.preventDefault();
  if (state.saving) return;

  const f = e.target;
  const title = f.title.value.trim();
  const syllabus = f.syllabus.value.trim();
  const exam_category = f.exam_category.value;
  const subjectId = f.subject_id?.value || 'ALL';
  const duration_minutes = Math.max(5, Number(f.duration_minutes.value) || 30);
  const negative_mark = Number(f.negative_mark.value ?? 0.5);
  const startRaw = f.start_time.value;
  const endRaw = f.end_time.value;
  const is_pro_only = Boolean(f.is_pro_only?.checked);
  const autoCount = Math.min(200, Math.max(5, Number(f.auto_q_count.value) || 50));
  const manualIdsRaw = (f.manual_q_ids?.value || '').trim();

  if (!title || !startRaw || !endRaw) {
    return showToast('পরীক্ষার নাম, শুরু ও শেষের সময় অবশ্যই দিন।', true);
  }

  const startDate = new Date(startRaw);
  const endDate = new Date(endRaw);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
    return showToast('শেষের সময় অবশ্যই শুরুর সময়ের পরে হতে হবে।', true);
  }

  state.saving = true;
  render();
  try {
    let question_ids = [];

    if (manualIdsRaw) {
      const parsedIds = [
        ...new Set(
          manualIdsRaw
            .split(',')
            .map((x) => Number(x.trim()))
            .filter((n) => Number.isInteger(n) && n > 0)
        ),
      ];
      if (parsedIds.length < 2) {
        throw new Error('ম্যানুয়াল Question IDs-এ কমপক্ষে ২টি বৈধ নম্বর কমা দিয়ে দিন (যেমন: 12, 15, 20)।');
      }
      const { data: verifiedRows, error: verErr } = await sb
        .from('preli_questions')
        .select('id')
        .in('id', parsedIds);
      if (verErr) throw verErr;
      const validSet = new Set((verifiedRows || []).map((r) => Number(r.id)));
      question_ids = parsedIds.filter((id) => validSet.has(id));
      if (question_ids.length < 2) {
        throw new Error('প্রদত্ত Question IDs ডাটাবেজে পাওয়া যায়নি।');
      }
    } else {
      let qQuery = sb
        .from('preli_questions')
        .select('id')
        .order('is_important', { ascending: false })
        .limit(500);

      if (subjectId !== 'ALL') {
        const topicIds = state.topics
          .filter((t) => String(t.subject_id) === String(subjectId))
          .map((t) => Number(t.id));
        if (!topicIds.length) {
          throw new Error('নির্বাচিত বিষয়ে এখনো কোনো টপিক যুক্ত হয়নি।');
        }
        qQuery = qQuery.in('topic_id', topicIds);
      }

      if (exam_category !== 'ALL') {
        qQuery = qQuery.contains('exam_tags', [exam_category]);
      }

      const { data: qRows, error: qErr } = await qQuery;
      if (qErr) throw qErr;
      const poolIds = (qRows || []).map((r) => Number(r.id));
      if (poolIds.length < 2) {
        throw new Error('এই বিষয়/ক্যাটাগরিতে লাইভ পরীক্ষা নেওয়ার মতো পর্যাপ্ত প্রশ্ন এখনো ডাটাবেজে নেই।');
      }
      question_ids = shuffleArray(poolIds).slice(0, Math.min(autoCount, poolIds.length));
    }

    const { error } = await sb.from('live_exams').insert({
      title,
      syllabus,
      exam_category,
      question_ids,
      duration_minutes,
      negative_mark,
      start_time: startDate.toISOString(),
      end_time: endDate.toISOString(),
      is_pro_only,
    });
    if (error) throw error;

    e.target.reset();
    showToast(`🔴 লাইভ পরীক্ষা তৈরি হয়েছে (${question_ids.length}টি প্রশ্ন লক করা হয়েছে)!`);
    await loadAdminData();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
    render();
  }
}

function openEditLiveExam(examId) {
  const ex = state.liveExams.find((e) => Number(e.id) === Number(examId));
  if (!ex) return;
  editingLiveExam = ex;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveEditLiveExam(e) {
  e.preventDefault();
  if (!editingLiveExam || state.saving) return;

  const f = e.target;
  const startDate = new Date(f.start_time.value);
  const endDate = new Date(f.end_time.value);
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime()) || endDate <= startDate) {
    return showToast('শেষের সময় অবশ্যই শুরুর সময়ের পরে হতে হবে।', true);
  }

  state.saving = true;
  render();
  try {
    const { error } = await sb
      .from('live_exams')
      .update({
        title: f.title.value.trim(),
        syllabus: f.syllabus.value.trim(),
        duration_minutes: Math.max(5, Number(f.duration_minutes.value) || 30),
        negative_mark: Number(f.negative_mark.value ?? 0.5),
        start_time: startDate.toISOString(),
        end_time: endDate.toISOString(),
        is_pro_only: Boolean(f.is_pro_only?.checked),
      })
      .eq('id', editingLiveExam.id);
    if (error) throw error;

    editingLiveExam = null;
    showToast('✅ লাইভ এক্সাম আপডেট হয়েছে!');
    await loadAdminData();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
    render();
  }
}

// ==========================================
// 3. Pending Viva Experience Moderation
// ==========================================
async function approveAdminViva(id) {
  if (state.saving) return;
  state.saving = true;
  render();
  try {
    const { error } = await sb.from('viva_items').update({ is_public: true }).eq('id', id);
    if (error) throw error;
    showToast('✅ ভাইভা অভিজ্ঞতা সবার জন্য পাবলিশ হয়েছে!');
    await loadAdminData();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
    render();
  }
}

// ==========================================
// 4. Notices Manager
// ==========================================
async function createNotice(e) {
  e.preventDefault();
  if (state.saving) return;
  const title = e.target.title.value.trim();
  const body = e.target.body.value.trim();
  if (!title || !body) return;

  state.saving = true;
  try {
    const { error } = await sb.from('notices').insert({ title, body, is_active: true });
    if (error) throw error;
    e.target.reset();
    showToast('📢 নতুন নোটিশ পাবলিশ হয়েছে!');
    await Promise.all([loadAdminData(), loadInitialData()]);
    render();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function toggleNoticeActive(id, currentActive) {
  if (state.saving) return;
  state.saving = true;
  try {
    const { error } = await sb.from('notices').update({ is_active: !currentActive }).eq('id', id);
    if (error) throw error;
    showToast(!currentActive ? 'নোটিশ চালু করা হয়েছে' : 'নোটিশ হাইড করা হয়েছে');
    await Promise.all([loadAdminData(), loadInitialData()]);
    render();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

// ==========================================
// 5. Error Reports Manager + Inline Item Inspector & Fixer
// ==========================================
async function inspectReportedItem(reportId) {
  const report = state.errorReports.find((r) => Number(r.id) === Number(reportId));
  if (!report || !report.item_id) {
    return showToast('এই রিপোর্টে নির্দিষ্ট আইটেম আইডি নেই।', true);
  }
  const table = getReportTable(report.item_type);
  if (!table) return showToast('এই ধরনের আইটেম ইনলাইন এডিট সাপোর্ট করে না।', true);

  state.loading = true;
  render();
  try {
    const { data, error } = await sb.from(table).select('*').eq('id', report.item_id).single();
    if (error || !data) throw new Error('আইটেমটি ডাটাবেজে পাওয়া যায়নি (সম্ভবত আগেই ডিলিট হয়েছে)।');
    inspectingReport = { report, itemType: report.item_type, item: data };
    window.scrollTo({ top: 0, behavior: 'smooth' });
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

async function saveReportedItemFix(e) {
  e.preventDefault();
  if (!inspectingReport || state.saving) return;

  const { report, itemType, item } = inspectingReport;
  const table = getReportTable(itemType);
  const f = e.target;
  const markResolved = Boolean(f.mark_resolved?.checked);

  state.saving = true;
  render();
  try {
    let payload = {};
    if (itemType === 'preli') {
      payload = {
        question: f.question.value.trim(),
        options: [f.opt0.value.trim(), f.opt1.value.trim(), f.opt2.value.trim(), f.opt3.value.trim()],
        correct_index: Number(f.correct_index.value),
        explanation: f.explanation.value.trim(),
      };
    } else if (itemType === 'vocab') {
      payload = {
        word: f.word.value.trim(),
        meaning_bn: f.meaning_bn.value.trim(),
        synonyms: f.synonyms.value.trim(),
        example: f.example.value.trim(),
      };
    } else if (itemType === 'written') {
      payload = {
        title: f.title.value.trim(),
        content: {
          overview: f.overview.value.trim(),
          body: f.body.value.trim(),
          tips: f.tips.value.trim(),
        },
      };
    } else if (itemType === 'column') {
      payload = {
        title: f.title.value.trim(),
        summary: f.summary.value.trim(),
        key_data: f.key_data.value.trim(),
      };
    }

    const { error: updErr } = await sb.from(table).update(payload).eq('id', item.id);
    if (updErr) throw updErr;

    if (markResolved && report.status !== 'resolved') {
      await sb.from('error_reports').update({ status: 'resolved' }).eq('id', report.id);
    }

    inspectingReport = null;
    showToast('✅ ভুল সংশোধন করে সেভ করা হয়েছে!');
    await loadAdminData();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
    render();
  }
}

async function resolveErrorReport(id) {
  if (state.saving) return;
  state.saving = true;
  try {
    const { error } = await sb.from('error_reports').update({ status: 'resolved' }).eq('id', id);
    if (error) throw error;
    showToast('✅ রিপোর্টটি Resolved হিসেবে চিহ্নিত হয়েছে!');
    await loadAdminData();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

// ==========================================
// 6. Users, Manual Pro & Device Lock Support
// ==========================================
async function loadAdminUsers() {
  let query = sb.from('profiles').select('*').order('created_at', { ascending: false }).limit(50);
  const safeQ = sanitizeOrFilter(adminUserSearch);
  if (safeQ) {
    query = query.or(`email.ilike.%${safeQ}%,full_name.ilike.%${safeQ}%`);
  }
  const { data, error } = await query;
  if (error) showToast(error.message, true);
  adminUsersList = data || [];
}

async function searchAdminUsers(e) {
  e.preventDefault();
  adminUserSearch = e.target.q.value.trim();
  state.loading = true;
  render();
  await loadAdminUsers();
  state.loading = false;
  render();
}

async function clearAdminUserSearch() {
  adminUserSearch = '';
  state.loading = true;
  render();
  await loadAdminUsers();
  state.loading = false;
  render();
}

async function grantManualPro(userId, days) {
  if (state.saving) return;
  if (!confirm(`এই ইউজারকে ${days} দিনের Pro দিতে চান?`)) return;

  state.saving = true;
  render();
  try {
    const user = adminUsersList.find((u) => u.id === userId);
    const baseMs =
      user?.is_pro && user?.pro_expires_at && new Date(user.pro_expires_at).getTime() > Date.now()
        ? new Date(user.pro_expires_at).getTime()
        : Date.now();
    const newExp = new Date(baseMs + days * 86400000).toISOString();

    const { error } = await sb
      .from('profiles')
      .update({ is_pro: true, pro_expires_at: newExp })
      .eq('id', userId);
    if (error) throw error;

    showToast(`✅ ${days} দিনের Pro যুক্ত করা হয়েছে!`);
    await loadAdminData();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
    render();
  }
}

async function revokeManualPro(userId) {
  if (state.saving) return;
  if (!confirm('এই ইউজারের Pro মেম্বারশিপ বাতিল করতে চান?')) return;

  state.saving = true;
  render();
  try {
    const { error } = await sb
      .from('profiles')
      .update({ is_pro: false, pro_expires_at: null })
      .eq('id', userId);
    if (error) throw error;

    showToast('Pro মেম্বারশিপ বাতিল করা হয়েছে।');
    await loadAdminData();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
    render();
  }
}

async function unlockUserDevice(userId) {
  if (state.saving) return;
  if (!confirm('এই ইউজারের ডিভাইস সেশন লক রিসেট করতে চান?')) return;

  state.saving = true;
  try {
    const { error } = await sb
      .from('profiles')
      .update({ active_session_id: null })
      .eq('id', userId);
    if (error) throw error;
    showToast('🔓 ডিভাইস সেশন লক আনলক করা হয়েছে!');
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
    render();
  }
}

// ==========================================
// Helper Render: Inline Report Fixer Form
// ==========================================
function renderInspectReportForm() {
  if (!inspectingReport) return '';
  const { report, itemType, item } = inspectingReport;

  let fieldsHtml = '';
  if (itemType === 'preli') {
    fieldsHtml = `
      <textarea name="question" required rows="2" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(item.question)}</textarea>
      <div class="grid grid-cols-1 gap-1.5">
        ${[0, 1, 2, 3].map((i) => `<input name="opt${i}" required value="${escHtml(item.options?.[i] || '')}" placeholder="অপশন ${i + 1}" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />`).join('')}
      </div>
      <select name="correct_index" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl">
        ${[0, 1, 2, 3].map((i) => `<option value="${i}" ${Number(item.correct_index) === i ? 'selected' : ''}>সঠিক উত্তর: অপশন ${i + 1}</option>`).join('')}
      </select>
      <textarea name="explanation" rows="2" placeholder="ব্যাখ্যা..." class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(item.explanation || '')}</textarea>`;
  } else if (itemType === 'vocab') {
    fieldsHtml = `
      <div class="grid grid-cols-2 gap-2">
        <input name="word" required value="${escHtml(item.word)}" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
        <input name="meaning_bn" required value="${escHtml(item.meaning_bn)}" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
      </div>
      <input name="synonyms" value="${escHtml(item.synonyms || '')}" placeholder="Synonyms" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
      <input name="example" value="${escHtml(item.example || '')}" placeholder="Example" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />`;
  } else if (itemType === 'written') {
    const c = item.content && typeof item.content === 'object' ? item.content : { overview: '', body: String(item.content || ''), tips: '' };
    fieldsHtml = `
      <input name="title" required value="${escHtml(item.title)}" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
      <textarea name="overview" rows="2" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(c.overview || '')}</textarea>
      <textarea name="body" required rows="5" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(c.body || '')}</textarea>
      <textarea name="tips" rows="2" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(c.tips || '')}</textarea>`;
  } else if (itemType === 'column') {
    fieldsHtml = `
      <input name="title" required value="${escHtml(item.title)}" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
      <textarea name="summary" required rows="4" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(item.summary || '')}</textarea>
      <textarea name="key_data" rows="2" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(item.key_data || '')}</textarea>`;
  }

  return `
    <form onsubmit="saveReportedItemFix(event)" class="bg-amber-50 dark:bg-slate-900 border-2 border-amber-400 p-4 rounded-2xl space-y-2.5">
      <div class="flex justify-between items-center">
        <p class="text-xs font-bold text-amber-900 dark:text-amber-300">🛠️ রিপোর্টকৃত আইটেম ঠিক করুন (${escHtml(itemType.toUpperCase())} #${item.id})</p>
        <button type="button" onclick="inspectingReport=null;render()" class="text-xs font-bold text-slate-500">বন্ধ ✕</button>
      </div>
      <p class="text-[11px] bg-white dark:bg-slate-800 p-2 rounded-lg text-rose-600 font-semibold">🚩 ইউজারের রিপোর্ট: ${escHtml(report.message)}</p>
      ${fieldsHtml}
      <label class="flex items-center gap-2 text-xs font-bold cursor-pointer">
        <input type="checkbox" name="mark_resolved" checked class="rounded accent-emerald-600" />
        <span>সেভ করার সাথে সাথে রিপোর্টটি Resolved করে দিন</span>
      </label>
      <button type="submit" ${state.saving ? 'disabled' : ''} class="w-full py-2.5 bg-emerald-600 text-white text-xs font-bold rounded-xl">
        ${state.saving ? 'সেভ হচ্ছে...' : '✅ সংশোধন সেভ করুন'}
      </button>
    </form>`;
}

// ==========================================
// Main Render Admin Studio
// ==========================================
function renderAdmin() {
  if (!isAdminUser()) {
    return `
      <div class="bg-white dark:bg-slate-900 p-8 rounded-2xl text-center space-y-2 border border-rose-200 dark:border-rose-900">
        <p class="text-2xl">🔒</p>
        <h2 class="font-bold text-base text-rose-600">অ্যাডমিন অ্যাক্সেস সংরক্ষিত</h2>
        <p class="text-xs text-slate-500">এই পেজটি শুধুমাত্র অ্যাডমিনের জন্য।</p>
      </div>`;
  }

  const sub = state.adminSubTab || 'payments';
  const openReportsCount = state.errorReports.filter((r) => r.status === 'open').length;

  const filteredPayments =
    adminPaymentFilter === 'pending'
      ? state.paymentRequests.filter((p) => p.status === 'pending')
      : state.paymentRequests;

  const filteredReports = state.errorReports.filter((r) => r.status === adminReportFilter);

  return `
    <div class="space-y-4">
      <!-- হেডার ও রিফ্রেশ -->
      <div class="flex justify-between items-center">
        <div>
          <h1 class="font-bold text-base">🛠️ Admin Studio</h1>
          <p class="text-[11px] text-slate-500">PrepBox BD V2 পূর্ণাঙ্গ কন্ট্রোল সেন্টার</p>
        </div>
        <button onclick="loadAdminData()" class="px-3 py-1.5 bg-slate-200 dark:bg-slate-800 text-xs font-bold rounded-lg">↺ রিফ্রেশ</button>
      </div>

      <!-- ৫টি রিয়েল-টাইম স্ট্যাটস ও আয় কার্ড -->
      <div class="grid grid-cols-2 sm:grid-cols-5 gap-2.5">
        <div class="col-span-2 sm:col-span-1 bg-gradient-to-r from-emerald-600 to-teal-600 text-white p-3.5 rounded-2xl shadow-sm">
          <p class="text-[11px] text-emerald-100">মোট আয় (Approved)</p>
          <p class="text-xl font-bold">৳${Number(state.adminStats.revenue || 0).toLocaleString('en-US')}</p>
        </div>
        <div class="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800">
          <p class="text-[11px] text-slate-500">মোট শিক্ষার্থী</p>
          <p class="text-xl font-bold text-slate-900 dark:text-white">${state.adminStats.users}</p>
        </div>
        <div class="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800">
          <p class="text-[11px] text-slate-500">অ্যাক্টিভ Pro</p>
          <p class="text-xl font-bold text-amber-600">${state.adminStats.proUsers}</p>
        </div>
        <div class="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800">
          <p class="text-[11px] text-slate-500">মোট প্রশ্নব্যাংক</p>
          <p class="text-xl font-bold text-teal-600">${state.adminStats.questions}</p>
        </div>
        <div class="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-100 dark:border-slate-800">
          <p class="text-[11px] text-slate-500">পেন্ডিং পেমেন্ট</p>
          <p class="text-xl font-bold text-rose-600">${state.adminStats.pendingPayments}</p>
        </div>
      </div>

      <!-- ৬টি সাব-ট্যাব -->
      <div class="flex gap-1.5 overflow-x-auto no-scrollbar pb-1">
        <button onclick="switchAdminSubTab('payments')" class="px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${sub === 'payments' ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'}">
          💳 পেমেন্ট (${state.adminStats.pendingPayments})
        </button>
        <button onclick="switchAdminSubTab('live_exams')" class="px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${sub === 'live_exams' ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'}">
          🔴 লাইভ এক্সাম
        </button>
        <button onclick="switchAdminSubTab('reports')" class="px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${sub === 'reports' ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'}">
          🚩 রিপোর্ট (${openReportsCount})
        </button>
        <button onclick="switchAdminSubTab('viva_pending')" class="px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${sub === 'viva_pending' ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'}">
          🗣️ ভাইভা (${adminPendingVivas.length})
        </button>
        <button onclick="switchAdminSubTab('notices')" class="px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${sub === 'notices' ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'}">
          📢 নোটিশ
        </button>
        <button onclick="switchAdminSubTab('users')" class="px-3 py-2 rounded-xl text-xs font-bold whitespace-nowrap ${sub === 'users' ? 'bg-teal-600 text-white' : 'bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700'}">
          👥 ইউজার
        </button>
      </div>

      <!-- ১. পেমেন্ট অ্যাপ্রুভাল ট্যাব -->
      ${sub === 'payments' ? `
        <div class="flex gap-2">
          <button onclick="adminPaymentFilter='pending';render()" class="px-3 py-1.5 rounded-lg text-xs font-bold ${adminPaymentFilter === 'pending' ? 'bg-rose-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}">পেন্ডিং (${state.adminStats.pendingPayments})</button>
          <button onclick="adminPaymentFilter='all';render()" class="px-3 py-1.5 rounded-lg text-xs font-bold ${adminPaymentFilter === 'all' ? 'bg-slate-900 text-white' : 'bg-slate-200 dark:bg-slate-800'}">সব পেমেন্ট</button>
        </div>

        <div class="space-y-2.5">
          ${filteredPayments.length === 0 ? `<div class="bg-white dark:bg-slate-900 p-6 rounded-2xl text-center text-xs text-slate-500">কোনো পেমেন্ট রিকোয়েস্ট নেই।</div>` : ''}
          ${filteredPayments.map((p) => `
            <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-2">
              <div class="flex justify-between items-start gap-2">
                <div>
                  <p class="font-bold text-sm">${escHtml(p.plan_name)} — <span class="text-teal-600">৳${p.amount}</span> (${p.plan_days || 30} দিন)</p>
                  <p class="text-xs text-slate-500">${escHtml(p.user_email || p.user_id)}</p>
                </div>
                <span class="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                  p.status === 'approved' ? 'bg-emerald-100 text-emerald-700' : p.status === 'rejected' ? 'bg-rose-100 text-rose-700' : 'bg-amber-100 text-amber-800'
                }">${escHtml(p.status)}</span>
              </div>
              <div class="text-xs bg-slate-50 dark:bg-slate-800 p-2.5 rounded-xl space-y-0.5">
                <p>মাধ্যম: <b>${escHtml(p.method)}</b> • নম্বর: <b>${escHtml(p.sender_number)}</b></p>
                <p>TrxID: <b class="font-mono text-indigo-600 dark:text-indigo-300">${escHtml(p.trx_id)}</b> • ${formatDateBD(p.created_at)}</p>
              </div>
              ${p.status === 'pending' ? `
                <div class="flex gap-2 pt-1">
                  <button onclick="handlePaymentAction(${p.id},true)" ${state.saving ? 'disabled' : ''} class="flex-1 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl disabled:opacity-50">✅ Approve & Pro দিন</button>
                  <button onclick="handlePaymentAction(${p.id},false)" ${state.saving ? 'disabled' : ''} class="flex-1 py-2 bg-rose-50 dark:bg-rose-950 text-rose-600 text-xs font-bold rounded-xl disabled:opacity-50">❌ Reject</button>
                </div>` : ''}
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- ২. শিডিউল্ড লাইভ এক্সাম ট্যাব (বিষয়ভিত্তিক + এডিটসহ) -->
      ${sub === 'live_exams' ? `
        ${editingLiveExam ? `
          <form onsubmit="saveEditLiveExam(event)" class="bg-amber-50 dark:bg-slate-900 border-2 border-amber-400 p-4 rounded-2xl space-y-3">
            <div class="flex justify-between items-center">
              <h2 class="font-bold text-sm text-amber-900 dark:text-amber-300">✏️ লাইভ এক্সাম এডিট করুন</h2>
              <button type="button" onclick="editingLiveExam=null;render()" class="text-xs font-bold text-slate-500">বাতিল ✕</button>
            </div>
            <input name="title" required value="${escHtml(editingLiveExam.title)}" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            <input name="syllabus" value="${escHtml(editingLiveExam.syllabus || '')}" placeholder="সিলেবাস..." class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            <div class="grid grid-cols-2 gap-2">
              <input name="duration_minutes" type="number" value="${editingLiveExam.duration_minutes || 30}" min="5" max="180" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
              <select name="negative_mark" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl">
                <option value="0.5" ${Number(editingLiveExam.negative_mark) === 0.5 ? 'selected' : ''}>নেগেটিভ: -০.৫০</option>
                <option value="0.25" ${Number(editingLiveExam.negative_mark) === 0.25 ? 'selected' : ''}>নেগেটিভ: -০.২৫</option>
                <option value="0" ${Number(editingLiveExam.negative_mark) === 0 ? 'selected' : ''}>নেগেটিভ নেই (০)</option>
              </select>
            </div>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label class="text-[11px] font-bold text-slate-500">শুরুর সময়</label>
                <input name="start_time" type="datetime-local" required value="${toDateTimeLocalValue(editingLiveExam.start_time)}" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
              </div>
              <div>
                <label class="text-[11px] font-bold text-slate-500">শেষের সময়</label>
                <input name="end_time" type="datetime-local" required value="${toDateTimeLocalValue(editingLiveExam.end_time)}" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
              </div>
            </div>
            <label class="flex items-center gap-2 text-xs font-bold cursor-pointer">
              <input type="checkbox" name="is_pro_only" ${editingLiveExam.is_pro_only ? 'checked' : ''} class="rounded accent-amber-500" />
              <span>👑 শুধুমাত্র Pro মেম্বারদের জন্য লক করুন</span>
            </label>
            <button type="submit" ${state.saving ? 'disabled' : ''} class="w-full py-2.5 bg-amber-500 text-slate-950 text-xs font-bold rounded-xl">পরিবর্তন সেভ করুন</button>
          </form>
        ` : `
          <form onsubmit="createLiveExam(event)" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-3">
            <h2 class="font-bold text-sm">🔴 নতুন শিডিউল্ড লাইভ এক্সাম তৈরি করুন</h2>
            <input name="title" required placeholder="পরীক্ষার শিরোনাম (যেমন: ৪৭তম বিসিএস সাপ্তাহিক লাইভ টেস্ট-১)" class="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl" />
            <input name="syllabus" placeholder="সিলেবাস (যেমন: বাংলা ব্যাকরণ + বাংলাদেশ সংবিধান)" class="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl" />

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select name="exam_category" class="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl">
                <option value="ALL">ক্যাটাগরি: সমন্বিত (সব)</option>
                <option value="BCS">ক্যাটাগরি: বিসিএস (BCS)</option>
                <option value="Bank">ক্যাটাগরি: ব্যাংক (Bank)</option>
                <option value="Primary">ক্যাটাগরি: প্রাইমারি (Primary)</option>
              </select>
              <select name="subject_id" class="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl">
                <option value="ALL">বিষয়: সব বিষয় (মিক্সড)</option>
                ${state.subjects.map((s) => `<option value="${s.id}">শুধু: ${escHtml(s.name)}</option>`).join('')}
              </select>
            </div>

            <div class="grid grid-cols-3 gap-2">
              <input name="auto_q_count" type="number" value="50" min="5" max="200" placeholder="প্রশ্ন সংখ্যা" class="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl" />
              <input name="duration_minutes" type="number" value="30" min="5" max="180" placeholder="সময় (মি.)" class="px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl" />
              <select name="negative_mark" class="px-2 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl">
                <option value="0.5">-০.৫০</option>
                <option value="0.25">-০.২৫</option>
                <option value="0">০.০০</option>
              </select>
            </div>

            <div class="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <label class="text-[11px] font-bold text-slate-500">শুরুর সময়</label>
                <input name="start_time" type="datetime-local" required class="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl" />
              </div>
              <div>
                <label class="text-[11px] font-bold text-slate-500">শেষের সময়</label>
                <input name="end_time" type="datetime-local" required class="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl" />
              </div>
            </div>

            <input name="manual_q_ids" placeholder="নির্দিষ্ট Question IDs (ঐচ্ছিক, কমা দিয়ে যেমন: 12,15,20 — খালি রাখলে অটো বাছাই হবে)" class="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl" />

            <label class="flex items-center gap-2 text-xs font-bold cursor-pointer">
              <input type="checkbox" name="is_pro_only" class="rounded accent-amber-500" />
              <span>👑 শুধুমাত্র Pro মেম্বারদের জন্য লক করুন</span>
            </label>

            <button type="submit" ${state.saving ? 'disabled' : ''} class="w-full py-2.5 bg-rose-600 text-white text-xs font-bold rounded-xl shadow-sm">
              ${state.saving ? 'তৈরি হচ্ছে...' : '🔴 লাইভ এক্সাম পাবলিশ করুন'}
            </button>
          </form>
        `}

        <div class="space-y-2.5">
          ${state.liveExams.map((ex) => `
            <div class="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 flex justify-between items-center gap-2">
              <div class="min-w-0">
                <p class="font-bold text-sm truncate">${escHtml(ex.title)}</p>
                <p class="text-[11px] text-slate-500">${(ex.question_ids || []).length} প্রশ্ন • ${formatDateBD(ex.start_time)}</p>
              </div>
              <div class="flex gap-1.5 shrink-0">
                <button onclick="openEditLiveExam(${ex.id})" class="px-2 py-1 bg-amber-50 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-xs font-bold rounded-lg">✏️</button>
                <button onclick="openLiveLeaderboard(${ex.id})" class="px-2 py-1 bg-amber-100 text-amber-800 text-xs font-bold rounded-lg">🏆</button>
                <button onclick="deleteItem('live_exams','${ex.id}',loadAdminData)" class="px-2 py-1 bg-rose-50 text-rose-600 text-xs font-bold rounded-lg">🗑️</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- ৩. ভুল প্রশ্ন রিপোর্ট ট্যাব (+ ইনলাইন এডিট) -->
      ${sub === 'reports' ? `
        ${renderInspectReportForm()}

        <div class="flex gap-2">
          <button onclick="adminReportFilter='open';render()" class="px-3 py-1.5 rounded-lg text-xs font-bold ${adminReportFilter === 'open' ? 'bg-rose-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}">অমীমাংসিত (${openReportsCount})</button>
          <button onclick="adminReportFilter='resolved';render()" class="px-3 py-1.5 rounded-lg text-xs font-bold ${adminReportFilter === 'resolved' ? 'bg-emerald-600 text-white' : 'bg-slate-200 dark:bg-slate-800'}">সমাধানকৃত</button>
        </div>

        <div class="space-y-2.5">
          ${filteredReports.length === 0 ? `<div class="bg-white dark:bg-slate-900 p-6 rounded-2xl text-center text-xs text-slate-500">কোনো রিপোর্ট নেই।</div>` : ''}
          ${filteredReports.map((r) => `
            <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2">
              <div class="flex justify-between items-center text-[11px]">
                <span class="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-bold uppercase">${escHtml(r.item_type)} #${r.item_id || '-'}</span>
                <span class="text-slate-400">${formatDateBD(r.created_at)}</span>
              </div>
              <p class="text-xs sm:text-sm">${escHtml(r.message)}</p>
              <div class="flex flex-wrap gap-2">
                ${r.item_id && getReportTable(r.item_type) ? `<button onclick="inspectReportedItem(${r.id})" class="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg">🔍 দেখুন ও ঠিক করুন</button>` : ''}
                ${r.status === 'open' ? `<button onclick="resolveErrorReport(${r.id})" class="px-3 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg">✅ Resolved</button>` : ''}
                <button onclick="deleteItem('error_reports','${r.id}',loadAdminData)" class="px-3 py-1.5 bg-rose-50 text-rose-600 text-xs font-bold rounded-lg">🗑️ ডিলিট</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- ৪. পেন্ডিং ভাইভা অভিজ্ঞতা অনুমোদন ট্যাব -->
      ${sub === 'viva_pending' ? `
        <div class="space-y-3">
          ${adminPendingVivas.length === 0 ? `<div class="bg-white dark:bg-slate-900 p-6 rounded-2xl text-center text-xs text-slate-500">কোনো পেন্ডিং ভাইভা অভিজ্ঞতা নেই।</div>` : ''}
          ${adminPendingVivas.map((v) => `
            <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-amber-200 dark:border-amber-800 space-y-2.5">
              <div>
                <p class="font-bold text-sm">${escHtml(v.title)}</p>
                <p class="text-[11px] text-slate-500">${escHtml(v.district || '-')} • ${escHtml(v.subject_name || '-')} • ${formatDateBD(v.created_at)}</p>
              </div>
              <div class="bg-slate-50 dark:bg-slate-800 p-3 rounded-xl text-xs space-y-1.5 max-h-40 overflow-y-auto">
                ${(v.qa_list || []).map((qa, i) => `<p><b>${i + 1}. ${escHtml(qa.q)}:</b> ${escHtml(qa.a)}</p>`).join('')}
              </div>
              <div class="flex gap-2">
                <button onclick="approveAdminViva(${v.id})" ${state.saving ? 'disabled' : ''} class="flex-1 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl">✅ পাবলিশ করুন</button>
                <button onclick="deleteItem('viva_items','${v.id}',loadAdminData)" class="flex-1 py-2 bg-rose-50 text-rose-600 text-xs font-bold rounded-xl">🗑️ ডিলিট</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- ৫. নোটিশ বোর্ড ট্যাব -->
      ${sub === 'notices' ? `
        <form onsubmit="createNotice(event)" class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2.5">
          <h2 class="font-bold text-sm">📢 নতুন নোটিশ দিন</h2>
          <input name="title" required placeholder="নোটিশের শিরোনাম (যেমন: আগামীকাল রাত ৯টায় ফ্রি লাইভ এক্সাম!)" class="w-full px-3 py-2 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl" />
          <textarea name="body" required rows="2" placeholder="বিস্তারিত বার্তা..." class="w-full p-2.5 text-xs bg-slate-50 dark:bg-slate-800 border rounded-xl"></textarea>
          <button type="submit" ${state.saving ? 'disabled' : ''} class="w-full py-2.5 bg-teal-600 text-white text-xs font-bold rounded-xl">নোটিশ পাবলিশ করুন</button>
        </form>

        <div class="space-y-2.5">
          ${state.adminNotices.map((n) => `
            <div class="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 flex justify-between items-start gap-2">
              <div>
                <p class="font-bold text-sm">${escHtml(n.title)} ${n.is_active ? '<span class="text-[10px] text-emerald-600">(Active)</span>' : '<span class="text-[10px] text-slate-400">(Hidden)</span>'}</p>
                <p class="text-xs text-slate-500 mt-0.5">${escHtml(n.body)}</p>
              </div>
              <div class="flex gap-1.5 shrink-0">
                <button onclick="toggleNoticeActive(${n.id},${n.is_active})" class="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-xs font-bold rounded-lg">${n.is_active ? 'Hide' : 'Show'}</button>
                <button onclick="deleteItem('notices','${n.id}',async()=>{await loadAdminData();await loadInitialData();render()})" class="px-2 py-1 bg-rose-50 text-rose-600 text-xs rounded-lg">🗑️</button>
              </div>
            </div>
          `).join('')}
        </div>
      ` : ''}

      <!-- ৬. ইউজার, ম্যানুয়াল Pro ও ডিভাইস আনলক ট্যাব -->
      ${sub === 'users' ? `
        <form onsubmit="searchAdminUsers(event)" class="flex gap-2">
          <input name="q" value="${escHtml(adminUserSearch)}" placeholder="ইউজারের নাম বা ইমেইল খুঁজুন..." class="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl" />
          <button type="submit" class="px-3 py-2 bg-teal-600 text-white text-xs font-bold rounded-xl">খুঁজুন</button>
          ${adminUserSearch ? `<button type="button" onclick="clearAdminUserSearch()" class="px-2.5 py-2 bg-slate-200 dark:bg-slate-700 text-xs font-bold rounded-xl">✕</button>` : ''}
        </form>

        ${state.loading ? `<p class="text-center text-xs text-slate-500 py-4">লোড হচ্ছে...</p>` : ''}

        <div class="space-y-2.5">
          ${!state.loading && adminUsersList.length === 0 ? `<div class="bg-white dark:bg-slate-900 p-6 rounded-2xl text-center text-xs text-slate-500">কোনো ইউজার পাওয়া যায়নি।</div>` : ''}
          ${adminUsersList.map((u) => {
            const activePro = u.is_pro && (!u.pro_expires_at || new Date(u.pro_expires_at) > new Date());
            return `
              <div class="bg-white dark:bg-slate-900 p-3.5 rounded-xl border border-slate-100 dark:border-slate-800 space-y-2">
                <div class="flex justify-between items-start gap-2">
                  <div class="min-w-0">
                    <p class="font-bold text-sm truncate">${escHtml(u.full_name)} ${u.role === 'admin' ? '<span class="text-[10px] text-teal-600">(Admin)</span>' : ''}</p>
                    <p class="text-xs text-slate-500 truncate">${escHtml(u.email || '')} • রেফারাল: ${u.referral_count || 0}</p>
                  </div>
                  <span class="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${activePro ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-500'}">
                    ${activePro ? '👑 PRO' : 'FREE'}
                  </span>
                </div>
                ${activePro && u.pro_expires_at ? `<p class="text-[11px] text-slate-400">মেয়াদ: ${formatDateBD(u.pro_expires_at)}</p>` : ''}
                ${u.role !== 'admin' ? `
                  <div class="flex flex-wrap gap-1.5">
                    <button onclick="grantManualPro('${u.id}',30)" ${state.saving ? 'disabled' : ''} class="px-2.5 py-1 bg-teal-600 text-white text-[11px] font-bold rounded-lg">+৩০ দিন</button>
                    <button onclick="grantManualPro('${u.id}',180)" ${state.saving ? 'disabled' : ''} class="px-2.5 py-1 bg-indigo-600 text-white text-[11px] font-bold rounded-lg">+৬ মাস</button>
                    <button onclick="grantManualPro('${u.id}',365)" ${state.saving ? 'disabled' : ''} class="px-2.5 py-1 bg-amber-500 text-slate-950 text-[11px] font-bold rounded-lg">+১ বছর</button>
                    <button onclick="unlockUserDevice('${u.id}')" ${state.saving ? 'disabled' : ''} class="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold rounded-lg">🔓 আনলক</button>
                    ${activePro ? `<button onclick="revokeManualPro('${u.id}')" ${state.saving ? 'disabled' : ''} class="px-2.5 py-1 bg-rose-50 text-rose-600 text-[11px] font-bold rounded-lg">বাতিল</button>` : ''}
                  </div>` : ''}
              </div>`;
          }).join('')}
        </div>
      ` : ''}
    </div>`;
}