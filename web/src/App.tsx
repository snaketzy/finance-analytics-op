import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from './layout/AppLayout';
import Dashboard from './pages/Dashboard';
import Ledger from './pages/Ledger';
import Categories from './pages/Categories';
import Suppliers from './pages/Suppliers';
import Accounts from './pages/Accounts';
import Fx from './pages/Fx';
import Recurring from './pages/Recurring';
import Budgets from './pages/Budgets';
import { AnalyticsView } from './pages/Analytics';
import CloudflareBilling from './pages/CloudflareBilling';
import Payments from './pages/Payments';
import Projects from './pages/Projects';
import Products from './pages/Products';
import UnitEconomics from './pages/UnitEconomics';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="ledger" element={<Ledger />} />
        <Route path="recurring" element={<Recurring />} />
        <Route path="cloudflare-billing" element={<CloudflareBilling />} />
        <Route path="payments" element={<Payments />} />
        <Route path="budgets" element={<Budgets />} />
        <Route path="projects" element={<Projects />} />
        <Route path="products" element={<Products />} />
        <Route path="unit-economics" element={<UnitEconomics />} />
        <Route path="cost" element={<AnalyticsView direction="expense" />} />
        <Route path="revenue" element={<AnalyticsView direction="income" />} />
        <Route path="categories" element={<Categories />} />
        <Route path="suppliers" element={<Suppliers />} />
        <Route path="accounts" element={<Accounts />} />
        <Route path="fx" element={<Fx />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
