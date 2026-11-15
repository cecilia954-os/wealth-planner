/* 财富规划助手 · 对话式原型
 * 问答采集 -> 集中确认 -> 确定性测算 -> 结果/建议书
 */
(function () {
  'use strict';

  const { PARAMS, PROFILES } = window.WealthData;
  const Engine = window.WealthEngine;
  const CURRENT_YEAR = new Date().getFullYear();

  const GOAL_META = {
    investment: { label: '投资计划', tag: '基础' },
    housing: { label: '购置房产' },
    education: { label: '子女教育' },
    retirement: { label: '退休养老' }
  };
  const SOURCE_META = {
    profile: { label: '画像带入', cls: 'src-profile' },
    client: { label: '客户提供', cls: 'src-client' },
    default: { label: '系统默认', cls: 'src-default' },
    edited: { label: '经理修改', cls: 'src-edited' }
  };

  const el = {};
  const state = {
    profile: null,
    goals: { investment: true, housing: true, education: true, retirement: true },
    fields: null,
    sources: {},
    queue: [],
    activeStep: null,
    answered: 0,
    started: false,
    completed: false,
    busy: false,
    results: null,
    inputs: null,
    resultTab: 'summary',
    confirmDraft: null,
    confirmDraftSources: null,
    demoMode: false
  };

  /* ------------------------------------------------------------------ */
  /* 工具函数                                                             */
  /* ------------------------------------------------------------------ */
  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }
  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function isNum(n) { return typeof n === 'number' && Number.isFinite(n); }
  function formatInputNum(n) {
    if (!isNum(n)) return '';
    return String(Math.round(n * 10000) / 10000);
  }
  function wan(v, digits) {
    if (!isNum(v)) return '—';
    const d = digits == null ? 1 : digits;
    return (v / 10000).toLocaleString('zh-CN', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtWan(v, digits) {
    if (!isNum(v)) return '—';
    return wan(v, digits == null ? 1 : digits) + ' 万';
  }
  function fmtYuan(v) {
    if (!isNum(v)) return '—';
    return Math.round(v).toLocaleString('zh-CN') + ' 元';
  }
  function fmtPct(v, digits) {
    if (!isNum(v)) return '—';
    return (v * 100).toFixed(digits == null ? 1 : digits) + '%';
  }
  function sourceBadge(source) {
    const meta = SOURCE_META[source] || SOURCE_META.default;
    return '<i class="src ' + meta.cls + '">' + meta.label + '</i>';
  }
  function draftSourceFor(path) {
    if (path.indexOf('children.') === 0) {
      const parts = path.split('.');
      return state.confirmDraftSources['children.' + parts[1]] || 'default';
    }
    return state.confirmDraftSources[path] || 'default';
  }
  function stageMeta(key) {
    return PARAMS.stages.find(function (s) { return s.key === key; }) || null;
  }
  function ageAtStartFor(startYear) {
    return state.profile.ageBase + (startYear - state.profile.baseYear);
  }
  function goalLabels() {
    return Object.keys(GOAL_META).filter(function (key) { return state.goals[key]; })
      .map(function (key) { return GOAL_META[key].label; });
  }
  function toast(message) {
    el.toast.textContent = message;
    el.toast.classList.remove('hidden');
    clearTimeout(toast._timer);
    toast._timer = setTimeout(function () { el.toast.classList.add('hidden'); }, 2800);
  }
  function showError(message) {
    el.errorBanner.textContent = '页面脚本提示：' + message;
    el.errorBanner.classList.remove('hidden');
    clearTimeout(showError._timer);
    showError._timer = setTimeout(function () { el.errorBanner.classList.add('hidden'); }, 8000);
  }

  /* 中文数字：支持 0–999 与常见小数场景 */
  const CN_DIGITS = {
    '零': 0, '〇': 0, '一': 1, '壹': 1, '二': 2, '两': 2, '贰': 2,
    '三': 3, '叁': 3, '四': 4, '肆': 4, '五': 5, '伍': 5, '六': 6, '陆': 6,
    '七': 7, '柒': 7, '八': 8, '捌': 8, '九': 9, '玖': 9
  };
  function cnToNumber(str) {
    if (str == null) return NaN;
    if (/^\d+(?:\.\d+)?$/.test(str)) return parseFloat(str);
    let section = 0;
    let number = 0;
    for (let i = 0; i < str.length; i++) {
      const ch = str[i];
      if (CN_DIGITS[ch] != null) {
        number = CN_DIGITS[ch];
      } else if (ch === '十' || ch === '拾') {
        section += (number || 1) * 10;
        number = 0;
      } else if (ch === '百' || ch === '佰') {
        section += (number || 1) * 100;
        number = 0;
      } else {
        return NaN;
      }
    }
    return section + number;
  }

  function extractAmount(text, opts) {
    const o = opts || {};
    const defaultUnit = o.defaultUnit == null ? 10000 : o.defaultUnit;
    const rawText = String(text);
    const monthlyContext = /每月|每个月|月均|月薪|月收入|月支出|\/月/.test(rawText);
    let raw = null;
    let unitText = '';
    const m = rawText.match(/(\d[\d,]*(?:\.\d+)?)\s*(万元|万|元|千元|千|k|K|w|W)?/);
    if (m) {
      raw = parseFloat(m[1].replace(/,/g, ''));
      unitText = m[2] || '';
    } else {
      const cm = rawText.match(/([零〇一壹二两贰三叁四肆五伍六陆七柒八捌九玖十拾百佰]+)\s*(万元|万|元|千元|千)?/);
      if (!cm) return null;
      raw = cnToNumber(cm[1]);
      unitText = cm[2] || '';
    }
    if (!Number.isFinite(raw)) return null;
    let multiplier;
    if (!unitText) {
      multiplier = (monthlyContext && raw >= 100) ? 1 : defaultUnit;
    } else if (/万|w/i.test(unitText)) {
      multiplier = 10000;
    } else if (/千|k/i.test(unitText)) {
      multiplier = 1000;
    } else {
      multiplier = 1;
    }
    let value = raw * multiplier;
    if (o.annualizeMonthly !== false && monthlyContext) value *= 12;
    return { value: value, monthly: monthlyContext, raw: raw, unitText: unitText };
  }

  function success(value, display, source) {
    return { ok: true, value: value, display: display, source: source || 'client' };
  }
  function failure(message) {
    return { ok: false, error: message };
  }

  function parseYearText(text, fields) {
    const m = String(text).match(/(19|20)\d{2}/);
    if (m) return parseInt(m[0], 10);
    const n = String(text).match(/(\d+)\s*年(?:后|以后)?/);
    if (n) return fields.startYear + parseInt(n[1], 10);
    const cn = String(text).match(/([一二两三四五六七八九十]+)\s*年(?:后|以后)?/);
    if (cn) {
      const v = cnToNumber(cn[1]);
      if (Number.isFinite(v)) return fields.startYear + v;
    }
    if (/明年/.test(text)) return fields.startYear + 1;
    return null;
  }

  function parseYesNo(text) {
    const t = String(text);
    if (/没有|并没有|无|暂无|否|不是|不需要|不用|不会|不参加|不采用|未参加|未退休|不出国|不贷款|全款/.test(t)) return false;
    if (/有|是|需要|要|对|确认|参加|采用|可以|好|同意|已退休|出国|贷款|按揭/.test(t)) return true;
    return null;
  }

  function parsePercentText(text) {
    const t = String(text);
    const m = t.match(/(\d+(?:\.\d+)?)\s*%/);
    if (m) return parseFloat(m[1]) / 100;
    const cn = t.match(/([一二两三四五六七八九十])\s*成/);
    if (cn) {
      const v = cnToNumber(cn[1]);
      if (Number.isFinite(v)) return v / 10;
    }
    const n = t.match(/(\d+(?:\.\d+)?)/);
    if (n) {
      const v = parseFloat(n[1]);
      return v > 1 ? v / 100 : v;
    }
    return null;
  }

  function parseStageText(text) {
    const t = String(text);
    if (/研究生|硕士|研一|研二/.test(t)) return '研究生';
    if (/本科|大学|大[一二三四]/.test(t)) return '本科';
    if (/高中|高[一二三]/.test(t)) return '高中';
    if (/初中|初[一二三]/.test(t)) return '初中';
    if (/小学|[一二三四五六]年级/.test(t)) return '小学';
    if (/幼儿园|小班|中班|大班/.test(t)) return '幼儿园';
    return null;
  }

  function parseGradeText(text, stageKey) {
    const stage = stageMeta(stageKey);
    if (!stage) return null;
    const t = String(text);
    const exact = stage.grades.findIndex(function (g) { return t.indexOf(g) >= 0; });
    if (exact >= 0) return exact + 1;
    const m = t.match(/([一二三四五六七八九十\d]+)\s*(?:年级|级)/);
    if (m) {
      const n = cnToNumber(m[1]);
      if (Number.isFinite(n) && n >= 1 && n <= stage.years) return n;
    }
    const n2 = t.match(/(\d+)/);
    if (n2) {
      const n = parseInt(n2[1], 10);
      if (n >= 1 && n <= stage.years) return n;
    }
    return null;
  }

  function parseChildCountText(text) {
    const t = String(text);
    if (/没有|无|暂无|不要|0\s*(?:个|名|位)?/.test(t)) return 0;
    const m = t.match(/([零〇一二两三四五六七八九十\d]+)\s*(?:个|名|位|孩子)?/);
    if (!m) return null;
    const n = cnToNumber(m[1]);
    if (!Number.isFinite(n)) return null;
    return Math.round(n);
  }

  function parseContributionText(text) {
    const t = String(text);
    const range = t.match(/(\d+)\s*[-–—~至到]\s*(\d+)/);
    if (range) return parseInt(range[1], 10);
    if (/不到|少于|不足|未满/.test(t)) {
      const m = t.match(/(\d+)/);
      return m ? Math.max(0, parseInt(m[1], 10) - 1) : 14;
    }
    if (/(35|三十五)\s*年?\s*以上|超过\s*35/.test(t)) return 35;
    const n = t.match(/(\d+(?:\.\d+)?)/);
    if (n) return parseFloat(n[1]);
    const cn = t.match(/([一二两三四五六七八九十]+)\s*年/);
    if (cn) {
      const v = cnToNumber(cn[1]);
      if (Number.isFinite(v)) return v;
    }
    return null;
  }

  function parseHousingMode(text) {
    const t = String(text);
    if (/全款|一次性|现金|不贷款/.test(t)) return 'cash';
    if (/贷款|按揭|月供|首付/.test(t)) return 'loan';
    return null;
  }

  function parseLoanChoice(text) {
    const t = String(text);
    if (/修改|调整|改一下|自定义|不用默认/.test(t)) return 'modify';
    if (/默认|采用|可以|是|好|同意|不用改/.test(t)) return 'default';
    return null;
  }

  function parsePensionMonthly(text) {
    const amount = extractAmount(text, { defaultUnit: 1, annualizeMonthly: false });
    if (!amount) return failure('我没有识别到养老金金额。可以输入「5000元」或「0.5万」。');
    let monthly = amount.value;
    if (/(每年|年薪|年养老金)/.test(text) && !/(每月|月养老金|\/月)/.test(text)) monthly = monthly / 12;
    if (!Number.isFinite(monthly) || monthly < 0) return failure('养老金金额无效。');
    return success(monthly, fmtYuan(monthly) + ' / 月', 'client');
  }

  /* ------------------------------------------------------------------ */
  /* 初始化与客户画像                                                     */
  /* ------------------------------------------------------------------ */
  function cacheEls() {
    [
      'profileSelect', 'demoBtn', 'resetBtn', 'exitBtn', 'profileCard', 'goalList',
      'progressText', 'progressBar', 'chatMessages', 'chatInput', 'sendBtn',
      'composerHint', 'confirmTopBtn', 'resultStatus', 'insightBody', 'fieldList',
      'editFieldsBtn', 'confirmModal', 'confirmBody', 'confirmErrors', 'confirmCalcBtn',
      'resultsModal', 'resultsTitle', 'resultsSub', 'parameterVersion', 'resultTabs',
      'resultsBody', 'downloadWordBtn', 'printBtn', 'toast', 'errorBanner'
    ].forEach(function (id) { el[id] = document.getElementById(id); });
  }

  function init() {
    cacheEls();
    populateProfileSelect();
    bindEvents();
    resetSession(PROFILES[0], { restore: true });
    const params = new URLSearchParams(window.location.search);
    const profileId = params.get('profile');
    if (profileId) {
      const profile = PROFILES.find(function (p) { return p.id === profileId; });
      if (profile) resetSession(profile, { restore: true });
    }
    if (params.get('demo') === '1') {
      setTimeout(function () { runDemo(params.get('tab') || 'summary'); }, 260);
    }
    window.WealthPlanner = {
      state: state,
      startPlan: startPlan,
      handleText: handleText,
      openConfirm: openConfirm,
      saveConfirm: saveConfirm,
      runDemo: runDemo,
      openResults: openResults,
      runCalculation: runCalculation
    };
    window.addEventListener('error', function (e) {
      showError(e.message || '未知错误');
    });
    window.addEventListener('unhandledrejection', function (e) {
      showError((e.reason && e.reason.message) || '未知异步错误');
    });
  }

  function populateProfileSelect() {
    el.profileSelect.innerHTML = PROFILES.map(function (p) {
      return '<option value="' + p.id + '">' + esc(p.name) + ' · ' + esc(p.city) + '</option>';
    }).join('');
  }

  function defaultFields(profile) {
    const y = CURRENT_YEAR;
    return {
      startYear: y,
      initialFunds: profile.initialAssets,
      extraInitialFunds: 0,
      endYear: y + 20,
      targetEndFunds: 0,
      wageAnnual: 0,
      businessAnnual: 0,
      otherAnnual: 0,
      otherExpenseAnnual: 0,
      dailyAnnual: 0,
      alimonyAnnual: 0,
      purchaseYear: y + 3,
      housePrice: 0,
      housingMode: 'loan',
      downRatio: PARAMS.loanDefaults.downRatio,
      loanYears: PARAMS.loanDefaults.years,
      loanRate: PARAMS.loanDefaults.annualRate,
      ownShare: 1,
      childCount: 0,
      children: [],
      alreadyRetired: profile.occupation === '已退休',
      retirementAge: 60,
      levelRatio: 1,
      contribYears: 20,
      participate: true,
      manualMonthlyPension: 0,
      _extraInitialPending: false,
      _otherPending: false,
      _alimonyPending: false
    };
  }

  function defaultSources(profile) {
    return {
      startYear: 'default',
      initialFunds: 'profile',
      extraInitialFunds: 'default',
      endYear: 'default',
      targetEndFunds: 'default',
      wageAnnual: 'default',
      businessAnnual: 'default',
      otherAnnual: 'default',
      otherExpenseAnnual: 'default',
      dailyAnnual: 'default',
      alimonyAnnual: 'default',
      purchaseYear: 'default',
      housePrice: 'default',
      housingMode: 'default',
      downRatio: 'default',
      loanYears: 'default',
      loanRate: 'default',
      ownShare: 'default',
      childCount: 'default',
      children: 'default',
      alreadyRetired: 'default',
      retirementAge: 'default',
      levelRatio: 'default',
      contribYears: 'default',
      participate: 'default',
      manualMonthlyPension: 'default'
    };
  }

  function resetSession(profile, options) {
    const opts = options || {};
    state.profile = profile;
    state.goals = {
      investment: true,
      housing: true,
      education: true,
      retirement: true
    };
    state.fields = defaultFields(profile);
    state.sources = defaultSources(profile);
    state.queue = [];
    state.activeStep = null;
    state.answered = 0;
    state.started = false;
    state.completed = false;
    state.busy = false;
    state.results = null;
    state.inputs = null;
    state.resultTab = 'summary';
    state.confirmDraft = null;
    state.confirmDraftSources = null;
    state.demoMode = false;
    el.profileSelect.value = profile.id;
    el.chatMessages.innerHTML = '';
    closeModal(el.confirmModal);
    closeModal(el.resultsModal);
    el.resultStatus.classList.add('hidden');
    el.resultStatus.className = 'status-chip hidden';
    renderProfile();
    renderGoals();
    renderProgress();
    renderFieldList();
    renderInsight();
    updateComposer();
    if (opts.restore) {
      const saved = loadSavedSession(profile.id);
      if (saved && applySavedSession(saved, profile)) return;
    }
    addAssistant(welcomeText(), { card: 'goals' });
  }

  function sessionKey(profileId) {
    return 'wealthPlanner.session.' + profileId;
  }
  function saveSession(confirmed) {
    try {
      if (!state.started || !state.completed || state.demoMode) return;
      const payload = {
        version: 1,
        savedAt: new Date().toISOString(),
        goals: state.goals,
        fields: state.fields,
        sources: state.sources,
        answered: state.answered,
        started: state.started,
        completed: state.completed,
        confirmed: !!confirmed
      };
      window.localStorage.setItem(sessionKey(state.profile.id), JSON.stringify(payload));
    } catch (err) { /* localStorage 不可用时静默降级 */ }
  }
  function clearSavedSession(profileId) {
    try { window.localStorage.removeItem(sessionKey(profileId)); } catch (err) { /* ignore */ }
  }
  function loadSavedSession(profileId) {
    try {
      const raw = window.localStorage.getItem(sessionKey(profileId));
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (!saved || saved.version !== 1 || !saved.fields) return null;
      return saved;
    } catch (err) {
      return null;
    }
  }
  function applySavedSession(snapshot, profile) {
    if (!snapshot || !snapshot.fields || !snapshot.started || !snapshot.completed) return false;
    try {
      state.goals = Object.assign({ investment: true, housing: true, education: true, retirement: true }, snapshot.goals || {});
      state.fields = Object.assign(defaultFields(profile), snapshot.fields);
      state.sources = Object.assign(defaultSources(profile), snapshot.sources || {});
      state.started = true;
      state.completed = true;
      state.answered = snapshot.answered || 0;
      state.queue = [];
      state.activeStep = null;
      state.busy = false;
      renderGoals();
      renderProgress();
      renderFieldList();
      updateComposer();
      const when = snapshot.savedAt ? new Date(snapshot.savedAt).toLocaleString('zh-CN') : '上次';
      if (snapshot.confirmed) {
        runCalculation();
        addAssistant('已恢复 ' + profile.name + ' 上次的规划会话（' + when +
          '）。已按保存的输入重新测算，可直接查看结果，或点击「集中确认」重新核对字段。', { card: 'results' });
      } else {
        addAssistant('已恢复 ' + profile.name + ' 上次的规划会话（' + when +
          '），上次停留在集中确认前。请核对输入后点击「集中确认」完成测算。', { card: 'confirm' });
      }
      addSystem('会话恢复自本机浏览器 · 如需重新采集，请点击右上角「重新开始」。');
      return true;
    } catch (err) {
      clearSavedSession(profile.id);
      return false;
    }
  }

  function welcomeText() {
    const p = state.profile;
    const ageNow = p.ageBase + (CURRENT_YEAR - p.baseYear);
    return '您好，我是财富规划助手。已读取 ' + p.name + ' 的客户画像：' + p.gender + '，' +
      ageNow + ' 岁，' + p.city + '（' + p.cityTier + '），已核实初始可投资资产 ' +
      fmtWan(p.initialAssets) + '。\n\n本次先确认规划目标。投资计划是统一年度账本的基础，已默认纳入；其他目标可按需勾选，确认后我会逐项提问。';
  }

  function renderProfile() {
    const p = state.profile;
    const ageNow = p.ageBase + (CURRENT_YEAR - p.baseYear);
    el.profileCard.innerHTML =
      '<div class="profile-main">' +
        '<div class="avatar">' + esc(p.name.charAt(0)) + '</div>' +
        '<div>' +
          '<div class="profile-name">' + esc(p.name) + '<span class="risk-tag">' + esc(p.risk) + '</span></div>' +
          '<div class="profile-meta">' + esc(p.gender) + ' · ' + ageNow + ' 岁 · ' + esc(p.city) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="profile-grid">' +
        '<div class="profile-cell"><div class="k">出生日期</div><div class="v">' + esc(p.birthDate) + '</div></div>' +
        '<div class="profile-cell"><div class="k">职业</div><div class="v">' + esc(p.occupation) + '</div></div>' +
        '<div class="profile-cell"><div class="k">城市档位</div><div class="v">' + esc(p.cityTier) + '</div></div>' +
        '<div class="profile-cell"><div class="k">风险等级</div><div class="v">' + esc(p.risk) + '</div></div>' +
        '<div class="profile-cell wide"><div class="k">初始可投资资产（已核实）</div><div class="v">' + fmtWan(p.initialAssets) + '</div></div>' +
      '</div>' +
      '<div class="profile-note">' + esc(p.note) + '</div>';
  }

  function renderGoals() {
    const profile = state.profile;
    const retiredLock = profile.occupation === '已退休';
    const items = [
      { key: 'investment', locked: true },
      { key: 'housing', locked: false },
      { key: 'education', locked: false },
      { key: 'retirement', locked: retiredLock }
    ];
    el.goalList.innerHTML = items.map(function (item) {
      const meta = GOAL_META[item.key];
      const locked = item.locked || state.started;
      const tag = item.key === 'investment' ? '基础' : (item.key === 'retirement' && retiredLock ? '已退休' : '');
      return '<label class="goal-item ' + (locked ? 'locked ' : '') + '">' +
        '<input type="checkbox" data-goal="' + item.key + '" ' + (locked ? 'data-locked="1" ' : '') +
        (state.goals[item.key] ? 'checked ' : '') + '>' +
        '<span class="goal-name">' + meta.label + '</span>' +
        (tag ? '<span class="goal-tag">' + tag + '</span>' : '') +
        '</label>';
    }).join('');
    $$('#goalList input[type="checkbox"]').forEach(function (input) {
      input.addEventListener('change', function () {
        const key = input.dataset.goal;
        if (input.dataset.locked === '1') {
          input.checked = !!state.goals[key];
          syncGoalCard();
          return;
        }
        if (state.started) return;
        state.goals[key] = input.checked;
        if (key === 'investment') state.goals.investment = true;
        syncGoalCard();
      });
    });
    syncGoalCard();
  }

  function syncGoalCard() {
    $$('#chatGoalCard [data-goal]').forEach(function (btn) {
      const key = btn.dataset.goal;
      btn.classList.toggle('on', !!state.goals[key]);
    });
    const start = $('#chatGoalCard [data-start]');
    if (start) {
      start.disabled = state.started;
      start.textContent = state.started ? '规划已开始' : '开始规划';
    }
    $$('#chatGoalCard [data-goal]').forEach(function (btn) {
      if (state.started) btn.classList.add('locked');
    });
  }

  /* ------------------------------------------------------------------ */
  /* 聊天渲染                                                             */
  /* ------------------------------------------------------------------ */
  function scrollChat() {
    el.chatMessages.scrollTop = el.chatMessages.scrollHeight;
  }

  function addAssistant(text, opts) {
    const o = opts || {};
    const msg = document.createElement('div');
    msg.className = 'msg assistant';
    msg.innerHTML = '<div class="msg-avatar">富</div><div class="msg-body"><div class="msg-bubble"></div></div>';
    const body = $('.msg-body', msg);
    $('.msg-bubble', body).textContent = text;
    if (o.chips && o.chips.length) {
      /* 新问题出现后，旧选项不可再点击，避免把上一题的答案写进当前字段 */
      $$('.chips .chip', el.chatMessages).forEach(function (old) {
        old.disabled = true;
        old.classList.add('disabled');
      });
      const chips = document.createElement('div');
      chips.className = 'chips';
      o.chips.forEach(function (chip) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'chip' + (chip.source === 'default' ? ' default' : '');
        btn.textContent = chip.label;
        btn.addEventListener('click', function () { handleChip(chip, o.step); });
        chips.appendChild(btn);
      });
      body.appendChild(chips);
    }
    if (o.hint) {
      const hint = document.createElement('div');
      hint.className = 'msg-hint';
      hint.textContent = o.hint;
      body.appendChild(hint);
    }
    if (o.card) body.appendChild(buildCard(o.card));
    el.chatMessages.appendChild(msg);
    scrollChat();
  }

  function addUser(text) {
    const msg = document.createElement('div');
    msg.className = 'msg user';
    msg.innerHTML = '<div class="msg-body"><div class="msg-bubble"></div></div>';
    $('.msg-bubble', msg).textContent = text;
    el.chatMessages.appendChild(msg);
    scrollChat();
  }

  function addSystem(text) {
    const msg = document.createElement('div');
    msg.className = 'msg system';
    msg.innerHTML = '<div class="msg-bubble"></div>';
    $('.msg-bubble', msg).textContent = text;
    el.chatMessages.appendChild(msg);
    scrollChat();
  }

  function buildCard(type) {
    if (type === 'goals') return buildGoalCard();
    if (type === 'confirm') {
      const card = document.createElement('div');
      card.className = 'chat-card';
      card.innerHTML = '<div class="chat-card-title">输入已收集完成</div>' +
        '<div class="muted small" style="line-height:1.6">请集中核对客户提供值、画像带入值和系统默认值。确认后进入确定性测算。</div>' +
        '<div class="chat-card-actions"><button class="btn primary" type="button" data-open-confirm>集中确认</button></div>';
      $('[data-open-confirm]', card).addEventListener('click', openConfirm);
      return card;
    }
    if (type === 'results') {
      const r = state.results;
      const s = r.summary;
      const card = document.createElement('div');
      card.className = 'chat-card';
      card.innerHTML = '<div class="chat-card-title">测算结果</div>' +
        '<div class="muted small" style="line-height:1.7">期末资金余额 <b>' + fmtWan(s.endBalance) + '</b><br>' +
        (s.targetGap > 0 ? '期末目标缺口 <b>' + fmtWan(s.targetGap) + '</b>' : '期末目标富余 <b>' + fmtWan(s.targetSurplus) + '</b>') +
        (s.maxShortfall > 0 ? '<br>最大年度资金不足 <b>' + fmtWan(s.maxShortfall) + '</b>' : '') + '</div>' +
        '<div class="chat-card-actions"><button class="btn primary" type="button" data-open-results>查看完整结果</button></div>';
      $('[data-open-results]', card).addEventListener('click', function () { openResults('summary'); });
      return card;
    }
    return document.createElement('div');
  }

  function buildGoalCard() {
    const card = document.createElement('div');
    card.className = 'chat-card';
    card.id = 'chatGoalCard';
    const retiredLock = state.profile.occupation === '已退休';
    const keys = ['investment', 'housing', 'education', 'retirement'];
    card.innerHTML = '<div class="chat-card-title">本次规划目标</div>' +
      '<div class="chat-goals">' + keys.map(function (key) {
        const meta = GOAL_META[key];
        const locked = key === 'investment' || (key === 'retirement' && retiredLock);
        return '<button type="button" class="chat-goal ' + (state.goals[key] ? 'on ' : '') + (locked ? 'locked' : '') + '" data-goal="' + key + '">' +
          '<span class="tick">✓</span><span>' + meta.label + '</span>' +
          '<span class="mini-tag">' + (key === 'investment' ? '基础' : (locked ? '已退休' : '')) + '</span>' +
          '</button>';
      }).join('') + '</div>' +
      '<div class="chat-card-actions"><button class="btn primary" type="button" data-start>开始规划</button></div>';
    $$('[data-goal]', card).forEach(function (btn) {
      btn.addEventListener('click', function () {
        if (state.started) return;
        const key = btn.dataset.goal;
        if (key === 'investment') return;
        if (key === 'retirement' && state.profile.occupation === '已退休') return;
        state.goals[key] = !state.goals[key];
        syncGoalCard();
        renderGoals();
      });
    });
    $('[data-start]', card).addEventListener('click', startPlan);
    return card;
  }

  function updateComposer() {
    if (state.activeStep) {
      el.chatInput.disabled = state.busy;
      el.sendBtn.disabled = state.busy;
      el.chatInput.placeholder = state.activeStep.placeholder || '输入回答，或点击上方选项';
      el.composerHint.textContent = '当前：' + state.activeStep.title +
        (state.activeStep.hint ? ' · ' + state.activeStep.hint : '');
    } else if (!state.started) {
      el.chatInput.disabled = true;
      el.sendBtn.disabled = true;
      el.chatInput.placeholder = '先选择规划目标';
      el.composerHint.textContent = '请在上方选择规划目标，然后点击「开始规划」。';
    } else if (state.completed) {
      el.chatInput.disabled = true;
      el.sendBtn.disabled = true;
      el.chatInput.placeholder = '问答已完成';
      el.composerHint.textContent = '问答已完成 · 请集中确认，或在右侧修改已采集字段。';
    } else {
      el.chatInput.disabled = true;
      el.sendBtn.disabled = true;
      el.chatInput.placeholder = '助手正在整理…';
      el.composerHint.textContent = '助手正在整理下一项问题…';
    }
  }

  function renderProgress() {
    const total = state.answered + state.queue.length + (state.activeStep ? 1 : 0);
    let pct = 0;
    let text = '待开始';
    if (state.started) {
      pct = total > 0 ? (state.answered / total) * 100 : 0;
      if (state.completed) pct = 100;
      text = state.answered ? state.answered + ' / ' + (state.completed ? state.answered : total) : (state.completed ? '已恢复' : '0 / 0');
    }
    el.progressBar.style.width = pct + '%';
    el.progressText.textContent = text;
  }

  /* ------------------------------------------------------------------ */
  /* 问答流程                                                             */
  /* ------------------------------------------------------------------ */
  function makeStep(cfg) {
    return Object.assign({
      group: '投资计划',
      title: cfg.id,
      prompt: '',
      hint: '',
      chips: [],
      path: null,
      placeholder: '输入回答…',
      parse: null,
      apply: null,
      afterApply: null,
      followUp: null
    }, cfg);
  }

  function buildSteps() {
    const steps = [];
    steps.push(stepStartYear());
    steps.push(stepInitialFunds());
    steps.push(stepExtraInitial());
    steps.push(stepEndYear());
    steps.push(stepTargetFunds());
    if (state.profile.occupation !== '已退休') steps.push(stepPrimaryIncome());
    steps.push(stepOtherIncome());
    steps.push(stepDailyExpense());
    steps.push(stepAlimony());
    if (state.goals.housing) {
      steps.push(stepPurchaseYear());
      steps.push(stepHousePrice());
      steps.push(stepPaymentType());
    }
    if (state.goals.education) steps.push(stepChildCount());
    if (state.goals.retirement) {
      if (state.profile.occupation === '已退休') steps.push(stepManualPensionNow());
      else steps.push(stepRetired());
    }
    return steps;
  }

  function startPlan() {
    if (state.started) return;
    clearSavedSession(state.profile.id);
    state.started = true;
    state.goals.investment = true;
    addUser('本次规划目标：' + goalLabels().join('、'));
    renderGoals();
    syncGoalCard();
    state.queue = buildSteps();
    state.busy = true;
    updateComposer();
    renderProgress();
    setTimeout(function () { state.busy = false; nextStep(); }, 450);
  }

  function nextStep() {
    if (!state.queue.length) {
      finishSteps();
      return;
    }
    state.activeStep = state.queue.shift();
    state.busy = false;
    const step = state.activeStep;
    const prompt = typeof step.prompt === 'function'
      ? step.prompt(state.fields, state.profile)
      : step.prompt;
    const chips = typeof step.chips === 'function'
      ? step.chips(state.fields, state.profile)
      : (step.chips || []);
    addAssistant(prompt, { chips: chips, hint: step.hint, step: step });
    updateComposer();
    renderProgress();
    scrollChat();
  }

  function finishSteps() {
    state.activeStep = null;
    state.completed = true;
    state.busy = false;
    updateComposer();
    renderProgress();
    renderFieldList();
    renderGoals();
    addAssistant('信息已收集完成。请在确认页集中核对客户提供值、画像带入值和系统默认值；确认后由确定性程序完成年度测算。', { card: 'confirm' });
    addSystem('本次共采集 ' + state.answered + ' 项输入 · 参数版本 ' + PARAMS.version);
    saveSession(false);
  }

  function handleText(text) {
    if (!state.activeStep || state.busy) return;
    const value = String(text || '').trim();
    if (!value) return;
    const step = state.activeStep;
    addUser(value);
    el.chatInput.value = '';
    let parsed;
    try {
      parsed = step.parse(value, state.fields, state.profile);
    } catch (err) {
      parsed = failure('我处理这条回答时遇到问题，请换一种说法或点击上方选项。');
    }
    if (!parsed || !parsed.ok) {
      const chips = typeof step.chips === 'function' ? step.chips(state.fields, state.profile) : (step.chips || []);
      addAssistant((parsed && parsed.error) || '我还没有理解，请换一种说法，或点击上面的选项。', { chips: chips, hint: step.hint, step: step });
      updateComposer();
      return;
    }
    applyAnswer(step, parsed.value, parsed.display, parsed.source || 'client');
  }

  function handleChip(chip, step) {
    if (!state.activeStep || state.busy) return;
    if (step && step !== state.activeStep) return;
    addUser(chip.label);
    applyAnswer(state.activeStep, chip.value, chip.label, chip.source || 'client');
  }

  function applyAnswer(step, value, display, source) {
    state.activeStep = null;
    state.busy = true;
    try {
      step.apply(value, state.fields, state.profile);
    } catch (err) {
      state.busy = false;
      addAssistant('这条回答没能写入字段，请再试一次。');
      showError(err.message || '字段写入失败');
      updateComposer();
      return;
    }
    const path = typeof step.path === 'function' ? step.path(state.fields) : step.path;
    if (path) state.sources[path] = source;
    state.answered += 1;

    let info = null;
    if (step.afterApply) {
      try { info = step.afterApply(value, state.fields, state.profile); } catch (err) { info = null; }
    }
    if (info) addSystem(info);
    let follow = null;
    if (step.followUp) {
      try { follow = step.followUp(state.fields, state.profile); } catch (err) { follow = null; }
    }
    if (follow && follow.length) state.queue.unshift.apply(state.queue, follow);
    renderFieldList();
    renderProgress();
    updateComposer();
    setTimeout(function () {
      state.busy = false;
      nextStep();
    }, info ? 620 : 400);
  }

  /* ------------------------- 投资计划步骤 ------------------------- */
  function stepStartYear() {
    return makeStep({
      id: 'startYear',
      group: '投资计划',
      title: '规划起始年',
      path: 'startYear',
      prompt: function () {
        const age = ageAtStartFor(state.fields.startYear);
        return '本次规划从哪一年开始？\n客户在起始年约为 ' + age + ' 岁，起始年按完整自然年度计算。';
      },
      hint: '可直接输入年份，或点击选项。',
      placeholder: '如 2026',
      chips: [
        { label: String(CURRENT_YEAR) + ' 年', value: CURRENT_YEAR },
        { label: String(CURRENT_YEAR + 1) + ' 年', value: CURRENT_YEAR + 1 }
      ],
      parse: function (text, fields) {
        const year = parseYearText(text, fields);
        if (year == null) return failure('请告诉我起始年份，例如「2026」。');
        if (year < 2000 || year > 2100) return failure('起始年份应在 2000–2100 年之间。');
        const age = ageAtStartFor(year);
        if (age < 18) return failure('起始年客户还未满 18 岁，请核对年份。');
        return success(year, year + ' 年');
      },
      apply: function (value, fields) { fields.startYear = value; },
      afterApply: function (value, fields) {
        return '规划起始年 ' + fields.startYear + ' 年，客户约 ' + ageAtStartFor(fields.startYear) + ' 岁。';
      }
    });
  }

  function stepInitialFunds() {
    const p = state.profile;
    return makeStep({
      id: 'initialFunds',
      title: '初始资金',
      path: 'initialFunds',
      prompt: function () {
        return '客户画像显示已核实初始可投资资产 ' + fmtWan(p.initialAssets) +
          '。这笔资金是否可作为起始年年初可用资金？可直接确认，或告诉我调整后的金额。';
      },
      hint: '必须是起始年年初口径；未来才到账的资金不能计入。',
      placeholder: '如 120万 / 1,200,000元',
      chips: [
        { label: '使用画像值 ' + fmtWan(p.initialAssets), value: p.initialAssets, source: 'profile' },
        { label: '100 万', value: 1000000 },
        { label: '300 万', value: 3000000 }
      ],
      parse: function (text) {
        const hasNumber = /\d|[零〇一二两三四五六七八九十百]/.test(text);
        const yn = parseYesNo(text);
        if (!hasNumber && yn === true) return success(p.initialAssets, fmtWan(p.initialAssets), 'profile');
        const amount = extractAmount(text, { defaultUnit: 10000 });
        if (!amount) return failure('我没有识别到金额。可以输入「120万」或「1,200,000元」。');
        if (amount.value < 0) return failure('初始资金不能为负数。');
        return success(amount.value, fmtWan(amount.value), 'client');
      },
      apply: function (value, fields) { fields.initialFunds = value; }
    });
  }

  function stepExtraInitial() {
    return makeStep({
      id: 'extraInitial',
      title: '年初一次性追加',
      path: 'extraInitialFunds',
      prompt: '是否还有未包含在上述金额中的年初一次性投入？',
      hint: '未来年份才到账的资金不计入 P0，应在到账年份作为额外流入。',
      chips: [
        { label: '没有', value: 0 },
        { label: '有', value: -1 }
      ],
      parse: function (text) {
        const amount = extractAmount(text, { defaultUnit: 10000 });
        if (amount && amount.value > 0) return success(amount.value, fmtWan(amount.value));
        const yn = parseYesNo(text);
        if (yn === null) return failure('请回答「没有」或「有」；如果有，也可以直接告诉我金额。');
        return success(yn ? -1 : 0, yn ? '有' : '没有');
      },
      apply: function (value, fields) {
        if (value === -1) {
          fields._extraInitialPending = true;
          fields.extraInitialFunds = 0;
        } else {
          fields._extraInitialPending = false;
          fields.extraInitialFunds = value;
        }
      },
      followUp: function (fields) {
        return fields._extraInitialPending ? [stepExtraInitialAmount()] : null;
      },
      afterApply: function (value, fields) {
        if (value === -1) return '请告诉我年初一次性追加的金额。';
        return 'P0 = 年初可用资金 ' + fmtWan(fields.initialFunds) + ' + 追加资金 ' + fmtWan(fields.extraInitialFunds) + '。';
      }
    });
  }

  function stepExtraInitialAmount() {
    return makeStep({
      id: 'extraInitialAmount',
      title: '追加金额',
      path: 'extraInitialFunds',
      prompt: '年初一次性追加资金是多少？',
      placeholder: '如 50万',
      parse: function (text) {
        const amount = extractAmount(text, { defaultUnit: 10000 });
        if (!amount) return failure('请告诉我金额，例如「50万」。');
        if (amount.value <= 0) return failure('追加金额应大于 0。');
        return success(amount.value, fmtWan(amount.value));
      },
      apply: function (value, fields) {
        fields.extraInitialFunds = value;
        fields._extraInitialPending = false;
      }
    });
  }

  function stepEndYear() {
    return makeStep({
      id: 'endYear',
      title: '规划截止年',
      path: 'endYear',
      prompt: '规划到哪一年？起始年和截止年均按完整自然年度计入。',
      hint: '计算年度数 = 截止年 − 起始年 + 1。',
      placeholder: '如 2046',
      chips: function (fields) {
        return [
          { label: (fields.startYear + 10) + ' 年（10 年）', value: fields.startYear + 10 },
          { label: (fields.startYear + 20) + ' 年（20 年）', value: fields.startYear + 20 },
          { label: (fields.startYear + 30) + ' 年（30 年）', value: fields.startYear + 30 }
        ];
      },
      parse: function (text, fields) {
        const year = parseYearText(text, fields);
        if (year == null) return failure('请告诉我截止年份，例如「2046」。');
        if (year < fields.startYear) return failure('截止年不能早于起始年。');
        if (year > 2100) return failure('截止年超出可测算范围。');
        return success(year, year + ' 年');
      },
      apply: function (value, fields) { fields.endYear = value; },
      afterApply: function (value, fields) {
        return '规划期间 ' + fields.startYear + '–' + fields.endYear + ' 年，共 ' +
          (fields.endYear - fields.startYear + 1) + ' 个完整年度。';
      }
    });
  }

  function stepTargetFunds() {
    return makeStep({
      id: 'targetEndFunds',
      title: '期末资金目标',
      path: 'targetEndFunds',
      prompt: '规划期末希望保留多少可用金融资金？这是余额要求，不是一笔支出。',
      hint: '目标值 G 不会再从现金流中扣除一次。',
      placeholder: '如 300万',
      chips: [
        { label: '0 万', value: 0 },
        { label: '50 万', value: 500000 },
        { label: '100 万', value: 1000000 },
        { label: '300 万', value: 3000000 }
      ],
      parse: function (text) {
        const amount = extractAmount(text, { defaultUnit: 10000 });
        if (!amount) return failure('请告诉我期末目标金额，例如「300万」；如果不需要保留，可选 0。');
        if (amount.value < 0) return failure('期末目标不能为负数。');
        return success(amount.value, fmtWan(amount.value));
      },
      apply: function (value, fields) { fields.targetEndFunds = value; }
    });
  }

  function stepPrimaryIncome() {
    const p = state.profile;
    const isEmployee = p.occupation === '公司职员' || p.occupation === '公务员';
    return makeStep({
      id: 'primaryIncome',
      title: isEmployee ? '工资收入' : '经营净收入',
      path: isEmployee ? 'wageAnnual' : 'businessAnnual',
      prompt: isEmployee
        ? '客户本人的税后工资是多少？可以按月或按年告诉我。'
        : (p.occupation === '自由职业者'
          ? '客户一年可供本人支配的净收入是多少？'
          : '客户经营净收入是多少？请填写扣除成本、税费及必要周转资金后的金额。'),
      hint: isEmployee ? '工资按每年 1.5% 增长；税后工资不参与养老金缴费基数计算。' : '净收入按每年 1.5% 增长。',
      placeholder: isEmployee ? '如 月薪2万 / 年30万' : '如 80万/年',
      chips: isEmployee
        ? [
          { label: '月薪 1 万（年 12 万）', value: 120000 },
          { label: '月薪 2 万（年 24 万）', value: 240000 },
          { label: '月薪 3 万（年 36 万）', value: 360000 }
        ]
        : [
          { label: '年净收入 20 万', value: 200000 },
          { label: '年净收入 50 万', value: 500000 },
          { label: '年净收入 100 万', value: 1000000 }
        ],
      parse: function (text) {
        const amount = extractAmount(text, { defaultUnit: 10000 });
        if (!amount) return failure('我没有识别到收入金额。可以说「月薪2万」或「年收入30万」。');
        if (amount.value < 0) return failure('收入不能为负数。');
        return success(amount.value, fmtWan(amount.value) + '/年');
      },
      apply: function (value, fields) {
        if (isEmployee) fields.wageAnnual = value;
        else fields.businessAnnual = value;
      },
      afterApply: function (value, fields) {
        return (isEmployee ? '税后工资 ' : '经营净收入 ') + fmtWan(value) + '/年，按每年 1.5% 增长。';
      }
    });
  }

  function stepOtherIncome() {
    return makeStep({
      id: 'otherIncome',
      title: '其他收入',
      path: 'otherAnnual',
      prompt: '客户是否还有其他的稳定收入？（租金、分红等）',
      hint: '其他确认收入按固定金额计入，不做默认增长。',
      chips: [
        { label: '没有', value: 0 },
        { label: '有', value: -1 }
      ],
      parse: function (text) {
        const amount = extractAmount(text, { defaultUnit: 10000 });
        if (amount && amount.value > 0) return success(amount.value, fmtWan(amount.value));
        const yn = parseYesNo(text);
        if (yn === null) return failure('请回答「没有」或「有」；如果有，也可以直接告诉我金额。');
        return success(yn ? -1 : 0, yn ? '有' : '没有');
      },
      apply: function (value, fields) {
        if (value === -1) {
          fields._otherPending = true;
          fields.otherAnnual = 0;
        } else {
          fields._otherPending = false;
          fields.otherAnnual = value;
        }
      },
      followUp: function (fields) { return fields._otherPending ? [stepOtherIncomeAmount()] : null; }
    });
  }

  function stepOtherIncomeAmount() {
    return makeStep({
      id: 'otherIncomeAmount',
      title: '其他收入金额',
      path: 'otherAnnual',
      prompt: '其他稳定收入每年大约多少？',
      placeholder: '如 10万',
      parse: function (text) {
        const amount = extractAmount(text, { defaultUnit: 10000 });
        if (!amount || amount.value <= 0) return failure('请告诉我金额，例如「10万」。');
        return success(amount.value, fmtWan(amount.value));
      },
      apply: function (value, fields) {
        fields.otherAnnual = value;
        fields._otherPending = false;
      }
    });
  }

  function stepDailyExpense() {
    return makeStep({
      id: 'dailyExpense',
      title: '日常支出',
      path: 'dailyAnnual',
      prompt: '客户每月或每年的日常生活支出是多少？不含医疗、赡养和购房支出。',
      hint: '可按月或按年回答。日常支出按每年 1.5% 增长。',
      placeholder: '如 每月8000 / 每年10万',
      chips: [
        { label: '每月 5,000', value: 60000 },
        { label: '每月 8,000', value: 96000 },
        { label: '每月 1.5 万', value: 180000 }
      ],
      parse: function (text) {
        const amount = extractAmount(text, { defaultUnit: 10000 });
        if (!amount) return failure('我没有识别到支出金额。可以说「每月8000」或「每年10万」。');
        if (amount.value < 0) return failure('支出不能为负数。');
        return success(amount.value, fmtWan(amount.value) + '/年');
      },
      apply: function (value, fields) { fields.dailyAnnual = value; },
      afterApply: function (value, fields) {
        return '日常支出 ' + fmtWan(value) + '/年。医疗支出将由系统按年龄、收入档和城市自动匹配，无需单独填写。';
      }
    });
  }

  function stepAlimony() {
    return makeStep({
      id: 'alimony',
      title: '赡养支出',
      path: 'alimonyAnnual',
      prompt: '客户是否有赡养支出？第一版默认 0，可在集中确认页修改。',
      hint: '赡养支出按每年 1.5% 增长，且不并入日常支出。',
      chips: [
        { label: '没有（明确为 0）', value: 0 },
        { label: '每年 2 万', value: 20000 },
        { label: '每年 5 万', value: 50000 }
      ],
      parse: function (text) {
        const amount = extractAmount(text, { defaultUnit: 10000 });
        if (amount && amount.value >= 0) return success(amount.value, fmtWan(amount.value));
        const yn = parseYesNo(text);
        if (yn === false) return success(0, '没有（0）');
        if (yn === true) return success(-1, '有');
        return failure('请回答「没有」或告诉我金额，例如「每年2万」。');
      },
      apply: function (value, fields) {
        if (value === -1) {
          fields._alimonyPending = true;
          fields.alimonyAnnual = 0;
        } else {
          fields._alimonyPending = false;
          fields.alimonyAnnual = value;
        }
      },
      followUp: function (fields) { return fields._alimonyPending ? [stepAlimonyAmount()] : null; }
    });
  }

  function stepAlimonyAmount() {
    return makeStep({
      id: 'alimonyAmount',
      title: '赡养金额',
      path: 'alimonyAnnual',
      prompt: '每年赡养支出大约多少？',
      placeholder: '如 每年2万',
      parse: function (text) {
        const amount = extractAmount(text, { defaultUnit: 10000 });
        if (!amount || amount.value <= 0) return failure('请告诉我金额，例如「每年2万」。');
        return success(amount.value, fmtWan(amount.value));
      },
      apply: function (value, fields) {
        fields.alimonyAnnual = value;
        fields._alimonyPending = false;
      }
    });
  }

  /* ------------------------- 购房步骤 ------------------------- */
  function stepPurchaseYear() {
    return makeStep({
      id: 'purchaseYear',
      group: '购房',
      title: '购房年份',
      path: 'purchaseYear',
      prompt: '计划哪一年购房？购房年份必须落在规划期内。',
      hint: '购房金额按购房当年口径，不叠加房价增长率。',
      placeholder: '如 2029',
      chips: function (fields) {
        return [3, 5, 10]
          .map(function (n) { return fields.startYear + n; })
          .filter(function (year) { return year <= fields.endYear; })
          .map(function (year) {
            return { label: year + ' 年（' + (year - fields.startYear) + ' 年后）', value: year };
          });
      },
      parse: function (text, fields) {
        const year = parseYearText(text, fields);
        if (year == null) return failure('请告诉我购房年份，例如「2029」或「3年后」。');
        if (year < fields.startYear || year > fields.endYear) {
          return failure('购房年份必须在 ' + fields.startYear + '–' + fields.endYear + ' 年的规划期内。');
        }
        return success(year, year + ' 年');
      },
      apply: function (value, fields) { fields.purchaseYear = value; }
    });
  }

  function stepHousePrice() {
    return makeStep({
      id: 'housePrice',
      group: '购房',
      title: '购房预算',
      path: 'housePrice',
      prompt: '购房当年的房屋总价预算是多少？该金额已按购房当年口径给出，不再叠加房价增长。',
      hint: '第一版只包含房款，不含税费、装修和其他附加费用。',
      placeholder: '如 300万',
      chips: [
        { label: '200 万', value: 2000000 },
        { label: '300 万', value: 3000000 },
        { label: '500 万', value: 5000000 }
      ],
      parse: function (text) {
        const amount = extractAmount(text, { defaultUnit: 10000 });
        if (!amount) return failure('请告诉我房屋总价，例如「300万」。');
        if (amount.value <= 0) return failure('购房总价应大于 0。');
        return success(amount.value, fmtWan(amount.value));
      },
      apply: function (value, fields) { fields.housePrice = value; },
      afterApply: function () {
        return '购房金额仅包含房款，不含税费、装修等附加费用。';
      }
    });
  }

  function stepPaymentType() {
    return makeStep({
      id: 'paymentType',
      group: '购房',
      title: '购房方式',
      path: 'housingMode',
      prompt: '购房方式采用贷款还是全款？',
      hint: '系统默认采用贷款购房，可在确认页修改。',
      chips: [
        { label: '贷款购房（默认）', value: 'loan', source: 'default' },
        { label: '全款购房', value: 'cash' }
      ],
      parse: function (text) {
        const mode = parseHousingMode(text);
        if (!mode) return failure('请回答「贷款」或「全款」。');
        return success(mode, mode === 'loan' ? '贷款购房' : '全款购房', 'client');
      },
      apply: function (value, fields) { fields.housingMode = value; },
      afterApply: function (value, fields) {
        if (value === 'cash') return '已切换为全款，首付比例、贷款期限、还款方式和利率均不参与计算。';
        return '接下来确认贷款默认参数。';
      },
      followUp: function (fields) {
        return fields.housingMode === 'loan' ? [stepLoanConfirm()] : null;
      }
    });
  }

  function stepLoanConfirm() {
    return makeStep({
      id: 'loanConfirm',
      group: '购房',
      title: '贷款参数',
      prompt: '系统默认采用：首付 30%、贷款期限 30 年、等额本息、贷款年利率 3.5%。是否采用这些默认参数？',
      hint: '理财经理可以直接说明客户全款购房，系统不会用默认贷款方案覆盖。',
      chips: [
        { label: '采用默认参数', value: 'default', source: 'default' },
        { label: '修改参数', value: 'modify' }
      ],
      parse: function (text) {
        const choice = parseLoanChoice(text);
        if (!choice) return failure('请回答「采用默认」或「修改参数」。');
        return success(choice, choice === 'default' ? '采用默认参数' : '修改参数', choice === 'default' ? 'default' : 'client');
      },
      apply: function (value, fields) {
        if (value === 'default') {
          fields.downRatio = PARAMS.loanDefaults.downRatio;
          fields.loanYears = PARAMS.loanDefaults.years;
          fields.loanRate = PARAMS.loanDefaults.annualRate;
          fields._loanModify = false;
        } else {
          fields._loanModify = true;
        }
      },
      followUp: function (fields) {
        return fields._loanModify ? [stepDownRatio(), stepLoanYears(), stepLoanRate()] : null;
      },
      afterApply: function (value, fields) {
        if (value === 'modify') return '请依次确认首付比例、贷款期限和年利率。';
        return mortgageSummaryText(fields);
      }
    });
  }

  function stepDownRatio() {
    return makeStep({
      id: 'downRatio',
      group: '购房',
      title: '首付比例',
      path: 'downRatio',
      prompt: '首付比例是多少？',
      placeholder: '如 30%',
      chips: [
        { label: '30%', value: 0.30 },
        { label: '20%', value: 0.20 },
        { label: '40%', value: 0.40 }
      ],
      parse: function (text) {
        const pct = parsePercentText(text);
        if (pct == null) return failure('请告诉我首付比例，例如「30%」。');
        if (pct <= 0 || pct >= 1) return failure('首付比例应在 0%–100% 之间。');
        return success(pct, fmtPct(pct, 0));
      },
      apply: function (value, fields) { fields.downRatio = value; }
    });
  }

  function stepLoanYears() {
    return makeStep({
      id: 'loanYears',
      group: '购房',
      title: '贷款期限',
      path: 'loanYears',
      prompt: '贷款期限是多少年？第一版统一采用等额本息。',
      placeholder: '如 30',
      chips: [
        { label: '30 年', value: 30 },
        { label: '20 年', value: 20 },
        { label: '25 年', value: 25 }
      ],
      parse: function (text) {
        const m = String(text).match(/(\d+(?:\.\d+)?)/);
        if (!m) return failure('请告诉我贷款期限，例如「30年」。');
        const years = parseFloat(m[1]);
        if (years <= 0 || years > 40) return failure('贷款期限应在 1–40 年之间。');
        return success(years, years + ' 年');
      },
      apply: function (value, fields) { fields.loanYears = value; }
    });
  }

  function stepLoanRate() {
    return makeStep({
      id: 'loanRate',
      group: '购房',
      title: '贷款年利率',
      path: 'loanRate',
      prompt: '贷款年利率是多少？',
      placeholder: '如 3.5%',
      chips: [
        { label: '3.5%', value: 0.035 },
        { label: '3.1%', value: 0.031 },
        { label: '4.0%', value: 0.040 }
      ],
      parse: function (text) {
        const rate = parsePercentText(text);
        if (rate == null) return failure('请告诉我年利率，例如「3.5%」。');
        if (rate < 0 || rate > 0.2) return failure('年利率应在 0%–20% 之间。');
        return success(rate, fmtPct(rate, 2));
      },
      apply: function (value, fields) { fields.loanRate = value; },
      afterApply: function (value, fields) { return mortgageSummaryText(fields); }
    });
  }

  function mortgageSummaryText(fields) {
    if (!fields.housePrice || fields.housePrice <= 0) return '请先在确认页补充购房总价。';
    const down = fields.housePrice * fields.downRatio;
    const principal = fields.housePrice - down;
    const loan = Engine.mortgage(principal, fields.loanRate, fields.loanYears);
    const firstYearCost = down + loan.monthly * 12;
    return '按当前参数：首付 ' + fmtWan(down) + '，贷款本金 ' + fmtWan(principal) +
      '，月供约 ' + fmtYuan(loan.monthly) + '，购房当年支出约 ' + fmtWan(firstYearCost) + '。';
  }

  /* ------------------------- 教育步骤 ------------------------- */
  function ensureChildren(count) {
    const fields = state.fields;
    if (!Array.isArray(fields.children)) fields.children = [];
    while (fields.children.length < count) {
      fields.children.push({
        age: null,
        stage: null,
        gradeIndex: null,
        highestStage: null,
        overseas: false,
        overseasStartStage: null,
        route: null
      });
    }
    fields.children.length = count;
    fields.childCount = count;
  }

  function stepChildCount() {
    return makeStep({
      id: 'childCount',
      group: '教育',
      title: '子女数量',
      path: 'childCount',
      prompt: '家庭有几名子女需要规划教育？第一版原型最多支持 3 名。',
      hint: '如果本次不需要规划教育，可选择「暂无子女」。',
      chips: [
        { label: '1 名', value: 1 },
        { label: '2 名', value: 2 },
        { label: '暂无子女', value: 0 }
      ],
      parse: function (text) {
        const count = parseChildCountText(text);
        if (count == null) return failure('请告诉我有几名子女，或选择「暂无子女」。');
        if (count < 0 || count > 3) return failure('第一版原型最多支持 3 名子女。');
        return success(count, count + ' 名');
      },
      apply: function (value, fields) { ensureChildren(value); },
      afterApply: function (value) {
        if (value === 0) return '本次不纳入子女教育支出。';
        return '接下来逐项确认每个孩子的当前年级、最高教育阶段和出国安排。';
      },
      followUp: function (fields) {
        const steps = [];
        for (let i = 0; i < fields.childCount; i++) {
          steps.push(stepChildAge(i), stepChildStage(i), stepChildGrade(i), stepChildHighest(i), stepChildOverseas(i));
        }
        return steps;
      }
    });
  }

  function stepChildAge(index) {
    return makeStep({
      id: 'childAge' + index,
      group: '教育',
      title: '孩子 ' + (index + 1) + ' 年龄',
      path: 'children',
      prompt: '孩子 ' + (index + 1) + ' 在规划起始年（' + state.fields.startYear + ' 年）的年龄是？',
      hint: '当前年级优先于年龄判断教育进度。',
      placeholder: '如 6岁',
      chips: [
        { label: '6 岁', value: 6 },
        { label: '10 岁', value: 10 },
        { label: '14 岁', value: 14 }
      ],
      parse: function (text) {
        const m = String(text).match(/(\d+)/);
        if (!m) return failure('请告诉我孩子的年龄，例如「6岁」。');
        const age = parseInt(m[1], 10);
        if (age < 0 || age > 40) return failure('年龄看起来不合理，请核对。');
        return success(age, age + ' 岁');
      },
      apply: function (value, fields) { fields.children[index].age = value; }
    });
  }

  function stepChildStage(index) {
    return makeStep({
      id: 'childStage' + index,
      group: '教育',
      title: '孩子 ' + (index + 1) + ' 当前阶段',
      path: 'children',
      prompt: '孩子 ' + (index + 1) + ' 当前处于哪个教育阶段？',
      chips: PARAMS.stages.map(function (s) { return { label: s.key, value: s.key }; }),
      parse: function (text) {
        const stage = parseStageText(text);
        if (!stage) return failure('请选择当前教育阶段，例如「小学」。');
        return success(stage, stage);
      },
      apply: function (value, fields) {
        const child = fields.children[index];
        child.stage = value;
        const meta = stageMeta(value);
        if (!child.gradeIndex || child.gradeIndex > meta.years) child.gradeIndex = 1;
      }
    });
  }

  function stepChildGrade(index) {
    return makeStep({
      id: 'childGrade' + index,
      group: '教育',
      title: '孩子 ' + (index + 1) + ' 当前年级',
      path: 'children',
      prompt: function (fields) {
        const child = fields.children[index];
        const meta = stageMeta(child.stage);
        return '孩子 ' + (index + 1) + ' 当前是' + child.stage + '几年级？';
      },
      chips: function (fields) {
        const child = fields.children[index];
        const meta = stageMeta(child.stage);
        if (!meta) return [];
        return meta.grades.map(function (g, i) { return { label: g, value: i + 1 }; });
      },
      parse: function (text, fields) {
        const child = fields.children[index];
        const grade = parseGradeText(text, child.stage);
        if (!grade) return failure('请选择具体年级，例如「三年级」。');
        return success(grade, stageMeta(child.stage).grades[grade - 1]);
      },
      apply: function (value, fields) { fields.children[index].gradeIndex = value; }
    });
  }

  function stepChildHighest(index) {
    return makeStep({
      id: 'childHighest' + index,
      group: '教育',
      title: '孩子 ' + (index + 1) + ' 最高阶段',
      path: 'children',
      prompt: '孩子 ' + (index + 1) + ' 预计读到哪个教育阶段？',
      hint: '最高教育阶段必须不早于当前阶段。',
      chips: function (fields) {
        const child = fields.children[index];
        const startIndex = Math.max(0, PARAMS.stages.findIndex(function (s) { return s.key === child.stage; }));
        return PARAMS.stages.slice(startIndex).map(function (s) { return { label: s.key, value: s.key }; });
      },
      parse: function (text, fields) {
        const child = fields.children[index];
        const stage = parseStageText(text);
        if (!stage) return failure('请选择最高教育阶段，例如「本科」。');
        const currentIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.stage; });
        const targetIndex = PARAMS.stages.findIndex(function (s) { return s.key === stage; });
        if (targetIndex < currentIndex) return failure('最高教育阶段不能低于当前阶段。');
        return success(stage, stage);
      },
      apply: function (value, fields) {
        fields.children[index].highestStage = value;
      }
    });
  }

  function stepChildOverseas(index) {
    return makeStep({
      id: 'childOverseas' + index,
      group: '教育',
      title: '孩子 ' + (index + 1) + ' 出国安排',
      path: 'children',
      prompt: function (fields) {
        const child = fields.children[index];
        const highestIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.highestStage; });
        const highSchoolIndex = PARAMS.stages.findIndex(function (s) { return s.key === '高中'; });
        if (highestIndex < highSchoolIndex) {
          return '孩子 ' + (index + 1) + ' 的最高阶段为' + child.highestStage + '，第一版海外预算只覆盖高中及以上，因此本次按国内路线测算。';
        }
        return '孩子 ' + (index + 1) + ' 是否出国读书？';
      },
      chips: function (fields) {
        const child = fields.children[index];
        const highestIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.highestStage; });
        const highSchoolIndex = PARAMS.stages.findIndex(function (s) { return s.key === '高中'; });
        if (highestIndex < highSchoolIndex) return [{ label: '不出国', value: false }];
        return [
          { label: '不出国', value: false },
          { label: '出国', value: true }
        ];
      },
      parse: function (text, fields) {
        const child = fields.children[index];
        const highestIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.highestStage; });
        const highSchoolIndex = PARAMS.stages.findIndex(function (s) { return s.key === '高中'; });
        if (highestIndex < highSchoolIndex) return success(false, '不出国');
        if (/不出国|国内|不留学/.test(text)) return success(false, '不出国');
        if (/出国|海外|留学/.test(text)) return success(true, '出国');
        const yn = parseYesNo(text);
        if (yn === null) return failure('请回答「不出国」或「出国」。');
        return success(yn, yn ? '出国' : '不出国');
      },
      apply: function (value, fields) {
        const child = fields.children[index];
        child.overseas = value;
        if (!value) {
          child.route = null;
          child.overseasStartStage = null;
        }
      },
      followUp: function (fields) {
        const child = fields.children[index];
        return child.overseas ? [stepChildRoute(index), stepChildOverseasStart(index)] : null;
      },
      afterApply: function (value, fields) {
        if (value) return '请选择海外路线和出国起始阶段。';
        return childSummary(fields.children[index], index);
      }
    });
  }

  function stepChildRoute(index) {
    return makeStep({
      id: 'childRoute' + index,
      group: '教育',
      title: '孩子 ' + (index + 1) + ' 海外路线',
      path: 'children',
      prompt: '孩子 ' + (index + 1) + ' 出国时选择大众路线还是高端路线？',
      chips: [
        { label: '大众路线', value: '大众' },
        { label: '高端路线', value: '高端' }
      ],
      parse: function (text) {
        if (/高端|精英|贵/.test(text)) return success('高端', '高端路线');
        if (/大众|普通|常规/.test(text)) return success('大众', '大众路线');
        return failure('请选择「大众路线」或「高端路线」。');
      },
      apply: function (value, fields) { fields.children[index].route = value; }
    });
  }

  function stepChildOverseasStart(index) {
    return makeStep({
      id: 'childOverseasStart' + index,
      group: '教育',
      title: '孩子 ' + (index + 1) + ' 出国阶段',
      path: 'children',
      prompt: '孩子 ' + (index + 1) + ' 计划从哪个阶段开始出国？第一版默认从该阶段起直到最高阶段均按海外路线测算。',
      chips: function (fields) {
        const child = fields.children[index];
        const currentIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.stage; });
        const highestIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.highestStage; });
        const highSchoolIndex = PARAMS.stages.findIndex(function (s) { return s.key === '高中'; });
        const startIndex = Math.max(currentIndex, highSchoolIndex);
        return PARAMS.stages.slice(startIndex, highestIndex + 1).map(function (s) {
          return { label: s.key, value: s.key };
        });
      },
      parse: function (text, fields) {
        const child = fields.children[index];
        const stage = parseStageText(text);
        if (!stage) return failure('请选择出国起始阶段，例如「高中」。');
        const currentIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.stage; });
        const highestIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.highestStage; });
        const highSchoolIndex = PARAMS.stages.findIndex(function (s) { return s.key === '高中'; });
        const targetIndex = PARAMS.stages.findIndex(function (s) { return s.key === stage; });
        if (targetIndex < highSchoolIndex) return failure('第一版海外预算最早从高中开始。');
        if (targetIndex < currentIndex) return failure('出国阶段不能早于当前阶段。');
        if (targetIndex > highestIndex) return failure('出国阶段不能高于最高教育阶段。');
        return success(stage, stage);
      },
      apply: function (value, fields) {
        const child = fields.children[index];
        child.overseasStartStage = value;
        if (!child.route) child.route = '大众';
      },
      afterApply: function (value, fields) {
        return childSummary(fields.children[index], index);
      }
    });
  }

  function childSummary(child, index) {
    if (!child || !child.stage || !child.highestStage) return '';
    const meta = stageMeta(child.stage);
    const grade = meta && child.gradeIndex ? meta.grades[child.gradeIndex - 1] : '';
    let text = '孩子 ' + (index + 1) + '：' + child.stage + (grade || '') + '起，最高到' + child.highestStage;
    if (child.overseas) {
      text += '，自' + child.overseasStartStage + '起按' + (child.route || '大众') + '海外路线测算。';
    } else {
      text += '，全程国内路线。';
    }
    return text;
  }

  /* ------------------------- 养老步骤 ------------------------- */
  function stepRetired() {
    return makeStep({
      id: 'retired',
      group: '养老',
      title: '退休状态',
      path: 'alreadyRetired',
      prompt: '客户目前是否已经退休？',
      hint: '已退休客户不再估算养老金，直接采集当前实际养老金。',
      chips: [
        { label: '未退休', value: false },
        { label: '已退休', value: true }
      ],
      parse: function (text) {
        if (/已退休|退休了|已经退休/.test(text)) return success(true, '已退休');
        if (/未退休|没退休|在职|还在工作/.test(text)) return success(false, '未退休');
        const yn = parseYesNo(text);
        if (yn === null) return failure('请回答「未退休」或「已退休」。');
        return success(yn, yn ? '已退休' : '未退休');
      },
      apply: function (value, fields) {
        fields.alreadyRetired = value;
        if (value) {
          fields.levelRatio = 1;
          fields.retirementAge = null;
        } else if (!fields.retirementAge) {
          fields.retirementAge = 60;
        }
      },
      followUp: function (fields) {
        if (fields.alreadyRetired) return [stepManualPensionNow()];
        const steps = [stepRetirementAge(), stepLevelRatio(), stepContribYears()];
        if (state.profile.occupation === '自由职业者' || state.profile.occupation === '个体经营者') {
          steps.push(stepParticipate());
        }
        return steps;
      },
      afterApply: function (value) {
        return value
          ? '已退休客户不再估算养老金，请填写当前实际月养老金；日常支出沿用当前水平。'
          : '请继续确认退休年龄、生活水平和累计缴费年限。';
      }
    });
  }

  function stepManualPensionNow() {
    return makeStep({
      id: 'manualPensionNow',
      group: '养老',
      title: '当前养老金',
      path: 'manualMonthlyPension',
      prompt: '客户当前每月实际养老金是多少？',
      hint: '已退休客户按实际值测算，养老金按每年 1.5% 增长。',
      placeholder: '如 5000元/月',
      chips: [
        { label: '3,000 元/月', value: 3000 },
        { label: '5,000 元/月', value: 5000 },
        { label: '8,000 元/月', value: 8000 }
      ],
      parse: parsePensionMonthly,
      apply: function (value, fields) {
        fields.manualMonthlyPension = value;
        fields.alreadyRetired = true;
        fields.retirementAge = null;
        fields.levelRatio = 1;
      },
      afterApply: function (value) {
        return '当前养老金 ' + fmtYuan(value) + '/月；医疗支出将继续单独匹配，不并入退休生活支出。';
      }
    });
  }

  function stepRetirementAge() {
    return makeStep({
      id: 'retirementAge',
      group: '养老',
      title: '计划退休年龄',
      path: 'retirementAge',
      prompt: function () {
        return '计划多少岁退休？退休年龄同时作为工作收入停止年龄和养老金预计开始年龄。客户起始年约 ' +
          ageAtStartFor(state.fields.startYear) + ' 岁。';
      },
      hint: '退休年龄必须大于起始年龄。',
      chips: function () {
        const age = ageAtStartFor(state.fields.startYear);
        return [55, 60, 63, 65].filter(function (a) { return a > age; }).map(function (a) {
          return { label: a + ' 岁', value: a };
        });
      },
      parse: function (text, fields) {
        const m = String(text).match(/(\d+)/);
        if (!m) return failure('请告诉我退休年龄，例如「60岁」。');
        const age = parseInt(m[1], 10);
        const current = ageAtStartFor(fields.startYear);
        if (age <= current) return failure('计划退休年龄必须大于起始年龄 ' + current + ' 岁。如已退休，请选择「已退休」。');
        if (age > 80) return failure('退休年龄超出可测算范围。');
        return success(age, age + ' 岁');
      },
      apply: function (value, fields) { fields.retirementAge = value; },
      afterApply: function (value) {
        return '预计 ' + (state.fields.startYear + Math.max(0, value - ageAtStartFor(state.fields.startYear))) + ' 年退休。';
      }
    });
  }

  function stepLevelRatio() {
    return makeStep({
      id: 'levelRatio',
      group: '养老',
      title: '退休生活水平',
      path: 'levelRatio',
      prompt: '退休后的日常支出预计为当前水平的多少？',
      hint: '选择 80%、100%、120%，或直接输入百分比。',
      chips: [
        { label: '当前的 80%', value: 0.8 },
        { label: '当前的 100%', value: 1.0 },
        { label: '当前的 120%', value: 1.2 }
      ],
      parse: function (text) {
        const pct = parsePercentText(text);
        if (pct == null) return failure('请告诉我比例，例如「100%」。');
        if (pct < 0.3 || pct > 2) return failure('退休生活水平应在 30%–200% 之间。');
        return success(pct, fmtPct(pct, 0));
      },
      apply: function (value, fields) { fields.levelRatio = value; }
    });
  }

  function stepContribYears() {
    return makeStep({
      id: 'contribYears',
      group: '养老',
      title: '累计缴费年限',
      path: 'contribYears',
      prompt: '目前职工基本养老保险累计缴费大约多少年？',
      hint: '使用区间时按区间下限保守测算；也可以填写准确年数。',
      placeholder: '如 20年 / 18.5年',
      chips: [
        { label: '不到 15 年', value: 14 },
        { label: '15–19 年（按下限 15）', value: 15 },
        { label: '20–24 年（按下限 20）', value: 20 },
        { label: '25–29 年（按下限 25）', value: 25 },
        { label: '30–34 年（按下限 30）', value: 30 },
        { label: '35 年以上', value: 35 }
      ],
      parse: function (text) {
        const years = parseContributionText(text);
        if (years == null) return failure('请告诉我累计缴费年限，例如「20年」。');
        if (years < 0 || years > 50) return failure('缴费年限看起来不合理，请核对。');
        return success(years, years + ' 年');
      },
      apply: function (value, fields) { fields.contribYears = value; }
    });
  }

  function stepParticipate() {
    return makeStep({
      id: 'participate',
      group: '养老',
      title: '职工养老保险',
      path: 'participate',
      prompt: '客户是否参加职工基本养老保险？自由职业或灵活就业客户需要确认。',
      hint: '城乡居民养老保险第一版不自动测算；未参保时养老金按手工值测算。',
      chips: [
        { label: '参加职工养老保险', value: true },
        { label: '不参加', value: false }
      ],
      parse: function (text) {
        if (/不参加|未参加|没有参加|居民养老|城乡居民/.test(text)) return success(false, '不参加');
        if (/参加|职工养老|有社保|是/.test(text)) return success(true, '参加');
        const yn = parseYesNo(text);
        if (yn === null) return failure('请回答「参加」或「不参加」。');
        return success(yn, yn ? '参加' : '不参加');
      },
      apply: function (value, fields) { fields.participate = value; },
      afterApply: function (value) {
        return value ? '按职工基本养老金公式估算。' : '已停止自动养老金测算，请填写预计月养老金。';
      },
      followUp: function (fields) {
        return fields.participate ? null : [stepManualPensionExpected()];
      }
    });
  }

  function stepManualPensionExpected() {
    return makeStep({
      id: 'manualPensionExpected',
      group: '养老',
      title: '手工养老金',
      path: 'manualMonthlyPension',
      prompt: '预计退休时每月养老金是多少？该值将作为手工值参与测算。',
      hint: '未参保或缴费年限不足时使用；也可在确认页修改。',
      placeholder: '如 3000元/月',
      chips: [
        { label: '0 元（暂不确定）', value: 0 },
        { label: '3,000 元/月', value: 3000 },
        { label: '5,000 元/月', value: 5000 }
      ],
      parse: parsePensionMonthly,
      apply: function (value, fields) { fields.manualMonthlyPension = value; }
    });
  }

  /* ------------------------------------------------------------------ */
  /* 已采集字段                                                           */
  /* ------------------------------------------------------------------ */
  function renderFieldList() {
    if (!state.started && !state.results) {
      el.fieldList.innerHTML = '<div class="empty-text" style="font-size:11px;color:var(--muted);line-height:1.65">选择目标并开始问答后，字段会实时汇总在这里，并标注来源。</div>';
      return;
    }
    const f = state.fields;
    const p = state.profile;
    let html = '';
    const row = function (label, value, path) {
      return '<div class="field-row"><span class="k">' + esc(label) + '</span>' +
        '<span class="v">' + esc(value) + '</span>' + sourceBadge(state.sources[path]) + '</div>';
    };

    let base = '';
    base += row('规划起始年', f.startYear + ' 年', 'startYear');
    base += row('规划截止年', f.endYear + ' 年', 'endYear');
    base += row('初始可用资金 P0', fmtWan((f.initialFunds || 0) + (f.extraInitialFunds || 0)), 'initialFunds');
    if (f.extraInitialFunds > 0) base += row('其中：年初追加', fmtWan(f.extraInitialFunds), 'extraInitialFunds');
    base += row('期末目标 G', fmtWan(f.targetEndFunds), 'targetEndFunds');
    if (p.occupation !== '已退休') {
      if (p.occupation === '公司职员' || p.occupation === '公务员') {
        base += row('税后工资', fmtWan(f.wageAnnual) + '/年', 'wageAnnual');
      } else {
        base += row('经营净收入', fmtWan(f.businessAnnual) + '/年', 'businessAnnual');
      }
    }
    if (f.otherAnnual > 0) base += row('其他收入', fmtWan(f.otherAnnual) + '/年', 'otherAnnual');
    base += row('日常支出', fmtWan(f.dailyAnnual) + '/年', 'dailyAnnual');
    base += row('赡养支出', fmtWan(f.alimonyAnnual) + '/年', 'alimonyAnnual');
    if (f.otherExpenseAnnual > 0) base += row('其他支出', fmtWan(f.otherExpenseAnnual) + '/年', 'otherExpenseAnnual');
    if (base) html += '<div><div class="field-group-title">投资计划</div>' + base + '</div>';

    if (state.goals.housing) {
      let h = '';
      h += row('购房年份', f.purchaseYear + ' 年', 'purchaseYear');
      h += row('购房总价', fmtWan(f.housePrice), 'housePrice');
      h += row('购房方式', f.housingMode === 'cash' ? '全款' : '贷款', 'housingMode');
      if (f.housingMode === 'loan') {
        h += row('首付比例', fmtPct(f.downRatio, 0), 'downRatio');
        h += row('贷款期限', f.loanYears + ' 年', 'loanYears');
        h += row('贷款年利率', fmtPct(f.loanRate, 2), 'loanRate');
      }
      if (f.ownShare < 1) h += row('本人承担比例', fmtPct(f.ownShare, 0), 'ownShare');
      html += '<div><div class="field-group-title">购房</div>' + h + '</div>';
    }

    if (state.goals.education) {
      let e = row('子女数量', f.childCount + ' 名', 'childCount');
      (f.children || []).forEach(function (child, i) {
        if (child && child.stage) {
          const meta = stageMeta(child.stage);
          const grade = meta && child.gradeIndex ? meta.grades[child.gradeIndex - 1] : '';
          let summary = child.stage + grade + ' → ' + (child.highestStage || '—');
          if (child.overseas) summary += ' · ' + child.overseasStartStage + '起' + (child.route || '大众') + '路线';
          else summary += ' · 国内';
          e += row('孩子 ' + (i + 1), summary, 'children');
        }
      });
      html += '<div><div class="field-group-title">教育</div>' + e + '</div>';
    }

    if (state.goals.retirement) {
      let r = '';
      if (f.alreadyRetired) {
        r += row('退休状态', '已退休', 'alreadyRetired');
        r += row('当前月养老金', fmtYuan(f.manualMonthlyPension) + '/月', 'manualMonthlyPension');
      } else {
        r += row('退休状态', '未退休', 'alreadyRetired');
        r += row('计划退休年龄', (f.retirementAge || '—') + ' 岁', 'retirementAge');
        r += row('退休生活水平', fmtPct(f.levelRatio, 0), 'levelRatio');
        r += row('累计缴费年限', (f.contribYears == null ? '—' : f.contribYears + ' 年'), 'contribYears');
        r += row('职工养老保险', f.participate ? '参加' : '不参加', 'participate');
        if (!f.participate && f.manualMonthlyPension > 0) {
          r += row('手工月养老金', fmtYuan(f.manualMonthlyPension) + '/月', 'manualMonthlyPension');
        }
      }
      html += '<div><div class="field-group-title">养老</div>' + r + '</div>';
    }
    el.fieldList.innerHTML = html;
  }

  /* ------------------------------------------------------------------ */
  /* 集中确认                                                             */
  /* ------------------------------------------------------------------ */
  function openConfirm() {
    if (!state.started) { toast('请先选择规划目标并开始问答。'); return; }
    if (state.busy || state.activeStep) { toast('请先完成当前问题。'); return; }
    if (!state.completed && state.queue.length) { toast('还有问题未完成，请继续回答。'); return; }
    state.confirmDraft = JSON.parse(JSON.stringify(state.fields));
    state.confirmDraftSources = Object.assign({}, state.sources);
    renderConfirm();
    el.confirmErrors.innerHTML = '';
    el.confirmModal.classList.remove('hidden');
  }

  function closeModal(modal) {
    if (modal) modal.classList.add('hidden');
  }

  function sectionHTML(title, hint, body) {
    return '<div class="form-section"><div class="form-section-head"><span>' + esc(title) + '</span><span class="hint">' + esc(hint) + '</span></div>' + body + '</div>';
  }

  function fieldControl(path, label, value, opts) {
    const o = opts || {};
    const kind = o.kind || 'number';
    const source = draftSourceFor(path);
    let display = value;
    if (kind === 'money') display = isNum(value) ? formatInputNum(value / 10000) : '';
    else if (kind === 'percent') display = isNum(value) ? formatInputNum(value * 100) : '';
    else if (value == null) display = '';
    const unit = o.unit ? '<span class="unit">' + esc(o.unit) + '</span>' : '';
    const attrs = [];
    if (o.min != null) attrs.push('min="' + o.min + '"');
    if (o.max != null) attrs.push('max="' + o.max + '"');
    if (o.step != null) attrs.push('step="' + o.step + '"');
    return '<div class="form-field ' + (o.full ? 'full' : '') + '">' +
      '<label>' + esc(label) + ' ' + sourceBadge(source) + '</label>' +
      '<div class="input-wrap"><input type="' + (o.type || 'number') + '" data-path="' + path + '" data-kind="' + kind + '" value="' + esc(display) + '" ' + attrs.join(' ') + ' placeholder="' + esc(o.placeholder || '') + '">' + unit + '</div>' +
      '</div>';
  }

  function selectControl(path, label, value, options, opts) {
    const o = opts || {};
    const source = draftSourceFor(path);
    const current = value == null ? '' : String(value);
    const body = options.map(function (opt) {
      const v = String(opt.value);
      return '<option value="' + esc(v) + '" ' + (v === current ? 'selected' : '') + '>' + esc(opt.label) + '</option>';
    }).join('');
    return '<div class="form-field ' + (o.full ? 'full' : '') + '">' +
      '<label>' + esc(label) + ' ' + sourceBadge(source) + '</label>' +
      '<div class="input-wrap"><select data-path="' + path + '" data-kind="' + (o.kind || 'string') + '">' + body + '</select></div>' +
      '</div>';
  }

  function renderConfirm() {
    const f = state.confirmDraft;
    const p = state.profile;
    const isEmployee = p.occupation === '公司职员' || p.occupation === '公务员';
    let html = '<p class="confirm-note">金额在确认页以「万元」展示，内部计算单位为元。任何修改在保存后会重新测算；系统默认值不代表客户已确认。</p>';

    let base = '<div class="form-grid">' +
      fieldControl('startYear', '规划起始年', f.startYear, { kind: 'integer', unit: '年', min: 2000, max: 2100 }) +
      fieldControl('endYear', '规划截止年', f.endYear, { kind: 'integer', unit: '年', min: 2000, max: 2100 }) +
      fieldControl('initialFunds', '初始可用资金', f.initialFunds, { kind: 'money', unit: '万元', min: 0, step: '0.01' }) +
      fieldControl('extraInitialFunds', '年初一次性追加', f.extraInitialFunds, { kind: 'money', unit: '万元', min: 0, step: '0.01' }) +
      fieldControl('targetEndFunds', '期末目标资金 G', f.targetEndFunds, { kind: 'money', unit: '万元', min: 0, step: '0.01' });
    if (p.occupation !== '已退休') {
      base += isEmployee
        ? fieldControl('wageAnnual', '税后工资', f.wageAnnual, { kind: 'money', unit: '万元/年', min: 0, step: '0.01' })
        : fieldControl('businessAnnual', '经营净收入', f.businessAnnual, { kind: 'money', unit: '万元/年', min: 0, step: '0.01' });
      base += fieldControl('otherAnnual', '其他收入', f.otherAnnual, { kind: 'money', unit: '万元/年', min: 0, step: '0.01' });
    }
    base += fieldControl('dailyAnnual', '日常支出', f.dailyAnnual, { kind: 'money', unit: '万元/年', min: 0, step: '0.01' }) +
      fieldControl('alimonyAnnual', '赡养支出', f.alimonyAnnual, { kind: 'money', unit: '万元/年', min: 0, step: '0.01' }) +
      fieldControl('otherExpenseAnnual', '其他确认支出', f.otherExpenseAnnual, { kind: 'money', unit: '万元/年', min: 0, step: '0.01' }) +
      '</div>';
    html += sectionHTML('投资计划', '统一年度账本 · 基础', base);

    if (state.goals.housing) {
      let h = '<div class="form-grid">' +
        fieldControl('purchaseYear', '购房年份', f.purchaseYear, { kind: 'integer', unit: '年', min: f.startYear, max: f.endYear }) +
        fieldControl('housePrice', '购房总价', f.housePrice, { kind: 'money', unit: '万元', min: 0, step: '0.01' }) +
        selectControl('housingMode', '购房方式', f.housingMode, [
          { value: 'loan', label: '贷款购房' }, { value: 'cash', label: '全款购房' }
        ]);
      if (f.housingMode === 'loan') {
        h += fieldControl('downRatio', '首付比例', f.downRatio, { kind: 'percent', unit: '%', min: 0, max: 95, step: '0.1' }) +
          fieldControl('loanYears', '贷款期限', f.loanYears, { kind: 'number', unit: '年', min: 1, max: 40, step: '1' }) +
          fieldControl('loanRate', '贷款年利率', f.loanRate, { kind: 'percent', unit: '%', min: 0, max: 20, step: '0.01' });
      }
      h += fieldControl('ownShare', '本人承担比例', f.ownShare, { kind: 'percent', unit: '%', min: 1, max: 100, step: '1' }) + '</div>';
      html += sectionHTML('购置房产', '默认贷款 · 等额本息', h);
    }

    if (state.goals.education) {
      let e = '';
      if (!f.children || !f.children.length) {
        e = '<div class="form-grid"><div class="form-field full"><div class="confirm-note" style="margin:0">本次不纳入子女教育支出。</div></div></div>';
      } else {
        f.children.forEach(function (child, i) {
          const currentOptions = [];
          PARAMS.stages.forEach(function (s) {
            s.grades.forEach(function (g, gi) {
              currentOptions.push({ value: s.key + '|' + (gi + 1), label: s.key + ' · ' + g });
            });
          });
          const currentIndex = Math.max(0, PARAMS.stages.findIndex(function (s) { return s.key === child.stage; }));
          const highestOptions = PARAMS.stages.slice(currentIndex).map(function (s) {
            return { value: s.key, label: s.key };
          });
          const overseas = !!child.overseas;
          const highestIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.highestStage; });
          const highSchoolIndex = PARAMS.stages.findIndex(function (s) { return s.key === '高中'; });
          const startIndex = Math.max(currentIndex, highSchoolIndex);
          const startOptions = (highestIndex >= startIndex)
            ? PARAMS.stages.slice(startIndex, highestIndex + 1).map(function (s) { return { value: s.key, label: s.key }; })
            : [];
          e += '<div class="child-card"><div class="child-title">孩子 ' + (i + 1) + '</div><div class="child-grid">' +
            fieldControl('children.' + i + '.age', '起始年年龄', child.age, { kind: 'integer', unit: '岁', min: 0, max: 40 }) +
            selectControl('children.' + i + '.current', '当前阶段 / 年级', child.stage ? child.stage + '|' + child.gradeIndex : '', currentOptions) +
            selectControl('children.' + i + '.highestStage', '最高教育阶段', child.highestStage || '', highestOptions) +
            selectControl('children.' + i + '.overseas', '是否出国', overseas ? 'true' : 'false', [
              { value: 'false', label: '不出国' }, { value: 'true', label: '出国' }
            ], { kind: 'bool' }) +
            (overseas ? selectControl('children.' + i + '.route', '海外路线', child.route || '大众', [
              { value: '大众', label: '大众路线' }, { value: '高端', label: '高端路线' }
            ]) : '') +
            (overseas ? selectControl('children.' + i + '.overseasStartStage', '出国起始阶段', child.overseasStartStage || '', startOptions) : '') +
            '</div></div>';
        });
      }
      html += sectionHTML('子女教育', '当前年级优先 · 海外从高中起', e);
    }

    if (state.goals.retirement) {
      let r = '<div class="form-grid">' +
        selectControl('alreadyRetired', '是否已退休', f.alreadyRetired ? 'true' : 'false', [
          { value: 'false', label: '未退休' }, { value: 'true', label: '已退休' }
        ], { kind: 'bool' });
      if (f.alreadyRetired) {
        r += fieldControl('manualMonthlyPension', '当前月养老金', f.manualMonthlyPension, { kind: 'yuan', unit: '元/月', min: 0, step: '1' });
      } else {
        r += fieldControl('retirementAge', '计划退休年龄', f.retirementAge, { kind: 'number', unit: '岁', min: 18, max: 80, step: '1' }) +
          fieldControl('levelRatio', '退休生活水平', f.levelRatio, { kind: 'percent', unit: '%', min: 30, max: 200, step: '1' }) +
          fieldControl('contribYears', '累计缴费年限', f.contribYears, { kind: 'number', unit: '年', min: 0, max: 50, step: '0.5' }) +
          selectControl('participate', '职工养老保险', f.participate ? 'true' : 'false', [
            { value: 'true', label: '参加' }, { value: 'false', label: '不参加' }
          ], { kind: 'bool' }) +
          fieldControl('manualMonthlyPension', '手工月养老金', f.manualMonthlyPension, { kind: 'yuan', unit: '元/月', min: 0, step: '1' });
      }
      r += '</div>';
      html += sectionHTML('退休养老', '职工养老金公式估算 · 允许手工覆盖', r);
    }

    el.confirmBody.innerHTML = html;
  }

  function markBadge(target) {
    const box = target.closest('.form-field');
    if (!box) return;
    const badge = box.querySelector('.src');
    if (badge) {
      badge.className = 'src src-edited';
      badge.textContent = '经理修改';
    }
  }

  function setDraftValue(path, value, kind) {
    const parts = path.split('.');
    const draft = state.confirmDraft;
    if (parts[0] === 'children') {
      const index = parseInt(parts[1], 10);
      const key = parts[2];
      const child = draft.children[index];
      if (key === 'current') {
        const pieces = String(value).split('|');
        child.stage = pieces[0];
        child.gradeIndex = parseInt(pieces[1], 10) || 1;
        const meta = stageMeta(child.stage);
        if (child.gradeIndex > meta.years) child.gradeIndex = meta.years;
        const currentIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.stage; });
        const highSchoolIndex = PARAMS.stages.findIndex(function (s) { return s.key === '高中'; });
        let highestIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.highestStage; });
        if (highestIndex < currentIndex) {
          child.highestStage = child.stage;
          highestIndex = currentIndex;
        }
        if (child.overseas) {
          const startIndex = Math.max(currentIndex, highSchoolIndex);
          const startValueIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.overseasStartStage; });
          if (startValueIndex < startIndex || startValueIndex > highestIndex) {
            child.overseasStartStage = highestIndex >= startIndex ? PARAMS.stages[startIndex].key : null;
          }
          if (!child.overseasStartStage) {
            child.overseas = false;
            child.route = null;
          }
        }
      } else if (key === 'overseas') {
        child.overseas = value;
        if (!value) {
          child.route = null;
          child.overseasStartStage = null;
        } else {
          if (!child.route) child.route = '大众';
          const currentIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.stage; });
          const highestIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.highestStage; });
          const highSchoolIndex = PARAMS.stages.findIndex(function (s) { return s.key === '高中'; });
          const startIndex = Math.max(currentIndex, highSchoolIndex);
          if (!child.overseasStartStage || PARAMS.stages.findIndex(function (s) { return s.key === child.overseasStartStage; }) < startIndex) {
            child.overseasStartStage = (highestIndex >= startIndex) ? PARAMS.stages[startIndex].key : null;
          }
        }
      } else if (key === 'highestStage') {
        child.highestStage = value;
        const currentIndex = PARAMS.stages.findIndex(function (s) { return s.key === child.stage; });
        const highestIndex = PARAMS.stages.findIndex(function (s) { return s.key === value; });
        if (highestIndex < currentIndex) {
          child.highestStage = child.stage;
        }
        const highSchoolIndex = PARAMS.stages.findIndex(function (s) { return s.key === '高中'; });
        if (highestIndex < highSchoolIndex) {
          child.overseas = false;
          child.route = null;
          child.overseasStartStage = null;
        } else if (child.overseas) {
          const startIndex = Math.max(currentIndex, highSchoolIndex);
          if (PARAMS.stages.findIndex(function (s) { return s.key === child.overseasStartStage; }) > highestIndex) {
            child.overseasStartStage = PARAMS.stages[Math.max(startIndex, highestIndex)].key;
          }
        }
      } else {
        child[key] = value;
      }
      state.confirmDraftSources['children.' + index] = 'edited';
    } else {
      draft[path] = value;
      state.confirmDraftSources[path] = 'edited';
      if (path === 'alreadyRetired') {
        if (value) {
          draft.levelRatio = 1;
          draft.retirementAge = null;
        } else if (!draft.retirementAge) {
          draft.retirementAge = 60;
        }
      }
    }
  }

  function readTarget(target) {
    const path = target.dataset.path;
    if (!path) return;
    const kind = target.dataset.kind;
    const raw = target.value;
    let value;
    if (kind === 'money') value = raw === '' ? null : parseFloat(raw) * 10000;
    else if (kind === 'percent') value = raw === '' ? null : parseFloat(raw) / 100;
    else if (kind === 'integer') value = raw === '' ? null : parseInt(raw, 10);
    else if (kind === 'number' || kind === 'yuan') value = raw === '' ? null : parseFloat(raw);
    else if (kind === 'bool') value = raw === 'true';
    else value = raw;
    setDraftValue(path, value, kind);
    markBadge(target);
    const pathParts = path.split('.');
    const structural = path === 'housingMode' || path === 'alreadyRetired' ||
      (pathParts[0] === 'children' && (pathParts[2] === 'current' || pathParts[2] === 'highestStage' || pathParts[2] === 'overseas'));
    if (structural) renderConfirm();
  }

  function validateConfirm() {
    const draft = state.confirmDraft;
    const inputs = buildInputsFrom(draft);
    const errors = Engine.validate(inputs, PARAMS);
    if (state.goals.housing && (!draft.housePrice || draft.housePrice <= 0)) {
      errors.push({ message: '购房总价必须大于 0。' });
    }
    if (state.goals.education && draft.children && draft.children.length) {
      draft.children.forEach(function (child, i) {
        if (!child.stage || !child.gradeIndex || !child.highestStage) {
          errors.push({ message: '孩子 ' + (i + 1) + ' 的教育阶段信息不完整。' });
        }
      });
    }
    if (state.goals.retirement) {
      if (!draft.alreadyRetired && (draft.retirementAge == null || draft.contribYears == null)) {
        errors.push({ message: '请填写计划退休年龄和累计缴费年限。' });
      }
      if (draft.alreadyRetired && draft.manualMonthlyPension == null) {
        errors.push({ message: '请填写当前月养老金。' });
      }
    }
    const seen = {};
    const unique = errors.filter(function (e) {
      if (seen[e.message]) return false;
      seen[e.message] = true;
      return true;
    });
    if (unique.length) {
      el.confirmErrors.innerHTML = '<ul>' + unique.map(function (e) {
        return '<li>' + esc(e.message) + '</li>';
      }).join('') + '</ul>';
      return false;
    }
    el.confirmErrors.innerHTML = '';
    return true;
  }

  function buildInputsFrom(fields) {
    const p = state.profile;
    const ageAtStart = p.ageBase + (fields.startYear - p.baseYear);
    return {
      startYear: fields.startYear,
      endYear: fields.endYear,
      ageAtStart: ageAtStart,
      cityTier: p.cityTier,
      occupation: p.occupation,
      initialFunds: fields.initialFunds,
      extraInitialFunds: fields.extraInitialFunds || 0,
      targetEndFunds: fields.targetEndFunds || 0,
      wageAnnual: fields.wageAnnual || 0,
      businessAnnual: fields.businessAnnual || 0,
      otherAnnual: fields.otherAnnual || 0,
      otherExpenseAnnual: fields.otherExpenseAnnual || 0,
      dailyAnnual: fields.dailyAnnual || 0,
      alimonyAnnual: fields.alimonyAnnual || 0,
      goals: Object.assign({}, state.goals),
      housing: {
        enabled: state.goals.housing,
        purchaseYear: fields.purchaseYear,
        totalPrice: fields.housePrice,
        mode: fields.housingMode,
        downRatio: fields.downRatio,
        years: fields.loanYears,
        annualRate: fields.loanRate,
        ownShare: fields.ownShare
      },
      education: {
        enabled: state.goals.education,
        children: (fields.children || []).map(function (c) {
          return {
            age: c.age,
            stage: c.stage,
            gradeIndex: c.gradeIndex,
            highestStage: c.highestStage,
            overseas: !!c.overseas,
            overseasStartStage: c.overseasStartStage,
            route: c.route
          };
        })
      },
      retirement: {
        enabled: state.goals.retirement,
        alreadyRetired: !!fields.alreadyRetired,
        retirementAge: fields.retirementAge,
        levelRatio: fields.levelRatio,
        contribYears: fields.contribYears,
        participate: !!fields.participate,
        manualMonthlyPension: fields.manualMonthlyPension || 0
      }
    };
  }

  function saveConfirm() {
    if (!validateConfirm()) {
      toast('请先修正确认页中的错误。');
      return;
    }
    state.fields = state.confirmDraft;
    state.sources = state.confirmDraftSources;
    closeModal(el.confirmModal);
    const result = runCalculation();
    saveSession(true);
    const s = result.summary;
    let text = '已按集中确认的输入完成测算。';
    if (result.valid) {
      text += '期末资金余额 ' + fmtWan(s.endBalance) + '，';
      text += s.targetGap > 0 ? '与期末目标相比存在缺口 ' + fmtWan(s.targetGap) + '。' : '高于期末目标 ' + fmtWan(s.targetSurplus) + '。';
      if (s.maxShortfall > 0.01) text += '规划期最大年度资金不足 ' + fmtWan(s.maxShortfall) + '。';
    } else {
      text += '当前存在待配置或待确认项，结果暂不作为正式结论。';
    }
    addAssistant(text, { card: 'results' });
    setTimeout(function () { openResults('summary'); }, 280);
  }

  /* ------------------------------------------------------------------ */
  /* 测算与结果                                                           */
  /* ------------------------------------------------------------------ */
  function runCalculation() {
    const inputs = buildInputsFrom(state.fields);
    const result = Engine.calculate(inputs, PARAMS);
    state.inputs = inputs;
    state.results = result;
    renderInsight();
    renderFieldList();
    if (!result.valid) toast('测算完成，但存在待配置/待确认项。');
    return result;
  }

  function statusMeta(s) {
    if (s.status === 'shortfall') {
      return {
        cls: 'shortfall', chip: '存在资金不足',
        title: '规划期出现资金不足',
        desc: s.firstShortfallYear
          ? s.firstShortfallYear + ' 年首次出现资金不足，最大年度资金不足 ' + fmtWan(s.maxShortfall) + '；需追加初始资金约 ' + fmtWan(s.additionalInitialNeeded) + '。'
          : '规划期存在年度资金不足。',
        big: fmtWan(s.maxShortfall), bigCap: '最大年度资金不足'
      };
    }
    if (s.status === 'gap') {
      return {
        cls: 'gap', chip: '期末有缺口',
        title: '期末目标存在缺口',
        desc: '规划期未出现年度资金不足，但期末余额 ' + fmtWan(s.endBalance) + ' 低于目标 ' + fmtWan(s.target) + '，缺口 ' + fmtWan(s.targetGap) + '。',
        big: fmtWan(s.targetGap), bigCap: '期末目标缺口'
      };
    }
    if (s.status === 'pending') {
      return {
        cls: 'pending', chip: '待配置',
        title: '存在待配置参数',
        desc: '当前结果包含未匹配的医疗/教育参数或未确认的养老金结论，暂不作为正式结论。',
        big: '待配置', bigCap: '请补充参数'
      };
    }
    return {
      cls: 'ok', chip: '规划达标',
      title: '规划目标可达成',
      desc: '规划期未出现资金不足，期末资金余额 ' + fmtWan(s.endBalance) + '，高于期末目标 ' + fmtWan(s.targetSurplus) + '。',
      big: fmtWan(s.endBalance), bigCap: '期末资金余额'
    };
  }

  function renderInsight() {
    const result = state.results;
    if (!result) {
      el.resultStatus.className = 'status-chip hidden';
      el.resultStatus.textContent = '';
      el.insightBody.innerHTML =
        '<div class="empty-state">' +
          '<div class="empty-graphic"></div>' +
          '<div class="empty-title">还没有测算结果</div>' +
          '<div class="empty-text">完成问答并集中确认后，这里会显示<br>期末余额、资金缺口与需追加的初始资金。</div>' +
        '</div>';
      return;
    }
    const s = result.summary;
    const meta = statusMeta(s);
    el.resultStatus.className = 'status-chip ' + meta.cls;
    el.resultStatus.textContent = meta.chip;
    el.resultStatus.classList.remove('hidden');
    const neg = function (v) { return v < 0 ? ' neg' : ''; };
    el.insightBody.innerHTML =
      '<div class="result-hero ' + meta.cls + '">' +
        '<div class="kicker">' + meta.bigCap + '</div>' +
        '<div class="value">' + meta.big + '</div>' +
        '<div class="desc">' + esc(meta.desc) + '</div>' +
      '</div>' +
      '<div class="metric-grid">' +
        '<div class="metric"><div class="k">初始资金 P0</div><div class="v">' + fmtWan(s.p0) + '</div></div>' +
        '<div class="metric"><div class="k">累计净结余</div><div class="v' + neg(s.cumulativeNet) + '">' + fmtWan(s.cumulativeNet) + '</div></div>' +
        '<div class="metric"><div class="k">期末余额</div><div class="v' + neg(s.endBalance) + '">' + fmtWan(s.endBalance) + '</div></div>' +
        '<div class="metric"><div class="k">期末目标</div><div class="v">' + fmtWan(s.target) + '</div></div>' +
        '<div class="metric"><div class="k">首次资金不足</div><div class="v">' + (s.firstShortfallYear || '无') + '</div></div>' +
        '<div class="metric"><div class="k">需追加初始资金</div><div class="v' + (s.additionalInitialNeeded > 0 ? ' neg' : '') + '">' + fmtWan(s.additionalInitialNeeded) + '</div></div>' +
      '</div>' +
      '<div class="insight-actions">' +
        '<button class="btn primary" type="button" id="openResultsBtn">查看完整结果</button>' +
        '<button class="btn secondary" type="button" id="openProposalBtn" ' + (result.valid ? '' : 'disabled') + '>查看建议书</button>' +
      '</div>' +
      '<div class="insight-note">参数版本 ' + esc(result.meta.parameterVersion) + ' · 不含投资收益 · 金额按元计算、页面按万元展示。</div>';
    const openBtn = $('#openResultsBtn');
    if (openBtn) openBtn.addEventListener('click', function () { openResults('summary'); });
    const proposalBtn = $('#openProposalBtn');
    if (proposalBtn && result.valid) proposalBtn.addEventListener('click', function () { openResults('proposal'); });
  }

  function openResults(tab) {
    if (!state.results) { toast('还没有可查看的测算结果。'); return; }
    const allowed = ['summary', 'years', 'housing', 'education', 'retirement', 'proposal'];
    state.resultTab = allowed.indexOf(tab) >= 0 ? tab : 'summary';
    renderResults();
    el.resultsModal.classList.remove('hidden');
    el.resultsBody.scrollTop = 0;
  }

  function renderResults() {
    const r = state.results;
    const p = state.profile;
    const s = r.summary;
    el.resultsTitle.textContent = p.name + ' · 财富规划';
    el.resultsSub.textContent = r.meta.startYear + '–' + r.meta.endYear + ' 年 · ' +
      goalLabels().join('、') + ' · ' + p.city + ' · 参数版本 ' + r.meta.parameterVersion;
    el.parameterVersion.textContent = r.meta.parameterVersion;
    el.downloadWordBtn.disabled = !r.valid;
    el.printBtn.disabled = !r.valid;
    $$('#resultTabs button').forEach(function (btn) {
      btn.classList.toggle('active', btn.dataset.tab === state.resultTab);
    });
    renderResultsBody();
  }

  function renderResultsBody() {
    const tab = state.resultTab;
    if (tab === 'summary') el.resultsBody.innerHTML = summaryTabHTML();
    else if (tab === 'years') el.resultsBody.innerHTML = yearsTabHTML();
    else if (tab === 'housing') el.resultsBody.innerHTML = housingTabHTML();
    else if (tab === 'education') el.resultsBody.innerHTML = educationTabHTML();
    else if (tab === 'retirement') el.resultsBody.innerHTML = retirementTabHTML();
    else if (tab === 'proposal') el.resultsBody.innerHTML = proposalTabHTML();
  }

  function detailCell(label, value, cls) {
    return '<div class="detail-cell"><div class="k">' + esc(label) + '</div><div class="v ' + (cls || '') + '">' + value + '</div></div>';
  }

  function calloutList(title, items, cls) {
    if (!items || !items.length) return '';
    return '<div class="callout ' + cls + '"><b>' + esc(title) + '</b><ul>' +
      items.map(function (item) { return '<li>' + (typeof item === 'string' ? esc(item) : esc(item.message || String(item))) + '</li>'; }).join('') +
      '</ul></div>';
  }

  function summaryTabHTML() {
    const r = state.results;
    const s = r.summary;
    const meta = statusMeta(s);
    const gapLabel = s.targetGap > 0 ? '期末目标缺口' : '期末目标富余';
    const gapValue = s.targetGap > 0 ? s.targetGap : s.targetSurplus;
    const errors = r.errors || [];
    const warnings = r.warnings || [];
    return '<div class="result-summary-hero ' + meta.cls + '">' +
        '<div><div class="kicker">规划结论</div><h3>' + esc(meta.title) + '</h3><p>' + esc(meta.desc) + '</p></div>' +
        '<div class="hero-figure"><div class="num">' + meta.big + '</div><div class="cap">' + meta.bigCap + '</div></div>' +
      '</div>' +
      '<div class="result-section">' +
        '<h3>关键指标</h3><div class="sub">金额单位为万元；累计净结余不含初始资金，期末余额 = P0 + 累计净结余。</div>' +
        '<div class="grid-4">' +
          detailCell('初始可用资金 P0', fmtWan(s.p0)) +
          detailCell('规划期累计净结余', fmtWan(s.cumulativeNet), s.cumulativeNet < 0 ? 'neg' : '') +
          detailCell('期末资金余额 B(Y1)', fmtWan(s.endBalance), s.endBalance < 0 ? 'neg' : '') +
          detailCell('期末目标资金 G', fmtWan(s.target)) +
          detailCell(gapLabel, fmtWan(gapValue), s.targetGap > 0 ? 'neg' : 'pos') +
          detailCell('首次资金不足年份', s.firstShortfallYear || '无') +
          detailCell('最大年度资金不足', fmtWan(s.maxShortfall), s.maxShortfall > 0 ? 'neg' : '') +
          detailCell('需追加的初始资金', fmtWan(s.additionalInitialNeeded), s.additionalInitialNeeded > 0 ? 'neg' : 'pos') +
        '</div>' +
        (errors.length ? calloutList('待配置 / 待确认', errors, 'danger') : '') +
        (warnings.length ? calloutList('测算提示', warnings, 'warn') : '') +
        (!errors.length && !warnings.length ? '<div class="callout ok">校验通过：年份、金额、本人承担口径、重复计入和参数匹配均未发现异常。</div>' : '') +
      '</div>' +
      '<div class="result-section">' +
        '<h3>测算假设</h3><div class="sub">第一版不计算投资收益、复利、折现或资产配置收益；不采集保险费用。</div>' +
        '<ul style="margin:0;padding-left:18px;font-size:11.5px;line-height:1.75;color:var(--ink-2)">' +
          '<li>时间口径：完整自然年度，起始年和截止年均计入。</li>' +
          '<li>增长假设：工资、经营净收入、日常支出、赡养支出和养老金按每年 1.5% 增长；医疗支出按年龄、收入档和城市匹配固定预算，不叠加增长率。</li>' +
          '<li>资金口径：初始资金为起始年年初口径；未来到账资金不计入 P0。</li>' +
          '<li>参数版本：' + esc(r.meta.parameterVersion) + '。医疗、社平工资、最低缴费年限等为演示参数，正式上线需后台版本化管理。</li>' +
        '</ul>' +
      '</div>';
  }

  function yearsTabHTML() {
    const r = state.results;
    const cols = [
      ['year', '年份'], ['age', '年龄'], ['startBalance', '年初资金'],
      ['incomeTotal', '收入合计'], ['expenseTotal', '支出合计'], ['net', '当年净结余'], ['cumNet', '累计净结余'], ['endBalance', '年末余额'],
      ['wage', '工资'], ['business', '经营'], ['pension', '养老金'], ['otherIncome', '其他收入'],
      ['daily', '日常'], ['alimony', '赡养'], ['medical', '医疗'], ['housing', '购房'], ['education', '教育'], ['otherExpense', '其他支出']
    ];
    const moneyCols = cols.slice(2).map(function (c) { return c[0]; });
    return '<div class="result-section">' +
      '<h3>逐年现金流</h3><div class="sub">单位：万元。前八列为关键结果（年初资金、收入、支出、净结余、累计结余、年末余额），向右滚动查看收入/支出明细。年初资金 = 上年末余额，起始年年初资金 = P0；负值以红色标识，年度资金不足所在行浅红底。</div>' +
      '<div class="table-wrap"><table class="year-table"><thead><tr>' +
      cols.map(function (c) { return '<th>' + c[1] + '</th>'; }).join('') +
      '</tr></thead><tbody>' +
      r.years.map(function (row) {
        const shortfall = row.endBalance < -0.01;
        return '<tr class="' + (shortfall ? 'shortfall' : '') + '">' +
          '<td><b>' + row.year + '</b></td><td>' + row.age + '</td>' +
          cols.slice(2).map(function (c) {
            const key = c[0];
            if (key === 'medical' && row.medicalPending) return '<td class="neg">待配置</td>';
            const v = row[key];
            const cls = (key === 'startBalance' || key === 'net' || key === 'cumNet' || key === 'endBalance') && v < -0.01
              ? ' class="neg"' : '';
            return '<td' + cls + '>' + wan(v, 1) + '</td>';
          }).join('') +
        '</tr>';
      }).join('') +
      '</tbody></table></div>' +
      '<div class="callout info">当年净结余为负不等于资金不足；只有叠加初始资金和此前结余后，年末余额仍为负，才记为该年资金不足。</div>' +
      '</div>';
  }

  function housingTabHTML() {
    const r = state.results;
    const h = r.housing;
    if (!r.meta || !h.enabled) {
      return '<div class="empty-tab"><strong>本次未纳入购房规划</strong>如需测算，请在开始前勾选「购置房产」，或在确认页补充。</div>';
    }
    const rows = r.years.filter(function (y) { return Math.abs(y.housing) > 0.01; });
    let detail = '';
    if (h.mode === 'cash') {
      detail = '<div class="grid-4">' +
        detailCell('购房年份', h.purchaseYear + ' 年') +
        detailCell('房屋总价', fmtWan(h.price)) +
        detailCell('购房方式', '全款') +
        detailCell('购房当年支出', fmtWan(h.purchaseYearCost), 'neg') +
        '</div>' +
        '<div class="callout info">全款购房时，首付比例、贷款期限、还款方式和利率均不参与计算；购房当年只计房款。</div>';
    } else {
      detail = '<div class="grid-4">' +
        detailCell('购房年份', h.purchaseYear + ' 年') +
        detailCell('房屋总价', fmtWan(h.price)) +
        detailCell('首付金额', fmtWan(h.downPayment)) +
        detailCell('贷款本金', fmtWan(h.principal)) +
        detailCell('月供（等额本息）', fmtYuan(h.monthly)) +
        detailCell('年度还款（12 期）', fmtWan(h.annualPayment)) +
        detailCell('购房当年支出', fmtWan(h.purchaseYearCost), 'neg') +
        detailCell('期末剩余贷款本金', fmtWan(h.remainingLoan), h.remainingLoan > 0 ? 'neg' : '') +
        '</div>' +
        '<div class="grid-3" style="margin-top:10px">' +
        detailCell('贷款期限', h.totalPeriods + ' 期（' + (h.totalPeriods / 12).toFixed(h.totalPeriods % 12 ? 1 : 0) + ' 年）') +
        detailCell('利息合计（估算）', fmtWan(h.totalInterest)) +
        detailCell('还清年份', h.paidOffYear ? h.paidOffYear + ' 年' : '规划期末未还清') +
        '</div>' +
        (h.ownShare < 1 ? '<div class="callout warn">按本人承担比例 ' + fmtPct(h.ownShare, 0) + ' 计入首付与还款；总价、贷款本金和剩余贷款均仅展示本人份额。</div>' : '') +
        (h.remainingLoan > 0.01 ? '<div class="callout warn">规划截止时贷款尚未还清，剩余本金 ' + fmtWan(h.remainingLoan) + ' 单独展示，未在截止年一次性扣除。</div>' : '') +
        '<div class="callout info">首付和月供已覆盖购房现金支出，未重复扣除全部房价或贷款本金；贷款到账属于融资，不计为工资或经营收入。</div>';
    }
    return '<div class="result-section"><h3>购房结果</h3><div class="sub">第一版只含房款，不含税费、装修和其他附加费用；不询问购房月份，统一按购房当年支付首付并偿还 12 期。</div>' + detail + '</div>' +
      '<div class="result-section"><h3>购房现金流</h3><div class="sub">仅列出发生购房支出的年份，单位：万元。</div>' +
      '<div class="table-wrap"><table class="mini-table"><thead><tr><th>年份</th><th>年龄</th><th>购房支出</th><th>年末资金余额</th></tr></thead><tbody>' +
      rows.map(function (row) {
        return '<tr><td>' + row.year + '</td><td>' + row.age + '</td><td>' + wan(row.housing, 1) + '</td><td class="' + (row.endBalance < 0 ? 'neg' : '') + '">' + wan(row.endBalance, 1) + '</td></tr>';
      }).join('') +
      '</tbody></table></div></div>';
  }

  function educationTabHTML() {
    const r = state.results;
    const e = r.education;
    if (!e.enabled || !e.children.length) {
      return '<div class="empty-tab"><strong>本次未纳入子女教育</strong>如需测算，请在开始前勾选「子女教育」，或在确认页补充子女信息。</div>';
    }
    let html = '';
    e.children.forEach(function (child) {
      const meta = stageMeta(child.stage);
      const grade = meta ? meta.grades[child.gradeIndex - 1] : '';
      const routeText = child.overseas ? (child.overseasStartStage + '起 · ' + child.route + '路线') : '国内路线';
      html += '<div class="result-section">' +
        '<h3>孩子 ' + (child.index + 1) + ' · ' + child.stage + grade + ' → ' + child.highestStage + '</h3>' +
        '<div class="sub">' + routeText + ' · 规划期内教育支出合计 ' + fmtWan(child.total) + '</div>' +
        '<div class="table-wrap"><table class="mini-table"><thead><tr><th>年份</th><th>年龄</th><th>阶段</th><th>年级</th><th>路线</th><th>年度预算（万元）</th></tr></thead><tbody>' +
        child.schedule.map(function (row) {
          return '<tr><td>' + row.year + '</td><td>' + row.age + '</td><td>' + row.stage + '</td><td>' + row.gradeLabel + '</td><td>' +
            (row.overseas ? (row.route + '海外') : '国内') + '</td><td>' + wan(row.cost, 1) + '</td></tr>';
        }).join('') +
        '</tbody></table></div>' +
        (child.missingBudget ? '<div class="callout danger">存在未配置的教育预算，当前以 0 展示，需补充参数后才能生成正式结论。</div>' : '') +
        (child.warnings.length ? calloutList('教育提示', child.warnings, 'warn') : '') +
        '</div>';
    });
    html += '<div class="result-section"><h3>教育口径</h3>' +
      '<div class="callout info">同一孩子同一年只使用一条国内或海外预算，不重复计算；国内与海外预算均按每年 1.5% 增长。教育综合预算已包含学费、书本、培训和基本教育相关支出，不重复并入家庭日常支出。</div></div>';
    return html;
  }

  function retirementTabHTML() {
    const r = state.results;
    const p = r.pension;
    if (!p || p.error) {
      return '<div class="empty-tab"><strong>本次未生成养老测算</strong>' +
        (p && p.message ? esc(p.message) : '如需测算，请在开始前勾选「退休养老」。') + '</div>';
    }
    if (p.mode === 'alreadyRetired') {
      return '<div class="result-section"><h3>已退休 · 当前养老金口径</h3>' +
        '<div class="sub">已退休客户不估算养老金，直接采用当前实际月养老金，并按每年 1.5% 增长。</div>' +
        '<div class="grid-4">' +
        detailCell('当前月养老金', fmtYuan(p.monthlyPension) + '/月') +
        detailCell('起始年养老金收入', fmtWan(p.monthlyPension * 12)) +
        detailCell('医疗支出', '按年龄 / 收入档 / 城市单独匹配') +
        detailCell('退休生活水平', '沿用当前日常支出') +
        '</div>' +
        '<div class="callout info">已退休客户不再使用职工养老金公式；日常支出沿用当前水平，医疗支出继续单独匹配，不并入退休生活支出。</div>' +
        '</div>';
    }
    const yearsToRetire = p.yearsToRetire;
    const eligibleText = p.eligible ? '满足（' + p.totalContribYears.toFixed(1) + ' 年 ≥ ' + p.minContribYears.toFixed(1) + ' 年）' : '不满足';
    const sourceText = p.source === 'formula' ? '职工养老金公式' : '理财经理手工值';
    const retirementRow = r.years.find(function (y) { return y.year === p.retirementYear; });
    return '<div class="result-section"><h3>退休测算结果</h3>' +
      '<div class="sub">退休年龄同时作为工作收入停止年龄和养老金预计开始年龄。当前结论来源：' + sourceText + '。</div>' +
      '<div class="grid-4">' +
      detailCell('退休年份', p.retirementYear + ' 年') +
      detailCell('退休年龄', p.retirementAge + ' 岁') +
      detailCell('距离退休', yearsToRetire + ' 年') +
      detailCell('退休生活水平', fmtPct(p.levelRatio || 1, 0)) +
      detailCell('退休时累计缴费', p.totalContribYears.toFixed(1) + ' 年') +
      detailCell('最低缴费年限', p.minContribYears.toFixed(1) + ' 年') +
      detailCell('资格校验', eligibleText, p.eligible ? 'pos' : 'neg') +
      detailCell('退休首年月养老金', fmtYuan(p.monthlyPension) + '/月', p.eligible ? '' : 'neg') +
      detailCell('月基础养老金', p.basicMonthly == null ? '—' : fmtYuan(p.basicMonthly)) +
      detailCell('月个人账户养老金', p.personalMonthly == null ? '—' : fmtYuan(p.personalMonthly)) +
      detailCell('个人账户余额', p.accountBalance == null ? '—' : fmtWan(p.accountBalance)) +
      detailCell('计发月数', p.months == null ? '—' : p.months + ' 个月') +
      detailCell('当前月社平工资', fmtYuan(p.currentSocialMonthly)) +
      detailCell('退休时月社平工资', fmtYuan(p.socialAtRetirement)) +
      detailCell('退休首年生活支出', retirementRow ? fmtWan(retirementRow.daily) : '—') +
      detailCell('养老金年收入（首年）', fmtWan(p.monthlyPension * 12)) +
      '</div>' +
      (p.source === 'manual' ? '<div class="callout warn">当前未自动生成正常领取结论，养老金按手工值 ' + fmtYuan(p.monthlyPension) + '/月测算。' +
        (p.formulaMonthly ? '公式参考值约为 ' + fmtYuan(p.formulaMonthly) + '/月；' : '') + '请理财经理确认领取时间、延长缴费或手工金额。</div>' : '') +
      (p.warnings.length ? calloutList('养老提示', p.warnings, 'warn') : '') +
      '</div>' +
      '<div class="result-section"><h3>系统假设</h3><div class="sub">第一版按职工基本养老金公式估算；城乡居民养老保险不自动测算，职业年金不计算。</div>' +
      '<div class="table-wrap"><table class="mini-table"><thead><tr><th>参数</th><th>第一版取值</th></tr></thead><tbody>' +
      '<tr><td>平均缴费指数</td><td>1.0</td></tr>' +
      '<tr><td>缴费基数</td><td>当地社平工资的 100%</td></tr>' +
      '<tr><td>个人账户计入比例</td><td>8%</td></tr>' +
      '<tr><td>社平工资增长率</td><td>1.5%</td></tr>' +
      '<tr><td>个人账户记账利率</td><td>1.5%</td></tr>' +
      '<tr><td>退休后养老金增长率</td><td>1.5%</td></tr>' +
      '<tr><td>历史缴费</td><td>按累计年限连续倒推，指数取 1.0</td></tr>' +
      '<tr><td>未来缴费</td><td>默认持续至计划退休年龄</td></tr>' +
      '</tbody></table></div>' +
      '<div class="callout info">养老金测算属于规划假设，不代表社保经办机构的最终金额；医疗支出继续单独匹配，不并入退休生活支出。</div>' +
      '</div>';
  }

  function proposalTabHTML() {
    const r = state.results;
    if (!r.valid) {
      return '<div class="result-section"><h3>建议书暂不可生成</h3>' +
        '<div class="callout danger">存在待配置或待确认参数，正式建议书已锁定。请先在确认页修正以下问题：<ul>' +
        (r.errors || []).map(function (e) { return '<li>' + esc(e.message) + '</li>'; }).join('') +
        '</ul></div>' +
        '<button class="btn secondary" type="button" id="proposalFixBtn">返回集中确认</button>' +
        '</div>';
    }
    return '<div class="proposal-note">下方为建议书预览。顶部「下载 Word」会导出 .doc 文件，「打印 / PDF」可另存为 PDF；关键数值与页面测算一致。</div>' +
      '<div class="paper"><div class="proposal-doc">' + proposalBodyHTML() + '</div></div>';
  }

  /* ------------------------------------------------------------------ */
  /* 建议书                                                               */
  /* ------------------------------------------------------------------ */
  function proposalBodyHTML() {
    const r = state.results;
    const f = state.fields;
    const s = r.summary;
    const p = state.profile;
    const date = new Date().toLocaleDateString('zh-CN');
    const nYears = f.endYear - f.startYear + 1;
    const statusText = s.targetGap > 0 ? '存在缺口' : '存在富余';
    const gapAmount = s.targetGap > 0 ? s.targetGap : s.targetSurplus;

    const yearlyRows = r.years.map(function (row) {
      return '<tr><td>' + row.year + '</td><td>' + row.age + '</td>' +
        ['wage', 'business', 'pension', 'otherIncome', 'incomeTotal', 'daily', 'alimony', 'medical', 'housing', 'education', 'otherExpense', 'expenseTotal', 'net', 'cumNet', 'endBalance']
          .map(function (key) {
            const neg = (key === 'net' || key === 'cumNet' || key === 'endBalance') && row[key] < -0.01 ? ' class="neg"' : '';
            return '<td' + neg + '>' + wan(row[key], 1) + '</td>';
          }).join('') + '</tr>';
    }).join('');

    const housingText = (function () {
      const h = r.housing;
      if (!h.enabled) return '<li>本次未纳入购房规划。</li>';
      if (h.mode === 'cash') {
        return '<li>购房年份 ' + h.purchaseYear + ' 年，总价 ' + fmtWan(h.price) + '，全款购房，购房当年支出 ' + fmtWan(h.purchaseYearCost) + '。</li>';
      }
      return '<li>购房年份 ' + h.purchaseYear + ' 年，总价 ' + fmtWan(h.price) + '，首付 ' + fmtWan(h.downPayment) +
        '，贷款本金 ' + fmtWan(h.principal) + '，月供约 ' + fmtYuan(h.monthly) + '，购房当年支出 ' +
        fmtWan(h.purchaseYearCost) + '。</li>' +
        '<li>规划期末剩余贷款本金 ' + fmtWan(h.remainingLoan) + '，未在截止年一次性扣除。</li>';
    })();

    const educationText = (function () {
      if (!r.education.enabled || !r.education.children.length) return '<li>本次未纳入子女教育规划。</li>';
      return r.education.children.map(function (child) {
        const meta = stageMeta(child.stage);
        const grade = meta ? meta.grades[child.gradeIndex - 1] : '';
        return '<li>孩子 ' + (child.index + 1) + '：' + child.stage + grade + '起，最高到' + child.highestStage +
          (child.overseas ? '，自' + child.overseasStartStage + '起按' + child.route + '海外路线测算' : '，国内路线') +
          '，规划期内教育支出合计 ' + fmtWan(child.total) + '。</li>';
      }).join('');
    })();

    const retirementText = (function () {
      const pen = r.pension;
      if (!pen) return '<li>本次未纳入退休养老规划。</li>';
      if (pen.error) return '<li>养老金参数缺失，未生成正式结论：' + esc(pen.message) + '。</li>';
      if (pen.mode === 'alreadyRetired') {
        return '<li>客户已退休，按当前实际月养老金 ' + fmtYuan(pen.monthlyPension) + ' 测算，并按每年 1.5% 增长。</li>';
      }
      return '<li>计划 ' + pen.retirementAge + ' 岁（' + pen.retirementYear + ' 年）退休，累计缴费 ' +
        pen.totalContribYears.toFixed(1) + ' 年，最低缴费年限 ' + pen.minContribYears.toFixed(1) + ' 年，' +
        (pen.eligible ? '满足资格校验' : '不满足资格校验，已按手工值测算') + '。</li>' +
        '<li>退休首年月养老金约 ' + fmtYuan(pen.monthlyPension) + '（' + (pen.source === 'formula' ? '职工养老金公式' : '手工值') + '）；退休生活支出为当前日常支出的 ' + fmtPct(pen.levelRatio || 1, 0) + '。</li>';
    })();

    const gapText = (function () {
      if (s.maxShortfall > 0.01 || s.targetGap > 0.01) {
        return '<p>按本文件口径，需追加的初始资金约为 <b>' + fmtWan(s.additionalInitialNeeded) + '</b>，用于同时覆盖最大年度资金不足和期末目标缺口。</p>' +
          '<ul>' +
          (s.firstShortfallYear ? '<li>' + s.firstShortfallYear + ' 年首次出现资金不足，金额约 ' + fmtWan(s.firstShortfallAmount) + '，应提前准备流动性。</li>' : '') +
          '<li>可与客户确认调整期末目标、推迟购房年份、调整教育路径或延长工作年限等方向；本建议书不提供具体金融产品建议。</li>' +
          '</ul>';
      }
      return '<p>在已确认的输入和测算假设下，规划期间未出现年度资金不足，期末资金余额可覆盖目标。建议按年度复盘，及时更新实际收支。</p>';
    })();

    return '<div class="doc-meta"><span>客户：' + esc(p.name) + '（' + esc(p.city) + ' · ' + esc(p.risk) + '）</span><span>规划期间：' + f.startYear + '–' + f.endYear + ' 年 · 生成日期：' + esc(date) + '</span></div>' +
      '<h1>财富规划建议书</h1>' +
      '<div class="doc-sub">基于已确认的年度收支与测算假设 · 参数版本 ' + esc(r.meta.parameterVersion) + '</div>' +

      '<h2>一、结论摘要</h2>' +
      '<p>按已确认的年度收支及测算假设，规划期间累计净结余为 <b>' + fmtWan(s.cumulativeNet) + '</b>。叠加初始可用资金 <b>' + fmtWan(s.p0) +
      '</b>，预计规划期末资金余额为 <b>' + fmtWan(s.endBalance) + '</b>，与期末目标 <b>' + fmtWan(s.target) + '</b> 相比' +
      statusText + ' <b>' + fmtWan(gapAmount) + '</b>。</p>' +
      (s.firstShortfallYear ? '<p>客户在 ' + s.firstShortfallYear + ' 年出现首次资金不足，金额约 ' + fmtWan(s.firstShortfallAmount) +
        '；规划期最大年度资金不足为 ' + fmtWan(s.maxShortfall) + '。客户在购房当年支付首付及当年房贷后，资金余额变化详见逐年现金流。</p>' : '') +
      '<div class="doc-kpi">' +
        '<div><span>初始可用资金 P0</span><b>' + fmtWan(s.p0) + '</b></div>' +
        '<div><span>累计净结余</span><b>' + fmtWan(s.cumulativeNet) + '</b></div>' +
        '<div><span>期末资金余额</span><b>' + fmtWan(s.endBalance) + '</b></div>' +
        '<div><span>需追加初始资金</span><b>' + fmtWan(s.additionalInitialNeeded) + '</b></div>' +
      '</div>' +

      '<h2>二、客户需求</h2>' +
      '<p>客户 ' + esc(p.name) + '，' + p.ageBase + ' 岁，' + esc(p.occupation) + '，所在城市 ' + esc(p.city) +
      '（' + esc(p.cityTier) + '）。本次规划目标为：' + esc(goalLabels().join('、')) + '。</p>' +
      '<ul>' + housingText + educationText + retirementText + '</ul>' +

      '<h2>三、输入与假设</h2>' +
      '<table><thead><tr><th style="width:26%">项目</th><th>取值</th></tr></thead><tbody>' +
        '<tr><td>规划期间</td><td>' + f.startYear + '–' + f.endYear + ' 年（' + nYears + ' 个完整年度）</td></tr>' +
        '<tr><td>初始可用资金 P0</td><td>' + fmtWan(s.p0) + '（年初可用资金 ' + fmtWan(f.initialFunds) + ' + 追加 ' + fmtWan(f.extraInitialFunds) + '）</td></tr>' +
        '<tr><td>期末目标资金 G</td><td>' + fmtWan(f.targetEndFunds) + '</td></tr>' +
        (p.occupation !== '已退休' ? '<tr><td>' + (p.occupation === '公司职员' || p.occupation === '公务员' ? '税后工资' : '经营净收入') + '</td><td>' + fmtWan(p.occupation === '公司职员' || p.occupation === '公务员' ? f.wageAnnual : f.businessAnnual) + '/年</td></tr>' : '') +
        '<tr><td>日常支出</td><td>' + fmtWan(f.dailyAnnual) + '/年</td></tr>' +
        '<tr><td>赡养支出</td><td>' + fmtWan(f.alimonyAnnual) + '/年</td></tr>' +
        '<tr><td>医疗支出</td><td>按当年年龄、收入档和城市档匹配固定年度预算</td></tr>' +
        '<tr><td>增长假设</td><td>工资、经营净收入、日常支出、赡养支出、养老金按 1.5%/年；医疗不叠加增长</td></tr>' +
      '</tbody></table>' +
      '<div class="doc-note">本建议书不计算投资收益、复利、折现或资产配置收益；不采集保险费用；房产价值不计入期末可用金融资金，也不用于填补现金流缺口。</div>' +

      '<h2>四、逐年现金流</h2>' +
      '<table><thead><tr><th>年份</th><th>年龄</th><th>工资</th><th>经营</th><th>养老金</th><th>其他收入</th><th>收入合计</th><th>日常</th><th>赡养</th><th>医疗</th><th>购房</th><th>教育</th><th>其他支出</th><th>支出合计</th><th>当年净结余</th><th>累计净结余</th><th>年末余额</th></tr></thead><tbody>' +
      yearlyRows + '</tbody></table>' +
      '<div class="doc-note">单位：万元。年初资金 = 上年末余额；起始年年初资金 = P0。当年净结余为负不等于资金不足，只有叠加 P0 和此前结余后年末余额仍为负，才记为该年资金不足。</div>' +

      '<h2>五、各目标规划</h2>' +
      '<h3>购置房产</h3><ul>' + housingText + '</ul>' +
      '<h3>子女教育</h3><ul>' + educationText + '</ul>' +
      '<h3>退休养老</h3><ul>' + retirementText + '</ul>' +

      '<h2>六、资金缺口及应对建议</h2>' + gapText +

      '<h2>七、后续复盘安排</h2>' +
      '<p>建议每年复盘一次，更新收入、日常支出、医疗、购房和教育实际发生额；当收入、家庭成员、购房计划或退休计划发生变化时，应重新测算并更新建议书。参数版本变化时，应同时更新测算结果。</p>' +

      '<h2>八、风险提示</h2>' +
      '<ul>' +
        '<li>本建议书基于客户提供及画像带入的输入和演示参数测算，不构成对未来的保证；实际收支可能与假设不同。</li>' +
        '<li>养老金测算使用职工基本养老金公式及演示社平工资、最低缴费年限参数，不代表社保经办机构的最终金额；城乡居民养老、职业年金未自动测算。</li>' +
        '<li>教育预算和医疗预算属于规划假设，不代表学校、医疗机构或保险机构的实际收费。</li>' +
        '<li>贷款按等额本息和默认利率测算；实际利率、放款时间、提前还款、组合贷、税费和装修等未纳入第一版。</li>' +
      '</ul>' +
      '<div class="doc-footer">参数版本：' + esc(r.meta.parameterVersion) + ' · 生成日期：' + esc(date) +
      ' · 本文件由财富规划助手原型生成，关键数值与页面测算一致。医疗、社平工资、最低缴费年限、计发月数等参数正式上线前需完成后台配置和版本管理。</div>';
  }

  const DOC_STYLES = [
    '@page { size: A4 landscape; margin: 12mm; }',
    'body { margin:0; background:#fff; }',
    '.proposal-doc { font-family: "Songti SC","SimSun","STSong",serif; color:#202830; font-size:10pt; line-height:1.75; padding:0; }',
    '.proposal-doc h1 { font-size:18pt; text-align:center; margin:0 0 6px; letter-spacing:.08em; }',
    '.proposal-doc .doc-sub { text-align:center; font-size:8.5pt; color:#6d7680; margin-bottom:22px; }',
    '.proposal-doc h2 { font-size:11pt; margin:20px 0 7px; padding-left:9px; border-left:3px solid #b18a52; color:#102b43; }',
    '.proposal-doc h3 { font-size:10pt; margin:14px 0 5px; color:#102b43; }',
    '.proposal-doc p { margin:6px 0; text-align:justify; }',
    '.proposal-doc ul { margin:5px 0; padding-left:20px; }',
    '.proposal-doc li { margin:2px 0; }',
    '.proposal-doc table { width:100%; border-collapse:collapse; margin:7px 0 10px; font-size:7pt; }',
    '.proposal-doc th,.proposal-doc td { border:1px solid #d9d2c5; padding:2pt 3pt; text-align:right; }',
    '.proposal-doc th { background:#f3eee4; font-weight:600; }',
    '.proposal-doc th:first-child,.proposal-doc td:first-child { text-align:left; }',
    '.proposal-doc .doc-meta { display:flex; justify-content:space-between; font-size:8pt; color:#6d7680; border-bottom:1px solid #d9d2c5; padding-bottom:6px; margin-bottom:14px; }',
    '.proposal-doc .doc-note { background:#f8f4ec; border:1px solid #e4dccd; padding:8px 10px; font-size:8pt; color:#5d6670; margin:8px 0; }',
    '.proposal-doc .doc-kpi { display:flex; gap:12px; margin:9px 0; }',
    '.proposal-doc .doc-kpi div { flex:1; border:1px solid #e4dccd; background:#fbf8f2; padding:8px 10px; }',
    '.proposal-doc .doc-kpi span { display:block; font-size:7.5pt; color:#6d7680; }',
    '.proposal-doc .doc-kpi b { display:block; font-size:12pt; margin-top:3px; color:#102b43; }',
    '.proposal-doc .neg { color:#a53c35; }',
    '.proposal-doc .doc-footer { margin-top:22px; padding-top:8px; border-top:1px solid #d9d2c5; font-size:7pt; color:#7c848c; line-height:1.6; }'
  ].join('\n');

  function fullProposalHTML() {
    return '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>财富规划建议书_' +
      esc(state.profile.name) + '</title><style>' + DOC_STYLES + '</style></head><body><div class="proposal-doc">' +
      proposalBodyHTML() + '</div></body></html>';
  }

  function downloadWord() {
    if (!state.results || !state.results.valid) { toast('存在待配置参数，暂不能生成正式建议书。'); return; }
    const html = fullProposalHTML();
    const blob = new Blob(['﻿' + html], { type: 'application/msword;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = '财富规划建议书_' + state.profile.name + '_' + new Date().toISOString().slice(0, 10) + '.doc';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1500);
    toast('Word 建议书已生成（.doc）');
  }

  function printProposal() {
    if (!state.results || !state.results.valid) { toast('存在待配置参数，暂不能生成正式建议书。'); return; }
    const html = fullProposalHTML();
    const iframe = document.createElement('iframe');
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    document.body.appendChild(iframe);
    iframe.onload = function () {
      try {
        iframe.contentWindow.focus();
        iframe.contentWindow.print();
      } catch (err) {
        showError('打印窗口打开失败，可使用浏览器打印功能。');
      }
      setTimeout(function () {
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      }, 60000);
    };
    iframe.srcdoc = html;
  }

  /* ------------------------------------------------------------------ */
  /* 示例方案                                                             */
  /* ------------------------------------------------------------------ */
  function runDemo(tab) {
    resetSession(PROFILES[0], { restore: false });
    state.demoMode = true;
    const p = PROFILES[0];
    state.goals = { investment: true, housing: true, education: true, retirement: true };
    state.fields = Object.assign(defaultFields(p), {
      startYear: CURRENT_YEAR,
      initialFunds: 1200000,
      extraInitialFunds: 0,
      endYear: CURRENT_YEAR + 20,
      targetEndFunds: 3000000,
      wageAnnual: 300000,
      businessAnnual: 0,
      otherAnnual: 0,
      otherExpenseAnnual: 0,
      dailyAnnual: 96000,
      alimonyAnnual: 0,
      purchaseYear: CURRENT_YEAR + 3,
      housePrice: 3000000,
      housingMode: 'loan',
      downRatio: 0.3,
      loanYears: 30,
      loanRate: 0.035,
      ownShare: 1,
      childCount: 1,
      children: [{
        age: 6, stage: '小学', gradeIndex: 1, highestStage: '本科',
        overseas: false, overseasStartStage: null, route: null
      }],
      alreadyRetired: false,
      retirementAge: 60,
      levelRatio: 1,
      contribYears: 20,
      participate: true,
      manualMonthlyPension: 0
    });
    state.sources = Object.assign(defaultSources(p), {
      startYear: 'client', initialFunds: 'profile', extraInitialFunds: 'client', endYear: 'client',
      targetEndFunds: 'client', wageAnnual: 'client', otherAnnual: 'client', dailyAnnual: 'client',
      alimonyAnnual: 'client', purchaseYear: 'client', housePrice: 'client', housingMode: 'client',
      downRatio: 'default', loanYears: 'default', loanRate: 'default', ownShare: 'default',
      childCount: 'client', children: 'client', alreadyRetired: 'client', retirementAge: 'client',
      levelRatio: 'client', contribYears: 'client', participate: 'default', manualMonthlyPension: 'default'
    });
    state.started = true;
    state.completed = true;
    state.answered = 20;
    state.queue = [];
    state.activeStep = null;
    state.busy = false;
    el.chatMessages.innerHTML = '';
    renderProfile();
    renderGoals();
    renderProgress();
    renderFieldList();
    updateComposer();
    addAssistant('已载入示例方案：' + p.name + '，' + CURRENT_YEAR + ' 年起规划 20 年，' +
      (CURRENT_YEAR + 3) + ' 年购房，1 名子女，60 岁退休。可以直接查看测算结果，也可以点击「重新开始」体验完整问答。');
    addSystem('示例数据仅用于演示流程与计算口径，不代表真实客户或正式业务参数。');
    const result = runCalculation();
    if (result) setTimeout(function () { openResults(tab || 'summary'); }, 320);
  }

  /* ------------------------------------------------------------------ */
  /* 事件绑定                                                             */
  /* ------------------------------------------------------------------ */
  function bindEvents() {
    el.profileSelect.addEventListener('change', function () {
      const profile = PROFILES.find(function (p) { return p.id === el.profileSelect.value; });
      if (profile) {
        resetSession(profile, { restore: true });
        toast('已切换至客户 ' + profile.name);
      }
    });
    el.demoBtn.addEventListener('click', runDemo);
    el.resetBtn.addEventListener('click', function () {
      if (state.started && !window.confirm('重新开始将清空当前问答与测算结果，确定吗？')) return;
      clearSavedSession(state.profile.id);
      resetSession(state.profile, { restore: false });
      toast('已重新开始');
    });
    el.exitBtn.addEventListener('click', function () {
      toast('原型环境：已模拟退出登录（不接入真实登录态）');
    });
    el.confirmTopBtn.addEventListener('click', openConfirm);
    el.editFieldsBtn.addEventListener('click', openConfirm);
    el.sendBtn.addEventListener('click', function () { handleText(el.chatInput.value); });
    el.chatInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleText(el.chatInput.value);
      }
    });
    el.confirmCalcBtn.addEventListener('click', saveConfirm);
    el.confirmBody.addEventListener('input', function (e) {
      if (e.target.matches('input')) readTarget(e.target);
    });
    el.confirmBody.addEventListener('change', function (e) {
      if (e.target.matches('select')) readTarget(e.target);
    });
    el.downloadWordBtn.addEventListener('click', downloadWord);
    el.printBtn.addEventListener('click', printProposal);
    el.resultTabs.addEventListener('click', function (e) {
      const btn = e.target.closest('button[data-tab]');
      if (!btn) return;
      state.resultTab = btn.dataset.tab;
      renderResults();
    });
    document.addEventListener('click', function (e) {
      const closer = e.target.closest('[data-close]');
      if (closer) {
        const modal = closer.closest('.modal');
        if (modal) closeModal(modal);
      }
      const fix = e.target.closest('#proposalFixBtn');
      if (fix) {
        closeModal(el.resultsModal);
        openConfirm();
      }
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') {
        closeModal(el.confirmModal);
        closeModal(el.resultsModal);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
