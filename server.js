/**
 * 4/2 Hub — Backend Proxy Server
 * Node.js + Express
 *
 * Endpoints:
 *   POST /api/scores   — Login + ดึงคะแนน + ชื่อ + เบอร์
 *   POST /api/report   — ดึงรายงานละเอียด (ความดี / ตัดคะแนน)
 *   GET  /api/health   — Health check
 *
 * Session Cookie Cache:
 *   เก็บ cookie ไว้ใน memory (sessionCache) เพื่อไม่ต้อง login ซ้ำทุก request
 *   TTL = 25 นาที (session โรงเรียนมักหมดที่ 30 นาที)
 */

'use strict';

const express  = require('express');
const fetch    = require('node-fetch');
const cheerio  = require('cheerio');
const path     = require('path');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

/* ──────────────────────────────────────────
   CONFIG
────────────────────────────────────────── */
const BASE_URL   = 'http://www.kci.xn--12c1bpbba3dcfr1jra8c9bzgl.com';
const SESSION_TTL = 25 * 60 * 1000; // 25 min in ms

/* ──────────────────────────────────────────
   IN-MEMORY SESSION CACHE
   key = username, value = { cookie, expiresAt }
────────────────────────────────────────── */
const sessionCache = new Map();

function getCachedCookie(username) {
  const entry = sessionCache.get(username);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) { sessionCache.delete(username); return null; }
  return entry.cookie;
}

function setCachedCookie(username, cookie) {
  sessionCache.set(username, { cookie, expiresAt: Date.now() + SESSION_TTL });
}

/* ──────────────────────────────────────────
   HELPER: Login → get Cookie
────────────────────────────────────────── */
async function doKCILogin(username, password) {
  const formData = new URLSearchParams();
  formData.append('user_stu', username);
  formData.append('pass_stu', password);
  formData.append('button2',  'เข้าสู่ระบบ');

  const loginRes = await fetch(`${BASE_URL}/stu/index.php`, {
    method:   'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent':   'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer':      `${BASE_URL}/stu/index.php`,
    },
    body:     formData.toString(),
    redirect: 'manual',
    timeout:  12000,
  });

  const rawCookies = loginRes.headers.raw()['set-cookie'];
  if (!rawCookies || rawCookies.length === 0) {
    throw new Error('LOGIN_FAILED');
  }
  const cookie = rawCookies.map(c => c.split(';')[0]).join('; ');
  return cookie;
}

/* ──────────────────────────────────────────
   HELPER: Fetch page with cookie (auto-retry once if session expired)
────────────────────────────────────────── */
async function fetchWithSession(url, username, password, referer) {
  // Try cached cookie first
  let cookie = getCachedCookie(username);
  if (!cookie) {
    cookie = await doKCILogin(username, password);
    setCachedCookie(username, cookie);
  }

  let pageRes = await fetch(url, {
    headers: {
      'Cookie':     cookie,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
      'Referer':    referer || `${BASE_URL}/stu/main-stu.php`,
    },
    timeout: 12000,
  });
  let html = await pageRes.text();

  // Detect session expired → re-login once
  const isLoginPage = html.includes('action="/stu/index.php"') ||
    (html.includes('pass_stu') && html.includes('เข้าสู่ระบบ'));

  if (isLoginPage) {
    sessionCache.delete(username);
    cookie = await doKCILogin(username, password);
    setCachedCookie(username, cookie);

    pageRes = await fetch(url, {
      headers: {
        'Cookie':     cookie,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Referer':    referer || `${BASE_URL}/stu/main-stu.php`,
      },
      timeout: 12000,
    });
    html = await pageRes.text();

    // Still login page = wrong credentials
    if (html.includes('action="/stu/index.php"') && html.includes('pass_stu')) {
      throw new Error('LOGIN_FAILED');
    }
  }

  return html;
}

/* ──────────────────────────────────────────
   HELPER: Parse table → array of row arrays
────────────────────────────────────────── */
function parseTable($, tableEl) {
  const rows = [];
  $(tableEl).find('tr').each((_, tr) => {
    const cells = [];
    $(tr).find('td, th').each((_, td) => {
      cells.push($(td).text().replace(/\s+/g, ' ').trim());
    });
    if (cells.some(c => c !== '')) rows.push(cells);
  });
  return rows;
}

/* ──────────────────────────────────────────
   HELPER: Smart student name extractor
────────────────────────────────────────── */
function extractStudentName($) {
  const prefixes = ['นาย', 'นางสาว', 'นาง', 'เด็กชาย', 'เด็กหญิง', 'ด.ช.', 'ด.ญ.'];
  let found = '';

  $('td, th, div, span, p, h1, h2, h3, h4, b, strong').each((_, el) => {
    if (found) return false;
    const txt = $(el).text().replace(/\s+/g, ' ').trim();
    if (txt.length > 5 && txt.length < 80) {
      if (prefixes.some(p => txt.startsWith(p) || txt.includes(p + ' '))) {
        found = txt;
        return false;
      }
    }
  });

  return found;
}

/* ──────────────────────────────────────────
   HELPER: Extract phone number
────────────────────────────────────────── */
function extractPhone($) {
  let phone = '';
  const phoneReg = /0[6-9]\d[\s\-]?\d{3}[\s\-]?\d{4}/;

  $('td, th, span, div').each((_, el) => {
    if (phone) return false;
    const txt = $(el).text().trim();
    const match = txt.match(phoneReg);
    if (match) { phone = match[0].replace(/[\s\-]/g, ''); return false; }
    if (/เบอร์|โทร|phone|tel/i.test(txt)) {
      const nextTxt = $(el).next().text().trim();
      const m2 = nextTxt.match(phoneReg);
      if (m2) { phone = m2[0].replace(/[\s\-]/g, ''); return false; }
    }
  });
  return phone;
}

/* ──────────────────────────────────────────
   API: POST /api/scores
   Body: { username, password }
   Returns: { success, student, tel, scores:{good,bad,total} }
────────────────────────────────────────── */
app.post('/api/scores', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'กรุณากรอก Username และ Password' });
  }

  try {
    const html = await fetchWithSession(
      `${BASE_URL}/stu/main-stu.php`,
      username, password,
      `${BASE_URL}/stu/index.php`
    );
    const $ = cheerio.load(html);

    /* ── Scores ── */
    // Try multiple selectors — KCI may change layout
    const tryText = (...selectors) => {
      for (const s of selectors) {
        const t = $(s).first().text().trim();
        if (t && t !== '') return t;
      }
      return '';
    };

    const goodScore  = tryText('.text1', 'span.text1', 'td.text1');
    const badScore   = tryText('.text2', 'td.text2', 'span.text2');
    const totalScore = tryText('.text3', 'td.text3', 'span.text3');

    /* ── Fallback: scan all td for numeric pattern near label ── */
    let goodFB = '', badFB = '', totalFB = '';
    if (!goodScore || !badScore) {
      $('td').each((_, el) => {
        const txt = $(el).text().trim();
        if (/ความดี/i.test(txt)) {
          const sib = $(el).next('td').text().trim();
          if (/^[+\-]?\d+/.test(sib)) goodFB = sib;
        }
        if (/ประพฤต|พฤติกรรม/i.test(txt)) {
          const sib = $(el).next('td').text().trim();
          if (/^[+\-]?\d+/.test(sib)) badFB = sib;
        }
        if (/รวม|สรุป|คะแนนรวม/i.test(txt)) {
          const sib = $(el).next('td').text().trim();
          if (/^[+\-]?\d+/.test(sib)) totalFB = sib;
        }
      });
    }

    const studentName = extractStudentName($);
    const tel         = extractPhone($);

    return res.json({
      success: true,
      student: studentName || null,
      tel:     tel || null,
      scores: {
        good:  goodScore  || goodFB  || '0',
        bad:   badScore   || badFB   || '0',
        total: totalScore || totalFB || '0',
      },
    });

  } catch (err) {
    console.error('[/api/scores]', err.message);
    const isLoginErr = err.message === 'LOGIN_FAILED';
    return res.status(isLoginErr ? 401 : 500).json({
      success: false,
      message: isLoginErr
        ? 'รหัสนักเรียนหรือรหัสผ่านไม่ถูกต้อง'
        : 'เกิดข้อผิดพลาดในการเชื่อมต่อ: ' + err.message,
    });
  }
});

/* ──────────────────────────────────────────
   API: POST /api/report
   Body: { username, password }
   Returns: { success, pageTitle, good:{rows,total}, bad:{rows,total} }
────────────────────────────────────────── */
app.post('/api/report', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'ไม่มีข้อมูล session' });
  }

  try {
    const html = await fetchWithSession(
      `${BASE_URL}/stu/pub_stu.php`,
      username, password,
      `${BASE_URL}/stu/main-stu.php`
    );
    const $ = cheerio.load(html);

    const pageTitle = $('title').text().trim() ||
                      $('h2, h3, h4').first().text().trim() || '';

    let goodRows = [], badRows = [];
    let goodTotal = '', badTotal = '';

    /* ── Strategy 1: match by table heading text ── */
    $('table').each((_, tbl) => {
      const text = $(tbl).text();
      if (/ความดี/.test(text) && !/ประพฤต/.test(text)) {
        goodRows  = parseTable($, tbl);
        goodTotal = $(tbl).find('b, strong, .total, td.text1').first().text().trim();
      } else if (/ประพฤต|พฤติกรรม|ตัดคะแนน/.test(text)) {
        badRows  = parseTable($, tbl);
        badTotal = $(tbl).find('b, strong, .total, td.text2').first().text().trim();
      }
    });

    /* ── Strategy 2: fallback — grab first 2 data-tables ── */
    if (!goodRows.length && !badRows.length) {
      const dataTables = $('table').toArray().filter(t => $(t).find('tr').length > 2);
      if (dataTables[0]) goodRows = parseTable($, dataTables[0]);
      if (dataTables[1]) badRows  = parseTable($, dataTables[1]);
    }

    /* ── Clean header-only rows ── */
    const headerPattern = /^(ที่|ลำดับ|รายละเอียด|คะแนน|วันที่|เหตุผล|หมายเหตุ)$/;
    const cleanRows = rows => rows.filter(r =>
      r.some(c => c !== '') &&
      !r.every(c => c === '' || headerPattern.test(c))
    );

    return res.json({
      success:    true,
      pageTitle,
      good: { rows: cleanRows(goodRows), total: goodTotal },
      bad:  { rows: cleanRows(badRows),  total: badTotal  },
    });

  } catch (err) {
    console.error('[/api/report]', err.message);
    const isLoginErr = err.message === 'LOGIN_FAILED';
    return res.status(isLoginErr ? 401 : 500).json({
      success: false,
      message: isLoginErr ? 'Session หมดอายุ กรุณา Login ใหม่' : 'เกิดข้อผิดพลาด: ' + err.message,
    });
  }
});

/* ──────────────────────────────────────────
   API: GET /api/health
────────────────────────────────────────── */
app.get('/api/health', (_, res) => {
  res.json({
    status:   'ok',
    uptime:   process.uptime(),
    sessions: sessionCache.size,
    time:     new Date().toISOString(),
  });
});

/* ──────────────────────────────────────────
   SPA fallback
────────────────────────────────────────── */
app.get('*', (_, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ──────────────────────────────────────────
   START
────────────────────────────────────────── */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n✅  4/2 Hub Server`);
  console.log(`🚀  http://localhost:${PORT}`);
  console.log(`📡  KCI Proxy → ${BASE_URL}`);
  console.log(`⏱   Session TTL: ${SESSION_TTL / 60000} min\n`);
});
