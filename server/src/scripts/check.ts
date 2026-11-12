import { pool, type Row } from '../db';
import { env } from '../env';

async function main() {
  const [v] = await pool.query<Row[]>('SELECT VERSION() AS v, DATABASE() AS db');
  console.log(`MySQL ${v[0].v} · 库 ${v[0].db}`);
  const [tables] = await pool.query<Row[]>(
    `SELECT table_name AS name, table_rows AS rowsCnt
       FROM information_schema.tables
      WHERE table_schema = ?
      ORDER BY table_name`,
    [env.mysql.database]
  );
  for (const t of tables) console.log(`  - ${t.name}: ~${t.rowsCnt ?? 0} 行`);
  await pool.end();
}

main().catch((e) => {
  console.error('❌ 检查失败：', e.message);
  process.exit(1);
});
