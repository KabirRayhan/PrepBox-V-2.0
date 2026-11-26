// ==========================================
// PrepBox BD V2 — 3-Layer Smart Preli, Mixed Model Test & Live Exam Engine
// ==========================================
const PRELI_PAGE_SIZE = 30;
let examTimerInterval = null;

function stopExamTimer() {
  if (examTimerInterval) {
    clearInterval(examTimerInterval);
    examTimerInterval = null;
  }
}

function formatTimer(sec) {
  const safe = Math.max(0, Number(sec) || 0);
  const h = Math.floor(safe / 3600);
  const m = Math.floor((safe % 3600) / 60);
  const s = safe % 60;
  if (h > 0) {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function matchesExamFilter(tags) {
  if (state.examFilter === 'ALL') return true;
  if (!Array.isArray(tags) || tags.length === 0) return true;
  return tags.includes(state.examFilter);
}

function getCheckedTagsFromForm(formEl) {
  const checked = Array.from(formEl.querySelectorAll('input[name="tag_pick"]:checked')).map((el) => el.value);
  return checked.length ? checked : ['BCS', 'Bank', 'Primary'];
}

function onPreliFilterChange(filterId) {
  setExamFilter(filterId);
  if (state.preliMode === 'browse') {
    if (state.selectedTopic) {
      if (!matchesExamFilter(state.selectedTopic.exam_tags)) {
        state.selectedTopic = null;
        if (state.selectedSubject && !matchesExamFilter(state.selectedSubject.exam_tags)) {
          state.selectedSubject = null;
        }
        render();
        return;
      }
      loadQuestions(state.selectedTopic.id, false);
      return;
    }
    if (state.selectedSubject && !matchesExamFilter(state.selectedSubject.exam_tags)) {
      state.selectedSubject = null;
    }
  }
  render();
}

function selectSubject(id) {
  state.preliMode = 'browse';
  state.selectedSubject = state.subjects.find((x) => String(x.id) === String(id)) || null;
  state.selectedTopic = null;
  state.showAddTopic = false;
  render();
}

function selectTopic(id) {
  stopExamTimer();
  state.preliMode = 'browse';
  state.selectedTopic = state.topics.find((x) => String(x.id) === String(id)) || null;
  state.preliSearch = '';
  state.preliOnlyImportant = false;
  state.modelTestActive = false;
  state.modelTestSubmitted = false;
  state.activeLiveExamId = null;
  state.editing = null;
  loadQuestions(id, false);
}

function togglePreliImportantOnly() {
  state.preliOnlyImportant = !state.preliOnlyImportant;
  if (state.selectedTopic) loadQuestions(state.selectedTopic.id, false);
  else render();
}

function openMixedTestSetup() {
  stopExamTimer();
  state.preliMode = 'mixed_setup';
  state.selectedSubject = null;
  state.selectedTopic = null;
  state.modelTestActive = false;
  state.modelTestSubmitted = false;
  state.activeLiveExamId = null;
  render();
}

function startExamCountdown() {
  stopExamTimer();
  examTimerInterval = setInterval(() => {
    state.modelTestSecondsLeft--;
    const el = document.getElementById('examTimerText');
    if (el) el.textContent = formatTimer(state.modelTestSecondsLeft);
    if (state.modelTestSecondsLeft <= 0) {
      submitModelTest(true);
    }
  }, 1000);
}

async function startMixedModelTest(e) {
  e.preventDefault();
  if (state.loading) return;

  const examTag = e.target.exam_tag.value;
  const count = Number(e.target.q_count.value);
  const negMark = Number(e.target.neg_mark.value);
  const onlyVvi = Boolean(e.target.only_vvi?.checked);

  if (!isProUser() && count > 25) {
    showToast('৫০, ১০০ বা ২০০ প্রশ্নের পূর্ণাঙ্গ পরীক্ষা দিতে Pro সাবস্ক্রিপশন নিন!', true);
    setTab('profile');
    return;
  }

  state.loading = true;
  render();
  try {
    let query = sb.from('preli_questions').select('*').limit(500);
    if (examTag !== 'ALL') query = query.contains('exam_tags', [examTag]);
    if (onlyVvi) query = query.eq('is_important', true);

    let { data, error } = await query;
    if (error) throw error;
    let pool = data || [];

    // VVI-তে পর্যাপ্ত প্রশ্ন না থাকলে সব প্রশ্ন থেকে নেওয়া
    if (onlyVvi && pool.length < 2) {
      let fallbackQ = sb.from('preli_questions').select('*').limit(500);
      if (examTag !== 'ALL') fallbackQ = fallbackQ.contains('exam_tags', [examTag]);
      const fb = await fallbackQ;
      pool = fb.data || [];
      if (pool.length >= 2) showToast('VVI প্রশ্ন কম থাকায় এই ক্যাটাগরির সব প্রশ্ন থেকে সেট তৈরি করা হয়েছে।');
    }

    if (pool.length < 2) {
      showToast('এই ক্যাটাগরিতে পূর্ণাঙ্গ পরীক্ষার জন্য পর্যাপ্ত প্রশ্ন এখনো যুক্ত হয়নি।', true);
      state.loading = false;
      render();
      return;
    }

    const picked = shuffleArray(pool).slice(0, Math.min(count, pool.length));
    const totalSec = Math.max(120, Math.round(picked.length * 36));
    const labelMap = { ALL: 'সমন্বিত', BCS: 'বিসিএস', Bank: 'ব্যাংক', Primary: 'প্রাইমারি' };

    state.preliMode = 'mixed_exam';
    state.questions = picked;
    state.questionsTotal = picked.length;
    state.modelTestNegMark = negMark;
    state.modelTestTitle = `${labelMap[examTag] || examTag} মিক্সড মডেল টেস্ট (${picked.length} প্রশ্ন)`;
    state.activeLiveExamId = null;
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

// শিডিউল্ড লাইভ এক্সাম রানার (live.js থেকে কল হবে)
async function startScheduledLiveExam(exam) {
  if (!exam) return;
  if (exam.is_pro_only && !isProUser()) {
    showToast('এই লাইভ পরীক্ষাটি শুধুমাত্র Pro মেম্বারদের জন্য!', true);
    setTab('profile');
    return;
  }

  const now = Date.now();
  const startMs = new Date(exam.start_time).getTime();
  const endMs = new Date(exam.end_time).getTime();

  if (!isAdminUser()) {
    if (now < startMs) {
      showToast('এই লাইভ পরীক্ষাটি এখনো শুরু হয়নি!', true);
      return;
    }
    if (now > endMs) {
      showToast('এই লাইভ পরীক্ষার সময় শেষ হয়ে গেছে। মেধাতালিকা দেখুন।', true);
      return;
    }
    if (state.myLiveAttempts.includes(Number(exam.id))) {
      showToast('আপনি ইতিমধ্যে এই লাইভ পরীক্ষা দিয়েছেন! মেধাতালিকা দেখুন।', true);
      return;
    }
  }

  state.loading = true;
  state.tab = 'preli';
  render();
  try {
    let qData = [];
    if (Array.isArray(exam.question_ids) && exam.question_ids.length > 0) {
      const { data, error } = await sb.from('preli_questions').select('*').in('id', exam.question_ids);
      if (error) throw error;
      // question_ids-এর ক্রম বজায় রাখা
      const byId = new Map((data || []).map((q) => [Number(q.id), q]));
      qData = exam.question_ids.map((id) => byId.get(Number(id))).filter(Boolean);
    } else {
      let query = sb.from('preli_questions').select('*').order('is_important', { ascending: false }).limit(150);
      if (exam.exam_category && exam.exam_category !== 'ALL') {
        query = query.contains('exam_tags', [exam.exam_category]);
      }
      const { data, error } = await query;
      if (error) throw error;
      qData = shuffleArray(data || []).slice(0, 50);
    }

    if (qData.length === 0) {
      showToast('এই লাইভ পরীক্ষায় এখনো কোনো প্রশ্ন পাওয়া যায়নি।', true);
      state.loading = false;
      state.tab = 'live';
      render();
      return;
    }

    const durationSec = (Number(exam.duration_minutes) || 30) * 60;
    const remainUntilEnd = Math.floor((endMs - Date.now()) / 1000);
    const totalSec = isAdminUser()
      ? durationSec
      : Math.max(30, Math.min(durationSec, remainUntilEnd > 0 ? remainUntilEnd : durationSec));

    state.preliMode = 'live_exam';
    state.questions = qData;
    state.questionsTotal = qData.length;
    state.modelTestNegMark = Number(exam.negative_mark ?? 0.5);
    state.modelTestTitle = `🔴 লাইভ: ${exam.title}`;
    state.activeLiveExamId = Number(exam.id);
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

async function openPreliSpecial(mode) {
  stopExamTimer();
  state.preliMode = mode; // 'bookmarks' or 'mistakes'
  state.selectedSubject = null;
  state.selectedTopic = null;
  state.modelTestActive = false;
  state.modelTestSubmitted = false;
  state.activeLiveExamId = null;
  state.preliSearch = '';
  const ids = mode === 'bookmarks' ? (state.bookmarks.preli || []) : (state.mistakes || []);
  state.loading = true;
  render();

  if (!ids.length) {
    state.questions = [];
    state.questionsTotal = 0;
    state.answered = {};
    state.loading = false;
    render();
    return;
  }

  const { data } = await sb.from('preli_questions').select('*').in('id', ids.slice(0, 100));
  state.questions = data || [];
  state.questionsTotal = state.questions.length;
  state.answered = {};
  state.loading = false;
  render();
}

async function loadQuestions(topicId, append = false) {
  state.loading = true;
  if (!append) state.questions = [];
  render();

  const from = append ? state.questions.length : 0;
  const to = from + PRELI_PAGE_SIZE - 1;

  let query = sb
    .from('preli_questions')
    .select('*', { count: 'exact' })
    .eq('topic_id', topicId)
    .order('is_important', { ascending: false })
    .order('created_at', { ascending: false })
    .range(from, to);

  if (state.examFilter !== 'ALL') {
    query = query.contains('exam_tags', [state.examFilter]);
  }
  if (state.preliOnlyImportant) {
    query = query.eq('is_important', true);
  }
  if (state.preliSearch) {
    query = query.ilike('question', `%${state.preliSearch}%`);
  }

  const { data, count, error } = await query;
  if (error) showToast(error.message, true);
  state.questions = append ? [...state.questions, ...(data || [])] : (data || []);
  state.questionsTotal = count ?? state.questions.length;
  if (!append) state.answered = {};
  state.loading = false;
  render();
}

function searchPreli(e) {
  e.preventDefault();
  state.preliSearch = e.target.q.value.trim();
  if (state.selectedTopic) loadQuestions(state.selectedTopic.id, false);
}

function clearPreliSearch() {
  state.preliSearch = '';
  if (state.selectedTopic) loadQuestions(state.selectedTopic.id, false);
}

function answerPreli(qId, oIdx) {
  if (state.modelTestActive) {
    if (state.modelTestSubmitted) return;
    state.modelTestAnswers[qId] = oIdx;
    render();
    return;
  }
  const q = state.questions.find((x) => String(x.id) === String(qId));
  state.answered[qId] = oIdx;
  if (q) recordMistake(q.id, oIdx !== q.correct_index);
  render();
}

function resetPreliAnswers() {
  state.answered = {};
  showToast('উত্তর রিসেট করা হয়েছে — আবার প্র্যাকটিস করুন!');
  render();
}

function startTopicModelTest() {
  const visibleCount = isProUser()
    ? state.questions.length
    : Math.min(state.questions.length, FREE_LIMITS.preliPerTopic);
  if (visibleCount < 2) return;
  stopExamTimer();
  const totalSec = Math.max(60, visibleCount * 45);
  state.modelTestNegMark = state.examFilter === 'Primary' ? 0.25 : 0.5;
  state.modelTestTitle = state.selectedTopic ? state.selectedTopic.name : 'টপিক মডেল টেস্ট';
  state.activeLiveExamId = null;
  state.modelTestActive = true;
  state.modelTestSubmitted = false;
  state.modelTestAnswers = {};
  state.modelTestTotalSeconds = totalSec;
  state.modelTestSecondsLeft = totalSec;
  render();
  startExamCountdown();
}

async function submitModelTest(autoSubmitted = false) {
  if (state.modelTestSubmitted) return;
  if (!autoSubmitted && !confirm('পরীক্ষা জমা দিতে চান? জমা দেওয়ার পর উত্তর বদলানো যাবে না।')) {
    return;
  }

  stopExamTimer();
  state.modelTestSubmitted = true;

  const isFullExam = state.preliMode === 'mixed_exam' || state.preliMode === 'live_exam';
  const qs = isFullExam || isProUser() ? state.questions : state.questions.slice(0, FREE_LIMITS.preliPerTopic);

  let correct = 0;
  let wrong = 0;
  const wrongIds = [];
  const correctIds = [];

  qs.forEach((q) => {
    const picked = state.modelTestAnswers[q.id];
    if (picked !== undefined) {
      if (picked === q.correct_index) {
        correct++;
        correctIds.push(q.id);
      } else {
        wrong++;
        wrongIds.push(q.id);
      }
    }
  });

  const negRate = state.modelTestNegMark ?? 0.5;
  const netScore = Number((correct - wrong * negRate).toFixed(2));
  const timeTaken = Math.max(1, (state.modelTestTotalSeconds || 0) - Math.max(0, state.modelTestSecondsLeft));

  // ১টি ব্যাচ কলেই সব ভুল/সঠিক প্রশ্ন ক্লাউডে সিঙ্ক
  syncMistakesBatch(wrongIds, correctIds);

  // রেজাল্ট ও লিডারবোর্ডে সেভ
  try {
    const { error } = await sb.from('exam_results').insert({
      user_id: state.user.id,
      user_name: state.profile?.full_name || 'Student',
      live_exam_id: state.activeLiveExamId || null,
      exam_title: state.modelTestTitle || 'মডেল টেস্ট',
      total_questions: qs.length,
      correct_count: correct,
      wrong_count: wrong,
      net_score: netScore,
      time_taken_seconds: timeTaken,
    });

    if (error) {
      if (error.code === '23505') {
        showToast('আপনার প্রথম অ্যাটেম্পটের স্কোর ইতিমধ্যে মেধাতালিকায় সংরক্ষিত আছে।');
      } else {
        showToast('রেজাল্ট সেভ করতে সমস্যা হয়েছে: ' + error.message, true);
      }
    } else {
      if (state.activeLiveExamId && !state.myLiveAttempts.includes(Number(state.activeLiveExamId))) {
        state.myLiveAttempts.push(Number(state.activeLiveExamId));
      }
      showToast(autoSubmitted ? 'সময় শেষ! পরীক্ষা স্বয়ংক্রিয়ভাবে জমা হয়েছে।' : 'পরীক্ষা জমা হয়েছে ও মেধাতালিকায় যুক্ত হয়েছে!');
    }
  } catch (_) {}

  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function exitModelTest(force = false) {
  if (state.modelTestActive && !state.modelTestSubmitted && !force) {
    if (!confirm('পরীক্ষা চলছে! এখন বের হলে আপনার দাগানো উত্তর মুছে যাবে। নিশ্চিতভাবে বের হতে চান?')) {
      return false;
    }
  }
  stopExamTimer();
  const wasLive = state.preliMode === 'live_exam';
  const wasMixed = state.preliMode === 'mixed_exam';
  state.modelTestActive = false;
  state.modelTestSubmitted = false;
  state.activeLiveExamId = null;

  if (wasLive) {
    state.preliMode = 'browse';
    setTab('live');
    return true;
  }
  if (wasMixed) {
    state.preliMode = 'browse';
  }
  render();
  return true;
}

function goBackFromPreliView() {
  if (state.modelTestActive) {
    exitModelTest(false);
    return;
  }
  state.selectedTopic = null;
  state.preliMode = 'browse';
  state.editing = null;
  render();
}

// ==========================================
// Admin: Subject, Topic, Edit, Bulk JSON & Smart AI
// ==========================================
async function addSubject(e) {
  e.preventDefault();
  if (state.saving) return;
  const name = e.target.subject_name.value.trim();
  if (!name) return;
  const examTags = getCheckedTagsFromForm(e.target);

  state.saving = true;
  try {
    const nextOrder = state.subjects.length
      ? Math.max(...state.subjects.map((s) => Number(s.sort_order) || 0)) + 1
      : 1;
    const { error } = await sb.from('subjects').insert({ name, sort_order: nextOrder, exam_tags: examTags });
    if (error) throw error;
    e.target.reset();
    state.showAddSubject = false;
    showToast(`"${name}" বিষয় যুক্ত হয়েছে!`);
    await loadInitialData();
    render();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function deleteSubject(event, subjectId) {
  event.stopPropagation();
  if (!confirm('এই বিষয় এবং এর ভেতরের সব টপিক ও প্রশ্ন মুছে ফেলতে চান?')) return;
  const { error } = await sb.from('subjects').delete().eq('id', subjectId);
  if (error) return showToast(error.message, true);
  showToast('বিষয়টি ডিলিট করা হয়েছে!');
  await loadInitialData();
  render();
}

async function addTopics(e) {
  e.preventDefault();
  if (!state.selectedSubject || state.saving) return;
  const raw = e.target.topic_names.value.trim();
  if (!raw) return;
  const examTags = getCheckedTagsFromForm(e.target);

  state.saving = true;
  try {
    const names = raw.split('\n').map((s) => s.trim()).filter(Boolean);
    const existing = new Set(
      state.topics
        .filter((t) => String(t.subject_id) === String(state.selectedSubject.id))
        .map((t) => normText(t.name))
    );
    const rows = [];
    let skipped = 0;
    names.forEach((name) => {
      const key = normText(name);
      if (existing.has(key)) { skipped++; return; }
      existing.add(key);
      rows.push({ subject_id: state.selectedSubject.id, name, exam_tags: examTags });
    });
    if (!rows.length) return showToast('এই টপিকগুলো আগে থেকেই আছে!', true);

    const { error } = await sb.from('topics').insert(rows);
    if (error) throw error;
    e.target.reset();
    state.showAddTopic = false;
    showToast(skipped ? `${rows.length}টি টপিক যুক্ত হয়েছে (${skipped}টি ডুপ্লিকেট বাদ)` : `${rows.length}টি নতুন টপিক যুক্ত হয়েছে!`);
    await loadInitialData();
    render();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function deleteTopic(event, topicId) {
  event.stopPropagation();
  if (!confirm('এই টপিক এবং এর ভেতরের সব প্রশ্ন মুছে ফেলতে চান?')) return;
  const { error } = await sb.from('topics').delete().eq('id', topicId);
  if (error) return showToast(error.message, true);
  showToast('টপিক ডিলিট করা হয়েছে!');
  await loadInitialData();
  render();
}

function openEditPreli(id) {
  const item = state.questions.find((q) => String(q.id) === String(id));
  if (!item) return;
  state.editing = { type: 'preli', item };
  state.showBulk.preli = false;
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveEditPreli(e) {
  e.preventDefault();
  if (!state.editing || state.saving) return;
  state.saving = true;
  try {
    const f = e.target;
    const options = [f.opt0.value.trim(), f.opt1.value.trim(), f.opt2.value.trim(), f.opt3.value.trim()];
    const tags = f.exam_tags.value.split(',').map((s) => s.trim()).filter(Boolean);
    const { error } = await sb
      .from('preli_questions')
      .update({
        question: f.question.value.trim(),
        options,
        correct_index: Number(f.correct_index.value),
        explanation: f.explanation.value.trim(),
        exam_tags: tags.length ? tags : ['BCS', 'Bank', 'Primary'],
        is_important: Boolean(f.is_important?.checked),
        source_note: f.source_note?.value.trim() || '',
      })
      .eq('id', state.editing.item.id);
    if (error) throw error;
    state.editing = null;
    showToast('প্রশ্ন সফলভাবে আপডেট হয়েছে!');
    if (state.selectedTopic) await loadQuestions(state.selectedTopic.id, false);
    else await openPreliSpecial(state.preliMode);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function importPreliJSON(e) {
  e.preventDefault();
  if (!state.selectedTopic || state.saving) return;
  state.saving = true;
  try {
    const parsed = parseBulkJSON(e.target.json_data.value);
    const items = Array.isArray(parsed) ? parsed : [parsed];

    const { data: existingRows } = await sb
      .from('preli_questions')
      .select('question')
      .eq('topic_id', state.selectedTopic.id);
    const seen = new Set((existingRows || []).map((r) => normText(r.question)));

    const defaultTags =
      state.examFilter !== 'ALL'
        ? [state.examFilter]
        : (state.selectedTopic.exam_tags?.length ? state.selectedTopic.exam_tags : ['BCS', 'Bank', 'Primary']);

    const rows = [];
    let skipped = 0;
    items.forEach((q, i) => {
      if (!q.question || !Array.isArray(q.options) || q.options.length < 2 || q.correct_index === undefined) {
        throw new Error(`${i + 1} নম্বর প্রশ্নে তথ্য অসম্পূর্ণ আছে।`);
      }
      const key = normText(q.question);
      if (seen.has(key)) { skipped++; return; }
      seen.add(key);
      rows.push({
        topic_id: state.selectedTopic.id,
        question: String(q.question).trim(),
        options: q.options.map((o) => String(o).trim()),
        correct_index: Number(q.correct_index),
        explanation: String(q.explanation || '').trim(),
        exam_tags: Array.isArray(q.exam_tags) && q.exam_tags.length ? q.exam_tags : defaultTags,
        is_important: Boolean(q.is_important),
        source_note: String(q.source_note || '').trim(),
      });
    });

    if (!rows.length) return showToast('সবগুলো প্রশ্ন আগে থেকেই এই টপিকে আছে!', true);

    const { error } = await sb.from('preli_questions').insert(rows);
    if (error) throw error;
    e.target.reset();
    state.showBulk.preli = false;
    showToast(skipped ? `${rows.length}টি প্রশ্ন সেভ হয়েছে (${skipped}টি ডুপ্লিকেট বাদ)` : `${rows.length}টি নতুন প্রশ্ন সেভ হয়েছে!`);
    await loadQuestions(state.selectedTopic.id, false);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function generatePreliAI(count = 5) {
  if (!state.selectedSubject || !state.selectedTopic || state.saving) return;
  state.saving = true;
  const focusLabel = state.examFilter === 'ALL' ? '' : ` (${state.examFilter})`;
  showToast(`AI দিয়ে ${count}টি${focusLabel} প্রশ্ন তৈরি হচ্ছে...`);
  try {
    const existing = state.questions.map((q) => q.question);
    const items = await callAI('preli', {
      subject: state.selectedSubject.name,
      topic: state.selectedTopic.name,
      examFocus: state.examFilter,
      existingQuestions: existing,
      count,
    });
    const list = Array.isArray(items) ? items : [];
    const seen = new Set(existing.map((x) => normText(x)));
    const rows = [];

    list.forEach((q) => {
      if (!q?.question || !Array.isArray(q?.options) || q.options.length < 2 || q.correct_index === undefined) return;
      const key = normText(q.question);
      if (seen.has(key)) return;
      seen.add(key);

      let tags = Array.isArray(q.exam_tags) && q.exam_tags.length ? [...q.exam_tags] : ['BCS', 'Bank', 'Primary'];
      if (state.examFilter !== 'ALL' && !tags.includes(state.examFilter)) {
        tags.push(state.examFilter);
      }

      rows.push({
        topic_id: state.selectedTopic.id,
        question: String(q.question).trim(),
        options: q.options.map((o) => String(o).trim()),
        correct_index: Number(q.correct_index),
        explanation: String(q.explanation || '').trim(),
        exam_tags: tags,
        is_important: Boolean(q.is_important),
        source_note: String(q.source_note || '').trim(),
      });
    });

    if (!rows.length) return showToast('নতুন ইউনিক প্রশ্ন পাওয়া যায়নি, আবার চেষ্টা করুন।', true);

    const { error } = await sb.from('preli_questions').insert(rows);
    if (error) throw error;
    showToast(`${rows.length}টি নতুন AI প্রশ্ন যুক্ত হয়েছে!`);
    await loadQuestions(state.selectedTopic.id, false);
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

// ==========================================
// Render Helpers
// ==========================================
function renderExamFilterBar() {
  const filters = [
    { id: 'ALL', label: 'সব (All)' },
    { id: 'BCS', label: '🏛️ বিসিএস' },
    { id: 'Bank', label: '🏦 ব্যাংক' },
    { id: 'Primary', label: '🏫 প্রাইমারি' },
  ];
  return `
    <div class="flex gap-2 overflow-x-auto no-scrollbar">
      ${filters.map((f) => `
        <button onclick="onPreliFilterChange('${f.id}')"
          class="px-3.5 py-1.5 rounded-full text-xs font-bold whitespace-nowrap transition ${
            state.examFilter === f.id
              ? 'bg-teal-600 text-white shadow-sm'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
          }">${f.label}</button>
      `).join('')}
    </div>`;
}

function renderTagCheckboxes(defaultTags = ['BCS', 'Bank', 'Primary']) {
  const opts = [
    { id: 'BCS', label: 'বিসিএস' },
    { id: 'Bank', label: 'ব্যাংক' },
    { id: 'Primary', label: 'প্রাইমারি' },
  ];
  return `
    <div class="flex flex-wrap items-center gap-3 text-xs">
      <span class="text-slate-300 font-semibold">কোন পরীক্ষার জন্য:</span>
      ${opts.map((o) => `
        <label class="inline-flex items-center gap-1.5 cursor-pointer">
          <input type="checkbox" name="tag_pick" value="${o.id}" ${defaultTags.includes(o.id) ? 'checked' : ''} class="rounded accent-teal-500" />
          <span>${o.label}</span>
        </label>
      `).join('')}
    </div>`;
}

// ==========================================
// Render Preli View
// ==========================================
function renderPreli() {
  const isAdmin = isAdminUser();
  const isPro = isProUser();

  // ০. পূর্ণাঙ্গ মিক্সড মডেল টেস্ট সেটআপ
  if (state.preliMode === 'mixed_setup') {
    const defNeg = state.examFilter === 'Primary' ? '0.25' : '0.5';
    return `
      <div class="space-y-4">
        <button onclick="state.preliMode='browse';render()" class="text-xs font-bold text-teal-700 dark:text-teal-400">← প্রিলি হোমে ফিরুন</button>
        <form onsubmit="startMixedModelTest(event)" class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-indigo-100 dark:border-slate-800 shadow-sm space-y-4">
          <div class="flex items-center gap-3">
            <div class="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-lg shadow-sm">🎯</div>
            <div>
              <h2 class="font-bold text-base">পূর্ণাঙ্গ মিক্সড মডেল টেস্ট</h2>
              <p class="text-xs text-slate-500 dark:text-slate-400">সব বিষয় মিলিয়ে পরীক্ষার হলের মতো রিয়েল-টাইম প্র্যাকটিস</p>
            </div>
          </div>

          <div class="space-y-1">
            <label class="text-xs font-bold">পরীক্ষার ধরন</label>
            <select name="exam_tag" class="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800">
              <option value="ALL" ${state.examFilter === 'ALL' ? 'selected' : ''}>সমন্বিত (সব বিষয় ও সব পরীক্ষা)</option>
              <option value="BCS" ${state.examFilter === 'BCS' ? 'selected' : ''}>বিসিএস প্রিলিমিনারি স্ট্যান্ডার্ড</option>
              <option value="Bank" ${state.examFilter === 'Bank' ? 'selected' : ''}>ব্যাংক জব প্রিলি স্ট্যান্ডার্ড</option>
              <option value="Primary" ${state.examFilter === 'Primary' ? 'selected' : ''}>প্রাইমারি শিক্ষক নিয়োগ স্ট্যান্ডার্ড</option>
            </select>
          </div>

          <div class="space-y-1">
            <label class="text-xs font-bold">প্রশ্নের সংখ্যা ও সময়</label>
            <select name="q_count" class="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800">
              <option value="25">২৫টি প্রশ্ন — ১৫ মিনিট (ফ্রি ডেমো)</option>
              <option value="50">৫০টি প্রশ্ন — ৩০ মিনিট ${isPro ? '' : '🔒 PRO'}</option>
              <option value="100">১০০টি প্রশ্ন — ৬০ মিনিট ${isPro ? '' : '🔒 PRO'}</option>
              <option value="200">২০০টি প্রশ্ন — ১২০ মিনিট ${isPro ? '' : '🔒 PRO'}</option>
            </select>
          </div>

          <div class="space-y-1">
            <label class="text-xs font-bold">নেগেটিভ মার্কিং</label>
            <select name="neg_mark" class="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800">
              <option value="0.5" ${defNeg === '0.5' ? 'selected' : ''}>০.৫০ নম্বর (বিসিএস ও ব্যাংক স্ট্যান্ডার্ড)</option>
              <option value="0.25" ${defNeg === '0.25' ? 'selected' : ''}>০.২৫ নম্বর (প্রাইমারি স্ট্যান্ডার্ড)</option>
              <option value="0">নেগেটিভ মার্কিং নেই (০.০০)</option>
            </select>
          </div>

          <label class="flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
            <input type="checkbox" name="only_vvi" class="rounded accent-teal-600" />
            <span>🔥 শুধুমাত্র গুরুত্বপূর্ণ (VVI) প্রশ্ন থেকে টেস্ট নিন</span>
          </label>

          <button type="submit" ${state.loading ? 'disabled' : ''} class="w-full py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl shadow-md disabled:opacity-60">
            ${state.loading ? 'প্রশ্নপত্র তৈরি হচ্ছে...' : '⏱️ পরীক্ষা শুরু করুন'}
          </button>
        </form>
      </div>`;
  }

  // ১. বিষয় তালিকা (৩-স্তরের ফিল্টার যুক্ত)
  if (state.preliMode === 'browse' && !state.selectedSubject) {
    const filteredSubjects = state.subjects.filter((s) => matchesExamFilter(s.exam_tags));
    const defaultAddTags = state.examFilter === 'ALL' ? ['BCS', 'Bank', 'Primary'] : [state.examFilter];

    return `
      <div class="space-y-4">
        ${renderExamFilterBar()}

        <button onclick="openMixedTestSetup()" class="w-full bg-gradient-to-r from-indigo-600 to-teal-600 text-white p-4 rounded-2xl shadow-md flex justify-between items-center text-left">
          <div>
            <p class="font-bold text-sm">🎯 পূর্ণাঙ্গ মিক্সড মডেল টেস্ট</p>
            <p class="text-[11px] text-indigo-100 mt-0.5">বিসিএস / ব্যাংক / প্রাইমারি — ২৫ থেকে ২০০ নম্বরের রিয়েল-টাইম পরীক্ষা</p>
          </div>
          <span class="px-3 py-1.5 bg-white/20 rounded-xl text-xs font-bold shrink-0">শুরু →</span>
        </button>

        <div class="grid grid-cols-2 gap-2.5">
          <button onclick="openPreliSpecial('bookmarks')" class="bg-amber-50 dark:bg-slate-900 border border-amber-200 dark:border-slate-700 p-3 rounded-xl flex items-center justify-between text-left">
            <div>
              <p class="text-xs font-bold text-amber-900 dark:text-amber-300">⭐ বুকমার্ক</p>
              <p class="text-[11px] text-amber-700 dark:text-slate-400">${(state.bookmarks.preli || []).length}টি প্রশ্ন</p>
            </div>
            <i data-lucide="chevron-right" class="w-4 h-4 text-amber-600"></i>
          </button>
          <button onclick="openPreliSpecial('mistakes')" class="bg-rose-50 dark:bg-slate-900 border border-rose-200 dark:border-slate-700 p-3 rounded-xl flex items-center justify-between text-left">
            <div>
              <p class="text-xs font-bold text-rose-900 dark:text-rose-300">❌ ভুল প্রশ্নের ঝুড়ি</p>
              <p class="text-[11px] text-rose-700 dark:text-slate-400">${(state.mistakes || []).length}টি প্রশ্ন</p>
            </div>
            <i data-lucide="chevron-right" class="w-4 h-4 text-rose-600"></i>
          </button>
        </div>

        <div class="flex justify-between items-center">
          <h2 class="font-bold text-sm">
            ${state.examFilter === 'ALL' ? 'সব বিষয়সমূহ' : `${state.examFilter} সিলেবাসের বিষয়সমূহ`} (${filteredSubjects.length}টি)
          </h2>
          ${isAdmin ? `
            <button onclick="state.showAddSubject=!state.showAddSubject;render()" class="px-3 py-1.5 bg-slate-900 dark:bg-teal-600 text-white text-xs font-bold rounded-lg">
              ${state.showAddSubject ? '✕ বন্ধ' : '+ নতুন বিষয়'}
            </button>` : ''}
        </div>

        ${isAdmin && state.showAddSubject ? `
          <form onsubmit="addSubject(event)" class="bg-slate-900 text-white p-4 rounded-2xl space-y-3">
            <input name="subject_name" required placeholder="নতুন বিষয়ের নাম..." class="w-full px-3 py-2.5 text-xs text-slate-900 bg-white rounded-xl" />
            ${renderTagCheckboxes(defaultAddTags)}
            <button type="submit" class="w-full py-2.5 bg-teal-500 text-slate-950 text-xs font-bold rounded-xl">বিষয় সেভ করুন</button>
          </form>` : ''}

        <div class="grid grid-cols-1 gap-2.5">
          ${filteredSubjects.map((s) => {
            const subTopics = state.topics.filter(
              (t) => String(t.subject_id) === String(s.id) && matchesExamFilter(t.exam_tags)
            );
            return `
              <div onclick="selectSubject('${s.id}')" class="bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex justify-between items-center gap-2 cursor-pointer">
                <div class="text-left">
                  <span class="font-semibold text-sm block">${escHtml(s.name)}</span>
                  <div class="flex flex-wrap items-center gap-1.5 mt-1">
                    <span class="text-[11px] text-slate-400">${subTopics.length}টি টপিক</span>
                    ${(s.exam_tags || []).map((tg) => `<span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-semibold">${escHtml(tg)}</span>`).join('')}
                  </div>
                </div>
                <div class="flex items-center gap-1.5 shrink-0">
                  ${isAdmin ? `<button onclick="deleteSubject(event,'${s.id}')" class="px-2 py-1 bg-rose-50 dark:bg-rose-950/50 text-rose-600 rounded-lg text-xs">🗑️</button>` : ''}
                  <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400"></i>
                </div>
              </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // ২. টপিক তালিকা (৩-স্তরের ফিল্টার যুক্ত)
  if (state.preliMode === 'browse' && !state.selectedTopic) {
    const subTopics = state.topics.filter(
      (t) => String(t.subject_id) === String(state.selectedSubject.id) && matchesExamFilter(t.exam_tags)
    );
    const defaultTopicTags =
      state.examFilter !== 'ALL'
        ? [state.examFilter]
        : (state.selectedSubject.exam_tags?.length ? state.selectedSubject.exam_tags : ['BCS', 'Bank', 'Primary']);

    return `
      <div class="space-y-3">
        ${renderExamFilterBar()}

        <div class="flex justify-between items-center">
          <button onclick="state.selectedSubject=null;state.showAddTopic=false;render()" class="text-xs font-bold text-teal-700 dark:text-teal-400">← সব বিষয়ে ফিরুন</button>
          ${isAdmin ? `
            <button onclick="state.showAddTopic=!state.showAddTopic;render()" class="px-3 py-1.5 bg-slate-900 dark:bg-teal-600 text-white text-xs font-bold rounded-lg">
              ${state.showAddTopic ? '✕ বন্ধ' : '+ নতুন টপিক'}
            </button>` : ''}
        </div>

        <h2 class="font-bold text-lg">${escHtml(state.selectedSubject.name)} (${subTopics.length}টি টপিক)</h2>

        ${isAdmin && state.showAddTopic ? `
          <form onsubmit="addTopics(event)" class="bg-slate-900 text-white p-4 rounded-2xl space-y-3">
            <p class="text-xs font-bold text-teal-300">+ নতুন টপিক যোগ করুন (প্রতি লাইনে একটি)</p>
            <textarea name="topic_names" required rows="3" placeholder="যেমন:&#10;সমাস ও প্রকৃতি-প্রত্যয়&#10;কারক ও বিভক্তি" class="w-full p-3 text-xs text-slate-900 bg-white rounded-xl"></textarea>
            ${renderTagCheckboxes(defaultTopicTags)}
            <button type="submit" class="w-full py-2.5 bg-teal-500 text-slate-950 text-xs font-bold rounded-xl">টপিক সেভ করুন</button>
          </form>` : ''}

        <div class="space-y-2.5">
          ${subTopics.length === 0 ? `<p class="text-center text-sm text-slate-500 py-8 bg-white dark:bg-slate-900 rounded-xl">এই ফিল্টারে এখনো কোনো টপিক যুক্ত হয়নি।</p>` : ''}
          ${subTopics.map((t) => `
            <div onclick="selectTopic('${t.id}')" class="w-full bg-white dark:bg-slate-900 p-4 rounded-xl border border-slate-100 dark:border-slate-800 shadow-sm flex justify-between items-center gap-2 cursor-pointer">
              <div class="text-left">
                <span class="font-medium text-sm block">${escHtml(t.name)}</span>
                <div class="flex gap-1 mt-1">
                  ${(t.exam_tags || []).map((tg) => `<span class="text-[9px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 font-semibold">${escHtml(tg)}</span>`).join('')}
                </div>
              </div>
              <div class="flex items-center gap-2 shrink-0">
                ${isAdmin ? `<button onclick="deleteTopic(event,'${t.id}')" class="px-2 py-1 bg-rose-50 dark:bg-rose-950/50 text-rose-600 rounded-lg text-xs">🗑️</button>` : ''}
                <i data-lucide="chevron-right" class="w-4 h-4 text-slate-400"></i>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
  }

  // ৩. প্রশ্ন তালিকা / মডেল টেস্ট / লাইভ এক্সাম ভিউ
  const isSpecial = state.preliMode !== 'browse';
  const isFullExam = state.preliMode === 'mixed_exam' || state.preliMode === 'live_exam';
  const heading = isFullExam
    ? state.modelTestTitle
    : state.preliMode === 'bookmarks'
      ? '⭐ বুকমার্ক করা প্রশ্ন'
      : state.preliMode === 'mistakes'
        ? '❌ ভুল প্রশ্নের ঝুড়ি (রিভিশন)'
        : state.selectedTopic.name;

  const visibleQuestions = !isSpecial && !isPro
    ? state.questions.slice(0, FREE_LIMITS.preliPerTopic)
    : state.questions;
  const lockedCount = !isSpecial && !isPro
    ? Math.max(0, state.questionsTotal - FREE_LIMITS.preliPerTopic)
    : 0;

  const negRate = state.modelTestActive ? (state.modelTestNegMark ?? 0.5) : 0.5;
  const activeMap = state.modelTestActive ? state.modelTestAnswers : state.answered;
  let correctCount = 0;
  let wrongCount = 0;
  visibleQuestions.forEach((q) => {
    const p = activeMap[q.id];
    if (p !== undefined) {
      if (p === q.correct_index) correctCount++;
      else wrongCount++;
    }
  });
  const negTotal = wrongCount * negRate;
  const netScore = (correctCount - negTotal).toFixed(2);
  const attempted = correctCount + wrongCount;
  const editItem = state.editing?.type === 'preli' ? state.editing.item : null;
  const aiFocusTag = state.examFilter === 'ALL' ? '' : ` (${state.examFilter})`;

  return `
    <div class="space-y-3">
      ${!isSpecial && !state.modelTestActive ? renderExamFilterBar() : ''}

      <div class="flex flex-wrap justify-between items-center gap-2">
        <button onclick="goBackFromPreliView()" class="text-xs font-bold text-teal-700 dark:text-teal-400">← ফিরে যান</button>
        <div class="flex flex-wrap gap-1.5">
          ${!isSpecial && !state.modelTestActive ? `
            <button onclick="togglePreliImportantOnly()"
              class="px-2.5 py-1.5 text-xs font-bold rounded-lg border ${
                state.preliOnlyImportant
                  ? 'bg-orange-500 text-white border-orange-500'
                  : 'bg-white dark:bg-slate-800 text-orange-600 border-orange-200 dark:border-slate-700'
              }">🔥 VVI</button>` : ''}
          ${!state.modelTestActive && visibleQuestions.length >= 2 ? `
            <button onclick="startTopicModelTest()" class="px-3 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg">⏱️ টেস্ট</button>` : ''}
          ${isAdmin && !isSpecial && !state.modelTestActive ? `
            <button onclick="toggleBulk('preli')" class="px-2.5 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-lg">📋 JSON</button>
            <button onclick="generatePreliAI(5)" ${state.saving ? 'disabled' : ''} class="px-2.5 py-1.5 bg-teal-600 text-white text-xs font-bold rounded-lg disabled:opacity-50">+৫ AI${aiFocusTag}</button>
            <button onclick="generatePreliAI(10)" ${state.saving ? 'disabled' : ''} class="px-2.5 py-1.5 bg-emerald-600 text-white text-xs font-bold rounded-lg disabled:opacity-50">+১০ AI</button>` : ''}
        </div>
      </div>

      <h2 class="font-bold text-base">${escHtml(heading)} (${state.questionsTotal}টি প্রশ্ন)</h2>

      ${!isSpecial && !state.modelTestActive ? `
        <form onsubmit="searchPreli(event)" class="flex gap-2">
          <input name="q" value="${escHtml(state.preliSearch)}" placeholder="এই টপিকে প্রশ্ন খুঁজুন..." class="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl" />
          <button type="submit" class="px-3 py-2 bg-teal-600 text-white text-xs font-bold rounded-xl">খুঁজুন</button>
          ${state.preliSearch ? `<button type="button" onclick="clearPreliSearch()" class="px-2.5 py-2 bg-slate-200 dark:bg-slate-700 text-xs font-bold rounded-xl">✕</button>` : ''}
        </form>` : ''}

      ${state.modelTestActive && !state.modelTestSubmitted ? `
        <div class="sticky top-14 z-20 bg-indigo-700 text-white p-3 rounded-2xl shadow-lg flex justify-between items-center gap-2">
          <div class="text-xs">
            <p class="font-bold">⏱️ পরীক্ষা চলছে (নেগেটিভ: -${negRate})</p>
            <p class="text-indigo-200">দাগানো: ${attempted}/${visibleQuestions.length} • বাকি: <span id="examTimerText" class="font-mono font-bold text-amber-300">${formatTimer(state.modelTestSecondsLeft)}</span></p>
          </div>
          <div class="flex gap-1.5 shrink-0">
            <button onclick="submitModelTest(false)" class="px-3 py-1.5 bg-amber-400 text-slate-950 text-xs font-bold rounded-lg shadow-sm">জমা দিন</button>
            <button onclick="exitModelTest(false)" class="px-2.5 py-1.5 bg-white/20 text-white text-xs font-bold rounded-lg">✕</button>
          </div>
        </div>` : ''}

      ${state.modelTestActive && state.modelTestSubmitted ? `
        <div class="bg-gradient-to-r from-indigo-700 to-teal-700 text-white p-4 rounded-2xl shadow-md space-y-3">
          <div class="flex justify-between items-center gap-2">
            <h3 class="font-bold text-sm">🏆 চূড়ান্ত ফলাফল</h3>
            <div class="flex gap-1.5">
              ${state.activeLiveExamId ? `
                <button onclick="if(typeof openLiveLeaderboard==='function') openLiveLeaderboard(${state.activeLiveExamId}); else setTab('live');" class="px-2.5 py-1 bg-amber-400 text-slate-950 text-xs rounded-lg font-bold">মেধাতালিকা</button>` : ''}
              <button onclick="exitModelTest(true)" class="px-2.5 py-1 bg-white/20 text-xs rounded-lg font-bold">ফিরে যান</button>
            </div>
          </div>
          <div class="grid grid-cols-4 gap-2 text-center">
            <div class="bg-white/15 rounded-xl p-2"><p class="text-[10px]">সঠিক</p><p class="font-bold text-emerald-300">${correctCount}</p></div>
            <div class="bg-white/15 rounded-xl p-2"><p class="text-[10px]">ভুল</p><p class="font-bold text-rose-300">${wrongCount}</p></div>
            <div class="bg-white/15 rounded-xl p-2"><p class="text-[10px]">নেগেটিভ</p><p class="font-bold text-amber-200">-${negTotal.toFixed(2)}</p></div>
            <div class="bg-white/15 rounded-xl p-2"><p class="text-[10px]">নিট স্কোর</p><p class="font-bold text-white">${netScore}</p></div>
          </div>
        </div>` : ''}

      ${!state.modelTestActive && attempted > 0 ? `
        <div class="bg-white dark:bg-slate-900 p-3 rounded-xl border border-slate-200 dark:border-slate-700 flex justify-between items-center text-xs">
          <div class="flex gap-3">
            <span class="text-emerald-600 font-bold">✓ ${correctCount}</span>
            <span class="text-rose-600 font-bold">✕ ${wrongCount}</span>
            <span class="font-bold">স্কোর: ${netScore}</span>
          </div>
          <button onclick="resetPreliAnswers()" class="text-teal-600 dark:text-teal-400 font-bold">↺ রিসেট</button>
        </div>` : ''}

      ${editItem ? `
        <form onsubmit="saveEditPreli(event)" class="bg-amber-50 dark:bg-slate-900 border border-amber-300 dark:border-amber-700 p-4 rounded-2xl space-y-2.5">
          <div class="flex justify-between items-center">
            <p class="text-xs font-bold text-amber-900 dark:text-amber-300">✏️ প্রশ্ন এডিট করুন</p>
            <button type="button" onclick="cancelEdit()" class="text-xs font-bold text-slate-500">বাতিল ✕</button>
          </div>
          <textarea name="question" required rows="2" class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(editItem.question)}</textarea>
          <div class="grid grid-cols-1 gap-1.5">
            ${[0, 1, 2, 3].map((i) => `<input name="opt${i}" required value="${escHtml(editItem.options?.[i] || '')}" placeholder="অপশন ${i + 1}" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />`).join('')}
          </div>
          <div class="grid grid-cols-2 gap-2">
            <select name="correct_index" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl">
              ${[0, 1, 2, 3].map((i) => `<option value="${i}" ${Number(editItem.correct_index) === i ? 'selected' : ''}>সঠিক: অপশন ${i + 1}</option>`).join('')}
            </select>
            <input name="exam_tags" value="${escHtml((editItem.exam_tags || []).join(', '))}" placeholder="BCS, Bank, Primary" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
          </div>
          <div class="grid grid-cols-2 gap-2 items-center">
            <input name="source_note" value="${escHtml(editItem.source_note || '')}" placeholder="রেফারেন্স (যেমন: ৪৫তম বিসিএস)" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            <label class="flex items-center gap-2 text-xs font-bold text-orange-700 dark:text-orange-400">
              <input type="checkbox" name="is_important" ${editItem.is_important ? 'checked' : ''} class="rounded accent-orange-500" />
              <span>🔥 গুরুত্বপূর্ণ (VVI)</span>
            </label>
          </div>
          <textarea name="explanation" rows="2" placeholder="ব্যাখ্যা..." class="w-full p-2.5 text-xs bg-white dark:bg-slate-800 border rounded-xl">${escHtml(editItem.explanation || '')}</textarea>
          <button type="submit" class="w-full py-2.5 bg-amber-500 text-slate-950 text-xs font-bold rounded-xl">পরিবর্তন সেভ করুন</button>
        </form>` : ''}

      ${isAdmin && !isSpecial && state.showBulk.preli ? `
        <form onsubmit="importPreliJSON(event)" class="bg-slate-900 text-white p-4 rounded-2xl space-y-2.5">
          <div class="flex justify-between items-center">
            <p class="text-xs font-bold text-teal-300">📋 প্রিলি প্রশ্নের JSON পেস্ট করুন</p>
            <button type="button" onclick="toggleBulk('preli')" class="text-xs text-slate-400">বন্ধ ✕</button>
          </div>
          <textarea name="json_data" required rows="5" placeholder='[{"question":"...","options":["ক","খ","গ","ঘ"],"correct_index":0,"explanation":"...","exam_tags":["BCS"],"is_important":true,"source_note":"৪৫তম বিসিএস"}]' class="w-full p-3 text-xs font-mono text-slate-900 bg-white rounded-xl"></textarea>
          <button type="submit" class="w-full py-2.5 bg-teal-500 text-slate-950 text-xs font-bold rounded-xl">ডাটাবেজে সেভ করুন</button>
        </form>` : ''}

      ${state.loading ? `<p class="text-center text-xs text-slate-500 py-6">লোড হচ্ছে...</p>` : ''}
      ${!state.loading && visibleQuestions.length === 0 ? `<div class="bg-white dark:bg-slate-900 p-6 rounded-xl text-center text-sm text-slate-500">কোনো প্রশ্ন পাওয়া যায়নি।</div>` : ''}

      <div class="space-y-4">
        ${visibleQuestions.map((q, idx) => {
          const picked = activeMap[q.id];
          const showResult = state.modelTestActive ? state.modelTestSubmitted : picked !== undefined;
          const bookmarked = isBookmarked('preli', q.id);
          return `
            <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm">
              <div class="flex justify-between items-start gap-2 mb-2">
                <p class="font-semibold text-sm leading-relaxed">${idx + 1}. ${escHtml(q.question)}</p>
                <div class="flex items-center gap-1 shrink-0">
                  <button onclick="toggleBookmark('preli','${q.id}')" class="px-1.5 py-1 rounded-lg text-xs ${bookmarked ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}">⭐</button>
                  <button onclick="submitErrorReport('preli','${q.id}')" class="px-1.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-lg text-xs" title="ভুল রিপোর্ট">🚩</button>
                  ${isAdmin && !isFullExam ? `
                    <button onclick="openEditPreli('${q.id}')" class="px-1.5 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs">✏️</button>
                    <button onclick="deleteItem('preli_questions','${q.id}',()=>${isSpecial ? `openPreliSpecial('${state.preliMode}')` : `loadQuestions('${state.selectedTopic.id}',false)`})" class="px-1.5 py-1 bg-rose-50 dark:bg-rose-950/50 text-rose-600 rounded-lg text-xs">🗑️</button>` : ''}
                </div>
              </div>

              <div class="flex flex-wrap gap-1 mb-3">
                ${q.is_important ? `<span class="text-[10px] px-2 py-0.5 bg-orange-100 dark:bg-orange-950/60 text-orange-700 dark:text-orange-300 rounded-full font-bold">🔥 VVI</span>` : ''}
                ${q.source_note ? `<span class="text-[10px] px-2 py-0.5 bg-teal-50 dark:bg-teal-950/60 text-teal-700 dark:text-teal-300 rounded-full font-semibold">${escHtml(q.source_note)}</span>` : ''}
                ${(q.exam_tags || []).map((tag) => `<span class="text-[10px] px-2 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-full font-medium">${escHtml(tag)}</span>`).join('')}
              </div>

              <div class="space-y-2">
                ${(q.options || []).map((opt, oIdx) => {
                  let cls = 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70';
                  if (state.modelTestActive && !state.modelTestSubmitted) {
                    if (oIdx === picked) cls = 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/60 text-indigo-900 dark:text-indigo-200 font-semibold';
                  } else if (showResult) {
                    if (oIdx === q.correct_index) cls = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 font-semibold';
                    else if (oIdx === picked) cls = 'border-rose-500 bg-rose-50 dark:bg-rose-950/60 text-rose-900 dark:text-rose-200';
                  }
                  return `<button onclick="answerPreli('${q.id}',${oIdx})" class="w-full text-left px-3 py-2.5 rounded-xl border text-sm transition ${cls}">${escHtml(opt)}</button>`;
                }).join('')}
              </div>

              ${showResult && q.explanation ? `<div class="mt-3 p-3 bg-teal-50 dark:bg-teal-950/50 rounded-xl text-xs text-teal-900 dark:text-teal-200 leading-relaxed"><b>ব্যাখ্যা:</b> ${escHtml(q.explanation)}</div>` : ''}
            </div>`;
        }).join('')}
      </div>

      ${lockedCount > 0 ? renderProLockCard(`এই টপিকে আরও ${lockedCount}টি গুরুত্বপূর্ণ প্রশ্ন রয়েছে। সব প্রশ্ন ও আনলিমিটেড মডেল টেস্ট পেতে Pro চালু করুন।`) : ''}

      ${!isSpecial && isPro && state.questions.length < state.questionsTotal ? `
        <button onclick="loadQuestions('${state.selectedTopic.id}',true)" class="w-full py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-teal-600 dark:text-teal-400 text-xs font-bold rounded-xl">
          আরও প্রশ্ন লোড করুন (${state.questions.length}/${state.questionsTotal})
        </button>` : ''}
    </div>`;
}