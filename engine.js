/* 财富规划助手 · 确定性计算引擎
 * 对应 PRD V0.3 第 3–8 章。所有金额单位为元。
 * 该文件不依赖 DOM，可在 Node 中直接测试。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WealthEngine = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const EPS = 1e-9;

  function round(n, digits) {
    const f = Math.pow(10, digits == null ? 2 : digits);
    return Math.round((n + EPS) * f) / f;
  }
  function clamp(n, min, max) {
    return Math.min(max, Math.max(min, n));
  }
  function growth(k, rate) {
    return Math.pow(1 + (rate == null ? 0.015 : rate), k);
  }
  function isFiniteNumber(n) {
    return typeof n === 'number' && Number.isFinite(n);
  }
  function stageIndex(stage, params) {
    return params.stages.findIndex(function (s) { return s.key === stage; });
  }
  function ageBandKey(age, params) {
    const band = params.medicalAgeBands.find(function (b) {
      return age >= b.min && age <= b.max;
    });
    return band ? band.key : null;
  }
  function incomeBandKey(annualIncome, params) {
    for (let i = 0; i < params.incomeBands.length; i++) {
      if (annualIncome < params.incomeBands[i].max) return params.incomeBands[i].key;
    }
    return params.incomeBands[params.incomeBands.length - 1].key;
  }
  function minContribYears(retirementYear, params) {
    const p = params.pension;
    if (retirementYear < p.reformStart) return p.minYearsBase;
    return Math.min(p.minYearsCap, p.minYearsBase + (retirementYear - p.reformStart + 1) * p.reformStep);
  }
  function monthsForAge(age, params) {
    const clamped = clamp(Math.round(age), 40, 70);
    return {
      months: params.contributionMonths[clamped] || 139,
      adjusted: Math.abs(age - clamped) > 1e-9 || age < 40 || age > 70
    };
  }
  function medicalBudget(age, annualIncome, cityTier, params) {
    const city = params.medical[cityTier];
    if (!city) return null;
    const band = incomeBandKey(annualIncome, params);
    const ageBand = ageBandKey(age, params);
    if (!ageBand) return null;
    const value = city[band] ? city[band][ageBand] : null;
    return typeof value === 'number' ? value : null;
  }

  /* ---------- 房贷 ---------- */
  function mortgage(principal, annualRate, years) {
    const n = Math.max(1, Math.round(years * 12));
    const i = annualRate / 12;
    const monthly = i === 0
      ? principal / n
      : principal * i / (1 - Math.pow(1 + i, -n));
    return {
      totalPeriods: n,
      monthlyRate: i,
      monthly: monthly,
      totalInterest: monthly * n - principal
    };
  }
  function remainingPrincipal(principal, monthly, monthlyRate, totalPeriods, paidPeriods) {
    if (paidPeriods <= 0) return principal;
    if (paidPeriods >= totalPeriods) return 0;
    if (monthlyRate === 0) return Math.max(0, principal - monthly * paidPeriods);
    const f = Math.pow(1 + monthlyRate, paidPeriods);
    return Math.max(0, principal * f - monthly * (f - 1) / monthlyRate);
  }

  function calcHousing(inputs, params) {
    const h = inputs.housing || {};
    if (!h.enabled) return { enabled: false };
    const purchaseYear = h.purchaseYear;
    const price = h.totalPrice;
    const ownShare = h.ownShare == null ? 1 : h.ownShare;
    const inHorizon = purchaseYear >= inputs.startYear && purchaseYear <= inputs.endYear;
    const base = {
      enabled: true,
      purchaseYear: purchaseYear,
      price: price,
      mode: h.mode,
      ownShare: ownShare,
      inHorizon: inHorizon,
      totalPriceOwn: price * ownShare
    };
    if (h.mode === 'cash') {
      return Object.assign(base, {
        downPayment: price * ownShare,
        principal: 0,
        monthly: 0,
        totalPeriods: 0,
        purchaseYearCost: inHorizon ? price * ownShare : 0,
        remainingLoan: 0,
        paidOffYear: purchaseYear
      });
    }

    const downPayment = price * h.downRatio;
    const principal = price - downPayment;
    const loan = mortgage(principal, h.annualRate, h.years);
    const lastPaymentYear = purchaseYear + Math.ceil(loan.totalPeriods / 12) - 1;
    const costForYear = function (year) {
      if (year < purchaseYear) return 0;
      const rel = year - purchaseYear;
      let cost = 0;
      if (rel === 0) cost += downPayment * ownShare;
      const paidBefore = rel * 12;
      const payments = Math.min(12, Math.max(0, loan.totalPeriods - paidBefore));
      cost += payments * loan.monthly * ownShare;
      return cost;
    };
    const paymentsMade = inHorizon
      ? clamp((inputs.endYear - purchaseYear + 1) * 12, 0, loan.totalPeriods)
      : 0;
    const remainingLoan = remainingPrincipal(
      principal, loan.monthly, loan.monthlyRate, loan.totalPeriods, paymentsMade
    ) * ownShare;

    return Object.assign(base, {
      downPayment: downPayment * ownShare,
      principal: principal * ownShare,
      monthly: loan.monthly * ownShare,
      totalPeriods: loan.totalPeriods,
      annualPayment: loan.monthly * 12 * ownShare,
      totalInterest: loan.totalInterest * ownShare,
      lastPaymentYear: lastPaymentYear,
      purchaseYearCost: inHorizon ? costForYear(purchaseYear) : 0,
      costForYear: costForYear,
      paymentsMade: paymentsMade,
      remainingLoan: remainingLoan,
      paidOffYear: remainingLoan <= 0.01 ? lastPaymentYear : null
    });
  }

  /* ---------- 子女教育 ---------- */
  function childSchedule(child, startYear, endYear, cityTier, params) {
    const order = params.stages;
    let si = stageIndex(child.stage, params);
    let gi = child.gradeIndex || 1;
    const hi = stageIndex(child.highestStage, params);
    const overseasStart = child.overseas ? stageIndex(child.overseasStartStage, params) : 999;
    const rows = [];
    if (si < 0 || hi < 0 || si > hi) return rows;
    for (let k = 0; startYear + k <= endYear; k++) {
      if (si > hi) break;
      const stage = order[si].key;
      const overseas = !!child.overseas && si >= overseasStart;
      let budget = null;
      if (overseas) {
        budget = params.educationOverseas[child.route || '大众']
          ? params.educationOverseas[child.route || '大众'][stage]
          : null;
      } else {
        budget = params.educationDomestic[stage] ? params.educationDomestic[stage][cityTier] : null;
      }
      rows.push({
        year: startYear + k,
        age: child.age + k,
        stage: stage,
        gradeIndex: gi,
        gradeLabel: order[si].grades[gi - 1] || '',
        overseas: overseas,
        route: overseas ? (child.route || '大众') : null,
        budget: budget,
        cost: typeof budget === 'number' ? budget * growth(k, params.growth) : null
      });
      if (gi < order[si].years) {
        gi++;
      } else {
        si++;
        gi = 1;
      }
    }
    return rows;
  }

  function calcEducation(inputs, params) {
    const e = inputs.education || {};
    if (!e.enabled) return { enabled: false, children: [] };
    const children = (e.children || []).map(function (child, index) {
      const schedule = childSchedule(child, inputs.startYear, inputs.endYear, inputs.cityTier, params);
      const warnings = [];
      const stage = params.stages[stageIndex(child.stage, params)];
      if (stage && (child.age < stage.ageMin - 1 || child.age > stage.ageMax + 1)) {
        warnings.push({
          code: 'EDU_AGE_CONFLICT',
          message: '孩子 ' + (index + 1) + ' 当前年级与年龄相差较大，已按具体年级测算，请核对。'
        });
      }
      let total = 0;
      let missing = false;
      schedule.forEach(function (row) {
        if (row.cost == null) {
          missing = true;
          row.cost = 0;
        }
        total += row.cost;
      });
      return {
        index: index,
        age: child.age,
        stage: child.stage,
        gradeIndex: child.gradeIndex,
        gradeLabel: stage ? stage.grades[child.gradeIndex - 1] : '',
        highestStage: child.highestStage,
        overseas: !!child.overseas,
        overseasStartStage: child.overseasStartStage || null,
        route: child.route || null,
        schedule: schedule,
        total: total,
        missingBudget: missing,
        warnings: warnings
      };
    });
    return { enabled: true, children: children };
  }

  /* ---------- 退休养老 ---------- */
  function calcPension(inputs, params) {
    const r = inputs.retirement || {};
    if (!r.enabled) return null;
    const p = params.pension;
    const currentSocial = params.socialAvgMonthly[inputs.cityTier];
    if (!currentSocial) {
      return { error: 'SOCIAL_AVG_MISSING', message: '当前城市档位缺少社平工资参数，无法测算养老金。' };
    }

    if (r.alreadyRetired) {
      const monthly = r.manualMonthlyPension || 0;
      return {
        mode: 'alreadyRetired',
        alreadyRetired: true,
        retirementYear: inputs.startYear,
        retirementAge: inputs.ageAtStart,
        yearsToRetire: 0,
        currentSocialMonthly: currentSocial,
        socialAtRetirement: currentSocial,
        totalContribYears: r.contribYears || 0,
        minContribYears: null,
        eligible: true,
        monthlyPension: monthly,
        monthlyNow: monthly,
        basicMonthly: null,
        personalMonthly: null,
        accountBalance: null,
        months: null,
        source: 'manual',
        warnings: [{
          code: 'PENSION_ALREADY_RETIRED',
          message: '已退休客户按当前实际月养老金测算，不再使用公式估算。'
        }]
      };
    }

    const yearsToRetire = Math.max(0, r.retirementAge - inputs.ageAtStart);
    const retirementYear = inputs.startYear + yearsToRetire;
    const totalYears = (r.contribYears || 0) + yearsToRetire;
    const minYears = minContribYears(retirementYear, params);
    const socialAtRetirement = currentSocial * growth(yearsToRetire, p.socialGrowth);
    const basicMonthly = socialAtRetirement * totalYears * 0.01 * ((1 + p.index) / 2);

    /* 个人账户：先按当前累计缴费年限向前倒推，再逐年缴至退休 */
    let balance = 0;
    const whole = Math.floor(r.contribYears || 0);
    const frac = (r.contribYears || 0) - whole;
    for (let i = 1; i <= whole; i++) {
      const monthlySocial = currentSocial / growth(i, p.socialGrowth);
      balance += monthlySocial * 12 * p.accountContribution * growth(i - 1, p.accountRate);
    }
    if (frac > 0) {
      const monthlySocial = currentSocial / growth(whole + 1, p.socialGrowth);
      balance += monthlySocial * 12 * p.accountContribution * frac;
    }
    for (let k = 0; k < yearsToRetire; k++) {
      const monthlySocial = currentSocial * growth(k, p.socialGrowth);
      balance = balance * (1 + p.accountRate) + monthlySocial * 12 * p.accountContribution;
    }

    const monthsInfo = monthsForAge(r.retirementAge, params);
    const personalMonthly = balance / monthsInfo.months;
    const formulaMonthly = basicMonthly + personalMonthly;
    const eligible = totalYears >= minYears - 1e-9;
    const manual = r.manualMonthlyPension || 0;
    const useFormula = !!r.participate && eligible;
    const monthlyPension = useFormula ? formulaMonthly : manual;
    const warnings = [];

    if (!r.participate) {
      warnings.push({
        code: 'PENSION_NOT_PARTICIPATING',
        message: '客户未参加职工基本养老保险，养老金按手工填写值 ' +
          round(manual, 0).toLocaleString('zh-CN') + ' 元/月测算。'
      });
    } else if (!eligible) {
      warnings.push({
        code: 'PENSION_INSUFFICIENT',
        message: '预计退休时累计缴费 ' + round(totalYears, 1) + ' 年，低于 ' + retirementYear +
          ' 年最低缴费年限 ' + round(minYears, 1) + ' 年，未自动生成正常领取结论；当前按手工值 ' +
          round(manual, 0).toLocaleString('zh-CN') + ' 元/月测算，请人工确认。'
      });
    }
    if (monthsInfo.adjusted) {
      warnings.push({
        code: 'PENSION_MONTHS_ADJUSTED',
        message: '退休年龄未命中计发月数表，已按最接近档位 ' + monthsInfo.months + ' 个月测算。'
      });
    }

    return {
      mode: 'formula',
      alreadyRetired: false,
      retirementAge: r.retirementAge,
      retirementYear: retirementYear,
      yearsToRetire: yearsToRetire,
      currentSocialMonthly: currentSocial,
      socialAtRetirement: socialAtRetirement,
      totalContribYears: totalYears,
      currentContribYears: r.contribYears || 0,
      minContribYears: minYears,
      eligible: eligible,
      basicMonthly: basicMonthly,
      personalMonthly: personalMonthly,
      accountBalance: balance,
      months: monthsInfo.months,
      formulaMonthly: formulaMonthly,
      monthlyPension: monthlyPension,
      monthlyNow: null,
      source: useFormula ? 'formula' : 'manual',
      participate: !!r.participate,
      levelRatio: r.levelRatio,
      warnings: warnings
    };
  }

  /* ---------- 输入校验 ---------- */
  function validate(inputs, params) {
    const errors = [];
    function err(field, message) { errors.push({ field: field, message: message }); }
    function num(field, value, min, max, label) {
      if (!isFiniteNumber(value)) { err(field, label + '必须是数字。'); return false; }
      if (min != null && value < min) { err(field, label + '不能小于 ' + min + '。'); return false; }
      if (max != null && value > max) { err(field, label + '不能大于 ' + max + '。'); return false; }
      return true;
    }

    if (!Number.isInteger(inputs.startYear) || inputs.startYear < 2000 || inputs.startYear > 2100) {
      err('startYear', '规划起始年份无效。');
    }
    if (!Number.isInteger(inputs.endYear) || inputs.endYear < 2000 || inputs.endYear > 2100) {
      err('endYear', '规划截止年份无效。');
    }
    if (Number.isInteger(inputs.startYear) && Number.isInteger(inputs.endYear) && inputs.endYear < inputs.startYear) {
      err('endYear', '规划截止年份不能早于起始年份。');
    }
    if (!isFiniteNumber(inputs.ageAtStart) || inputs.ageAtStart < 0) {
      err('ageAtStart', '客户起始年龄无效。');
    }
    num('initialFunds', inputs.initialFunds, 0, null, '初始资金');
    num('extraInitialFunds', inputs.extraInitialFunds, 0, null, '年初一次性追加资金');
    num('targetEndFunds', inputs.targetEndFunds, 0, null, '期末目标资金');
    num('wageAnnual', inputs.wageAnnual, 0, null, '工资收入');
    num('businessAnnual', inputs.businessAnnual, 0, null, '经营净收入');
    num('otherAnnual', inputs.otherAnnual, 0, null, '其他收入');
    num('otherExpenseAnnual', inputs.otherExpenseAnnual, 0, null, '其他支出');
    num('dailyAnnual', inputs.dailyAnnual, 0, null, '日常支出');
    num('alimonyAnnual', inputs.alimonyAnnual, 0, null, '赡养支出');
    if (!params.socialAvgMonthly[inputs.cityTier] && inputs.retirement && inputs.retirement.enabled) {
      err('cityTier', '当前城市档位缺少社平工资参数。');
    }

    const h = inputs.housing || {};
    if (h.enabled) {
      if (!Number.isInteger(h.purchaseYear)) err('purchaseYear', '购房年份无效。');
      if (Number.isInteger(h.purchaseYear) && (h.purchaseYear < inputs.startYear || h.purchaseYear > inputs.endYear)) {
        err('purchaseYear', '购房年份必须落在规划期内。');
      }
      num('housePrice', h.totalPrice, 1, null, '购房总价');
      if (h.mode !== 'loan' && h.mode !== 'cash') err('housingMode', '购房方式无效。');
      if (h.mode === 'loan') {
        num('downRatio', h.downRatio, 0, 0.95, '首付比例');
        num('loanYears', h.years, 1, 40, '贷款期限');
        num('loanRate', h.annualRate, 0, 0.2, '贷款年利率');
      }
      num('ownShare', h.ownShare, 0.01, 1, '本人承担比例');
    }

    const e = inputs.education || {};
    if (e.enabled) {
      (e.children || []).forEach(function (child, i) {
        const prefix = '孩子 ' + (i + 1) + '：';
        if (!isFiniteNumber(child.age) || child.age < 0 || child.age > 40) {
          err('children.' + i + '.age', prefix + '年龄无效。');
        }
        const si = stageIndex(child.stage, params);
        const hi = stageIndex(child.highestStage, params);
        if (si < 0) err('children.' + i + '.stage', prefix + '当前教育阶段无效。');
        if (hi < 0) err('children.' + i + '.highestStage', prefix + '最高教育阶段无效。');
        if (si >= 0 && hi >= 0 && hi < si) {
          err('children.' + i + '.highestStage', prefix + '最高教育阶段不能低于当前阶段。');
        }
        if (si >= 0 && (!Number.isInteger(child.gradeIndex) || child.gradeIndex < 1 || child.gradeIndex > params.stages[si].years)) {
          err('children.' + i + '.gradeIndex', prefix + '当前年级无效。');
        }
        if (child.overseas) {
          const oi = stageIndex(child.overseasStartStage, params);
          const highSchool = stageIndex('高中', params);
          if (oi < highSchool) err('children.' + i + '.overseasStartStage', prefix + '出国阶段最早为高中。');
          if (si >= 0 && oi >= 0 && oi < si) err('children.' + i + '.overseasStartStage', prefix + '出国阶段不能早于当前阶段。');
          if (hi >= 0 && oi > hi) err('children.' + i + '.overseasStartStage', prefix + '出国阶段不能高于最高教育阶段。');
          if (child.route !== '大众' && child.route !== '高端') err('children.' + i + '.route', prefix + '海外路线无效。');
        }
      });
    }

    const r = inputs.retirement || {};
    if (r.enabled) {
      if (!r.alreadyRetired) {
        if (!isFiniteNumber(r.retirementAge) || r.retirementAge <= inputs.ageAtStart || r.retirementAge > 80) {
          err('retirementAge', '计划退休年龄必须大于起始年龄且不超过 80 岁。');
        }
        num('levelRatio', r.levelRatio, 0.3, 2, '退休生活水平');
        num('contribYears', r.contribYears, 0, 50, '累计缴费年限');
      }
      num('manualMonthlyPension', r.manualMonthlyPension, 0, null, '手工月养老金');
    }
    return errors;
  }

  /* ---------- 主计算 ---------- */
  function calculate(inputs, params) {
    const errors = validate(inputs, params);
    const warnings = [];
    const g = params.growth;
    const p0 = (inputs.initialFunds || 0) + (inputs.extraInitialFunds || 0);
    const years = [];

    const pensionRaw = calcPension(inputs, params);
    const pension = pensionRaw && !pensionRaw.error ? pensionRaw : null;
    if (pensionRaw && pensionRaw.error) {
      errors.push({ field: 'pension', message: pensionRaw.message });
    }
    if (pension && pension.warnings) {
      pension.warnings.forEach(function (w) { warnings.push(w); });
    }

    const housing = calcHousing(inputs, params);
    if (housing.enabled) {
      if (!housing.inHorizon) {
        errors.push({ field: 'purchaseYear', message: '购房年份不在规划期内，无法生成正式结论。' });
      }
      if (housing.mode === 'loan' && housing.remainingLoan > 0.01) {
        warnings.push({
          code: 'LOAN_REMAINING',
          message: '规划截止时贷款尚未还清，期末剩余贷款本金约 ' +
            round(housing.remainingLoan, 0).toLocaleString('zh-CN') + ' 元，已在购房结果中单独展示。'
        });
      }
    }

    const education = calcEducation(inputs, params);
    if (education.enabled) {
      education.children.forEach(function (child) {
        child.warnings.forEach(function (w) { warnings.push(w); });
        if (child.missingBudget) {
          errors.push({
            field: 'education.children.' + child.index,
            message: '孩子 ' + (child.index + 1) + ' 存在未配置的教育预算，请补充参数后再生成正式结论。'
          });
        }
      });
    }

    const retirementEnabled = !!(inputs.retirement && inputs.retirement.enabled);
    const alreadyRetired = !!(pension && pension.alreadyRetired);
    const yearsToRetire = pension && !alreadyRetired ? pension.yearsToRetire : 0;
    const stopWorkK = retirementEnabled ? (alreadyRetired ? 0 : yearsToRetire) : Infinity;
    const pensionMonthly = pension ? pension.monthlyPension : 0;
    const levelRatio = inputs.retirement ? (inputs.retirement.levelRatio || 1) : 1;

    let balance = p0;
    let cumulative = 0;
    let medicalMissing = false;
    let incomeBandBase = Math.max(
      (inputs.wageAnnual || 0) + (inputs.businessAnnual || 0),
      pension ? pensionMonthly * 12 : 0
    );

    const educationByYear = {};
    if (education.enabled) {
      education.children.forEach(function (child) {
        child.schedule.forEach(function (row) {
          if (!educationByYear[row.year]) educationByYear[row.year] = 0;
          educationByYear[row.year] += row.cost || 0;
        });
      });
    }

    const nYears = inputs.endYear - inputs.startYear + 1;
    for (let k = 0; k < nYears; k++) {
      const year = inputs.startYear + k;
      if (year > inputs.endYear) break;
      const age = inputs.ageAtStart + k;

      let wage = (inputs.wageAnnual || 0) * growth(k, g);
      let business = (inputs.businessAnnual || 0) * growth(k, g);
      if (retirementEnabled && k >= stopWorkK) {
        wage = 0;
        business = 0;
      }

      let pensionIncome = 0;
      if (pension) {
        if (alreadyRetired) {
          pensionIncome = pensionMonthly * 12 * growth(k, g);
        } else if (k >= yearsToRetire) {
          pensionIncome = pensionMonthly * 12 * growth(k - yearsToRetire, g);
        }
      }

      const otherIncome = inputs.otherAnnual || 0;
      const incomeTotal = wage + business + pensionIncome + otherIncome;

      let daily = (inputs.dailyAnnual || 0) * growth(k, g);
      if (retirementEnabled && !alreadyRetired && k >= yearsToRetire) {
        daily *= levelRatio;
      }
      const alimony = (inputs.alimonyAnnual || 0) * growth(k, g);
      const medical = medicalBudget(age, incomeBandBase, inputs.cityTier, params);
      if (medical == null) medicalMissing = true;

      const housingCost = housing.enabled && housing.costForYear ? housing.costForYear(year) : 0;
      const educationCost = educationByYear[year] || 0;
      const otherExpense = inputs.otherExpenseAnnual || 0;

      const expenseTotal = daily + alimony + (medical == null ? 0 : medical) +
        housingCost + educationCost + otherExpense;
      const net = incomeTotal - expenseTotal;
      const startBalance = balance;
      cumulative += net;
      balance = startBalance + net;

      years.push({
        year: year,
        age: age,
        startBalance: startBalance,
        wage: wage,
        business: business,
        pension: pensionIncome,
        otherIncome: otherIncome,
        incomeTotal: incomeTotal,
        daily: daily,
        alimony: alimony,
        medical: medical == null ? 0 : medical,
        housing: housingCost,
        education: educationCost,
        otherExpense: otherExpense,
        expenseTotal: expenseTotal,
        net: net,
        cumNet: cumulative,
        endBalance: balance,
        shortfall: Math.max(0, -balance),
        medicalPending: medical == null
      });
    }

    if (medicalMissing) {
      errors.push({
        field: 'medical',
        message: '医疗预算存在未匹配的年龄/收入/城市组合，当前显示「待配置」，请补充参数后再生成正式结论。'
      });
    }

    const firstShortfall = years.find(function (row) { return row.endBalance < -EPS; }) || null;
    const maxShortfallRow = years.reduce(function (max, row) {
      return !max || row.shortfall > max.shortfall ? row : max;
    }, null);
    const endBalance = years.length ? years[years.length - 1].endBalance : p0;
    const cumulativeNet = years.length ? years[years.length - 1].cumNet : 0;
    const target = inputs.targetEndFunds || 0;
    const targetGap = Math.max(0, target - endBalance);
    const targetSurplus = Math.max(0, endBalance - target);
    const maxShortfall = maxShortfallRow ? maxShortfallRow.shortfall : 0;
    const additionalInitial = Math.max(maxShortfall, targetGap);
    const status = errors.length ? 'pending' : (maxShortfall > 0.01 ? 'shortfall' : (targetGap > 0.01 ? 'gap' : 'ok'));

    return {
      valid: errors.length === 0,
      errors: errors,
      warnings: warnings,
      years: years,
      summary: {
        p0: p0,
        initialFunds: inputs.initialFunds || 0,
        extraInitialFunds: inputs.extraInitialFunds || 0,
        cumulativeNet: cumulativeNet,
        endBalance: endBalance,
        target: target,
        targetGap: targetGap,
        targetSurplus: targetSurplus,
        firstShortfallYear: firstShortfall ? firstShortfall.year : null,
        firstShortfallAmount: firstShortfall ? firstShortfall.shortfall : 0,
        maxShortfall: maxShortfall,
        maxShortfallYear: maxShortfallRow && maxShortfallRow.shortfall > 0.01 ? maxShortfallRow.year : null,
        additionalInitialNeeded: additionalInitial,
        status: status,
        totalIncome: years.reduce(function (s, r) { return s + r.incomeTotal; }, 0),
        totalExpense: years.reduce(function (s, r) { return s + r.expenseTotal; }, 0)
      },
      housing: housing,
      education: education,
      pension: pensionRaw,
      meta: {
        parameterVersion: params.version,
        growth: g,
        cityTier: inputs.cityTier,
        startYear: inputs.startYear,
        endYear: inputs.endYear,
        ageAtStart: inputs.ageAtStart,
        incomeBand: incomeBandKey(incomeBandBase, params),
        medicalAgeBand: years.length ? ageBandKey(years[0].age, params) : null,
        noInvestmentReturn: true
      }
    };
  }

  return {
    calculate: calculate,
    validate: validate,
    calcPension: calcPension,
    calcHousing: calcHousing,
    calcEducation: calcEducation,
    childSchedule: childSchedule,
    medicalBudget: medicalBudget,
    minContribYears: minContribYears,
    mortgage: mortgage,
    remainingPrincipal: remainingPrincipal,
    growth: growth,
    round: round
  };
});
