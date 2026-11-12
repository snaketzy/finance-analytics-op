import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { env } from './env';
import { fail } from './http';
import { startRepoSyncScheduler } from './lib/repoSync';

import projectsRoutes from './routes/projects';
import categoriesRoutes from './routes/categories';
import suppliersRoutes from './routes/suppliers';
import accountsRoutes from './routes/accounts';
import transactionsRoutes from './routes/transactions';
import fxRoutes from './routes/fx';
import dashboardRoutes from './routes/dashboard';
import recurringRoutes from './routes/recurring';
import budgetsRoutes from './routes/budgets';
import analyticsRoutes from './routes/analytics';
import cloudflareBillingRoutes from './routes/cloudflare-billing';
import paymentsRoutes from './routes/payments';
import unitEconomicsRoutes from './routes/unit-economics';
import productsRoutes from './routes/products';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({ logger: { level: 'info' }, bodyLimit: 10 * 1024 * 1024 });
  app.addContentTypeParser('application/pdf', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  await app.register(cors, { origin: env.webOrigin, credentials: true });

  app.get('/api/health', async () => ({ code: 0, message: 'ok', data: { status: 'up' } }));

  await app.register(projectsRoutes, { prefix: '/api/projects' });
  await app.register(categoriesRoutes, { prefix: '/api/categories' });
  await app.register(suppliersRoutes, { prefix: '/api/suppliers' });
  await app.register(accountsRoutes, { prefix: '/api/accounts' });
  await app.register(transactionsRoutes, { prefix: '/api/transactions' });
  await app.register(fxRoutes, { prefix: '/api/fx' });
  await app.register(dashboardRoutes, { prefix: '/api/dashboard' });
  await app.register(recurringRoutes, { prefix: '/api/recurring-costs' });
  await app.register(budgetsRoutes, { prefix: '/api/budgets' });
  await app.register(analyticsRoutes, { prefix: '/api/analytics' });
  await app.register(cloudflareBillingRoutes, { prefix: '/api/cloudflare-billing' });
  await app.register(paymentsRoutes, { prefix: '/api/payments' });
  await app.register(unitEconomicsRoutes, { prefix: '/api/unit-economics' });
  await app.register(productsRoutes, { prefix: '/api/products' });

  startRepoSyncScheduler();

  app.setErrorHandler((err, _req, reply) => {
    app.log.error(err);
    const e = err as { statusCode?: number; message?: string };
    const status = e.statusCode && e.statusCode >= 400 ? e.statusCode : 500;
    reply.status(status).send(fail(status, e.message ?? 'internal error'));
  });

  app.setNotFoundHandler((_req, reply) => {
    reply.status(404).send(fail(404, 'route not found'));
  });

  return app;
}
