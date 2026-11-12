-- =============================================================
-- P3 · 供应商 / 交易对手名录（幂等）
-- 供应商与科目为多对多：一个供应商（如 Cloudflare）可同时归属
-- 对象存储 / CDN / 域名 / SSL 等多个科目。
-- =============================================================

SET NAMES utf8mb4;

-- ---------- 供应商主表 ----------
CREATE TABLE IF NOT EXISTS suppliers (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name_cn    VARCHAR(64)  NOT NULL,
  name_en    VARCHAR(64)  NOT NULL,
  kind       ENUM('vendor','customer','both') NOT NULL DEFAULT 'vendor', -- 供应商 / 客户 / 两者
  region     ENUM('cn','global') NOT NULL DEFAULT 'global',              -- 国内 / 海外
  website    VARCHAR(128) NULL,
  contact    VARCHAR(128) NULL,
  note       VARCHAR(255) NULL,
  sort_order INT NOT NULL DEFAULT 0,
  status     TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uk_supplier_cn (name_cn),
  KEY idx_kind (kind, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 供应商 ↔ 科目 关联（多对多）----------
CREATE TABLE IF NOT EXISTS supplier_categories (
  supplier_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  PRIMARY KEY (supplier_id, category_id),
  KEY idx_sc_category (category_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ---------- 常见国内外供应商（幂等：以 name_cn 去重）----------
INSERT IGNORE INTO suppliers (name_cn, name_en, kind, region, website, sort_order) VALUES
  -- 基础设施 · 存储 / CDN / 算力 / 域名 / 证书
  ('Cloudflare',       'Cloudflare',            'vendor',   'global', 'https://www.cloudflare.com',       1),
  ('Backblaze',        'Backblaze',             'vendor',   'global', 'https://www.backblaze.com',        2),
  ('Wasabi',           'Wasabi',                'vendor',   'global', 'https://wasabi.com',               3),
  ('亚马逊云科技',      'Amazon Web Services',   'vendor',   'global', 'https://aws.amazon.com',           4),
  ('阿里云',            'Alibaba Cloud',         'vendor',   'cn',     'https://www.aliyun.com',           5),
  ('腾讯云',            'Tencent Cloud',         'vendor',   'cn',     'https://cloud.tencent.com',        6),
  ('七牛云',            'Qiniu',                 'vendor',   'cn',     'https://www.qiniu.com',            7),
  ('火山引擎',          'Volcano Engine',        'vendor',   'cn',     'https://www.volcengine.com',       8),
  ('Akamai',           'Akamai',                'vendor',   'global', 'https://www.akamai.com',           9),
  ('Fastly',           'Fastly',                'vendor',   'global', 'https://www.fastly.com',          10),
  ('Bunny.net',        'Bunny CDN',             'vendor',   'global', 'https://bunny.net',               11),
  ('网宿科技',          'ChinaNetCenter',        'vendor',   'cn',     'https://www.wangsu.com',          12),
  ('Vultr',            'Vultr',                 'vendor',   'global', 'https://www.vultr.com',           13),
  ('DigitalOcean',     'DigitalOcean',          'vendor',   'global', 'https://www.digitalocean.com',    14),
  ('Hetzner',          'Hetzner',               'vendor',   'global', 'https://www.hetzner.com',         15),
  ('Oracle',           'Oracle Cloud',          'vendor',   'global', 'https://www.oracle.com',          16),
  ('Google',           'Google',                'both',     'global', 'https://cloud.google.com',        17),
  ('Microsoft',        'Microsoft',             'both',     'global', 'https://www.microsoft.com',       18),
  ('PlanetScale',      'PlanetScale',           'vendor',   'global', 'https://planetscale.com',         19),
  ('Supabase',         'Supabase',              'vendor',   'global', 'https://supabase.com',            20),
  ('Aiven',            'Aiven',                 'vendor',   'global', 'https://aiven.io',                21),
  ('GoDaddy',          'GoDaddy',               'vendor',   'global', 'https://www.godaddy.com',         22),
  ('Namecheap',        'Namecheap',             'vendor',   'global', 'https://www.namecheap.com',       23),
  ('Dynadot',          'Dynadot',               'vendor',   'global', 'https://www.dynadot.com',         24),
  ('DigiCert',         'DigiCert',              'vendor',   'global', 'https://www.digicert.com',        25),
  ('Sectigo',          'Sectigo',               'vendor',   'global', 'https://www.sectigo.com',         26),
  ('Let''s Encrypt',   'ISRG / Let''s Encrypt', 'vendor',   'global', 'https://letsencrypt.org',         27),
  -- 算力 · DRM
  ('Axinom',           'Axinom',                'vendor',   'global', 'https://www.axinom.com',          28),
  ('BuyDRM',           'BuyDRM',                'vendor',   'global', 'https://buydrm.com',              29),
  ('Verimatrix',       'Verimatrix',            'vendor',   'global', 'https://www.verimatrix.com',      30),
  ('Irdeto',           'Irdeto',                'vendor',   'global', 'https://www.irdeto.com',          31),
  ('PallyCon',         'PallyCon',              'vendor',   'global', 'https://www.pallycon.com',        32),
  ('Apple',            'Apple',                 'both',     'global', 'https://www.apple.com',           33),
  -- 算力 · AI 推理
  ('OpenAI',           'OpenAI',                'vendor',   'global', 'https://openai.com',              34),
  ('Anthropic',        'Anthropic',             'vendor',   'global', 'https://www.anthropic.com',       35),
  ('深度求索',          'DeepSeek',              'vendor',   'cn',     'https://www.deepseek.com',        36),
  ('月之暗面',          'Moonshot AI',           'vendor',   'cn',     'https://www.moonshot.cn',         37),
  ('智谱',             'Zhipu AI',              'vendor',   'cn',     'https://www.zhipuai.cn',          38),
  ('百度',             'Baidu',                 'both',     'cn',     'https://www.baidu.com',           39),
  -- 内容 · 版权 / 制作 / 修复 / 字幕 / 配音
  ('Netflix',          'Netflix',               'both',     'global', 'https://www.netflix.com',         40),
  ('迪士尼',           'The Walt Disney Company','both',    'global', 'https://www.thewaltdisneycompany.com', 41),
  ('华纳兄弟探索',      'Warner Bros. Discovery', 'both',    'global', 'https://www.wbd.com',             42),
  ('索尼影视',          'Sony Pictures',         'both',    'global', 'https://www.sonypictures.com',    43),
  ('环球影业',          'Universal Pictures',    'both',    'global', 'https://www.universalpictures.com', 44),
  ('亚马逊',           'Amazon',                'both',     'global', 'https://www.amazon.com',          45),
  ('华视网聚',          'China Vision',          'vendor',  'cn',     NULL,                              46),
  ('中影股份',          'China Film',            'both',    'cn',     NULL,                              47),
  ('博纳影业',          'Bona Film Group',       'both',    'cn',     NULL,                              48),
  ('光线传媒',          'Enlight Media',         'both',    'cn',     NULL,                              49),
  ('华策影视',          'Huace Film & TV',       'both',    'cn',     NULL,                              50),
  ('正午阳光',          'Daylight Entertainment','vendor',  'cn',     NULL,                              51),
  ('中国电影资料馆',    'China Film Archive',    'vendor',  'cn',     NULL,                              52),
  ('Iyuno',            'Iyuno',                 'vendor',   'global', 'https://www.iyuno.com',           53),
  ('Pixelogic',        'Pixelogic',             'vendor',   'global', 'https://www.pixelogicmedia.com',  54),
  ('ZOO Digital',      'ZOO Digital',           'vendor',   'global', 'https://www.zoodigital.com',      55),
  ('上海电影译制厂',    'Shanghai Film Dubbing Factory', 'vendor', 'cn', NULL,                            56),
  -- 人力 · 外包 / 顾问 / 招聘
  ('Upwork',           'Upwork',                'vendor',   'global', 'https://www.upwork.com',          57),
  ('Fiverr',           'Fiverr',                'vendor',   'global', 'https://www.fiverr.com',          58),
  ('猪八戒网',          'Zhubajie',              'vendor',   'cn',     'https://www.zbj.com',             59),
  ('普华永道',          'PwC',                   'vendor',   'global', 'https://www.pwc.com',             60),
  ('德勤',             'Deloitte',              'vendor',   'global', 'https://www.deloitte.com',        61),
  ('安永',             'EY',                    'vendor',   'global', 'https://www.ey.com',              62),
  ('毕马威',           'KPMG',                  'vendor',   'global', 'https://kpmg.com',                63),
  ('麦肯锡',           'McKinsey & Company',    'vendor',   'global', 'https://www.mckinsey.com',        64),
  ('BOSS直聘',         'Kanzhun',               'vendor',   'cn',     'https://www.zhipin.com',          65),
  ('猎聘',             'Liepin',                'vendor',   'cn',     'https://www.liepin.com',          66),
  ('智联招聘',          'Zhaopin',               'vendor',   'cn',     'https://www.zhaopin.com',         67),
  ('前程无忧',          '51job',                 'vendor',   'cn',     'https://www.51job.com',           68),
  -- 市场 · 投放 / KOL / SEO
  ('Meta',             'Meta',                  'both',     'global', 'https://www.meta.com',            69),
  ('字节跳动',          'ByteDance',             'both',     'cn',     'https://www.bytedance.com',       70),
  ('TikTok',           'TikTok',                'both',     'global', 'https://www.tiktok.com',          71),
  ('X',                'X (Twitter)',           'both',     'global', 'https://x.com',                   72),
  ('抖音',             'Douyin',                'both',     'cn',     'https://www.douyin.com',          73),
  ('哔哩哔哩',          'Bilibili',              'both',     'cn',     'https://www.bilibili.com',        74),
  ('小红书',           'Xiaohongshu',           'both',     'cn',     'https://www.xiaohongshu.com',     75),
  ('Ahrefs',           'Ahrefs',                'vendor',   'global', 'https://ahrefs.com',              76),
  ('Semrush',          'Semrush',               'vendor',   'global', 'https://www.semrush.com',         77),
  ('Moz',              'Moz',                   'vendor',   'global', 'https://moz.com',                 78),
  -- 平台渠道 · 应用商店 / 支付
  ('华为',             'Huawei',                'both',     'cn',     'https://www.huawei.com',          79),
  ('小米',             'Xiaomi',                'both',     'cn',     'https://www.mi.com',              80),
  ('OPPO',             'OPPO',                  'both',     'cn',     'https://www.oppo.com',            81),
  ('vivo',             'vivo',                  'both',     'cn',     'https://www.vivo.com',            82),
  ('三星',             'Samsung',               'both',     'global', 'https://www.samsung.com',         83),
  ('Stripe',           'Stripe',                'both',     'global', 'https://stripe.com',              84),
  ('PayPal',           'PayPal',                'both',     'global', 'https://www.paypal.com',          85),
  ('Adyen',            'Adyen',                 'both',     'global', 'https://www.adyen.com',           86),
  ('Paddle',           'Paddle',                'both',     'global', 'https://www.paddle.com',          87),
  ('Lemon Squeezy',    'Lemon Squeezy',         'both',     'global', 'https://www.lemonsqueezy.com',    88),
  ('支付宝',           'Alipay',                'both',     'cn',     'https://www.alipay.com',          89),
  ('微信支付',          'WeChat Pay',            'both',     'cn',     'https://pay.weixin.qq.com',       90),
  -- 管理 · 设备 / SaaS / 差旅 / 保险
  ('联想',             'Lenovo',                'vendor',   'cn',     'https://www.lenovo.com',          91),
  ('Dell',             'Dell',                  'vendor',   'global', 'https://www.dell.com',            92),
  ('GitHub',           'GitHub',                'vendor',   'global', 'https://github.com',              93),
  ('Atlassian',        'Atlassian',             'vendor',   'global', 'https://www.atlassian.com',       94),
  ('Slack',            'Slack',                 'vendor',   'global', 'https://slack.com',               95),
  ('Notion',           'Notion',                'vendor',   'global', 'https://www.notion.so',           96),
  ('Figma',            'Figma',                 'vendor',   'global', 'https://www.figma.com',           97),
  ('Adobe',            'Adobe',                 'vendor',   'global', 'https://www.adobe.com',           98),
  ('JetBrains',        'JetBrains',             'vendor',   'global', 'https://www.jetbrains.com',       99),
  ('Sentry',           'Sentry',                'vendor',   'global', 'https://sentry.io',              100),
  ('Vercel',           'Vercel',                'vendor',   'global', 'https://vercel.com',             101),
  ('携程',             'Trip.com',              'vendor',   'cn',     'https://www.ctrip.com',          102),
  ('飞猪',             'Fliggy',                'vendor',   'cn',     'https://www.fliggy.com',         103),
  ('Booking.com',      'Booking.com',           'vendor',   'global', 'https://www.booking.com',        104),
  ('Airbnb',           'Airbnb',                'vendor',   'global', 'https://www.airbnb.com',         105),
  ('中国平安',          'Ping An',               'vendor',   'cn',     'https://www.pingan.com',         106),
  ('中国人保',          'PICC',                  'vendor',   'cn',     'https://www.picc.com',           107),
  -- 收入侧 · 平台 / 版权买家
  ('爱奇艺',           'iQIYI',                 'both',     'cn',     'https://www.iqiyi.com',          108),
  ('优酷',             'Youku',                 'both',     'cn',     'https://www.youku.com',          109),
  ('芒果TV',           'Mango TV',              'both',     'cn',     'https://www.mgtv.com',           110),
  ('招商银行',          'China Merchants Bank',  'both',     'cn',     'https://www.cmbchina.com',       111);

-- ---------- 供应商 ↔ 科目 关联（支出按子科目，收入按领域父级）----------
INSERT IGNORE INTO supplier_categories (supplier_id, category_id)
SELECT s.id, m.category_id
FROM (
  -- 基础设施
  SELECT 'Cloudflare' AS supplier_name, 20101 AS category_id
  UNION ALL SELECT 'Cloudflare', 20102
  UNION ALL SELECT 'Cloudflare', 20105
  UNION ALL SELECT 'Cloudflare', 20106
  UNION ALL SELECT 'Backblaze', 20101
  UNION ALL SELECT 'Wasabi', 20101
  UNION ALL SELECT '亚马逊云科技', 20101
  UNION ALL SELECT '亚马逊云科技', 20103
  UNION ALL SELECT '亚马逊云科技', 20104
  UNION ALL SELECT '亚马逊云科技', 20201
  UNION ALL SELECT '阿里云', 20101
  UNION ALL SELECT '阿里云', 20102
  UNION ALL SELECT '阿里云', 20103
  UNION ALL SELECT '阿里云', 20104
  UNION ALL SELECT '阿里云', 20105
  UNION ALL SELECT '阿里云', 20106
  UNION ALL SELECT '阿里云', 20107
  UNION ALL SELECT '阿里云', 20201
  UNION ALL SELECT '阿里云', 20204
  UNION ALL SELECT '腾讯云', 20101
  UNION ALL SELECT '腾讯云', 20102
  UNION ALL SELECT '腾讯云', 20103
  UNION ALL SELECT '腾讯云', 20104
  UNION ALL SELECT '腾讯云', 20105
  UNION ALL SELECT '腾讯云', 20106
  UNION ALL SELECT '腾讯云', 20107
  UNION ALL SELECT '腾讯云', 20201
  UNION ALL SELECT '七牛云', 20101
  UNION ALL SELECT '七牛云', 20102
  UNION ALL SELECT '火山引擎', 20103
  UNION ALL SELECT '火山引擎', 20104
  UNION ALL SELECT '火山引擎', 20201
  UNION ALL SELECT '火山引擎', 20204
  UNION ALL SELECT 'Akamai', 20102
  UNION ALL SELECT 'Fastly', 20102
  UNION ALL SELECT 'Bunny.net', 20102
  UNION ALL SELECT '网宿科技', 20102
  UNION ALL SELECT 'Vultr', 20103
  UNION ALL SELECT 'Vultr', 20105
  UNION ALL SELECT 'DigitalOcean', 20103
  UNION ALL SELECT 'Hetzner', 20103
  UNION ALL SELECT 'Oracle', 20103
  UNION ALL SELECT 'Oracle', 20104
  UNION ALL SELECT 'Google', 20103
  UNION ALL SELECT 'Google', 20104
  UNION ALL SELECT 'Google', 20202
  UNION ALL SELECT 'Google', 20204
  UNION ALL SELECT 'Microsoft', 20103
  UNION ALL SELECT 'Microsoft', 20104
  UNION ALL SELECT 'PlanetScale', 20104
  UNION ALL SELECT 'Supabase', 20104
  UNION ALL SELECT 'Aiven', 20104
  UNION ALL SELECT 'GoDaddy', 20106
  UNION ALL SELECT 'Namecheap', 20106
  UNION ALL SELECT 'Dynadot', 20106
  UNION ALL SELECT 'DigiCert', 20107
  UNION ALL SELECT 'Sectigo', 20107
  UNION ALL SELECT 'Let''s Encrypt', 20107
  -- 算力 · DRM / AI
  UNION ALL SELECT 'Axinom', 20202
  UNION ALL SELECT 'BuyDRM', 20202
  UNION ALL SELECT 'Verimatrix', 20202
  UNION ALL SELECT 'Irdeto', 20202
  UNION ALL SELECT 'PallyCon', 20202
  UNION ALL SELECT 'Apple', 20202
  UNION ALL SELECT 'OpenAI', 20204
  UNION ALL SELECT 'Anthropic', 20204
  UNION ALL SELECT '深度求索', 20204
  UNION ALL SELECT '月之暗面', 20204
  UNION ALL SELECT '智谱', 20204
  UNION ALL SELECT '百度', 20204
  UNION ALL SELECT '百度', 20501
  -- 内容
  UNION ALL SELECT 'Netflix', 20301
  UNION ALL SELECT 'Netflix', 104
  UNION ALL SELECT '迪士尼', 20301
  UNION ALL SELECT '迪士尼', 104
  UNION ALL SELECT '华纳兄弟探索', 20301
  UNION ALL SELECT '华纳兄弟探索', 104
  UNION ALL SELECT '索尼影视', 20301
  UNION ALL SELECT '索尼影视', 104
  UNION ALL SELECT '环球影业', 20301
  UNION ALL SELECT '环球影业', 104
  UNION ALL SELECT '亚马逊', 104
  UNION ALL SELECT '亚马逊', 20601
  UNION ALL SELECT '华视网聚', 20301
  UNION ALL SELECT '中影股份', 20301
  UNION ALL SELECT '中影股份', 20303
  UNION ALL SELECT '中影股份', 20304
  UNION ALL SELECT '博纳影业', 20301
  UNION ALL SELECT '博纳影业', 20302
  UNION ALL SELECT '光线传媒', 20302
  UNION ALL SELECT '华策影视', 20302
  UNION ALL SELECT '正午阳光', 20302
  UNION ALL SELECT '中国电影资料馆', 20303
  UNION ALL SELECT 'Iyuno', 20304
  UNION ALL SELECT 'Iyuno', 20305
  UNION ALL SELECT 'Pixelogic', 20304
  UNION ALL SELECT 'Pixelogic', 20305
  UNION ALL SELECT 'ZOO Digital', 20304
  UNION ALL SELECT 'ZOO Digital', 20305
  UNION ALL SELECT '上海电影译制厂', 20305
  -- 人力
  UNION ALL SELECT 'Upwork', 20403
  UNION ALL SELECT 'Fiverr', 20403
  UNION ALL SELECT '猪八戒网', 20403
  UNION ALL SELECT '普华永道', 20404
  UNION ALL SELECT '普华永道', 20706
  UNION ALL SELECT '德勤', 20404
  UNION ALL SELECT '德勤', 20706
  UNION ALL SELECT '安永', 20706
  UNION ALL SELECT '毕马威', 20706
  UNION ALL SELECT '麦肯锡', 20404
  UNION ALL SELECT 'BOSS直聘', 20405
  UNION ALL SELECT '猎聘', 20405
  UNION ALL SELECT '智联招聘', 20405
  UNION ALL SELECT '前程无忧', 20405
  -- 市场
  UNION ALL SELECT 'Meta', 20501
  UNION ALL SELECT 'Meta', 103
  UNION ALL SELECT '字节跳动', 20501
  UNION ALL SELECT '字节跳动', 20503
  UNION ALL SELECT '字节跳动', 103
  UNION ALL SELECT 'TikTok', 20501
  UNION ALL SELECT 'X', 20501
  UNION ALL SELECT '抖音', 20503
  UNION ALL SELECT '哔哩哔哩', 20503
  UNION ALL SELECT '小红书', 20503
  UNION ALL SELECT 'Ahrefs', 20506
  UNION ALL SELECT 'Semrush', 20506
  UNION ALL SELECT 'Moz', 20506
  -- 平台渠道
  UNION ALL SELECT '华为', 20601
  UNION ALL SELECT '华为', 20702
  UNION ALL SELECT '小米', 20601
  UNION ALL SELECT '小米', 20702
  UNION ALL SELECT 'OPPO', 20601
  UNION ALL SELECT 'vivo', 20601
  UNION ALL SELECT 'Apple', 20601
  UNION ALL SELECT 'Apple', 20702
  UNION ALL SELECT 'Apple', 101
  UNION ALL SELECT 'Apple', 102
  UNION ALL SELECT 'Apple', 104
  UNION ALL SELECT 'Apple', 107
  UNION ALL SELECT 'Google', 20601
  UNION ALL SELECT 'Google', 101
  UNION ALL SELECT 'Google', 102
  UNION ALL SELECT 'Google', 103
  UNION ALL SELECT 'Google', 107
  UNION ALL SELECT '微软', 20601
  UNION ALL SELECT 'Stripe', 20602
  UNION ALL SELECT 'Stripe', 101
  UNION ALL SELECT 'Stripe', 102
  UNION ALL SELECT 'PayPal', 20602
  UNION ALL SELECT 'PayPal', 101
  UNION ALL SELECT 'PayPal', 102
  UNION ALL SELECT 'Adyen', 20602
  UNION ALL SELECT 'Paddle', 20602
  UNION ALL SELECT 'Lemon Squeezy', 20602
  UNION ALL SELECT '支付宝', 20602
  UNION ALL SELECT '支付宝', 101
  UNION ALL SELECT '微信支付', 20602
  UNION ALL SELECT '微信支付', 101
  -- 管理
  UNION ALL SELECT '联想', 20702
  UNION ALL SELECT 'Dell', 20702
  UNION ALL SELECT 'GitHub', 20703
  UNION ALL SELECT 'Atlassian', 20703
  UNION ALL SELECT 'Slack', 20703
  UNION ALL SELECT 'Notion', 20703
  UNION ALL SELECT 'Figma', 20703
  UNION ALL SELECT 'Adobe', 20703
  UNION ALL SELECT 'JetBrains', 20703
  UNION ALL SELECT 'Sentry', 20703
  UNION ALL SELECT 'Vercel', 20703
  UNION ALL SELECT 'Microsoft', 20703
  UNION ALL SELECT '携程', 20708
  UNION ALL SELECT '飞猪', 20708
  UNION ALL SELECT 'Booking.com', 20708
  UNION ALL SELECT 'Airbnb', 20708
  UNION ALL SELECT '中国平安', 20709
  UNION ALL SELECT '中国人保', 20709
  UNION ALL SELECT '招商银行', 20707
  UNION ALL SELECT '招商银行', 108
  -- 收入侧
  UNION ALL SELECT '爱奇艺', 104
  UNION ALL SELECT '优酷', 104
  UNION ALL SELECT '芒果TV', 104
  UNION ALL SELECT 'Netflix', 101
  UNION ALL SELECT '字节跳动', 107
) m
JOIN suppliers s ON s.name_cn = m.supplier_name;
