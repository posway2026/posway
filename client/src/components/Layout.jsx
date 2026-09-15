import React, { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

const links = [
  { to: '/', label: '📊 Bosh sahifa', end: true },
  { to: '/sotuv', label: '🛒 Sotuv (kassa)' },
  { to: '/mahsulotlar', label: '📦 Mahsulotlar' },
  { to: '/kassa-harakatlari', label: '💸 Kassa harakati' },
  { to: '/mijozlar', label: '👥 Mijozlar / Qarz' },
  { to: '/taminotchilar', label: "🏭 Ta'minotchilarga qarzim" },
  { to: '/harakatlar-tarixi', label: '🕘 Harakatlar tarixi' },
  { to: '/kassa-yopish', label: '🔒 Kunlik kassa yopish' },
  { to: '/hisobotlar', label: '📈 Hisobotlar' },
  { to: '/xodimlar', label: '🧑‍💼 Xodimlar', adminOnly: true },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const sidebarRef = useRef(null);
  const toggleRef = useRef(null);
  const touchStartX = useRef(null);

  // (15) Mobilda sidebar ochiq bo'lganda tashqariga bosilsa yopilishi.
  // Toggle tugmasi alohida tekshiriladi — aks holda tugma bosilganda
  // sidebar bir zumda ochilib, darhol yana yopilib qolardi.
  useEffect(() => {
    function handleOutside(e) {
      if (!open) return;
      if (sidebarRef.current && sidebarRef.current.contains(e.target)) return;
      if (toggleRef.current && toggleRef.current.contains(e.target)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('touchstart', handleOutside);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('touchstart', handleOutside);
    };
  }, [open]);

  // (15) Sidebar ochiq bo'lganda chapga svayp qilinsa yopilishi.
  function handleTouchStart(e) {
    touchStartX.current = e.touches[0].clientX;
  }
  function handleTouchEnd(e) {
    if (touchStartX.current == null) return;
    const deltaX = e.changedTouches[0].clientX - touchStartX.current;
    if (deltaX < -50) setOpen(false);
    touchStartX.current = null;
  }

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="app-layout">
      {open && <div className="sidebar-overlay" onClick={() => setOpen(false)} />}
      <div
        className={`sidebar ${open ? 'open' : ''}`}
        ref={sidebarRef}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        <div className="sidebar-brand">
          Posway
          <span>{user?.full_name}</span>
        </div>
        {links.map((l) => {
          if (l.adminOnly && user?.role !== 'admin') return null;
          return (
            <NavLink
              key={l.to}
              to={l.to}
              end={l.end}
              className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}
              onClick={() => setOpen(false)}
            >
              {l.label}
            </NavLink>
          );
        })}
        <button className="nav-link" style={{ width: '100%', border: 'none', marginTop: 20, background: 'transparent' }} onClick={handleLogout}>
          🚪 Chiqish
        </button>
      </div>
      <div className="main-content">
        <div className="mobile-toggle" style={{ marginBottom: 16 }} ref={toggleRef}>
          <button className="btn secondary" onClick={() => setOpen(!open)}>☰ Menyu</button>
        </div>
        <Outlet />
      </div>
    </div>
  );
}
