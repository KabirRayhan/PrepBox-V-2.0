// ==========================================
// PrepBox BD V2 — Secure Hybrid AI Engine
// (Supabase JWT Auth + Role Guard + Gemini Primary + Groq Auto-Backup)
// ==========================================

const ADMIN_ONLY_ACTIONS = new Set(['preli', 'written', 'vocab', 'column', 'viva_curated']);
const FREE_DAILY_VIVA_LIMIT = 1;

async function fetchWithTimeout(url, options = {}, timeoutMs = 25000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error('সার্ভার থেকে উত্তর আসতে বেশি সময় লাগছে (Timeout)।');
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function getBangladeshTodayStartISO() {
  const bdMs = Date.now() + 6 * 60 * 60 * 1000;
  const bdDate = new Date(bdMs);
  const y = bdDate.getUTCFullYear();
  const m = String(bdDate.getUTCMonth() + 1).padStart(2, '0');
  const d = String(bdDate.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}T00:00:00+06:00`;
}

function cleanInput(str, maxLen = 120) {
  return String(str || '').replace(/[\r\n]+/g, ' ').trim().slice(0, maxLen);
}

// ==========================================
// Supabase ইউজার ও রোল যাচাই
// ==========================================
async function verifyUserAndProfile(req) {
  const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/+$/, '');
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !supabaseAnonKey) {
    throw { status: 500, message: 'Vercel-এ SUPABASE_URL বা SUPABASE_ANON_KEY সেট করা নেই।' };
  }

  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  if (!token) {
    throw { status: 401, message: 'অনুগ্রহ করে আগে লগইন করুন।' };
  }

  const headers = {
    apikey: supabaseAnonKey,
    Authorization: `Bearer ${token}`,
  };

  // ১. JWT টোকেন থেকে আসল ইউজার যাচাই
  const userRes = await fetchWithTimeout(`${supabaseUrl}/auth/v1/user`, { headers }, 10000);
  if (!userRes.ok) {
    throw { status: 401, message: 'আপনার লগইন সেশন মেয়াদোত্তীর্ণ। পুনরায় লগইন করুন।' };
  }
  const user = await userRes.json();
  if (!user?.id) {
    throw { status: 401, message: 'অবৈধ ইউজার টোকেন।' };
  }

  // ২. RLS-এর মাধ্যমে প্রোফাইল (role ও Pro স্ট্যাটাস) যাচাই
  const profUrl = `${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=role,is_pro,pro_expires_at&limit=1`;
  const profRes = await fetchWithTimeout(profUrl, { headers }, 10000);
  if (!profRes.ok) {
    throw { status: 403, message: 'ইউজার প্রোফাইল যাচাই করা যায়নি।' };
  }
  const profList = await profRes.json();
  const profile = Array.isArray(profList) ? profList[0] : null;
  if (!profile) {
    throw { status: 403, message: 'প্রোফাইল পাওয়া যায়নি।' };
  }

  const isAdmin = profile.role === 'admin';
  const isPro =
    isAdmin ||
    (Boolean(profile.is_pro) &&
      (!profile.pro_expires_at || new Date(profile.pro_expires_at) > new Date()));

  return { user, profile, isAdmin, isPro, supabaseUrl, headers };
}

async function checkFreeVivaQuota(authCtx) {
  if (authCtx.isPro) return;
  const todayISO = encodeURIComponent(getBangladeshTodayStartISO());
  const url = `${authCtx.supabaseUrl}/rest/v1/viva_items?user_id=eq.${encodeURIComponent(authCtx.user.id)}&is_public=eq.false&created_at=gte.${todayISO}&select=id`;
  const res = await fetchWithTimeout(url, { headers: authCtx.headers }, 10000);
  if (!res.ok) return;
  const items = await res.json();
  if (Array.isArray(items) && items.length >= FREE_DAILY_VIVA_LIMIT) {
    throw {
      status: 429,
      message: 'ফ্রি প্ল্যানে দিনে ১টি কাস্টম ভাইভা তৈরি করা যায়। আনলিমিটেড ভাইভার জন্য Pro চালু করুন।',
    };
  }
}

// ==========================================
// প্রম্পট বিল্ডার (৩-স্তরের এক্সাম ফোকাসসহ)
// ==========================================
function buildPrompt(action, payload = {}) {
  if (action === 'preli') {
    const existing = (payload.existingQuestions || []).slice(0, 25).join(' | ');
    const count = Math.min(15, Math.max(1, Number(payload.count) || 5));
    const subject = cleanInput(payload.subject, 100);
    const topic = cleanInput(payload.topic, 120);
    const focus = cleanInput(payload.examFocus || 'ALL', 20);

    let focusInstruction = 'বিসিএস, ব্যাংক ও প্রাইমারি—সব পরীক্ষার জন্য প্রাসঙ্গিক মানসম্মত প্রশ্ন তৈরি করো এবং সঠিক exam_tags বসাও।';
    if (focus === 'BCS') {
      focusInstruction = 'শুধুমাত্র বিসিএস প্রিলিমিনারি (PSC) স্ট্যান্ডার্ডের বিশ্লেষণধর্মী ও গুরুত্বপূর্ণ প্রশ্ন তৈরি করো। exam_tags-এ অবশ্যই "BCS" রাখো।';
    } else if (focus === 'Bank') {
      focusInstruction = 'বাংলাদেশ ব্যাংক ও সমন্বিত ব্যাংক (Combined Bank) প্রিলি স্ট্যান্ডার্ডের প্রশ্ন তৈরি করো (গণিত/ইংরেজি/ব্যাংকিং হলে ইংরেজি স্ট্যান্ডার্ড বজায় রাখো)। exam_tags-এ অবশ্যই "Bank" রাখো।';
    } else if (focus === 'Primary') {
      focusInstruction = 'সরকারি প্রাথমিক সহকারী শিক্ষক নিয়োগ (DPE) পরীক্ষার স্ট্যান্ডার্ড অনুযায়ী সরাসরি, সহজবোধ্য ও হাই-ইয়েল্ড প্রশ্ন তৈরি করো। exam_tags-এ অবশ্যই "Primary" রাখো।';
    }

    return `তুমি বাংলাদেশের বিসিএস, ব্যাংক ও প্রাইমারি চাকরির পরীক্ষার অভিজ্ঞ প্রশ্নকর্তা।
বিষয়: ${subject}
টপিক: ${topic}
পরীক্ষার ফোকাস: ${focus} — ${focusInstruction}
আগে থাকা প্রশ্ন (এগুলো রিপিট করবে না): ${existing || 'নেই'}

এই টপিকের ওপর ${count}টি সম্পূর্ণ নতুন, শতভাগ নির্ভুল ও পরীক্ষা-মানের MCQ প্রশ্ন তৈরি করো।
সতর্কতা: কোনো প্রশ্ন বিগত সালের কিনা ১০০% নিশ্চিত না হলে বানিয়ে সাল লিখবে না; সেক্ষেত্রে source_note-এ "মডেল সাজেশন" বা "গুরুত্বপূর্ণ" লিখবে। পরীক্ষার জন্য খুব গুরুত্বপূর্ণ প্রশ্ন হলে is_important: true দেবে।

শুধুমাত্র নিচের JSON অবজেক্ট ফরম্যাটে উত্তর দাও:
{
  "result": [
    {
      "question": "প্রশ্নটি বাংলায় (ইংরেজি বিষয় বা ব্যাংক ম্যাথ হলে ইংরেজিতে)",
      "options": ["অপশন ক", "অপশন খ", "অপশন গ", "অপশন ঘ"],
      "correct_index": 0,
      "explanation": "১-২ লাইনে পরিষ্কার ও নির্ভুল ব্যাখ্যা",
      "exam_tags": ["BCS", "Bank", "Primary"],
      "is_important": true,
      "source_note": "মডেল সাজেশন"
    }
  ]
}`;
  }

  if (action === 'written') {
    const existing = (payload.existingTitles || []).slice(0, 25).join(' | ');
    const examLabel = payload.exam_type === 'bank' ? 'ব্যাংক' : 'বিসিএস';
    const folder = cleanInput(payload.folder, 120);

    return `তুমি বাংলাদেশের ${examLabel} লিখিত পরীক্ষার অভিজ্ঞ শিক্ষক ও পরীক্ষক।
ফোল্ডার/বিষয়: ${folder}
আগে থাকা শিরোনাম (রিপিট করবে না): ${existing || 'নেই'}

এই ফোল্ডারের ওপর পরীক্ষায় আসার মতো ৫টি সম্পূর্ণ নতুন, সমৃদ্ধ ও গুছানো লিখিত নোট (গণিত হলে LaTeX সূত্রসহ ধাপে ধাপে সমাধান) তৈরি করো।
শুধুমাত্র নিচের JSON অবজেক্ট ফরম্যাটে উত্তর দাও:
{
  "result": [
    {
      "title": "সুনির্দিষ্ট শিরোনাম",
      "content": {
        "overview": "২-৩ লাইনে মূল ধারণা ও ভূমিকা",
        "body": "পয়েন্ট আকারে মূল বিশ্লেষণ, তথ্য বা ধাপে ধাপে সমাধান",
        "tips": "পরীক্ষার খাতায় বেশি নম্বর পাওয়ার ১টি কার্যকর টিপস"
      }
    }
  ]
}`;
  }

  if (action === 'vocab') {
    const existing = (payload.existingWords || []).slice(0, 40).join(', ');
    const category = cleanInput(payload.category || 'BCS & Bank High-Frequency', 100);

    return `Generate 5 high-frequency English vocabulary words essential for Bangladesh BCS, Bank, and Primary job exams.
Category: ${category}
Avoid these existing words: ${existing || 'None'}

Return ONLY valid JSON in this exact format:
{
  "result": [
    {
      "word": "Pragmatic",
      "meaning_bn": "বাস্তববাদী / প্রয়োগবাদী",
      "synonyms": "Practical, Realistic, Sensible",
      "example": "A clean, exam-relevant example sentence."
    }
  ]
}`;
  }

  if (action === 'column') {
    const existing = (payload.existingTitles || []).slice(0, 25).join(' | ');
    const isEditorial = payload.item_type === 'editorial';
    const subCategory = cleanInput(payload.sub_category || (isEditorial ? '🇧🇩 বাংলা সম্পাদকীয়' : 'বাংলাদেশ'), 60);
    const editionLabel = cleanInput(payload.edition_label || '', 40);
    const typeLabel = isEditorial ? `পত্রিকা সম্পাদকীয় বিশ্লেষণ (${subCategory})` : `সাম্প্রতিক সাধারণ জ্ঞান বুলেটিন (${subCategory})`;

    return `তুমি বাংলাদেশের বিসিএস ও ব্যাংক পরীক্ষার জন্য পত্রিকার সম্পাদকীয় ও সাম্প্রতিক বিশ্লেষক।
ধরন: ${typeLabel}
সংস্করণ/মাস: ${editionLabel || 'সাম্প্রতিক'}
আগে থাকা শিরোনাম (রিপিট করবে না): ${existing || 'নেই'}

বাংলাদেশ ও আন্তর্জাতিক প্রেক্ষাপটে প্রিলি, রিটেন ও ভাইভার জন্য অত্যন্ত গুরুত্বপূর্ণ ৫টি নতুন ${typeLabel} তৈরি করো।
${isEditorial ? 'প্রতিটি সম্পাদকীয়তে পরীক্ষার অনুবাদের জন্য ২টি গুরুত্বপূর্ণ English-to-Bangla বাক্য (translation_list) এবং ৩-৪টি ইংরেজি ভোকাবুলারি (vocab_list) অবশ্যই দাও।' : 'প্রতিটি সাম্প্রতিক তথ্যে মূল পয়েন্ট ও পিন-পয়েন্ট ফ্যাক্টস দাও।'}

শুধুমাত্র নিচের JSON অবজেক্ট ফরম্যাটে উত্তর দাও:
{
  "result": [
    {
      "title": "আকর্ষণীয় ও তথ্যবহুল শিরোনাম",
      "sub_category": "${subCategory}",
      "edition_label": "${editionLabel}",
      "summary": "পয়েন্ট আকারে সহজ ও বিশ্লেষণধর্মী সারসংক্ষেপ",
      "key_data": "পরীক্ষার জন্য গুরুত্বপূর্ণ ৩-৪টি মূল তথ্য বা পরিসংখ্যান",
      "translation_list": [
        { "en": "A high-value exam-standard English sentence.", "bn": "এর প্রাঞ্জল বাংলা অনুবাদ।" }
      ],
      "vocab_list": [
        { "word": "Inflation", "meaning": "মুদ্রাস্ফীতি" }
      ]
    }
  ]
}`;
  }

  if (action === 'viva_curated') {
    const existing = (payload.existingTitles || []).slice(0, 20).join(' | ');
    const vivaType = cleanInput(payload.viva_type || 'general', 40);

    return `তুমি বাংলাদেশের বিসিএস, ব্যাংক ও প্রাইমারি ভাইভা বোর্ডের একজন অভিজ্ঞ সদস্য।
ক্যাটাগরি: ${vivaType}
আগে থাকা সেটের শিরোনাম (রিপিট করবে না): ${existing || 'নেই'}

বাংলাদেশের চাকরির ভাইভায় সবচেয়ে বেশি জিজ্ঞাসা করা হয় এমন ১টি বোর্ড-স্ট্যান্ডার্ড সাজেশন ভাইভা সেট তৈরি করো (সংবিধান, মুক্তিযুদ্ধ, ব্যাংকিং/অর্থনীতি, প্রাথমিক শিক্ষা বা প্রশাসনিক পরিস্থিতি নিয়ে ৬টি প্রশ্ন ও স্মার্ট, মার্জিত উত্তর)।
শুধুমাত্র নিচের JSON অবজেক্ট ফরম্যাটে উত্তর দাও:
{
  "result": {
    "title": "আকর্ষণীয় ও সুনির্দিষ্ট সেটের শিরোনাম",
    "qa_list": [
      { "q": "বোর্ডের প্রশ্ন", "a": "মার্জিত, কূটনৈতিক ও টু-দ্য-পয়েন্ট উত্তর" }
    ]
  }
}`;
  }

  if (action === 'viva') {
    const district = cleanInput(payload.district, 60);
    const subjectName = cleanInput(payload.subject_name, 80);
    const targetJob = cleanInput(payload.target_job || 'বিসিএস/ব্যাংক', 60);

    if (!district || !subjectName) {
      throw { status: 400, message: 'নিজ জেলা এবং পড়াশোনার বিষয় লিখুন।' };
    }

    return `তুমি বাংলাদেশের ${targetJob} ভাইভা বোর্ডের একজন অভিজ্ঞ সদস্য।
প্রার্থীর নিজ জেলা: ${district}
অনার্স/পড়াশোনার বিষয়: ${subjectName}
টার্গেট চাকরি: ${targetJob}

এই প্রার্থীর জন্য নিজ জেলার ইতিহাস-ঐতিহ্য, নিজের পড়াশোনার বিষয় এবং টার্গেট চাকরির প্রাসঙ্গিকতার ওপর ৬টি বাস্তবসম্মত ভাইভা প্রশ্ন ও স্মার্ট, মার্জিত উত্তর তৈরি করো।
শুধুমাত্র নিচের JSON অবজেক্ট ফরম্যাটে উত্তর দাও:
{
  "result": {
    "title": "${targetJob} — ${district} (${subjectName})",
    "qa_list": [
      { "q": "বোর্ডের প্রশ্ন", "a": "মার্জিত ও টু-দ্য-পয়েন্ট উত্তর" }
    ]
  }
}`;
  }

  throw { status: 400, message: 'অজানা AI অ্যাকশন।' };
}

// ==========================================
// JSON পার্সার ও AI প্রোভাইডার কল
// ==========================================
function extractJSON(rawText) {
  let cleaned = String(rawText || '').trim();
  cleaned = cleaned.replace(/^\x60{3}(?:json)?\s*/i, '').replace(/\s*\x60{3}$/i, '').trim();

  try {
    const parsed = JSON.parse(cleaned);
    return parsed.result !== undefined ? parsed.result : parsed;
  } catch (_) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end > start) {
      const parsed = JSON.parse(cleaned.slice(start, end + 1));
      return parsed.result !== undefined ? parsed.result : parsed;
    }
    throw new Error('AI থেকে সঠিক JSON ফরম্যাট পাওয়া যায়নি। আবার চেষ্টা করুন।');
  }
}

async function callGemini(prompt, apiKey) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${encodeURIComponent(apiKey)}`;
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          maxOutputTokens: 8192,
          responseMimeType: 'application/json',
        },
      }),
    },
    25000
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Gemini HTTP ${res.status}`);
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini থেকে কোনো উত্তর পাওয়া যায়নি।');
  return extractJSON(text);
}

async function callGroq(prompt, apiKey) {
  const res = await fetchWithTimeout(
    'https://api.groq.com/openai/v1/chat/completions',
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        temperature: 0.4,
        max_tokens: 4096,
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are an expert exam content creator for Bangladesh BCS, Bank, and Primary job exams. Always respond strictly with valid JSON matching the requested schema.',
          },
          { role: 'user', content: prompt },
        ],
      }),
    },
    25000
  );
  const json = await res.json();
  if (!res.ok) throw new Error(json.error?.message || `Groq HTTP ${res.status}`);
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('Groq থেকে কোনো উত্তর পাওয়া যায়নি।');
  return extractJSON(text);
}

// ==========================================
// Main Vercel Handler
// ==========================================
module.exports = async (req, res) => {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

  try {
    const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
    const action = String(body.action || '').trim();
    const payload = body.payload || {};

    // ১. ইউজার অথেনটিকেশন ও পারমিশন যাচাই
    const authCtx = await verifyUserAndProfile(req);

    if (ADMIN_ONLY_ACTIONS.has(action) && !authCtx.isAdmin) {
      return res.status(403).json({ error: 'এই AI ফিচারটি শুধুমাত্র অ্যাডমিনের জন্য সংরক্ষিত।' });
    }

    if (action === 'viva') {
      await checkFreeVivaQuota(authCtx);
    }

    // ২. প্রম্পট তৈরি ও AI কল
    const prompt = buildPrompt(action, payload);
    const geminiKey = process.env.GEMINI_API_KEY;
    const groqKey = process.env.GROQ_API_KEY;

    if (!geminiKey && !groqKey) {
      return res.status(500).json({ error: 'Vercel-এ GEMINI_API_KEY বা GROQ_API_KEY বসানো নেই।' });
    }

    let data = null;
    let provider = '';
    const errors = [];

    if (geminiKey) {
      try {
        data = await callGemini(prompt, geminiKey);
        provider = 'gemini';
      } catch (err) {
        errors.push(`Gemini: ${err.message}`);
      }
    }

    if (!data && groqKey) {
      try {
        data = await callGroq(prompt, groqKey);
        provider = 'groq';
      } catch (err) {
        errors.push(`Groq: ${err.message}`);
      }
    }

    if (!data) {
      throw new Error(errors.join(' | ') || 'AI সার্ভার এই মুহূর্তে ব্যস্ত আছে, কিছুক্ষণ পর চেষ্টা করুন।');
    }

    return res.status(200).json({ data, provider });
  } catch (err) {
    const status = err.status || 500;
    const message = err.message || 'অপ্রত্যাশিত সার্ভার ত্রুটি ঘটেছে।';
    return res.status(status).json({ error: message });
  }
};