import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { env } from '../env';

/** 建库 + 建表 + 灌种子（幂等，可反复执行） */
async function main() {
  const conn = await mysql.createConnection({
    host: env.mysql.host,
    port: env.mysql.port,
    user: env.mysql.user,
    password: env.mysql.password,
    multipleStatements: true,
  });

  await conn.query(
    `CREATE DATABASE IF NOT EXISTS \`${env.mysql.database}\`
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
  );
  await conn.changeUser({ database: env.mysql.database });

  const dir = path.resolve(process.cwd(), 'sql');
  for (const f of ['001_schema.sql', '002_seed.sql', '004_p3_usage.sql', '005_p3_metered.sql', '006_cloudflare_billing.sql', '007_payment_imports.sql', '008_suppliers.sql', '009_ref_id_widen.sql', '010_recurring_supplier.sql', '011_unit_economics.sql', '012_products.sql', '013_project_repo.sql', '014_product_econ_variables.sql', '015_product_econ_snapshots.sql', '016_category_note.sql', '017_budget_period_once.sql', '018_cdn_tiered_pricing.sql', '019_cdn_package_pricing.sql', '020_product_thkcos_variables.sql', '021_product_thkcos_package_pricing.sql', '022_product_thkcos_edgeone.sql', '023_product_thkcos_subscription_tiers.sql', '024_video_traffic_bitrates.sql', '025_video_traffic_codec.sql', '026_traffic_per_minute.sql', '027_viewer_segments.sql', '028_thkcos_viewer_tier_rename.sql']) {
    const file = path.join(dir, f);
    if (!fs.existsSync(file)) { console.warn(`跳过（不存在）：${f}`); continue; }
    console.log(`▶ 执行 ${f} ...`);
    await conn.query(fs.readFileSync(file, 'utf8'));
  }

  const [v] = await conn.query<any[]>('SELECT VERSION() AS v');
  const [c] = await conn.query<any[]>('SELECT COUNT(*) AS n FROM transactions');
  const [rc] = await conn.query<any[]>('SELECT COUNT(*) AS n FROM recurring_costs');
  const [bd] = await conn.query<any[]>('SELECT COUNT(*) AS n FROM budgets');
  const [sp] = await conn.query<any[]>('SELECT COUNT(*) AS n FROM suppliers');
  console.log(
    `✅ 完成。MySQL ${v[0].v} · 库 ${env.mysql.database} · 流水 ${c[0].n} 条 · ` +
      `周期成本 ${rc[0].n} 条 · 预算 ${bd[0].n} 条 · 供应商 ${sp[0].n} 个`
  );
  await conn.end();
}

main().catch((e) => {
  console.error('❌ 迁移失败：', e.message);
  process.exit(1);
});
