// ==========================================
// PrepBox BD V2 — Magoosh-Style Vocabulary Builder, Flashcards & Exam Engine
// ==========================================

const DEFAULT_VOCAB_CATEGORIES = [
  'BCS High-Frequency',
  'Bank & IBA Standard',
  'Primary & Basic',
  'Idioms & Phrases',
  'Group Verbs & Prepositions',
];

let vocabViewMode = 'list'; // list, flashcard, quiz
let vocabBookmarkOnly = false;
let showAddVocabForm = false;
let vocabFlashOnlyUnmastered = false;

// Magoosh-Style Adaptive Quiz State
const vocabQuiz = {
  active: false,
  finished: false,
  mode: 'meaning', // meaning (English -> বাংলা), synonym (English -> Synonym)
  questions: [],
  currentIndex: 0,
  selectedOption: null,
  correctCount: 0,
  wrongCount: 0,
  streak: 0,
  bestStreak: 0,
  wrongItems: [],
};

// ==========================================
// Mastery Storage (User-wise Local Progress)
// ==========================================
function getVocabMasteryKey() {
  return `pb_vocab_mastery_${state.user?.id || 'guest'}`;
}

function getVocabMasteryMap() {
  try {
    return JSON.parse(localStorage.getItem(getVocabMasteryKey()) || '{}');
  } catch (_) {
    return {};
  }
}

function setVocabMasteryStatus(wordId, status) {
  const map = getVocabMasteryMap();
  if (status) map[String(wordId)] = status; // 'mastered' | 'learning'
  else delete map[String(wordId)];
  localStorage.setItem(getVocabMasteryKey(), JSON.stringify(map));
}

function resetVocabMastery() {
  if (!confirm('ভোকাবুলারি মাস্টারি প্রগ্রেস রিসেট করে নতুন করে শুরু করতে চান?')) return;
  localStorage.removeItem(getVocabMasteryKey());
  state.vocabFlashIndex = 0;
  state.vocabFlashFlipped = false;
  showToast('মাস্টারি প্রগ্রেস রিসেট হয়েছে!');
  render();
}

// ==========================================
// Audio Pronunciation (Web Speech API)
// ==========================================
function speakVocabById(id) {
  const item = state.vocabItems.find((v) => Number(v.id) === Number(id));
  if (!item?.word) return;
  if (!('speechSynthesis' in window)) {
    showToast('এই ব্রাউজারে অডিও উচ্চারণ সাপোর্ট করে না।', true);
    return;
  }
  try {
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(item.word);
    utter.lang = 'en-US';
    utter.rate = 0.92;
    window.speechSynthesis.speak(utter);
  } catch (_) {
    showToast('উচ্চারণ চালু করা যায়নি।', true);
  }
}

// ==========================================
// Data Loading & Category Helpers
// ==========================================
function getVocabCategories() {
  const set = new Set(DEFAULT_VOCAB_CATEGORIES);
  state.vocabItems.forEach((v) => {
    if (v.category && v.category.trim()) set.add(v.category.trim());
  });
  return ['ALL', ...Array.from(set)];
}

async function loadVocabItems() {
  state.loading = true;
  render();
  try {
    const { data, error } = await sb
      .from('vocab_items')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (error) throw error;
    state.vocabItems = data || [];
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.loading = false;
    render();
  }
}

function getVisibleVocabPool() {
  const isPro = isProUser();
  const base = isPro ? state.vocabItems : state.vocabItems.slice(0, FREE_LIMITS.vocabTotal);
  const q = normText(state.vocabSearch);
  const bmSet = new Set(state.bookmarks.vocab || []);

  return base.filter((v) => {
    if (vocabBookmarkOnly && !bmSet.has(Number(v.id))) return false;
    if (state.vocabCategory !== 'ALL' && v.category !== state.vocabCategory) return false;
    if (q) {
      const hay = normText(`${v.word} ${v.meaning_bn} ${v.synonyms} ${v.example}`);
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function switchVocabMode(mode) {
  vocabViewMode = mode;
  state.vocabFlashFlipped = false;
  if (mode === 'flashcard') state.vocabFlashIndex = 0;
  if (mode !== 'quiz') {
    vocabQuiz.active = false;
    vocabQuiz.finished = false;
  }
  render();
}

function selectVocabCategoryByIdx(idx) {
  const cats = getVocabCategories();
  state.vocabCategory = cats[idx] || 'ALL';
  state.vocabFlashIndex = 0;
  state.vocabFlashFlipped = false;
  render();
}

function toggleVocabBookmarkOnly() {
  vocabBookmarkOnly = !vocabBookmarkOnly;
  state.vocabFlashIndex = 0;
  state.vocabFlashFlipped = false;
  render();
}

function searchVocab(e) {
  e.preventDefault();
  state.vocabSearch = e.target.q.value.trim();
  state.vocabFlashIndex = 0;
  render();
}

function clearVocabSearch() {
  state.vocabSearch = '';
  render();
}

// ==========================================
// Magoosh Flashcard Actions
// ==========================================
function getFlashcardDeck() {
  const pool = getVisibleVocabPool();
  if (!vocabFlashOnlyUnmastered) return pool;
  const mastery = getVocabMasteryMap();
  return pool.filter((v) => mastery[String(v.id)] !== 'mastered');
}

function flipFlashcard() {
  state.vocabFlashFlipped = !state.vocabFlashFlipped;
  render();
}

function markFlashcard(wordId, status) {
  setVocabMasteryStatus(wordId, status);
  state.vocabFlashFlipped = false;
  const deck = getFlashcardDeck();
  if (deck.length === 0) {
    state.vocabFlashIndex = 0;
  } else if (vocabFlashOnlyUnmastered && status === 'mastered') {
    // অজানা ডেক থেকে শব্দটি সরে যাওয়ায় বর্তমান ইনডেক্সেই পরের শব্দ আসবে
    if (state.vocabFlashIndex >= deck.length) state.vocabFlashIndex = 0;
  } else {
    state.vocabFlashIndex = (state.vocabFlashIndex + 1) % deck.length;
  }
  render();
}

function moveFlashcard(step) {
  const deck = getFlashcardDeck();
  if (!deck.length) return;
  state.vocabFlashFlipped = false;
  state.vocabFlashIndex = (state.vocabFlashIndex + step + deck.length) % deck.length;
  render();
}

// ==========================================
// Magoosh Adaptive Quiz Engine
// ==========================================
function buildVocabQuizQuestions(sourceItems, allPool, mode, count) {
  const validSource = sourceItems.filter((item) => {
    if (mode === 'synonym') return Boolean(item.synonyms && item.synonyms.trim());
    return Boolean(item.meaning_bn && item.meaning_bn.trim());
  });

  const validDistractors = allPool.filter((item) => {
    if (mode === 'synonym') return Boolean(item.synonyms && item.synonyms.trim());
    return Boolean(item.meaning_bn && item.meaning_bn.trim());
  });

  if (validSource.length < 1 || validDistractors.length < 4) return [];

  const picked = shuffleArray(validSource).slice(0, Math.min(count, validSource.length));

  return picked.map((item) => {
    const correctText = mode === 'synonym'
      ? item.synonyms.split(',')[0].trim()
      : item.meaning_bn.trim();

    const wrongTexts = [];
    const seen = new Set([normText(correctText)]);
    const candidates = shuffleArray(validDistractors);

    for (const c of candidates) {
      if (Number(c.id) === Number(item.id)) continue;
      const txt = mode === 'synonym'
        ? c.synonyms.split(',')[0].trim()
        : c.meaning_bn.trim();
      const key = normText(txt);
      if (!txt || seen.has(key)) continue;
      seen.add(key);
      wrongTexts.push(txt);
      if (wrongTexts.length === 3) break;
    }

    const options = shuffleArray([correctText, ...wrongTexts]);
    return {
      item,
      options,
      correctIndex: options.indexOf(correctText),
    };
  });
}

function startVocabQuiz(e) {
  e.preventDefault();
  const mode = e.target.quiz_mode.value; // meaning | synonym
  const count = Number(e.target.quiz_count.value) || 10;
  const scope = e.target.quiz_scope.value; // current | unmastered

  const visiblePool = getVisibleVocabPool();
  const allAllowedPool = isProUser()
    ? state.vocabItems
    : state.vocabItems.slice(0, FREE_LIMITS.vocabTotal);

  let source = visiblePool;
  if (scope === 'unmastered') {
    const mastery = getVocabMasteryMap();
    const unmastered = visiblePool.filter((v) => mastery[String(v.id)] !== 'mastered');
    if (unmastered.length >= 1) source = unmastered;
    else showToast('সব শব্দই আয়ত্ত হয়ে গেছে! তাই সব শব্দ থেকে কুইজ চালু করা হলো।');
  }

  const questions = buildVocabQuizQuestions(source, allAllowedPool, mode, count);
  if (questions.length === 0) {
    showToast('ভোকাব কুইজ চালানোর জন্য কমপক্ষে ৪টি শব্দ প্রয়োজন।', true);
    return;
  }

  vocabQuiz.active = true;
  vocabQuiz.finished = false;
  vocabQuiz.mode = mode;
  vocabQuiz.questions = questions;
  vocabQuiz.currentIndex = 0;
  vocabQuiz.selectedOption = null;
  vocabQuiz.correctCount = 0;
  vocabQuiz.wrongCount = 0;
  vocabQuiz.streak = 0;
  vocabQuiz.bestStreak = 0;
  vocabQuiz.wrongItems = [];
  render();
}

function retryWrongVocabQuiz() {
  if (!vocabQuiz.wrongItems.length) return;
  const allAllowedPool = isProUser()
    ? state.vocabItems
    : state.vocabItems.slice(0, FREE_LIMITS.vocabTotal);

  const questions = buildVocabQuizQuestions(
    vocabQuiz.wrongItems,
    allAllowedPool,
    vocabQuiz.mode,
    vocabQuiz.wrongItems.length
  );
  if (!questions.length) return;

  vocabQuiz.active = true;
  vocabQuiz.finished = false;
  vocabQuiz.questions = questions;
  vocabQuiz.currentIndex = 0;
  vocabQuiz.selectedOption = null;
  vocabQuiz.correctCount = 0;
  vocabQuiz.wrongCount = 0;
  vocabQuiz.streak = 0;
  vocabQuiz.bestStreak = 0;
  vocabQuiz.wrongItems = [];
  render();
}

function answerVocabQuiz(optIdx) {
  if (!vocabQuiz.active || vocabQuiz.selectedOption !== null) return;
  const q = vocabQuiz.questions[vocabQuiz.currentIndex];
  if (!q) return;

  vocabQuiz.selectedOption = optIdx;
  if (optIdx === q.correctIndex) {
    vocabQuiz.correctCount++;
    vocabQuiz.streak++;
    if (vocabQuiz.streak > vocabQuiz.bestStreak) vocabQuiz.bestStreak = vocabQuiz.streak;
    setVocabMasteryStatus(q.item.id, 'mastered');
  } else {
    vocabQuiz.wrongCount++;
    vocabQuiz.streak = 0;
    setVocabMasteryStatus(q.item.id, 'learning');
    if (!vocabQuiz.wrongItems.some((w) => Number(w.id) === Number(q.item.id))) {
      vocabQuiz.wrongItems.push(q.item);
    }
  }
  render();
}

function nextVocabQuizQuestion() {
  if (vocabQuiz.currentIndex + 1 >= vocabQuiz.questions.length) {
    vocabQuiz.finished = true;
    vocabQuiz.active = false;
  } else {
    vocabQuiz.currentIndex++;
    vocabQuiz.selectedOption = null;
  }
  render();
}

function exitVocabQuiz() {
  vocabQuiz.active = false;
  vocabQuiz.finished = false;
  render();
}

// ==========================================
// Admin: Manual Add, Edit, Bulk JSON & AI
// ==========================================
function toggleAddVocabForm() {
  showAddVocabForm = !showAddVocabForm;
  state.showBulk.vocab = false;
  state.editing = null;
  render();
}

async function saveManualVocab(e) {
  e.preventDefault();
  if (state.saving) return;
  state.saving = true;
  try {
    const f = e.target;
    const word = f.word.value.trim();
    const meaning_bn = f.meaning_bn.value.trim();
    const category = f.category.value.trim() || 'BCS High-Frequency';
    if (!word || !meaning_bn) throw new Error('Word এবং বাংলা অর্থ অবশ্যই লিখুন।');

    const { error } = await sb.from('vocab_items').insert({
      category,
      word,
      meaning_bn,
      synonyms: f.synonyms.value.trim(),
      example: f.example.value.trim(),
    });
    if (error) {
      if (error.code === '23505') throw new Error(`"${word}" শব্দটি আগে থেকেই ডাটাবেজে আছে!`);
      throw error;
    }
    e.target.reset();
    showAddVocabForm = false;
    showToast(`"${word}" সফলভাবে সেভ হয়েছে!`);
    await loadVocabItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

function openEditVocab(id) {
  const item = state.vocabItems.find((v) => String(v.id) === String(id));
  if (!item) return;
  vocabViewMode = 'list';
  showAddVocabForm = false;
  state.showBulk.vocab = false;
  state.editing = { type: 'vocab', item };
  render();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

async function saveEditVocab(e) {
  e.preventDefault();
  if (!state.editing || state.saving) return;
  state.saving = true;
  try {
    const f = e.target;
    const { error } = await sb
      .from('vocab_items')
      .update({
        category: f.category.value.trim() || 'BCS High-Frequency',
        word: f.word.value.trim(),
        meaning_bn: f.meaning_bn.value.trim(),
        synonyms: f.synonyms.value.trim(),
        example: f.example.value.trim(),
      })
      .eq('id', state.editing.item.id);
    if (error) throw error;
    state.editing = null;
    showToast('শব্দটি আপডেট হয়েছে!');
    await loadVocabItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function importVocabJSON(e) {
  e.preventDefault();
  if (state.saving) return;
  state.saving = true;
  try {
    const parsed = parseBulkJSON(e.target.json_data.value);
    const items = Array.isArray(parsed) ? parsed : [parsed];
    const defaultCat = state.vocabCategory !== 'ALL' ? state.vocabCategory : 'BCS High-Frequency';

    const { data: existingRows } = await sb.from('vocab_items').select('word');
    const seen = new Set((existingRows || []).map((r) => normText(r.word)));

    const rows = [];
    let skipped = 0;
    items.forEach((v, i) => {
      if (!v?.word || !v?.meaning_bn) {
        throw new Error(`${i + 1} নম্বর শব্দে word বা meaning_bn নেই।`);
      }
      const key = normText(v.word);
      if (seen.has(key)) { skipped++; return; }
      seen.add(key);
      rows.push({
        category: String(v.category || defaultCat).trim(),
        word: String(v.word).trim(),
        meaning_bn: String(v.meaning_bn).trim(),
        synonyms: String(v.synonyms || '').trim(),
        example: String(v.example || '').trim(),
      });
    });

    if (!rows.length) return showToast('সবগুলো শব্দ আগে থেকেই ডাটাবেজে আছে!', true);

    const { error } = await sb.from('vocab_items').insert(rows);
    if (error) throw error;
    e.target.reset();
    state.showBulk.vocab = false;
    showToast(skipped ? `${rows.length}টি শব্দ সেভ হয়েছে (${skipped}টি ডুপ্লিকেট বাদ)` : `${rows.length}টি নতুন শব্দ সেভ হয়েছে!`);
    await loadVocabItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

async function generateVocabAI() {
  if (state.saving) return;
  state.saving = true;
  const targetCat = state.vocabCategory !== 'ALL' ? state.vocabCategory : 'BCS High-Frequency';
  showToast(`AI দিয়ে "${targetCat}"-এর ৫টি নতুন শব্দ তৈরি হচ্ছে...`);
  try {
    const existingWords = state.vocabItems.map((v) => v.word);
    const items = await callAI('vocab', { category: targetCat, existingWords });
    const list = Array.isArray(items) ? items : [];
    const seen = new Set(existingWords.map((w) => normText(w)));
    const rows = [];

    list.forEach((v) => {
      if (!v?.word || !v?.meaning_bn) return;
      const key = normText(v.word);
      if (seen.has(key)) return;
      seen.add(key);
      rows.push({
        category: targetCat,
        word: String(v.word).trim(),
        meaning_bn: String(v.meaning_bn).trim(),
        synonyms: String(v.synonyms || '').trim(),
        example: String(v.example || '').trim(),
      });
    });

    if (!rows.length) return showToast('নতুন ইউনিক শব্দ পাওয়া যায়নি, আবার চেষ্টা করুন।', true);

    const { error } = await sb.from('vocab_items').insert(rows);
    if (error) throw error;
    showToast(`${rows.length}টি নতুন AI শব্দ যুক্ত হয়েছে!`);
    await loadVocabItems();
  } catch (err) {
    showToast(err.message, true);
  } finally {
    state.saving = false;
  }
}

// ==========================================
// Render Vocab Sub-Views
// ==========================================
function renderVocabFlashcards(visiblePool, masteryMap) {
  const deck = getFlashcardDeck();
  const totalPool = visiblePool.length;
  const masteredCount = visiblePool.filter((v) => masteryMap[String(v.id)] === 'mastered').length;
  const progressPct = totalPool ? Math.round((masteredCount / totalPool) * 100) : 0;

  if (totalPool === 0) {
    return `<div class="bg-white dark:bg-slate-900 p-6 rounded-2xl text-center text-sm text-slate-500">ফ্ল্যাশকার্ড দেখার জন্য এই ক্যাটাগরিতে কোনো শব্দ নেই।</div>`;
  }

  const safeIdx = deck.length ? state.vocabFlashIndex % deck.length : 0;
  const card = deck[safeIdx];

  return `
    <div class="space-y-4">
      <!-- Mastery Progress Bar -->
      <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 space-y-2">
        <div class="flex justify-between items-center text-xs">
          <span class="font-bold text-teal-700 dark:text-teal-300">📊 মাস্টারি: ${masteredCount}/${totalPool} (${progressPct}%)</span>
          <div class="flex items-center gap-2">
            <label class="inline-flex items-center gap-1 text-[11px] font-semibold cursor-pointer">
              <input type="checkbox" onchange="vocabFlashOnlyUnmastered=this.checked;state.vocabFlashIndex=0;state.vocabFlashFlipped=false;render()" ${vocabFlashOnlyUnmastered ? 'checked' : ''} class="rounded accent-teal-600" />
              <span>শুধু অজানা</span>
            </label>
            <button onclick="resetVocabMastery()" class="text-[11px] text-rose-600 font-bold">↺ রিসেট</button>
          </div>
        </div>
        <div class="w-full h-2 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
          <div class="h-full bg-gradient-to-r from-teal-500 to-emerald-500 transition-all" style="width:${progressPct}%"></div>
        </div>
      </div>

      ${!card ? `
        <div class="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 p-6 rounded-2xl text-center space-y-3">
          <p class="text-3xl">🎉</p>
          <h3 class="font-bold text-base text-emerald-900 dark:text-emerald-200">অভিনন্দন! সবগুলো শব্দ আয়ত্ত হয়ে গেছে!</h3>
          <button onclick="vocabFlashOnlyUnmastered=false;state.vocabFlashIndex=0;render()" class="px-4 py-2 bg-emerald-600 text-white text-xs font-bold rounded-xl">সব কার্ড আবার রিভিশন দিন</button>
        </div>
      ` : `
        <div onclick="flipFlashcard()" class="min-h-[260px] bg-white dark:bg-slate-900 p-6 rounded-3xl border-2 ${state.vocabFlashFlipped ? 'border-teal-500' : 'border-slate-200 dark:border-slate-700'} shadow-md flex flex-col justify-between cursor-pointer select-none transition">
          <div class="flex justify-between items-center text-[11px] text-slate-400">
            <span>কার্ড ${safeIdx + 1} / ${deck.length}</span>
            <span class="px-2 py-0.5 rounded-full font-bold ${
              masteryMap[String(card.id)] === 'mastered'
                ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300'
                : 'bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300'
            }">${masteryMap[String(card.id)] === 'mastered' ? '✅ Mastered' : '🔄 Learning'}</span>
          </div>

          ${!state.vocabFlashFlipped ? `
            <div class="text-center py-8 space-y-3">
              <p class="text-[11px] uppercase tracking-wider text-teal-600 font-bold">${escHtml(card.category)}</p>
              <h2 class="text-3xl font-bold text-slate-900 dark:text-white">${escHtml(card.word)}</h2>
              <button type="button" onclick="event.stopPropagation();speakVocabById(${card.id})" class="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 rounded-full text-xs font-bold">
                🔊 উচ্চারণ শুনুন
              </button>
              <p class="text-xs text-slate-400 pt-2">অর্থ দেখতে কার্ডে ট্যাপ করুন 👆</p>
            </div>
          ` : `
            <div class="py-3 space-y-3">
              <div class="flex justify-between items-center">
                <h3 class="text-xl font-bold text-teal-700 dark:text-teal-300">${escHtml(card.word)}</h3>
                <button type="button" onclick="event.stopPropagation();speakVocabById(${card.id})" class="px-2.5 py-1 bg-slate-100 dark:bg-slate-800 rounded-lg text-xs">🔊</button>
              </div>
              <p class="text-lg font-bold text-slate-900 dark:text-white">${escHtml(card.meaning_bn)}</p>
              ${card.synonyms ? `<p class="text-xs text-slate-600 dark:text-slate-300"><b>Synonyms:</b> ${escHtml(card.synonyms)}</p>` : ''}
              ${card.example ? `<p class="text-xs italic text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800 p-3 rounded-xl">"${escHtml(card.example)}"</p>` : ''}
            </div>
          `}

          <div class="flex justify-between items-center text-[11px] text-slate-400 pt-2 border-t border-slate-100 dark:border-slate-800">
            <button type="button" onclick="event.stopPropagation();moveFlashcard(-1)" class="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">← আগের</button>
            <button type="button" onclick="event.stopPropagation();toggleBookmark('vocab','${card.id}')" class="px-2.5 py-1 rounded-lg font-bold ${isBookmarked('vocab', card.id) ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'}">⭐ বুকমার্ক</button>
            <button type="button" onclick="event.stopPropagation();moveFlashcard(1)" class="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 font-bold">পরের →</button>
          </div>
        </div>

        <!-- Magoosh Mastery Action Buttons -->
        <div class="grid grid-cols-2 gap-3">
          <button onclick="markFlashcard(${card.id},'learning')" class="py-3.5 bg-rose-50 dark:bg-rose-950/50 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 font-bold text-xs rounded-2xl">
            🔄 আবার পড়ব (Don't Know)
          </button>
          <button onclick="markFlashcard(${card.id},'mastered')" class="py-3.5 bg-emerald-600 text-white font-bold text-xs rounded-2xl shadow-md">
            ✅ জানি (I Knew This)
          </button>
        </div>
      `}
    </div>`;
}

function renderVocabQuizView(visiblePool) {
  // ১. কুইজ ফলাফল স্ক্রিন
  if (vocabQuiz.finished) {
    const total = vocabQuiz.questions.length;
    const accuracy = total ? Math.round((vocabQuiz.correctCount / total) * 100) : 0;
    return `
      <div class="space-y-4">
        <div class="bg-gradient-to-br from-indigo-700 to-teal-700 text-white p-6 rounded-3xl shadow-lg text-center space-y-3">
          <p class="text-3xl">${accuracy >= 80 ? '🏆' : accuracy >= 50 ? '👏' : '💪'}</p>
          <h2 class="text-lg font-bold">ভোকাবুলারি এক্সাম সম্পন্ন!</h2>
          <div class="grid grid-cols-3 gap-2 pt-2">
            <div class="bg-white/15 rounded-xl p-2.5"><p class="text-[10px]">সঠিক</p><p class="font-bold text-lg text-emerald-300">${vocabQuiz.correctCount}/${total}</p></div>
            <div class="bg-white/15 rounded-xl p-2.5"><p class="text-[10px]">দক্ষতা</p><p class="font-bold text-lg">${accuracy}%</p></div>
            <div class="bg-white/15 rounded-xl p-2.5"><p class="text-[10px]">সেরা স্ট্রিক</p><p class="font-bold text-lg text-amber-300">🔥 ${vocabQuiz.bestStreak}</p></div>
          </div>
          <div class="flex flex-wrap gap-2 pt-2">
            ${vocabQuiz.wrongItems.length > 0 ? `
              <button onclick="retryWrongVocabQuiz()" class="flex-1 py-2.5 bg-amber-400 text-slate-950 font-bold text-xs rounded-xl shadow-sm">
                🔄 ভুল ${vocabQuiz.wrongItems.length}টি আবার দিন
              </button>` : ''}
            <button onclick="exitVocabQuiz()" class="flex-1 py-2.5 bg-white/20 text-white font-bold text-xs rounded-xl">
              নতুন এক্সাম সেটআপ
            </button>
          </div>
        </div>

        ${vocabQuiz.wrongItems.length > 0 ? `
          <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-rose-100 dark:border-slate-800 space-y-2.5">
            <h3 class="font-bold text-xs text-rose-600">❌ যে শব্দগুলোতে ভুল হয়েছে (রিভিশন):</h3>
            ${vocabQuiz.wrongItems.map((w) => `
              <div class="p-3 rounded-xl bg-rose-50/70 dark:bg-slate-800 flex justify-between items-start gap-2">
                <div>
                  <p class="font-bold text-sm">${escHtml(w.word)} — <span class="text-teal-700 dark:text-teal-300">${escHtml(w.meaning_bn)}</span></p>
                  ${w.synonyms ? `<p class="text-[11px] text-slate-500">Synonyms: ${escHtml(w.synonyms)}</p>` : ''}
                </div>
                <button onclick="speakVocabById(${w.id})" class="px-2 py-1 bg-white dark:bg-slate-700 rounded-lg text-xs">🔊</button>
              </div>
            `).join('')}
          </div>` : ''}
      </div>`;
  }

  // ২. চলমান কুইজ প্রশ্ন স্ক্রিন
  if (vocabQuiz.active) {
    const q = vocabQuiz.questions[vocabQuiz.currentIndex];
    const total = vocabQuiz.questions.length;
    const pct = Math.round(((vocabQuiz.currentIndex + 1) / total) * 100);
    const answered = vocabQuiz.selectedOption !== null;
    const isCorrect = answered && vocabQuiz.selectedOption === q.correctIndex;

    return `
      <div class="space-y-4">
        <div class="flex justify-between items-center text-xs">
          <button onclick="exitVocabQuiz()" class="font-bold text-rose-600">✕ বাতিল</button>
          <span class="font-bold text-slate-500">প্রশ্ন ${vocabQuiz.currentIndex + 1} / ${total}</span>
          <span class="font-bold text-orange-500">🔥 স্ট্রিক: ${vocabQuiz.streak}</span>
        </div>

        <div class="w-full h-2 bg-slate-200 dark:bg-slate-800 rounded-full overflow-hidden">
          <div class="h-full bg-indigo-600 transition-all" style="width:${pct}%"></div>
        </div>

        <div class="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-4">
          <div class="text-center space-y-2">
            <p class="text-[11px] font-bold text-indigo-600 dark:text-indigo-400">
              ${vocabQuiz.mode === 'synonym' ? 'নিচের শব্দটির সঠিক Synonym কোনটি?' : 'নিচের শব্দটির সঠিক বাংলা অর্থ কোনটি?'}
            </p>
            <div class="flex items-center justify-center gap-2">
              <h2 class="text-2xl font-bold text-slate-900 dark:text-white">${escHtml(q.item.word)}</h2>
              <button onclick="speakVocabById(${q.item.id})" class="px-2.5 py-1 bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 rounded-lg text-xs">🔊</button>
            </div>
          </div>

          <div class="space-y-2.5">
            ${q.options.map((opt, idx) => {
              let cls = 'border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800';
              if (answered) {
                if (idx === q.correctIndex) cls = 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/60 text-emerald-900 dark:text-emerald-200 font-bold';
                else if (idx === vocabQuiz.selectedOption) cls = 'border-rose-500 bg-rose-50 dark:bg-rose-950/60 text-rose-900 dark:text-rose-200';
              }
              return `<button onclick="answerVocabQuiz(${idx})" ${answered ? 'disabled' : ''} class="w-full text-left px-4 py-3 rounded-xl border text-sm transition ${cls}">${escHtml(opt)}</button>`;
            }).join('')}
          </div>

          ${answered ? `
            <div class="p-3.5 rounded-2xl text-xs space-y-1.5 ${isCorrect ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200' : 'bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200'}">
              <p class="font-bold">${isCorrect ? '✅ দারুণ! সঠিক উত্তর (+Mastered)' : '❌ ভুল হয়েছে — শব্দটি রিভিশন লিস্টে যোগ হয়েছে'}</p>
              <p><b>অর্থ:</b> ${escHtml(q.item.meaning_bn)}</p>
              ${q.item.synonyms ? `<p><b>Synonyms:</b> ${escHtml(q.item.synonyms)}</p>` : ''}
              ${q.item.example ? `<p class="italic">"${escHtml(q.item.example)}"</p>` : ''}
            </div>
            <button onclick="nextVocabQuizQuestion()" class="w-full py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl shadow-md">
              ${vocabQuiz.currentIndex + 1 >= total ? 'ফলাফল দেখুন 🏆' : 'পরবর্তী শব্দ →'}
            </button>` : ''}
        </div>
      </div>`;
  }

  // ৩. কুইজ সেটআপ স্ক্রিন
  return `
    <form onsubmit="startVocabQuiz(event)" class="bg-white dark:bg-slate-900 p-5 rounded-2xl border border-indigo-100 dark:border-slate-800 shadow-sm space-y-4">
      <div class="flex items-center gap-3">
        <div class="w-11 h-11 rounded-2xl bg-indigo-600 text-white flex items-center justify-center text-lg shadow-sm">🎯</div>
        <div>
          <h2 class="font-bold text-base">Magoosh-স্টাইল ভোকাব এক্সাম</h2>
          <p class="text-xs text-slate-500 dark:text-slate-400">স্বয়ংক্রিয় MCQ কুইজের মাধ্যমে শব্দ মুখস্থ যাচাই করুন (${visiblePool.length}টি শব্দ প্রস্তুত)</p>
        </div>
      </div>

      <div class="space-y-1">
        <label class="text-xs font-bold">পরীক্ষার ধরন</label>
        <select name="quiz_mode" class="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800">
          <option value="meaning">English Word → বাংলা অর্থ</option>
          <option value="synonym">English Word → Synonym (সমার্থক শব্দ)</option>
        </select>
      </div>

      <div class="space-y-1">
        <label class="text-xs font-bold">কোন শব্দগুলো থেকে পরীক্ষা দেবেন?</label>
        <select name="quiz_scope" class="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800">
          <option value="unmastered">🔄 শুধু যেগুলো এখনো আয়ত্ত হয়নি (Magoosh Smart)</option>
          <option value="current">📚 বর্তমান ক্যাটাগরির সব শব্দ</option>
        </select>
      </div>

      <div class="space-y-1">
        <label class="text-xs font-bold">প্রশ্নের সংখ্যা</label>
        <select name="quiz_count" class="w-full px-3 py-2.5 text-sm border border-slate-200 dark:border-slate-700 rounded-xl bg-white dark:bg-slate-800">
          <option value="10">১০টি শব্দ (কুইক টেস্ট)</option>
          <option value="20">২০টি শব্দ (স্ট্যান্ডার্ড)</option>
          <option value="30">৩০টি শব্দ (ম্যারাথন)</option>
        </select>
      </div>

      <button type="submit" class="w-full py-3 bg-indigo-600 text-white text-sm font-bold rounded-xl shadow-md">
        🎯 ভোকাব এক্সাম শুরু করুন
      </button>
    </form>`;
}

// ==========================================
// Main Render Vocab View
// ==========================================
function renderVocab() {
  const isAdmin = isAdminUser();
  const isPro = isProUser();
  const categories = getVocabCategories();
  const visiblePool = getVisibleVocabPool();
  const masteryMap = getVocabMasteryMap();
  const lockedCount = !isPro ? Math.max(0, state.vocabItems.length - FREE_LIMITS.vocabTotal) : 0;
  const editItem = state.editing?.type === 'vocab' ? state.editing.item : null;

  return `
    <div class="space-y-3.5">
      <!-- ৩টি মোড সুইচার -->
      <div class="grid grid-cols-3 bg-slate-200/70 dark:bg-slate-800 p-1 rounded-xl gap-1">
        <button onclick="switchVocabMode('list')"
          class="py-2 text-xs font-bold rounded-lg transition ${vocabViewMode === 'list' ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'}">
          📖 লিস্ট
        </button>
        <button onclick="switchVocabMode('flashcard')"
          class="py-2 text-xs font-bold rounded-lg transition ${vocabViewMode === 'flashcard' ? 'bg-white dark:bg-slate-700 text-teal-700 dark:text-teal-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'}">
          🃏 ফ্ল্যাশকার্ড
        </button>
        <button onclick="switchVocabMode('quiz')"
          class="py-2 text-xs font-bold rounded-lg transition ${vocabViewMode === 'quiz' ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-sm' : 'text-slate-600 dark:text-slate-400'}">
          🎯 কুইজ এক্সাম
        </button>
      </div>

      <!-- ক্যাটাগরি ফিল্টার বার (চলমান কুইজের সময় লুকানো থাকবে) -->
      ${!(vocabViewMode === 'quiz' && vocabQuiz.active) ? `
        <div class="flex gap-2 overflow-x-auto no-scrollbar">
          ${categories.map((cat, idx) => `
            <button onclick="selectVocabCategoryByIdx(${idx})"
              class="px-3 py-1.5 rounded-full text-xs font-bold whitespace-nowrap ${
                state.vocabCategory === cat
                  ? 'bg-teal-600 text-white'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
              }">${cat === 'ALL' ? 'সব ক্যাটাগরি' : escHtml(cat)}</button>
          `).join('')}
        </div>` : ''}

      <!-- ফ্ল্যাশকার্ড মোড -->
      ${vocabViewMode === 'flashcard' ? renderVocabFlashcards(visiblePool, masteryMap) : ''}

      <!-- Magoosh কুইজ মোড -->
      ${vocabViewMode === 'quiz' ? renderVocabQuizView(visiblePool) : ''}

      <!-- লিস্ট মোড -->
      ${vocabViewMode === 'list' ? `
        <div class="flex flex-wrap justify-between items-center gap-2">
          <button onclick="toggleVocabBookmarkOnly()"
            class="px-3 py-1.5 rounded-lg text-xs font-bold border ${
              vocabBookmarkOnly
                ? 'bg-amber-500 text-slate-950 border-amber-500'
                : 'bg-white dark:bg-slate-900 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-slate-700'
            }">⭐ বুকমার্ক (${(state.bookmarks.vocab || []).length})</button>

          ${isAdmin ? `
            <div class="flex flex-wrap gap-1.5">
              <button onclick="toggleAddVocabForm()" class="px-2.5 py-1.5 bg-indigo-600 text-white text-xs font-bold rounded-lg">+ শব্দ</button>
              <button onclick="toggleBulk('vocab')" class="px-2.5 py-1.5 bg-slate-900 dark:bg-slate-700 text-white text-xs font-bold rounded-lg">📋 JSON</button>
              <button onclick="generateVocabAI()" ${state.saving ? 'disabled' : ''} class="px-2.5 py-1.5 bg-teal-600 text-white text-xs font-bold rounded-lg disabled:opacity-50">+৫ AI</button>
            </div>` : ''}
        </div>

        <form onsubmit="searchVocab(event)" class="flex gap-2">
          <input name="q" value="${escHtml(state.vocabSearch)}" placeholder="শব্দ, বাংলা অর্থ বা Synonym খুঁজুন..." class="flex-1 px-3 py-2 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl" />
          <button type="submit" class="px-3 py-2 bg-teal-600 text-white text-xs font-bold rounded-xl">খুঁজুন</button>
          ${state.vocabSearch ? `<button type="button" onclick="clearVocabSearch()" class="px-2.5 py-2 bg-slate-200 dark:bg-slate-700 text-xs font-bold rounded-xl">✕</button>` : ''}
        </form>

        ${isAdmin && showAddVocabForm ? `
          <form onsubmit="saveManualVocab(event)" class="bg-indigo-50 dark:bg-slate-900 border border-indigo-200 dark:border-slate-700 p-4 rounded-2xl space-y-2.5">
            <div class="flex justify-between items-center">
              <p class="text-xs font-bold text-indigo-900 dark:text-indigo-300">✍️ নতুন ভোকাবুলারি যোগ করুন</p>
              <button type="button" onclick="toggleAddVocabForm()" class="text-xs text-slate-500 font-bold">বন্ধ ✕</button>
            </div>
            <select name="category" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl">
              ${DEFAULT_VOCAB_CATEGORIES.map((c) => `<option value="${escHtml(c)}" ${state.vocabCategory === c ? 'selected' : ''}>${escHtml(c)}</option>`).join('')}
            </select>
            <div class="grid grid-cols-2 gap-2">
              <input name="word" required placeholder="Word (e.g. Pragmatic)" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
              <input name="meaning_bn" required placeholder="বাংলা অর্থ" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            </div>
            <input name="synonyms" placeholder="Synonyms (e.g. Practical, Realistic)" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            <input name="example" placeholder="Example sentence..." class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            <button type="submit" class="w-full py-2.5 bg-indigo-600 text-white text-xs font-bold rounded-xl">শব্দ সেভ করুন</button>
          </form>` : ''}

        ${editItem ? `
          <form onsubmit="saveEditVocab(event)" class="bg-amber-50 dark:bg-slate-900 border border-amber-300 dark:border-amber-700 p-4 rounded-2xl space-y-2.5">
            <div class="flex justify-between items-center">
              <p class="text-xs font-bold text-amber-900 dark:text-amber-300">✏️ শব্দ এডিট করুন</p>
              <button type="button" onclick="cancelEdit()" class="text-xs text-slate-500 font-bold">বাতিল ✕</button>
            </div>
            <input name="category" required value="${escHtml(editItem.category)}" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            <div class="grid grid-cols-2 gap-2">
              <input name="word" required value="${escHtml(editItem.word)}" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
              <input name="meaning_bn" required value="${escHtml(editItem.meaning_bn)}" class="px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            </div>
            <input name="synonyms" value="${escHtml(editItem.synonyms || '')}" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            <input name="example" value="${escHtml(editItem.example || '')}" class="w-full px-3 py-2 text-xs bg-white dark:bg-slate-800 border rounded-xl" />
            <button type="submit" class="w-full py-2.5 bg-amber-500 text-slate-950 text-xs font-bold rounded-xl">পরিবর্তন সেভ করুন</button>
          </form>` : ''}

        ${isAdmin && state.showBulk.vocab ? `
          <form onsubmit="importVocabJSON(event)" class="bg-slate-900 text-white p-4 rounded-2xl space-y-2.5">
            <div class="flex justify-between items-center">
              <p class="text-xs font-bold text-teal-300">📋 ভোকাবুলারি বাল্ক JSON পেস্ট করুন</p>
              <button type="button" onclick="toggleBulk('vocab')" class="text-xs text-slate-400">বন্ধ ✕</button>
            </div>
            <textarea name="json_data" required rows="5" placeholder='[{"word":"Pragmatic","meaning_bn":"বাস্তববাদী","synonyms":"Practical, Realistic","example":"He took a pragmatic approach.","category":"BCS High-Frequency"}]' class="w-full p-3 text-xs font-mono text-slate-900 bg-white rounded-xl"></textarea>
            <button type="submit" class="w-full py-2.5 bg-teal-500 text-slate-950 text-xs font-bold rounded-xl">ডাটাবেজে সেভ করুন</button>
          </form>` : ''}

        ${state.loading ? `<p class="text-center text-xs text-slate-500 py-6">লোড হচ্ছে...</p>` : ''}
        ${!state.loading && visiblePool.length === 0 ? `<div class="bg-white dark:bg-slate-900 p-6 rounded-xl text-center text-sm text-slate-500">কোনো শব্দ পাওয়া যায়নি।</div>` : ''}

        <div class="space-y-3">
          ${visiblePool.map((v) => {
            const bookmarked = isBookmarked('vocab', v.id);
            const mastered = masteryMap[String(v.id)] === 'mastered';
            return `
              <div class="bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-sm space-y-1.5">
                <div class="flex justify-between items-start gap-2">
                  <div class="flex flex-wrap items-center gap-2">
                    <h3 class="font-bold text-base text-teal-700 dark:text-teal-300">${escHtml(v.word)}</h3>
                    <button onclick="speakVocabById(${v.id})" class="px-2 py-0.5 bg-teal-50 dark:bg-teal-950 text-teal-700 dark:text-teal-300 rounded-lg text-xs" title="উচ্চারণ শুনুন">🔊</button>
                    ${mastered ? `<span class="text-[10px] px-2 py-0.5 bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 rounded-full font-bold">✅ আয়ত্ত</span>` : ''}
                  </div>
                  <div class="flex items-center gap-1 shrink-0">
                    <button onclick="toggleBookmark('vocab','${v.id}')" class="px-1.5 py-1 rounded-lg text-xs ${bookmarked ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-600' : 'bg-slate-100 dark:bg-slate-800 text-slate-400'}">⭐</button>
                    <button onclick="submitErrorReport('vocab','${v.id}')" class="px-1.5 py-1 bg-slate-100 dark:bg-slate-800 text-slate-500 rounded-lg text-xs">🚩</button>
                    ${isAdmin ? `
                      <button onclick="openEditVocab('${v.id}')" class="px-1.5 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 rounded-lg text-xs">✏️</button>
                      <button onclick="deleteItem('vocab_items','${v.id}',loadVocabItems)" class="px-1.5 py-1 bg-rose-50 dark:bg-rose-950/50 text-rose-600 rounded-lg text-xs">🗑️</button>` : ''}
                  </div>
                </div>
                <p class="font-semibold text-sm">${escHtml(v.meaning_bn)}</p>
                ${v.synonyms ? `<p class="text-xs text-slate-600 dark:text-slate-300"><b>Synonyms:</b> ${escHtml(v.synonyms)}</p>` : ''}
                ${v.example ? `<p class="text-xs italic text-slate-500 dark:text-slate-400">"${escHtml(v.example)}"</p>` : ''}
                <p class="text-[10px] text-slate-400 pt-0.5">${escHtml(v.category)}</p>
              </div>`;
          }).join('')}
        </div>

        ${lockedCount > 0 ? renderProLockCard(`আরও ${lockedCount}টি গুরুত্বপূর্ণ ভোকাবুলারি রয়েছে। সব শব্দ ও পূর্ণাঙ্গ Magoosh এক্সাম আনলক করতে Pro চালু করুন।`) : ''}
      ` : ''}
    </div>`;
}