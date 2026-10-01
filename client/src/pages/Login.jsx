import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../AuthContext.jsx';

export default function Login() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  // (2026-10-01) api.js endi 401 (token muddati tugagan) holatini shu
  // yerga, bitta belgi orqali xabar beradi — shunda foydalanuvchi nega
  // birdan login sahifasiga tushib qolganini tushunadi.
  useEffect(() => {
    if (sessionStorage.getItem('posway_session_expired')) {
      setError('Sessiya muddati tugagan — qaytadan tizimga kiring');
      sessionStorage.removeItem('posway_session_expired');
    }
  }, []);

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      navigate('/');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-split">
      <div className="login-panel">
        <div className="login-panel__brand">
          <img src="/icon-192.png" alt="Posway" />
          Posway
        </div>
        <div className="login-panel__logo-strip">
          <img src="/logo-wordmark.png" alt="Posway" />
        </div>
        <div className="login-panel__tagline">
          <h2>Biznesingizni bir joydan boshqaring</h2>
          <p>Sotuvlar, mahsulotlar, mijozlar va hisobotlar — barchasi bitta tizimda.</p>
        </div>
        <div />
      </div>
      <div className="login-form-side">
        <form className="login-box" onSubmit={handleSubmit}>
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--accent)' }}>Posway</div>
          <div style={{ color: 'var(--text-dim)', fontSize: 13 }}>Do'kon boshqaruv tizimi</div>
        </div>
        {error && (
          <div style={{ background: 'rgba(239,68,68,0.15)', color: 'var(--red)', padding: 10, borderRadius: 8, marginBottom: 14, fontSize: 14 }}>
            {error}
          </div>
        )}
        <div className="form-row">
          <label>Login</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" required />
        </div>
        <div className="form-row">
          <label>Parol</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" required />
        </div>
        <button className="btn" style={{ width: '100%' }} disabled={loading}>
          {loading ? 'Kirilmoqda...' : 'Kirish'}
        </button>
        <div style={{ marginTop: 16, fontSize: 12, color: 'var(--text-dim)', textAlign: 'center' }}>
          Boshlang'ich: admin / admin123
        </div>
        </form>
      </div>
    </div>
  );
}
