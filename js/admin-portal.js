/* =============================================================
   樂活管理後台 · admin-portal.js
   -------------------------------------------------------------
   依賴 (HTML 中需先載入):
   - LohasUtils    (utils.js)
   - LohasAuth     (auth.js)
   - LohasSupabase (supabase.js)
   - window.supabase (Supabase JS SDK from CDN)
   ============================================================= */

(function (window) {
  'use strict';

  const Utils = window.LohasUtils;
  const Auth = window.LohasAuth;
  const Supabase = window.LohasSupabase;

  if (!Utils || !Auth || !Supabase) {
    console.error('[admin-portal] 缺少依賴,請先載入 utils.js / auth.js / supabase.js');
    return;
  }

  const root = document.getElementById('ad');
  if (!root) return;


  /* =============================================================
     全域 State
     ============================================================= */

  const State = {
    member: null,        // 當前登入會員 (從 Auth.getStoredMember())
    isAdmin: false,      // 是否為 admin
    adminInfo: null,     // admins table 紀錄
    users: [],           // 會員列表 (cache)
    creatorIds: new Set(),    // 是 Creator 的 erpid set
    suspendedIds: new Set(),  // 被停權的 erpid set
    adminIds: new Set()       // 是 Admin 的 erpid set
  };

  function getSb() {
    if (!Supabase || !Supabase.getClient) return null;
    return Supabase.getClient();
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }


  /* =============================================================
     1. Admin 身份檢查
     ============================================================= */

  async function verifyAdmin() {
    const member = Auth.getStoredMember();

    if (!member || !member.erpid) {
      // 沒登入 → 導 login
      Auth.requireLogin('admin-portal.html');
      return false;
    }

    // 強制把 erpid 轉成字串
    // (ERP API 可能回 number, 但 Supabase 的 member_id 欄位是 TEXT 型別)
    member.erpid = String(member.erpid);

    State.member = member;

    // 查 Supabase admins table
    const sb = getSb();
    if (!sb) {
      alert('Supabase 設定錯誤,無法驗證 admin 身份');
      return false;
    }

    try {
      const { data, error } = await sb
        .from('admins')
        .select('member_id, display_name, role, status')
        .eq('member_id', member.erpid)
        .eq('status', 'active')
        .maybeSingle();

      if (error) {
        console.error('[admin 身份查詢失敗]', error);
        alert('admin 身份驗證失敗');
        return false;
      }

      if (!data) {
        // 不是 admin → 導回會員平台
        alert('您沒有後台管理權限,即將返回會員中心');
        window.location.href = 'member-portal.html';
        return false;
      }

      State.isAdmin = true;
      State.adminInfo = data;
      return true;

    } catch (err) {
      console.error('[verifyAdmin 例外]', err);
      alert('身份驗證過程出錯');
      return false;
    }
  }

  function applyAdminUI() {
    const m = State.member;
    const ai = State.adminInfo;

    // sidebar admin user 區
    const adminAvatar = root.querySelector('.admin-avatar');
    const adminName = root.querySelector('.admin-name');
    const adminRole = root.querySelector('.admin-role');

    if (adminAvatar && m.name) {
      adminAvatar.textContent = m.name.slice(0, 1);
    }
    if (adminName) adminName.textContent = ai.display_name || m.name || '管理員';
    if (adminRole) adminRole.textContent = ai.role === 'super_admin' ? '超級管理員' : '管理員';
  }


  /* =============================================================
     2. Nav 切換 + Breadcrumb
     ============================================================= */

  const pageTitles = {
    'dashboard': '儀表板',
    'review-designs': '刻圖審核',
    'review-photos': '照片審核',
    'review-stories': '故事審核',
    'cm-banner': '首頁與分頁 Banner',
    'cm-news': '最新消息',
    'users': '會員列表',
    'creators': '創作者管理',
    'ip': 'IP 合作'
  };

  function goTo(page) {
    root.querySelectorAll('.nav-link').forEach(x => x.classList.remove('on'));
    const navLink = root.querySelector(`.nav-link[data-page="${page}"]`);
    if (navLink) navLink.classList.add('on');

    root.querySelectorAll('.content-page').forEach(p => {
      p.classList.toggle('on', p.dataset.page === page);
    });

    Utils.setText('#breadcrumbCurrent', pageTitles[page] || '');

    // 進入頁面時觸發載入
    if (page === 'dashboard') loadDashboard();
    if (page === 'users') loadUsers();
    if (page === 'review-designs') loadDesignReview();
    if (page === 'review-photos') loadPhotoReview();
    if (page === 'review-stories') loadStoryReview();
    if (page === 'cm-news') loadNews();

    root.querySelector('.main').scrollTop = 0;
  }

  function bindNav() {
    root.querySelectorAll('.nav-link[data-page]').forEach(n => {
      n.addEventListener('click', () => goTo(n.dataset.page));
    });
    root.querySelectorAll('[data-jump]').forEach(a => {
      a.addEventListener('click', () => goTo(a.dataset.jump));
    });
  }


  /* =============================================================
     3. 儀表板 KPI (從 Supabase 統計)
     ============================================================= */

  async function loadDashboard() {
    const sb = getSb();
    if (!sb) return;

    // 待審核項目 (3 個 table 的 pending 加總)
    try {
      const [designs, photos, stories] = await Promise.all([
        sb.from('engraving_designs').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        sb.from('gallery_posts').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
        sb.from('member_stories').select('id', { count: 'exact', head: true }).eq('status', 'pending')
      ]);

      const dCount = designs.count || 0;
      const pCount = photos.count || 0;
      const sCount = stories.count || 0;
      const total = dCount + pCount + sCount;

      // 套到 KPI
      const kpi = root.querySelector('.kpi-card.alert');
      if (kpi) {
        kpi.querySelector('.kpi-value').textContent = total;
        kpi.querySelector('.kpi-trend').textContent = `${dCount} 設計 · ${pCount} 照片 · ${sCount} 故事`;
      }

      // 側邊欄 badge 也更新
      updateBadge('review-designs', dCount);
      updateBadge('review-photos', pCount);
      updateBadge('review-stories', sCount);

    } catch (err) {
      console.error('[儀表板 KPI 載入失敗]', err);
    }

    // 本月新刻圖上架
    try {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const { data: monthDesigns } = await sb
        .from('engraving_designs')
        .select('type')
        .eq('status', 'approved')
        .gte('listed_at', monthStart.toISOString());

      const arr = monthDesigns || [];
      const creatorCount = arr.filter(d => d.type === 'creator').length;
      const collabCount = arr.filter(d => d.type === 'collab').length;
      const totalDesigns = arr.length;

      const kpiCards = root.querySelectorAll('.content-page[data-page="dashboard"] .kpi-card');
      const kpi2 = kpiCards[1];
      if (kpi2) {
        kpi2.querySelector('.kpi-value').textContent = totalDesigns;
        kpi2.querySelector('.kpi-trend').textContent = `↑ Creator ${creatorCount} · Collab ${collabCount}`;
      }
    } catch (err) {
      console.error('[本月新刻圖統計失敗]', err);
    }

    // 本月上傳照片
    try {
      const monthStart = new Date();
      monthStart.setDate(1);
      monthStart.setHours(0, 0, 0, 0);

      const { count: photoCount } = await sb
        .from('gallery_posts')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', monthStart.toISOString());

      const kpiCards = root.querySelectorAll('.content-page[data-page="dashboard"] .kpi-card');
      const kpi3 = kpiCards[2];
      if (kpi3) {
        kpi3.querySelector('.kpi-value').textContent = photoCount || 0;
      }
    } catch (err) {
      console.error('[本月上傳照片統計失敗]', err);
    }

    // 載入 Dashboard 待審核小列表 (最早送審的前 4 筆)
    loadDashboardReviewList();
  }

  function updateBadge(page, count) {
    const link = root.querySelector(`.nav-link[data-page="${page}"]`);
    if (!link) return;
    const badge = link.querySelector('.badge');
    if (!badge) return;
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = '';
    } else {
      badge.style.display = 'none';
    }
  }

  async function loadDashboardReviewList() {
    const sb = getSb();
    if (!sb) return;

    const list = root.querySelector('.content-page[data-page="dashboard"] .review-list');
    if (!list) return;

    try {
      const [designsRes, photosRes, storiesRes] = await Promise.all([
        sb.from('engraving_designs').select('id, name, creator_id, type, created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(2),
        sb.from('gallery_posts').select('id, title, member_id, created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(1),
        sb.from('member_stories').select('id, title, member_id, created_at').eq('status', 'pending').order('created_at', { ascending: true }).limit(1)
      ]);

      const items = [];
      (designsRes.data || []).forEach(d => items.push({
        type: 'design', id: d.id, title: d.name, by: d.creator_id, role: d.type, time: d.created_at
      }));
      (photosRes.data || []).forEach(p => items.push({
        type: 'photo', id: p.id, title: p.title || '未命名', by: p.member_id, role: 'member', time: p.created_at
      }));
      (storiesRes.data || []).forEach(s => items.push({
        type: 'story', id: s.id, title: s.title, by: s.member_id, role: 'member', time: s.created_at
      }));

      // 按時間升序 (最舊的優先)
      items.sort((a, b) => new Date(a.time) - new Date(b.time));

      if (items.length === 0) {
        list.innerHTML = '<p style="text-align:center;padding:40px 0;color:var(--lohas-mute);font-size:12px">目前沒有待審核項目</p>';
        return;
      }

      const typeLabels = { design: '設 計', photo: '照 片', story: '故 事' };
      const grads = ['', 'g2', 'g3'];

      list.innerHTML = items.slice(0, 4).map((it, i) => {
        const grad = grads[i % grads.length];
        const rolePill = it.role === 'creator'
          ? '<span class="role-pill creator"><i class="fa-solid fa-star"></i>Creator</span>'
          : it.role === 'collab' || it.role === 'ip'
            ? '<span class="role-pill ip"><i class="fa-solid fa-crown"></i>Collab</span>'
            : '<span class="role-pill member">Member</span>';

        return `
          <div class="review-item" data-type="${it.type}" data-id="${it.id}">
            <div class="review-thumb ${grad}">${typeLabels[it.type]}</div>
            <div class="review-body">
              <div class="review-title">${escapeHtml(it.title)} ${rolePill}</div>
              <div class="review-meta">by <b>${escapeHtml(it.by)}</b> · ${formatTime(it.time)}</div>
            </div>
            <div class="review-actions">
              <button class="approve" data-act="approve"><i class="fa-solid fa-check"></i></button>
              <button class="reject" data-act="reject"><i class="fa-solid fa-xmark"></i></button>
            </div>
          </div>`;
      }).join('');

      // 綁定按鈕
      list.querySelectorAll('.review-item').forEach(item => {
        const type = item.dataset.type;
        const id = item.dataset.id;
        item.querySelector('[data-act="approve"]').addEventListener('click', e => {
          e.stopPropagation();
          quickApprove(type, id);
        });
        item.querySelector('[data-act="reject"]').addEventListener('click', e => {
          e.stopPropagation();
          openRejectModal(type, id);
        });
      });

    } catch (err) {
      console.error('[Dashboard 待審核列表載入失敗]', err);
    }
  }

  function formatTime(timestamp) {
    if (!timestamp) return '';
    const d = new Date(timestamp);
    const diffH = (Date.now() - d) / 3600000;
    if (diffH < 1) return Math.max(1, Math.floor((Date.now() - d) / 60000)) + ' 分鐘前';
    if (diffH < 24) return Math.floor(diffH) + ' 小時前';
    const diffD = diffH / 24;
    if (diffD < 2) return '昨天';
    if (diffD < 7) return Math.floor(diffD) + ' 天前';
    return d.toISOString().slice(0, 10).replace(/-/g, '.');
  }


  /* =============================================================
     4. 會員列表
     ============================================================= */

  async function loadUsers() {
    const tbody = document.getElementById('usersTbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--lohas-mute)">載入中...</td></tr>';

    try {
      // 1. 從 ERP 撈會員列表
      // ⚠️ 假設 endpoint 是 /proxy/member/list 不傳參數 = 全部
      // 如果你的 endpoint 不同, 改這裡
      const erpResult = await Auth.apiPost('/proxy/member/list', {});

      let erpUsers = [];
      if (Utils.normalizeApiCode(erpResult.code) === '200') {
        erpUsers = erpResult.data || [];
        // ERP 可能回單筆或陣列
        if (!Array.isArray(erpUsers)) erpUsers = [erpUsers];
      } else {
        console.warn('[ERP 撈會員失敗]', erpResult);
      }

      // 2. 從 Supabase 撈創作者 / 停權 / admin 狀態
      const sb = getSb();
      const [creatorsRes, statusRes, adminsRes, postsCountRes] = await Promise.all([
        sb.from('creators').select('member_id, status'),
        sb.from('member_status').select('member_id, status'),
        sb.from('admins').select('member_id'),
        // 累積上傳統計 - 撈每個會員的數量
        sb.from('gallery_posts').select('member_id')
      ]);

      State.creatorIds = new Set(
        (creatorsRes.data || []).filter(c => c.status === 'active').map(c => c.member_id)
      );
      State.suspendedIds = new Set(
        (statusRes.data || []).filter(s => s.status === 'suspended').map(s => s.member_id)
      );
      State.adminIds = new Set(
        (adminsRes.data || []).map(a => a.member_id)
      );

      // 統計每個會員的照片數
      const photoCount = {};
      (postsCountRes.data || []).forEach(p => {
        photoCount[p.member_id] = (photoCount[p.member_id] || 0) + 1;
      });

      // 3. 整合 ERP + Supabase 資料
      const merged = erpUsers.map(u => {
        // 強制轉字串(ERP 可能回 number, Supabase 是 text)
        const erpid = String(u.client_id || u.erpid || '');
        const isAdmin = State.adminIds.has(erpid);
        const isCreator = State.creatorIds.has(erpid);
        const isSuspended = State.suspendedIds.has(erpid);

        let role = 'member';
        if (isAdmin) role = 'admin';
        else if (isCreator) role = 'creator';
        // collab 暫時靠 ERP id 開頭判斷 (LH-COL-...) 或從 erp 欄位
        if (erpid && erpid.startsWith('LH-COL-')) role = 'ip';

        const photos = photoCount[erpid] || 0;

        return {
          erpid,
          name: u.name || u.client_name || '-',
          email: u.email || '',
          mobile: u.mobile || '',
          avatar: (u.name || '?').slice(0, 1),
          role,
          status: isSuspended ? 'suspended' : 'active',
          uploads: photos > 0 ? `${photos} 張照片` : '—'
        };
      });

      State.users = merged;
      applyFilters();

    } catch (err) {
      console.error('[載入會員列表失敗]', err);
      tbody.innerHTML = `<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--status-rejected)">載入失敗: ${escapeHtml(err.message)}</td></tr>`;
    }
  }

  function rolePillHtml(role) {
    const map = {
      member: '<span class="row-role-pill member">Member</span>',
      creator: '<span class="row-role-pill creator"><i class="fa-solid fa-star"></i>Creator</span>',
      ip: '<span class="row-role-pill ip"><i class="fa-solid fa-crown"></i>Collab</span>',
      admin: '<span class="row-role-pill admin"><i class="fa-solid fa-shield-halved"></i>Admin</span>'
    };
    return map[role] || map.member;
  }

  function statusPillHtml(status) {
    if (status === 'suspended') {
      return '<span class="row-status suspended"><i class="fa-solid fa-ban"></i>已停權</span>';
    }
    return '<span class="row-status active"><i class="fa-solid fa-circle"></i>正常</span>';
  }

  function actionsHtml(user) {
    if (user.status === 'suspended') {
      return `
        <button data-act="view" data-erpid="${escapeHtml(user.erpid)}"><i class="fa-regular fa-eye"></i>查看</button>
        <button data-act="restore" data-erpid="${escapeHtml(user.erpid)}"><i class="fa-solid fa-rotate-left"></i>恢復</button>`;
    }
    if (user.role === 'member') {
      return `
        <button data-act="view" data-erpid="${escapeHtml(user.erpid)}"><i class="fa-regular fa-eye"></i>查看</button>
        <button class="promote" data-act="promote" data-erpid="${escapeHtml(user.erpid)}" data-name="${escapeHtml(user.name)}"><i class="fa-solid fa-star"></i>升級為 Creator</button>`;
    }
    return `
      <button data-act="view" data-erpid="${escapeHtml(user.erpid)}"><i class="fa-regular fa-eye"></i>查看</button>
      <button data-act="suspend" data-erpid="${escapeHtml(user.erpid)}" data-name="${escapeHtml(user.name)}"><i class="fa-regular fa-circle-pause"></i>停權</button>`;
  }

  function renderUsers(users) {
    const tbody = document.getElementById('usersTbody');
    if (!tbody) return;

    if (!users || users.length === 0) {
      tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--lohas-mute)">查無會員</td></tr>';
      return;
    }

    tbody.innerHTML = users.map(u => {
      const meta = [];
      if (u.erpid) meta.push(u.erpid);
      if (u.email) meta.push(u.email);
      if (u.mobile) meta.push(u.mobile);
      const metaText = meta.join(' · ');

      return `
        <tr>
          <td>
            <div class="user-cell">
              <div class="user-avatar ${u.role}">${escapeHtml(u.avatar)}</div>
              <div>
                <div class="user-info-name">${escapeHtml(u.name)}</div>
                <div class="user-info-id">${escapeHtml(metaText)}</div>
              </div>
            </div>
          </td>
          <td>${rolePillHtml(u.role)}</td>
          <td>${statusPillHtml(u.status)}</td>
          <td>${escapeHtml(u.uploads)}</td>
          <td><div class="row-actions">${actionsHtml(u)}</div></td>
        </tr>`;
    }).join('');

    tbody.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', () => {
        handleUserAction(btn.dataset.act, btn.dataset.erpid, btn.dataset.name);
      });
    });

    // 更新 KPI
    updateUsersKPI();
  }

  function updateUsersKPI() {
    const cards = root.querySelectorAll('.content-page[data-page="users"] .kpi-card .kpi-value');
    if (cards.length < 4) return;

    cards[0].textContent = State.users.length.toLocaleString(); // 總會員
    cards[1].textContent = State.creatorIds.size; // Creator 總數

    const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
    // 本月升級的數字目前無法精準算 (需要看 creators.created_at), 顯示總數
    // TODO: 之後用 creators.created_at >= monthStart 算

    cards[3].textContent = State.suspendedIds.size; // 停權數
  }

  function applyFilters() {
    const q = (document.getElementById('userSearchInput')?.value || '').toLowerCase().trim();
    const roleFilter = document.getElementById('filterRole')?.value || '';
    const statusFilter = document.getElementById('filterStatus')?.value || '';

    let filtered = State.users;

    if (q) {
      filtered = filtered.filter(u =>
        (u.name || '').toLowerCase().includes(q) ||
        (u.erpid || '').toLowerCase().includes(q) ||
        (u.email || '').toLowerCase().includes(q) ||
        (u.mobile || '').toLowerCase().includes(q)
      );
    }
    if (roleFilter) filtered = filtered.filter(u => u.role === roleFilter);
    if (statusFilter) filtered = filtered.filter(u => u.status === statusFilter);

    renderUsers(filtered);
  }

  function bindUserFilters() {
    document.getElementById('userSearchInput')?.addEventListener('input', applyFilters);
    document.getElementById('filterRole')?.addEventListener('change', applyFilters);
    document.getElementById('filterStatus')?.addEventListener('change', applyFilters);
  }


  /* =============================================================
     5. 會員操作 (升級 / 停權 / 恢復)
     ============================================================= */

  async function handleUserAction(action, erpid, name) {
    if (action === 'promote') {
      await promoteToCreator(erpid, name);
    } else if (action === 'suspend') {
      await suspendUser(erpid, name);
    } else if (action === 'restore') {
      await restoreUser(erpid);
    } else if (action === 'view') {
      alert(`查看會員: ${erpid}\n\n(個人頁待開發)`);
    }
  }

  async function promoteToCreator(erpid, name) {
    if (!confirm(`確定將「${name}」升級為 Creator?\n\n升級後可以:\n· 上架刻圖設計\n· 享 $500/次 分潤\n· 編輯創作者個人頁`)) return;

    const sb = getSb();
    if (!sb) return alert('Supabase 連線失敗');

    try {
      const { error } = await sb.from('creators').upsert({
        member_id: erpid,
        display_name: name,
        status: 'active'
      }, { onConflict: 'member_id' });

      if (error) {
        console.error('[升級失敗]', error);
        alert('升級失敗: ' + error.message);
        return;
      }

      alert(`「${name}」已升級為 Creator`);
      loadUsers(); // 重新載入

    } catch (err) {
      alert('升級失敗: ' + err.message);
    }
  }

  async function suspendUser(erpid, name) {
    const reason = prompt(`停權「${name}」的原因:`);
    if (reason === null) return; // 取消
    if (!reason.trim()) return alert('請輸入停權原因');

    const sb = getSb();
    if (!sb) return;

    try {
      const { error } = await sb.from('member_status').upsert({
        member_id: erpid,
        status: 'suspended',
        reason: reason.trim(),
        suspended_at: new Date().toISOString(),
        suspended_by: State.member.erpid
      }, { onConflict: 'member_id' });

      if (error) return alert('停權失敗: ' + error.message);

      alert(`「${name}」已停權`);
      loadUsers();
    } catch (err) {
      alert('停權失敗: ' + err.message);
    }
  }

  async function restoreUser(erpid) {
    if (!confirm('確定恢復這個帳號?')) return;

    const sb = getSb();
    if (!sb) return;

    try {
      const { error } = await sb.from('member_status')
        .update({ status: 'active' })
        .eq('member_id', erpid);

      if (error) return alert('恢復失敗: ' + error.message);

      alert('已恢復');
      loadUsers();
    } catch (err) {
      alert('恢復失敗: ' + err.message);
    }
  }


  /* =============================================================
     6. 刻圖審核
     ============================================================= */

  async function loadDesignReview() {
    const grid = root.querySelector('.content-page[data-page="review-designs"] .review-grid');
    if (!grid) return;

    grid.innerHTML = '<p class="empty-text" style="grid-column:1/-1;text-align:center;padding:60px;color:var(--lohas-mute)">載入中...</p>';

    const sb = getSb();
    if (!sb) return;

    try {
      const { data, error } = await sb
        .from('engraving_designs')
        .select('id, name, description, image_url, type, creator_id, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (error) {
        grid.innerHTML = `<p class="empty-text" style="grid-column:1/-1">載入失敗: ${escapeHtml(error.message)}</p>`;
        return;
      }

      const designs = data || [];
      if (designs.length === 0) {
        grid.innerHTML = '<p class="empty-text" style="grid-column:1/-1;text-align:center;padding:60px;color:var(--lohas-mute)">目前沒有待審核設計</p>';
        return;
      }

      const grads = ['', 'g2', 'g3', 'g4', 'g5', 'g6'];

      grid.innerHTML = designs.map((d, i) => {
        const grad = grads[i % grads.length];
        const typeLabel = d.type === 'collab' ? '<i class="fa-solid fa-crown" style="color:#9D7E3F"></i>Collab'
          : d.type === 'creator' ? '<i class="fa-solid fa-star" style="color:#9D7E3F"></i>Creator'
          : 'Member';
        const rolePillCls = d.type === 'collab' ? 'ip' : d.type === 'creator' ? 'creator' : 'member';
        const rolePillContent = d.type === 'collab' ? '<i class="fa-solid fa-crown"></i>Collab'
          : d.type === 'creator' ? '<i class="fa-solid fa-star"></i>Creator'
          : 'Member';

        const imgStyle = d.image_url
          ? `style="background-image:url('${escapeHtml(d.image_url)}');background-size:cover;background-position:center"`
          : '';

        return `
          <div class="rcard" data-id="${d.id}">
            <div class="rcard-img ${grad}" ${imgStyle}>
              <span class="rcard-pill">${typeLabel}</span>
              ${escapeHtml(d.name)}
            </div>
            <div class="rcard-info">
              <div class="rcard-title">${escapeHtml(d.name)}</div>
              <div class="rcard-by">by <b>${escapeHtml(d.creator_id)}</b> <span class="role-pill ${rolePillCls}">${rolePillContent}</span></div>
              ${d.description ? `<div class="rcard-quote">${escapeHtml(d.description)}</div>` : ''}
              <div class="rcard-meta"><i class="fa-regular fa-clock"></i>送審 ${formatTime(d.created_at)}</div>
              <div class="rcard-actions">
                <button class="approve" data-act="approve" data-id="${d.id}"><i class="fa-solid fa-check"></i>通 過</button>
                <button class="reject" data-act="reject" data-id="${d.id}" data-name="${escapeHtml(d.name)}" data-by="${escapeHtml(d.creator_id)}"><i class="fa-solid fa-xmark"></i>駁 回</button>
                <button class="more"><i class="fa-solid fa-ellipsis"></i></button>
              </div>
            </div>
          </div>`;
      }).join('');

      // 綁定通過/駁回
      grid.querySelectorAll('[data-act="approve"]').forEach(b => {
        b.addEventListener('click', () => approveDesign(b.dataset.id));
      });
      grid.querySelectorAll('[data-act="reject"]').forEach(b => {
        b.addEventListener('click', () => openRejectModal('design', b.dataset.id, { name: b.dataset.name, by: b.dataset.by }));
      });

    } catch (err) {
      console.error('[刻圖審核載入失敗]', err);
    }
  }

  async function approveDesign(id) {
    if (!confirm('確定通過這個設計?\n通過後會自動上架到創作者市集,作者也會自動升級為 Creator (如果還不是)')) return;

    const sb = getSb();
    if (!sb) return;

    const { error } = await sb.from('engraving_designs')
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', id);

    if (error) return alert('通過失敗: ' + error.message);

    alert('已通過 (Creator 自動升級已由 trigger 處理)');
    loadDesignReview();
    loadDashboard();
  }


  /* =============================================================
     7. 照片 / 故事審核
     ============================================================= */

  async function loadPhotoReview() {
    // TODO 簡化處理 - 之後可比照 loadDesignReview() 模式做
    const page = root.querySelector('.content-page[data-page="review-photos"]');
    if (page) page.querySelector('.empty-page-title').textContent = '照片審核 (架構同刻圖審核,可比照 loadDesignReview() 實作)';
  }

  async function loadStoryReview() {
    const page = root.querySelector('.content-page[data-page="review-stories"]');
    if (page) page.querySelector('.empty-page-title').textContent = '故事審核 (待實作)';
  }

  async function quickApprove(type, id) {
    if (!confirm('快速通過?')) return;
    const sb = getSb();
    if (!sb) return;

    const tableMap = {
      design: 'engraving_designs',
      photo: 'gallery_posts',
      story: 'member_stories'
    };
    const table = tableMap[type];
    if (!table) return;

    const { error } = await sb.from(table)
      .update({ status: 'approved', reviewed_at: new Date().toISOString() })
      .eq('id', id);

    if (error) return alert('通過失敗: ' + error.message);
    alert('已通過');
    loadDashboard();
  }


  /* =============================================================
     8. 駁回 modal (整合所有審核類型)
     ============================================================= */

  let currentRejectTarget = null;

  function openRejectModal(type, id, info) {
    currentRejectTarget = { type, id };
    const modal = document.getElementById('rejectModal');
    if (info) {
      modal.querySelector('.info-t').textContent = info.name || '';
      const typeLabel = { design: '創作者作品', photo: '會員照片', story: '會員故事' }[type] || '';
      modal.querySelector('.info-m').textContent = `by ${info.by || ''} · ${typeLabel}`;
    }
    document.getElementById('reasonText').value = '';
    document.querySelectorAll('.preset').forEach(x => x.classList.remove('on'));
    modal.classList.add('show');
  }

  function closeReject() {
    document.getElementById('rejectModal').classList.remove('show');
    currentRejectTarget = null;
  }

  async function confirmReject() {
    if (!currentRejectTarget) return;
    const reason = document.getElementById('reasonText').value.trim();
    if (!reason) return alert('請輸入駁回原因');

    const sb = getSb();
    if (!sb) return;

    const tableMap = {
      design: 'engraving_designs',
      photo: 'gallery_posts',
      story: 'member_stories'
    };
    const table = tableMap[currentRejectTarget.type];
    if (!table) return;

    const { error } = await sb.from(table)
      .update({
        status: 'rejected',
        reject_reason: reason,
        reviewed_at: new Date().toISOString()
      })
      .eq('id', currentRejectTarget.id);

    if (error) return alert('駁回失敗: ' + error.message);

    closeReject();
    alert('已駁回');

    // 重新載入當前頁
    if (currentRejectTarget?.type === 'design') loadDesignReview();
    loadDashboard();
  }


  /* =============================================================
     9. 最新消息 (CRUD)
     ============================================================= */

  async function loadNews() {
    const tbody = root.querySelector('.content-page[data-page="cm-news"] .news-table tbody');
    if (!tbody) return;

    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px">載入中...</td></tr>';

    const sb = getSb();
    if (!sb) return;

    try {
      const { data, error } = await sb
        .from('news')
        .select('id, title, category, status, published_at, scheduled_at, created_at')
        .order('created_at', { ascending: false });

      if (error) {
        tbody.innerHTML = `<tr><td colspan="5">載入失敗: ${escapeHtml(error.message)}</td></tr>`;
        return;
      }

      const items = data || [];
      const filterInfo = root.querySelector('.content-page[data-page="cm-news"] .filter-info b');
      if (filterInfo) filterInfo.textContent = items.length;

      if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center;padding:40px;color:var(--lohas-mute)">尚未建立任何消息</td></tr>';
        return;
      }

      const categoryLabels = {
        announcement: '系統公告',
        event: '活動優惠',
        creator: '創作者公告'
      };

      tbody.innerHTML = items.map(n => {
        const status = n.status;
        let statusHtml;
        if (status === 'published') {
          statusHtml = '<span class="news-status published"><i class="fa-solid fa-circle-check"></i>已發布</span>';
        } else if (status === 'scheduled') {
          const sd = n.scheduled_at ? new Date(n.scheduled_at).toLocaleDateString('zh-TW') : '';
          statusHtml = `<span class="news-status scheduled"><i class="fa-regular fa-clock"></i>已排程 ${sd}</span>`;
        } else {
          statusHtml = '<span class="news-status draft">草稿</span>';
        }

        const dateStr = n.published_at
          ? new Date(n.published_at).toLocaleDateString('zh-TW').replace(/\//g, '.')
          : '—';

        return `
          <tr>
            <td>${escapeHtml(n.title)}</td>
            <td>${escapeHtml(categoryLabels[n.category] || n.category)}</td>
            <td>${statusHtml}</td>
            <td>${dateStr}</td>
            <td>
              <div class="news-actions">
                <button data-act="edit-news" data-id="${n.id}" title="編輯"><i class="fa-regular fa-pen-to-square"></i></button>
                <button data-act="view-news" data-id="${n.id}" title="預覽"><i class="fa-regular fa-eye"></i></button>
                <button data-act="delete-news" data-id="${n.id}" title="刪除"><i class="fa-regular fa-trash-can"></i></button>
              </div>
            </td>
          </tr>`;
      }).join('');

      // 綁定按鈕
      tbody.querySelectorAll('[data-act="delete-news"]').forEach(btn => {
        btn.addEventListener('click', () => deleteNews(btn.dataset.id));
      });
      tbody.querySelectorAll('[data-act="edit-news"]').forEach(btn => {
        btn.addEventListener('click', () => alert('編輯消息 (待實作 modal)'));
      });
      tbody.querySelectorAll('[data-act="view-news"]').forEach(btn => {
        btn.addEventListener('click', () => alert('預覽消息 (待實作)'));
      });

    } catch (err) {
      console.error('[載入消息失敗]', err);
    }
  }

  async function deleteNews(id) {
    if (!confirm('確定刪除這則消息?')) return;
    const sb = getSb();
    if (!sb) return;
    const { error } = await sb.from('news').delete().eq('id', id);
    if (error) return alert('刪除失敗: ' + error.message);
    loadNews();
  }

  async function createNews() {
    const title = prompt('消息標題:');
    if (!title) return;
    const category = prompt('分類 (announcement / event / creator):', 'announcement');
    if (!category) return;

    const sb = getSb();
    if (!sb) return;

    const { error } = await sb.from('news').insert({
      title: title.trim(),
      category: category.trim(),
      status: 'draft',
      author_id: State.member.erpid
    });

    if (error) return alert('建立失敗: ' + error.message);
    alert('已建立草稿');
    loadNews();
  }


  /* =============================================================
     10. 審核 tabs / preset / Modal 操作
     ============================================================= */

  function bindReviewTabs() {
    root.querySelectorAll('.rtab').forEach(t => {
      t.addEventListener('click', () => {
        root.querySelectorAll('.rtab').forEach(x => x.classList.remove('on'));
        t.classList.add('on');
      });
    });
  }

  function bindRejectModal() {
    document.getElementById('cancelReject')?.addEventListener('click', closeReject);
    document.getElementById('closeRejectX')?.addEventListener('click', closeReject);
    document.getElementById('confirmReject')?.addEventListener('click', confirmReject);

    const modal = document.getElementById('rejectModal');
    modal?.addEventListener('click', e => {
      if (e.target === modal) closeReject();
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modal?.classList.contains('show')) closeReject();
    });

    document.querySelectorAll('.preset').forEach(p => {
      p.addEventListener('click', () => {
        document.querySelectorAll('.preset').forEach(x => x.classList.remove('on'));
        p.classList.add('on');
        document.getElementById('reasonText').value = p.dataset.text;
      });
    });
  }


  /* =============================================================
     11. 登出
     ============================================================= */

  function bindLogout() {
    document.getElementById('logout-btn')?.addEventListener('click', () => {
      if (!confirm('確定要登出?')) return;
      Auth.logout();
    });

    // 新增消息按鈕
    document.getElementById('btnCreateNews')?.addEventListener('click', createNews);
  }


  /* =============================================================
     12. Init
     ============================================================= */

  async function init() {
    const isAdmin = await verifyAdmin();
    if (!isAdmin) return;

    applyAdminUI();
    bindNav();
    bindReviewTabs();
    bindRejectModal();
    bindUserFilters();
    bindLogout();

    // 預設開 dashboard
    loadDashboard();
  }

  document.addEventListener('DOMContentLoaded', init);


  /* =============================================================
     Export
     ============================================================= */

  window.LohasAdmin = {
    State,
    goTo,
    loadUsers,
    loadDashboard,
    loadDesignReview,
    loadNews,
    promoteToCreator,
    suspendUser,
    restoreUser,
    createNews,
    applyFilters
  };

})(window);
