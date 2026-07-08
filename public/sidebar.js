const ICONS = {
  truck: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M1 3h15v13H1z"/><path d="M16 8h4l3 3v5h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/></svg>`,
  trucklist: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="3" width="15" height="13" rx="1"/><path d="M16 8h4l3 5v3h-7V8z"/><circle cx="5.5" cy="18.5" r="2.5"/><circle cx="18.5" cy="18.5" r="2.5"/><line x1="5" y1="8" x2="11" y2="8"/><line x1="5" y1="11" x2="9" y2="11"/></svg>`,
  clipboard: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="8" y="2" width="8" height="4" rx="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M9 12h6M9 16h4"/></svg>`,
  user: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="8" r="4"/><path d="M4 20c0-4 3.6-7 8-7s8 3 8 7"/></svg>`,
  users: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="9" cy="7" r="4"/><path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/><path d="M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.85"/></svg>`,
  mappin: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a7 7 0 0 1 7 7c0 5-7 13-7 13S5 14 5 9a7 7 0 0 1 7-7z"/><circle cx="12" cy="9" r="2.5"/></svg>`,
  plus: `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>`,
  package: `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16.5 9.4 7.55 4.24"/><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/><polyline points="3.29 7 12 12 20.71 7"/><line x1="12" y1="22" x2="12" y2="12"/></svg>`,
};

async function loadCompanyName() {
  try {
    const res = await fetch('/api/me');
    if (!res.ok) return;
    const { name, logoUrl } = await res.json();
    const nameEl = document.getElementById('sidebar-company-name');
    const roleEl = document.getElementById('sidebar-company-role');
    const avatarEl = document.getElementById('sidebar-avatar');
    if (nameEl) nameEl.textContent = name;
    if (roleEl) roleEl.textContent = 'Dispatcher';
    if (avatarEl) avatarEl.textContent = name.charAt(0).toUpperCase();
    if (logoUrl) {
      const logoEl = document.getElementById('sidebar-client-logo');
      if (logoEl) { logoEl.src = logoUrl; logoEl.style.display = 'block'; }
      const mobileEl = document.getElementById('mobile-client-logo');
      if (mobileEl) { mobileEl.src = logoUrl; mobileEl.style.display = 'block'; mobileEl.onerror = () => { mobileEl.style.display = 'none'; }; }
    }
  } catch {}
}

function renderSidebar(active) {
  const nav = [
    { id: 'dispatcher', icon: ICONS.truck,     label: 'Active Jobs',  href: '/dispatcher' },
    { id: 'history',    icon: ICONS.clipboard,  label: 'History',      href: '/history' },
    { id: 'new',        icon: ICONS.plus,       label: 'New Job',      href: '/' },
    { id: 'drivers',    icon: ICONS.user,       label: 'Drivers',      href: '/drivers' },
    { id: 'locations',  icon: ICONS.mappin,     label: 'Locations',    href: '/locations' },
  ];

  const allNav = [
    ...nav,
    { id: 'clients',    icon: ICONS.users,      label: 'Clients',      href: '/clients' },
    { id: 'trial',      icon: ICONS.package,    label: 'Trial',        href: '/trial' },
  ];

  setTimeout(loadCompanyName, 0);
  return `
    <div class="mobile-topbar">
      <img src="/logo.svg" alt="Drova" class="mobile-topbar-logo">
      <img id="mobile-client-logo" src="" alt="" style="display:none; max-height:36px; max-width:160px; object-fit:contain; mix-blend-mode:lighten;">
    </div>
    <aside class="sidebar">
      <div class="sidebar-logo"><img src="/logo.svg" alt="Drova"></div>
      <div id="sidebar-client-logo-wrap" style="padding: 14px 16px; border-bottom: 1px solid #2a2a2a; display: flex; align-items: center; justify-content: center;">
        <img id="sidebar-client-logo" src="" alt="" style="display:none; width:100%; max-height:56px; object-fit:contain; mix-blend-mode:lighten;">
      </div>
      <nav class="sidebar-nav">
        ${allNav.map(n => `
          <a class="nav-item${active === n.id ? ' active' : ''}" href="${n.href}">
            <span class="nav-icon">${n.icon}</span>${n.label}
          </a>`).join('')}
      </nav>
      <div class="sidebar-user">
        <div class="user-avatar" id="sidebar-avatar">D</div>
        <div style="flex:1;min-width:0;">
          <div class="user-name" id="sidebar-company-name">Loading...</div>
          <div class="user-role" id="sidebar-company-role">Dispatcher</div>
        </div>
        <form method="POST" action="/logout" style="margin:0;">
          <button type="submit" title="Sign out" style="background:none;border:none;cursor:pointer;color:#555;display:flex;align-items:center;padding:4px;">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
          </button>
        </form>
      </div>
    </aside>
    <nav class="bottom-nav">
      ${nav.map(n => `
        <a class="bottom-nav-item${active === n.id ? ' active' : ''}" href="${n.href}">
          <span class="bottom-nav-icon">${n.icon}</span>
          <span class="bottom-nav-label">${n.label}</span>
        </a>`).join('')}
    </nav>`;
}

const SIDEBAR_CSS = `
  .sidebar {
    width: 220px; background: #1a1a1a; min-height: 100vh;
    display: flex; flex-direction: column; flex-shrink: 0;
    position: fixed; top: 0; left: 0; bottom: 0; z-index: 100;
    overflow-y: auto;
  }
  .sidebar-logo {
    padding: 22px 16px; border-bottom: 1px solid #2a2a2a;
  }
  .sidebar-logo img {
    height: 52px; display: block; filter: brightness(0) invert(1); width: 100%; object-fit: contain; object-position: left;
  }
  .sidebar-nav { padding: 16px 0; flex: 1; }
  .nav-item {
    display: flex; align-items: center; gap: 12px;
    padding: 12px 24px; font-size: 14px; color: #666;
    text-decoration: none; transition: background 0.15s, color 0.15s;
  }
  .nav-item:hover { background: #242424; color: #ccc; }
  .nav-item.active { background: #242424; color: #f59e0b; }
  .nav-icon { width: 20px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .nav-icon svg { display: block; }
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
  .user-role { font-size: 11px; color: #555; }
  .mobile-topbar { display: none; }
  .bottom-nav { display: none; }
  @media (max-width: 768px) {
    .sidebar { display: none; }
    .mobile-topbar {
      display: flex; align-items: center; justify-content: space-between;
      background: #1a1a1a; padding: 10px 16px;
      border-bottom: 1px solid #2a2a2a;
      position: fixed; top: 0; left: 0; right: 0; z-index: 500;
      padding-left: max(env(safe-area-inset-left), 16px);
      padding-right: max(env(safe-area-inset-right), 16px);
      isolation: isolate;
    }
    .mobile-topbar-logo { height: 28px; filter: brightness(0) invert(1); }
    .main { padding-top: 50px; }
    .bottom-nav {
      display: flex; position: fixed; bottom: 0; left: 0; right: 0;
      background: #1a1a1a; border-top: 1px solid #2a2a2a;
      z-index: 10000;
      padding-bottom: env(safe-area-inset-bottom);
      padding-left: max(env(safe-area-inset-left), 12px);
      padding-right: max(env(safe-area-inset-right), 12px);
    }
    .bottom-nav-item {
      flex: 1; display: flex; flex-direction: column; align-items: center;
      justify-content: center; padding: 10px 8px 8px; gap: 4px;
      text-decoration: none; color: #555; transition: color 0.15s;
      min-width: 0;
    }
    .bottom-nav-item.active { color: #f59e0b; }
    .bottom-nav-item:hover { color: #ccc; }
    .bottom-nav-icon { display: flex; }
    .bottom-nav-icon svg { width: 22px; height: 22px; }
    .bottom-nav-label { font-size: 10px; font-weight: 600; }
    .bottom-nav-item.active .bottom-nav-icon svg { stroke: #f59e0b; }
  }
`;
