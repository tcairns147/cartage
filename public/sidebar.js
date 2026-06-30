function renderSidebar(active) {
  const nav = [
    { id: 'dispatcher', icon: '🚛', label: 'Active Jobs',  href: '/dispatcher' },
    { id: 'history',    icon: '📋', label: 'Job History',  href: '/history' },
    { id: 'drivers',    icon: '👤', label: 'Drivers',      href: '/drivers' },
    { id: 'clients',    icon: '🤝', label: 'Clients',      href: '/clients' },
    { id: 'locations',  icon: '📍', label: 'Locations',    href: '/locations' },
    { id: 'new',        icon: '＋', label: 'New Job',      href: '/' },
  ];

  return `
    <aside class="sidebar">
      <div class="sidebar-logo">DROVA</div>
      <nav class="sidebar-nav">
        ${nav.map(n => `
          <a class="nav-item${active === n.id ? ' active' : ''}" href="${n.href}">
            <span class="nav-icon">${n.icon}</span>${n.label}
          </a>`).join('')}
      </nav>
      <div class="sidebar-user">
        <div class="user-avatar">D</div>
        <div>
          <div class="user-name">Dispatcher</div>
          <div class="user-role">Drova Demo</div>
        </div>
      </div>
    </aside>`;
}

const SIDEBAR_CSS = `
  .sidebar {
    width: 220px; background: #1a1a1a; min-height: 100vh;
    display: flex; flex-direction: column; flex-shrink: 0;
    position: fixed; top: 0; left: 0; bottom: 0; z-index: 100;
  }
  .sidebar-logo {
    padding: 28px 24px 24px; font-size: 26px; font-weight: 900;
    color: white; letter-spacing: -1px; border-bottom: 1px solid #2a2a2a;
  }
  .sidebar-nav { padding: 16px 0; flex: 1; }
  .nav-item {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 24px; font-size: 14px; color: #888;
    text-decoration: none; transition: background 0.15s, color 0.15s;
  }
  .nav-item:hover { background: #242424; color: #ccc; }
  .nav-item.active { background: #242424; color: #f59e0b; }
  .nav-icon { font-size: 16px; width: 20px; text-align: center; }
  .sidebar-user {
    padding: 16px 24px; border-top: 1px solid #2a2a2a;
    display: flex; align-items: center; gap: 10px;
  }
  .user-avatar {
    width: 36px; height: 36px; border-radius: 50%; background: #f59e0b;
    display: flex; align-items: center; justify-content: center;
    font-size: 13px; font-weight: 700; color: #1a1a1a; flex-shrink: 0;
  }
  .user-name { font-size: 13px; font-weight: 600; color: white; }
  .user-role { font-size: 11px; color: #666; }
  @media (max-width: 768px) { .sidebar { display: none; } }
`;
