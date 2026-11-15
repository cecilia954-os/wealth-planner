/* 财富规划助手 · 演示参数与客户画像
 * 所有金额内部单位为「元」。参数版本仅用于原型演示，不代表正式业务口径。
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.WealthData = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const PARAMS = {
    version: '演示参数 v0.1（2026-11）',
    growth: 0.015,
    pension: {
      accountRate: 0.015,
      accountContribution: 0.08,
      index: 1.0,
      socialGrowth: 0.015,
      minYearsBase: 15,
      reformStart: 2030,
      reformStep: 0.5,
      minYearsCap: 20
    },
    loanDefaults: {
      downRatio: 0.30,
      years: 30,
      annualRate: 0.035
    },
    cityTiers: ['一线', '二线含新一线', '三四线'],
    socialAvgMonthly: {
      '一线': 12183,
      '二线含新一线': 9000,
      '三四线': 7000
    },
    incomeBands: [
      { key: 'low', label: '20 万元以下', max: 200000 },
      { key: 'mid', label: '20–50 万元', max: 500000 },
      { key: 'high', label: '50 万元以上', max: Infinity }
    ],
    medicalAgeBands: [
      { key: '<40', label: '40 岁前', min: 0, max: 39 },
      { key: '40-59', label: '40–59 岁', min: 40, max: 59 },
      { key: '60-69', label: '60–69 岁', min: 60, max: 69 },
      { key: '70-79', label: '70–79 岁', min: 70, max: 79 },
      { key: '80+', label: '80 岁及以上', min: 80, max: 200 }
    ],
    /* 演示用年度医疗预算（元/年），按城市档 × 收入档 × 年龄档匹配。
     * 正式上线前必须替换为后台版本化参数，缺失时应显示「待配置」。 */
    medical: {
      '一线': {
        low:  { '<40': 6000,  '40-59': 9000,  '60-69': 15000, '70-79': 23000, '80+': 32000 },
        mid:  { '<40': 9000,  '40-59': 14000, '60-69': 22000, '70-79': 34000, '80+': 48000 },
        high: { '<40': 15000, '40-59': 23000, '60-69': 34000, '70-79': 52000, '80+': 72000 }
      },
      '二线含新一线': {
        low:  { '<40': 4500,  '40-59': 7000,  '60-69': 11000, '70-79': 17000, '80+': 24000 },
        mid:  { '<40': 7000,  '40-59': 11000, '60-69': 17000, '70-79': 26000, '80+': 36000 },
        high: { '<40': 12000, '40-59': 18000, '60-69': 27000, '70-79': 41000, '80+': 57000 }
      },
      '三四线': {
        low:  { '<40': 3500, '40-59': 5500, '60-69': 9000,  '70-79': 14000, '80+': 20000 },
        mid:  { '<40': 5500, '40-59': 9000, '60-69': 14000, '70-79': 21000, '80+': 29000 },
        high: { '<40': 9000, '40-59': 14000, '60-69': 21000, '70-79': 33000, '80+': 46000 }
      }
    },
    stages: [
      { key: '幼儿园', years: 3, grades: ['小班', '中班', '大班'], ageMin: 3, ageMax: 5 },
      { key: '小学', years: 6, grades: ['一年级', '二年级', '三年级', '四年级', '五年级', '六年级'], ageMin: 6, ageMax: 11 },
      { key: '初中', years: 3, grades: ['初一', '初二', '初三'], ageMin: 12, ageMax: 14 },
      { key: '高中', years: 3, grades: ['高一', '高二', '高三'], ageMin: 15, ageMax: 17 },
      { key: '本科', years: 4, grades: ['大一', '大二', '大三', '大四'], ageMin: 18, ageMax: 21 },
      { key: '研究生', years: 2, grades: ['研一', '研二'], ageMin: 22, ageMax: 23 }
    ],
    /* 国内教育综合预算（元/年）：PRD 6.3，单位由万元换算 */
    educationDomestic: {
      '幼儿园': { '一线': 20000, '二线含新一线': 14000, '三四线': 9000 },
      '小学':   { '一线': 45000, '二线含新一线': 31000, '三四线': 20000 },
      '初中':   { '一线': 60000, '二线含新一线': 40000, '三四线': 26000 },
      '高中':   { '一线': 80000, '二线含新一线': 55000, '三四线': 38000 },
      '本科':   { '一线': 35000, '二线含新一线': 35000, '三四线': 35000 },
      '研究生': { '一线': 25000, '二线含新一线': 25000, '三四线': 25000 }
    },
    /* 海外教育预算（元/年）：PRD 6.4 */
    educationOverseas: {
      '高端': { '高中': 500000, '本科': 500000, '研究生': 600000 },
      '大众': { '高中': 280000, '本科': 300000, '研究生': 300000 }
    },
    /* 退休年龄对应计发月数（演示表，取标准表常用档位） */
    contributionMonths: {
      40: 233, 41: 230, 42: 226, 43: 223, 44: 220, 45: 216,
      46: 212, 47: 208, 48: 204, 49: 199, 50: 195, 51: 190,
      52: 185, 53: 180, 54: 175, 55: 170, 56: 164, 57: 158,
      58: 152, 59: 145, 60: 139, 61: 132, 62: 125, 63: 117,
      64: 109, 65: 101, 66: 93, 67: 84, 68: 75, 69: 65, 70: 56
    }
  };

  const PROFILES = [
    {
      id: 'zhangwei',
      name: '张伟',
      gender: '男',
      birthDate: '1985-03-12',
      ageBase: 41,
      baseYear: 2026,
      risk: 'C3 稳健型',
      occupation: '公司职员',
      city: '杭州',
      cityTier: '二线含新一线',
      initialAssets: 1200000,
      note: '双职工家庭，计划 3 年内购房，1 名子女'
    },
    {
      id: 'lina',
      name: '李娜',
      gender: '女',
      birthDate: '1972-08-05',
      ageBase: 54,
      baseYear: 2026,
      risk: 'C2 谨慎型',
      occupation: '个体经营者',
      city: '上海',
      cityTier: '一线',
      initialAssets: 3800000,
      note: '企业主，关注退休安排与教育金'
    },
    {
      id: 'wangqiang',
      name: '王强',
      gender: '男',
      birthDate: '1990-11-20',
      ageBase: 36,
      baseYear: 2026,
      risk: 'C4 成长型',
      occupation: '自由职业者',
      city: '成都',
      cityTier: '二线含新一线',
      initialAssets: 650000,
      note: '自由职业，收入波动较大'
    },
    {
      id: 'chenjianguo',
      name: '陈建国',
      gender: '男',
      birthDate: '1960-02-18',
      ageBase: 66,
      baseYear: 2026,
      risk: 'C2 谨慎型',
      occupation: '已退休',
      city: '苏州',
      cityTier: '二线含新一线',
      initialAssets: 2000000,
      note: '已退休，关注养老金与医疗支出'
    }
  ];

  return { PARAMS, PROFILES };
});
