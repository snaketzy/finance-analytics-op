-- =============================================================
-- FBAP · 种子数据（幂等）
-- =============================================================
SET NAMES utf8mb4;

-- ---------- 项目 ----------
INSERT IGNORE INTO projects (id, code, name_cn, name_en, status, launch_date, sort_order) VALUES
  (1, 'vidday',   'Vidday 流媒体', 'Vidday',          'active', '2025-06-01', 1),
  (2, 'moive-db', '影库管理',       'Movie Database',  'active', '2025-09-01', 2),
  (3, 'isee',     'iSee 视频',      'iSee Videos',     'active', '2025-03-01', 3);

-- ---------- 资金账户 ----------
INSERT IGNORE INTO accounts (id, name_cn, name_en, type, currency, opening_balance_cny, sort_order) VALUES
  (1, '现金',        'Cash',         'cash',     'CNY', 0, 1),
  (2, '招商银行',    'CMB Bank',     'bank',     'CNY', 0, 2),
  (3, 'Stripe 余额', 'Stripe Balance','platform','USD', 0, 3),
  (4, '支付宝',      'Alipay',       'platform', 'CNY', 0, 4);

-- ---------- 汇率快照（1 USD = ? CNY）----------
INSERT INTO fx_rates (rate_date, base_ccy, quote_ccy, rate, source) VALUES
  ('2026-06-30', 'CNY', 'USD', 7.18000000, 'manual'),
  ('2026-07-31', 'CNY', 'USD', 7.15500000, 'manual'),
  ('2026-08-31', 'CNY', 'USD', 7.12000000, 'manual'),
  ('2026-09-30', 'CNY', 'USD', 7.09000000, 'manual'),
  ('2026-10-31', 'CNY', 'USD', 7.08000000, 'manual'),
  ('2026-11-08', 'CNY', 'USD', 7.10000000, 'manual')
ON DUPLICATE KEY UPDATE rate = VALUES(rate), source = VALUES(source);

-- ---------- 收支科目（树形 + 领域）----------
INSERT IGNORE INTO categories (id, parent_id, name_cn, name_en, type, domain, is_recurring, is_cogs, sort_order) VALUES
  -- ===== 收入 · 领域（父）=====
  (101, NULL, '订阅收入',   'Subscription',     'income', 'subscription',  0, 0, 101),
  (102, NULL, '点播收入',   'Transactional',    'income', 'transactional', 0, 0, 102),
  (103, NULL, '广告收入',   'Advertising',      'income', 'advertising',   0, 0, 103),
  (104, NULL, '版权分发',   'Licensing',        'income', 'licensing',     0, 0, 104),
  (105, NULL, '增值周边',   'Value-added',      'income', 'valueadd',      0, 0, 105),
  (106, NULL, '赞助',       'Sponsorship',      'income', 'sponsorship',   0, 0, 106),
  (107, NULL, '平台激励',   'Platform Incentive','income','incentive',     0, 0, 107),
  (108, NULL, '金融收益',   'Financial',        'income', 'financial',     0, 0, 108),
  (109, NULL, '其他收入',   'Other Income',     'income', 'other',         0, 0, 109),
  -- ===== 收入 · 子项 =====
  (10101, 101, '月度订阅',  'Monthly Subscription',  'income','subscription',1,0,1),
  (10102, 101, '季度订阅',  'Quarterly Subscription','income','subscription',1,0,2),
  (10103, 101, '年度订阅',  'Yearly Subscription',   'income','subscription',1,0,3),
  (10104, 101, '自动续费',  'Auto Renewal',          'income','subscription',1,0,4),
  (10201, 102, '单片付费',  'TVOD Rental',           'income','transactional',0,0,1),
  (10202, 102, '下载付费',  'Download Purchase',     'income','transactional',0,0,2),
  (10203, 102, '解锁剧集',  'Episode Unlock',        'income','transactional',0,0,3),
  (10301, 103, '贴片广告',  'Pre-roll Ad',           'income','advertising',0,0,1),
  (10302, 103, '展示广告',  'Display Ad',            'income','advertising',0,0,2),
  (10303, 103, '品牌定制',  'Branded Content',       'income','advertising',0,0,3),
  (10304, 103, '激励视频',  'Rewarded Video',        'income','advertising',0,0,4),
  (10401, 104, '版权授权',  'Licensing Fee',         'income','licensing',0,0,1),
  (10402, 104, '渠道分成',  'Distribution Share',    'income','licensing',0,0,2),
  (10403, 104, '海外发行',  'Overseas Distribution', 'income','licensing',0,0,3),
  (10404, 104, '二次分销',  'Sub-licensing',         'income','licensing',0,0,4),
  (10501, 105, '数字商品',  'Digital Goods',         'income','valueadd',0,0,1),
  (10502, 105, '实体周边',  'Merchandise',           'income','valueadd',0,0,2),
  (10503, 105, '打赏',      'Tipping',               'income','valueadd',0,0,3),
  (10504, 105, '会员礼包',  'Membership Bundle',     'income','valueadd',0,0,4),
  (10601, 106, '冠名',      'Title Sponsorship',     'income','sponsorship',0,0,1),
  (10602, 106, '项目赞助',  'Project Sponsorship',   'income','sponsorship',0,0,2),
  (10603, 106, '联合出品',  'Co-production',         'income','sponsorship',0,0,3),
  (10701, 107, '平台补贴',  'Platform Subsidy',      'income','incentive',0,0,1),
  (10702, 107, '创作者激励','Creator Incentive',     'income','incentive',0,0,2),
  (10703, 107, '扶持基金',  'Support Fund',          'income','incentive',0,0,3),
  (10801, 108, '利息',      'Interest',              'income','financial',0,0,1),
  (10802, 108, '理财收益',  'Investment Income',     'income','financial',0,0,2),
  (10803, 108, '汇兑收益',  'FX Gain',               'income','financial',0,0,3),
  (10901, 109, '政府补贴',  'Government Grant',      'income','other',0,0,1),
  (10902, 109, '退款冲减',  'Refund Offset',         'income','other',0,0,2),
  (10903, 109, '杂项收入',  'Miscellaneous Income',  'income','other',0,0,3),
  -- ===== 支出 · 领域（父）=====
  (201, NULL, '基础设施',   'Infrastructure',   'expense', 'infra',     0, 1, 201),
  (202, NULL, '算力',       'Compute',          'expense', 'compute',   0, 1, 202),
  (203, NULL, '内容',       'Content',          'expense', 'content',   0, 1, 203),
  (204, NULL, '人力',       'People',           'expense', 'people',    0, 0, 204),
  (205, NULL, '市场',       'Marketing',        'expense', 'marketing', 0, 0, 205),
  (206, NULL, '平台渠道',   'Platform Channel', 'expense', 'channel',   0, 1, 206),
  (207, NULL, '管理',       'G&A',              'expense', 'ops',       0, 0, 207),
  (208, NULL, '其他支出',   'Other Expense',    'expense', 'other',     0, 0, 208),
  -- ===== 支出 · 子项 =====
  (20101, 201, '对象存储 (R2)', 'Object Storage (R2)', 'expense','infra',1,1,1),
  (20102, 201, 'CDN 出流量',    'CDN Egress',          'expense','infra',0,1,2),
  (20103, 201, '云主机/计算',   'Cloud Compute',       'expense','infra',1,1,3),
  (20104, 201, '数据库',        'Database',            'expense','infra',1,1,4),
  (20105, 201, '带宽',          'Bandwidth',           'expense','infra',0,1,5),
  (20106, 201, '域名',          'Domain',              'expense','infra',1,1,6),
  (20107, 201, 'SSL 证书',      'SSL Certificate',     'expense','infra',0,1,7),
  (20201, 202, '转码/编码',     'Transcoding',         'expense','compute',0,1,1),
  (20202, 202, 'DRM 授权',      'DRM Licensing',       'expense','compute',1,1,2),
  (20203, 202, 'P2P 节点',      'P2P Nodes',           'expense','compute',0,1,3),
  (20204, 202, 'AI 推理',       'AI Inference',        'expense','compute',0,1,4),
  (20301, 203, '版权采购',      'Content Licensing',   'expense','content',0,1,1),
  (20302, 203, '内容制作',      'Content Production',  'expense','content',0,1,2),
  (20303, 203, '修复转制',      'Restoration',         'expense','content',0,1,3),
  (20304, 203, '字幕 (PGS)',    'Subtitles (PGS)',     'expense','content',0,1,4),
  (20305, 203, '配音配乐',      'Dubbing & Music',     'expense','content',0,1,5),
  (20401, 204, '全职薪资',      'Full-time Salary',    'expense','people',1,0,1),
  (20402, 204, '社保公积金',    'Social Insurance',    'expense','people',1,0,2),
  (20403, 204, '外包/自由职业', 'Outsourcing',         'expense','people',0,0,3),
  (20404, 204, '顾问',          'Consultant',          'expense','people',0,0,4),
  (20405, 204, '招聘',          'Recruiting',          'expense','people',0,0,5),
  (20501, 205, '广告投放',      'Paid Ads',            'expense','marketing',0,0,1),
  (20502, 205, 'Affiliate 佣金','Affiliate Commission','expense','marketing',0,0,2),
  (20503, 205, 'KOL/达人',      'KOL',                 'expense','marketing',0,0,3),
  (20504, 205, 'ASO',           'ASO',                 'expense','marketing',0,0,4),
  (20505, 205, '活动',          'Events',              'expense','marketing',0,0,5),
  (20506, 205, 'SEO',           'SEO',                 'expense','marketing',0,0,6),
  (20601, 206, '应用商店分成',  'App Store Fee',       'expense','channel',0,1,1),
  (20602, 206, '支付手续费',    'Payment Fee',         'expense','channel',0,1,2),
  (20603, 206, '发行分成',      'Publisher Share',     'expense','channel',0,1,3),
  (20701, 207, '办公',          'Office',              'expense','ops',0,0,1),
  (20702, 207, '设备与折旧',    'Equipment & Depr.',   'expense','ops',0,0,2),
  (20703, 207, '软件订阅 (SaaS)','Software Subscription','expense','ops',1,0,3),
  (20704, 207, '法务',          'Legal',               'expense','ops',0,0,4),
  (20705, 207, '税务',          'Tax',                 'expense','ops',0,0,5),
  (20706, 207, '审计',          'Audit',               'expense','ops',0,0,6),
  (20707, 207, '财务费用',      'Finance Cost',        'expense','ops',0,0,7),
  (20708, 207, '差旅',          'Travel',              'expense','ops',0,0,8),
  (20709, 207, '保险',          'Insurance',           'expense','ops',0,0,9),
  (20801, 208, '杂项',          'Miscellaneous',       'expense','other',0,0,1),
  (20802, 208, '坏账',          'Bad Debt',            'expense','other',0,0,2),
  (20803, 208, '罚款',          'Penalty',             'expense','other',0,0,3);

-- ---------- 示例流水 ----------
-- 已移除种子 mock 流水：台账只保留真实录入 / 周期成本生成的流水，不再自动灌入示例数据。
