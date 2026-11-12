import { buildApp } from './app';
import { env } from './env';
import { pool } from './db';
import { startDailyFxSync } from './lib/fxSource';

async function main() {
  const app = await buildApp();

  // 启动前探活数据库
  try {
    await pool.query('SELECT 1');
  } catch (e) {
    app.log.error({ err: e }, '数据库连接失败，请检查 server/.env 配置');
    process.exit(1);
  }

  await app.listen({ port: env.port, host: '0.0.0.0' });
  app.log.info(`FBAP API 已启动：http://localhost:${env.port}/api/health`);

  // 每日 01:30 自动同步线上汇率
  startDailyFxSync();
  app.log.info('汇率每日定时同步已启用（01:30）');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
