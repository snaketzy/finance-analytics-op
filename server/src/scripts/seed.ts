import fs from 'node:fs';
import path from 'node:path';
import mysql from 'mysql2/promise';
import { env } from '../env';

/** 仅重灌种子数据（002_seed.sql，幂等） */
async function main() {
  const conn = await mysql.createConnection({
    host: env.mysql.host,
    port: env.mysql.port,
    user: env.mysql.user,
    password: env.mysql.password,
    database: env.mysql.database,
    multipleStatements: true,
  });
  const file = path.resolve(process.cwd(), 'sql/002_seed.sql');
  console.log('▶ 执行 002_seed.sql ...');
  await conn.query(fs.readFileSync(file, 'utf8'));
  console.log('✅ 种子数据已就绪');
  await conn.end();
}

main().catch((e) => {
  console.error('❌ 灌种失败：', e.message);
  process.exit(1);
});
