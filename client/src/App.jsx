import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Products from './pages/Products.jsx';
import Pos from './pages/Pos.jsx';
import CashMovements from './pages/CashMovements.jsx';
import Customers from './pages/Customers.jsx';
import SupplierDebts from './pages/SupplierDebts.jsx';
import StockMovements from './pages/StockMovements.jsx';
import CashClose from './pages/CashClose.jsx';
import Reports from './pages/Reports.jsx';
import Users from './pages/Users.jsx';

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

function AdminRoute({ children }) {
  const { user } = useAuth();
  if (!user || user.role !== 'admin') return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  return (
    <AuthProvider>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/"
          element={
            <ProtectedRoute>
              <Layout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route path="sotuv" element={<Pos />} />
          <Route path="mahsulotlar" element={<Products />} />
          <Route path="kassa-harakatlari" element={<CashMovements />} />
          <Route path="mijozlar" element={<Customers />} />
          <Route path="taminotchilar" element={<SupplierDebts />} />
          <Route path="harakatlar-tarixi" element={<StockMovements />} />
          <Route path="kassa-yopish" element={<CashClose />} />
          <Route path="hisobotlar" element={<Reports />} />
          <Route
            path="xodimlar"
            element={
              <AdminRoute>
                <Users />
              </AdminRoute>
            }
          />
        </Route>
      </Routes>
    </AuthProvider>
  );
}
