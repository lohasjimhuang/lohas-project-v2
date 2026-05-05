/* =============================================================
   樂活會員中心 · member-portal.js
   -------------------------------------------------------------
   依賴 (需在這之前載入):
   - LohasUtils    (utils.js)     - $, setText, show, hide
   - LohasAuth     (auth.js)      - getStoredMember, logout, ...
   - LohasSupabase (supabase.js)  - getClient(), CONFIG.*
   ============================================================= */

(function (window) {
  'use strict';

  const Utils = window.LohasUtils;
  const Auth = window.LohasAuth;
  const Supabase = window.LohasSupabase;

  if (!Utils || !Auth) {
    console.error('[member-portal] 缺少 LohasUtils 或 LohasAuth,請先載入 utils.js / auth.js');
    return;
  }

  const root = document.getElementById('mp');
  if (!root) return;

  // 全域狀態
  const State = {
    member: null,       // 當前會員 (從 Auth.getStoredMember())
    isCreator: false,   // 是否創作者
    creatorInfo: null,  // 創作者主檔資料 (creators table)
    isAdmin: false      // 是否後台管理員 (admins table)
  };


  /* =============================================================
     Helpers
     ============================================================= */

  function getSupabase() {
    if (!Supabase || !Supabase.getClient) return null;
    return Supabase.getClient();
  }

  function getAvatarText(name) {
    if (!name) return '?';
    const trimmed = name.trim();
    if (/[\u4e00-\u9fff]/.test(trimmed)) return trimmed.slice(-2);
    return trimmed.slice(0, 2).toUpperCase();
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return '';
    const now = new Date();
    const diffMs = now - d;
    const diffH = diffMs / (1000 * 60 * 60);
    if (diffH < 1) return Math.max(1, Math.floor(diffMs / 60000)) + ' 分鐘前';
    if (diffH < 24) return Math.floor(diffH) + ' 小時前';
    const diffD = diffH / 24;
    if (diffD < 2) return '昨天';
    if (diffD < 7) return Math.floor(diffD) + ' 天前';
    return d.toISOString().slice(0, 10).replace(/-/g, '.');
  }

  function escapeHtml(str) {
    if (str == null) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function maskBankAccount(account) {
    if (!account) return '';
    const s = String(account);
    if (s.length <= 4) return '*'.repeat(s.length);
    return '**** **** **** ' + s.slice(-4);
  }


  /* =============================================================
     Identity · 載入會員 + Creator 判斷
     ============================================================= */

  async function loadIdentity() {
    const member = Auth.getStoredMember();

    if (!member || !member.erpid) {
      // 沒登入 → 導去登入頁
      Auth.setRedirect && Auth.setRedirect('member-portal.html');
      window.location.href = 'login.html';
      return false;
    }

    // 強制把 erpid 轉成字串
    // (ERP API 可能回 number, 但 Supabase 的 member_id 欄位是 TEXT 型別,
    //  型別不一致會查不到資料)
    member.erpid = String(member.erpid);

    State.member = member;

    const sb = getSupabase();
    if (sb) {
      // 平行查 Creator + Admin 身份
      try {
        const [creatorRes, adminRes] = await Promise.all([
          sb.from('creators')
            .select('member_id, display_name, bio, avatar_url, status, bank_name, bank_code, bank_branch, bank_account, account_holder')
            .eq('member_id', member.erpid)
            .eq('status', 'active')
            .maybeSingle(),
          sb.from('admins')
            .select('member_id, status')
            .eq('member_id', member.erpid)
            .eq('status', 'active')
            .maybeSingle()
        ]);

        if (!creatorRes.error && creatorRes.data) {
          State.isCreator = true;
          State.creatorInfo = creatorRes.data;
        }

        if (!adminRes.error && adminRes.data) {
          State.isAdmin = true;
        }
      } catch (err) {
        console.warn('[身份查詢失敗]', err);
      }
    }

    return true;
  }

  function applyIdentity() {
    const m = State.member;

    root.classList.toggle('is-creator', State.isCreator);

    // Hero 區
    Utils.setText('#dashboard-name', m.name || '-');
    Utils.setText('#dashboard-id', `樂活會員編號:${m.erpid || '-'}`);

    const heroBadge = document.getElementById('heroBadge');
    if (heroBadge) heroBadge.style.display = State.isCreator ? 'inline-flex' : 'none';

    // Admin badge + 進入後台按鈕
    const heroAdminBadge = document.getElementById('heroAdminBadge');
    if (heroAdminBadge) heroAdminBadge.style.display = State.isAdmin ? 'inline-flex' : 'none';

    const enterAdminBtn = document.getElementById('enterAdminBtn');
    if (enterAdminBtn) enterAdminBtn.style.display = State.isAdmin ? 'inline-flex' : 'none';

    const roleTag = document.getElementById('roleTag');
    if (roleTag) {
      // 顯示優先級: Admin > Creator > Member
      let roleText;
      if (State.isAdmin) roleText = 'Admin';
      else if (State.isCreator) roleText = 'Creator';
      else roleText = 'Member';
      roleTag.textContent = '會員中心 · ' + roleText;
      roleTag.classList.toggle('creator', State.isCreator && !State.isAdmin);
    }

    // 頭像
    const avatarEl = document.getElementById('avatarPreview');
    if (avatarEl) {
      avatarEl.classList.toggle('is-creator', State.isCreator);
      const saved = localStorage.getItem('lohasMemberAvatar');
      if (saved) {
        avatarEl.innerHTML = `<img src="${saved}" alt="會員頭像">`;
      } else {
        avatarEl.textContent = getAvatarText(m.name);
      }
    }

    // 會員資料頁
    Utils.setText('#profile-name', m.name || '-');
    Utils.setText('#profile-mobile', m.mobile || '-');
    Utils.setText('#profile-email', m.email || '-');
    Utils.setText('#profile-birthday', m.birthday || '-');

    // 創作者個人頁(如果是 Creator,把 creators table 資料填進去)
    if (State.isCreator && State.creatorInfo) {
      const ci = State.creatorInfo;
      const creatorAvatar = document.getElementById('creatorAvatar');
      if (creatorAvatar) creatorAvatar.textContent = getAvatarText(ci.display_name || m.name);

      const dn = document.getElementById('creatorDisplayName');
      if (dn) dn.value = ci.display_name || m.name || '';

      const bio = document.getElementById('creatorBio');
      if (bio) bio.value = ci.bio || '';
    }
  }


  /* =============================================================
     Photos · 我的照片 (gallery_posts)
     ============================================================= */

  async function loadPhotos() {
    const list = document.getElementById('myPhotoList');
    const banner = document.getElementById('photoRejectedBanner');
    const rejectBadge = document.getElementById('photoRejectBadge');
    const photoCount = document.getElementById('photoCount');

    if (!list || !State.member) return;

    const sb = getSupabase();
    if (!sb) {
      list.innerHTML = '<p class="empty-text">尚未設定 Supabase</p>';
      return;
    }

    const postsTable = (Supabase.CONFIG && Supabase.CONFIG.POSTS_TABLE) || 'gallery_posts';

    const { data, error } = await sb
      .from(postsTable)
      .select('id, title, topic, carrier, image_urls, main_image_url, status, reject_reason, created_at')
      .eq('member_id', State.member.erpid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[讀取照片失敗]', error);
      list.innerHTML = '<p class="empty-text">讀取照片失敗</p>';
      return;
    }

    const photos = data || [];
    if (photoCount) photoCount.textContent = photos.length ? photos.length + ' 張' : '';

    // 處理駁回 banner
    const rejected = photos.filter(p => p.status === 'rejected');
    if (rejected.length > 0 && banner) {
      const first = rejected[0];
      Utils.setText(
        '#photoRejectedTitle',
        rejected.length === 1
          ? `您有 1 張照片「${first.title || '未命名'}」未通過審核`
          : `您有 ${rejected.length} 張照片未通過審核`
      );
      const reasonEl = document.getElementById('photoRejectedReason');
      if (reasonEl) {
        reasonEl.innerHTML = '<b>駁回原因:</b>' + escapeHtml(first.reject_reason || '請聯繫客服了解詳情。');
      }
      banner.style.display = '';
    } else if (banner) {
      banner.style.display = 'none';
    }

    // 側邊欄紅標
    if (rejectBadge) {
      if (rejected.length > 0) {
        rejectBadge.textContent = rejected.length;
        rejectBadge.style.display = 'inline-flex';
      } else {
        rejectBadge.style.display = 'none';
      }
    }

    // Render 卡片
    if (photos.length === 0) {
      list.innerHTML = `
        <p class="empty-text">尚未上傳分享照片</p>
        <button class="add-photo-card">
          <i class="fa-solid fa-plus"></i><span>上 傳 新 照 片</span>
        </button>`;
      return;
    }

    // 漸層背景輪流(g, g2, g3, g4, g5, g6)
    const grads = ['', 'g2', 'g3', 'g4', 'g5', 'g6'];

    const cards = photos.map((p, i) => {
      const img = p.main_image_url
        || (Array.isArray(p.image_urls) ? p.image_urls[0] : '')
        || '';
      const status = p.status || 'pending';
      const grad = grads[i % grads.length];
      const date = formatDate(p.created_at);

      return `
        <div class="photo-card" data-id="${p.id}">
          <div class="photo-cover ${grad}"
               data-id="${p.id}"
               data-name="${escapeHtml(p.title || '未命名')}"
               data-date="${escapeHtml(date)}"
               data-status="${status}"
               data-fav="0"
               data-cover="${grad}"
               data-reason="${escapeHtml(p.reject_reason || '')}"
               ${img ? `style="background-image:url('${img}');background-size:cover;background-position:center"` : ''}>
            <span class="status-badge ${status}">
              <i class="fa-solid fa-${status === 'pending' ? 'clock' : status === 'approved' ? 'check' : 'xmark'}"></i>
              ${status === 'pending' ? '待審核' : status === 'approved' ? '已公開' : '未通過'}
            </span>
            <div class="photo-cover-dim"></div>
            <div class="photo-cover-text">詳 情</div>
          </div>
          <div class="photo-info">
            <div class="photo-name">${escapeHtml(p.title || '未命名')}</div>
            <div class="photo-date">${escapeHtml(date)}</div>
          </div>
        </div>`;
    }).join('');

    list.innerHTML = cards + `
      <button class="add-photo-card">
        <i class="fa-solid fa-plus"></i><span>上 傳 新 照 片</span>
      </button>`;

    // 綁定 hover modal
    list.querySelectorAll('.photo-cover').forEach(cover => {
      cover.addEventListener('click', () => openPhotoModal(cover));
    });
  }

  async function deletePhoto(postId) {
    if (!postId) return;
    if (!window.confirm('確定要刪除這張照片嗎?')) return;

    const sb = getSupabase();
    if (!sb) {
      window.alert('尚未設定 Supabase');
      return;
    }

    const postsTable = (Supabase.CONFIG && Supabase.CONFIG.POSTS_TABLE) || 'gallery_posts';

    const { data, error } = await sb
      .from(postsTable)
      .delete()
      .eq('id', postId)
      .select('id');

    if (error || !data || data.length === 0) {
      window.alert('刪除失敗,請確認權限');
      return;
    }

    closeModal();
    loadPhotos();
  }


  /* =============================================================
     Inspos · 我的靈感 (gallery_favorites)
     ============================================================= */

  async function loadInspos() {
    const list = document.getElementById('myFavoriteList');
    const countEl = document.getElementById('inspoCount');
    if (!list || !State.member) return;

    const sb = getSupabase();
    if (!sb) {
      list.innerHTML = '<p class="empty-text">尚未設定 Supabase</p>';
      return;
    }

    const favTable = (Supabase.CONFIG && Supabase.CONFIG.FAVORITES_TABLE) || 'gallery_favorites';

    const { data, error } = await sb
      .from(favTable)
      .select(`
        post_id,
        gallery_posts (
          id, title, topic, carrier, image_urls, main_image_url, member_id
        )
      `)
      .eq('member_id', State.member.erpid);

    if (error) {
      console.error('[讀取靈感失敗]', error);
      list.innerHTML = '<p class="empty-text">讀取靈感失敗</p>';
      return;
    }

    const posts = (data || []).map(item => item.gallery_posts).filter(Boolean);
    if (countEl) countEl.textContent = posts.length ? posts.length + ' 張' : '';

    if (posts.length === 0) {
      list.innerHTML = '<p class="empty-text">尚未收藏任何靈感</p>';
      return;
    }

    const grads = ['', 'g2', 'g3', 'g4', 'g5', 'g6'];
    list.innerHTML = posts.map((p, i) => {
      const img = p.main_image_url || (Array.isArray(p.image_urls) ? p.image_urls[0] : '') || '';
      const grad = grads[i % grads.length];
      const author = p.member_id ? `會員 ${String(p.member_id).slice(-3)}` : '會員';
      return `
        <div class="inspo-card">
          <div class="inspo-img ${grad}" ${img ? `style="background-image:url('${img}');background-size:cover;background-position:center"` : ''}>
            <button class="inspo-bookmark"><i class="fa-solid fa-bookmark"></i></button>
          </div>
          <div class="inspo-info">
            <div class="inspo-by">${escapeHtml(author)}</div>
            <div class="inspo-quote">${escapeHtml(p.title || '未命名')}</div>
          </div>
        </div>`;
    }).join('');
  }


  /* =============================================================
     Wishlist · 想刻清單 (engraving_wishlist + engraving_designs)
     ============================================================= */

  async function loadWishlist() {
    const list = document.getElementById('myWishList');
    const countEl = document.getElementById('wishCount');
    if (!list || !State.member) return;

    const sb = getSupabase();
    if (!sb) return;

    const { data, error } = await sb
      .from('engraving_wishlist')
      .select(`
        design_id, created_at,
        engraving_designs (
          id, name, image_url, type, creator_id, status
        )
      `)
      .eq('member_id', State.member.erpid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[讀取想刻清單失敗]', error);
      list.innerHTML = '<p class="empty-text">讀取失敗</p>';
      return;
    }

    const designs = (data || [])
      .map(item => item.engraving_designs)
      .filter(d => d && d.status === 'approved');

    if (countEl) countEl.textContent = designs.length ? designs.length + ' 件' : '';

    if (designs.length === 0) {
      list.innerHTML = '<p class="empty-text">尚未加入任何想刻設計</p>';
      return;
    }

    const grads = ['', 'g2', 'g3', 'g4'];
    list.innerHTML = designs.map((d, i) => {
      const grad = grads[i % grads.length];
      const typeClass = d.type === 'collab' ? 'i' : d.type === 'creator' ? 'c' : '';
      const typeLabel = d.type === 'collab'
        ? '<i class="fa-solid fa-crown"></i>Collab'
        : d.type === 'creator'
        ? '<i class="fa-solid fa-star"></i>Creator'
        : 'Member';

      return `
        <div class="wish-card">
          <div class="wish-img ${grad}" ${d.image_url ? `style="background-image:url('${d.image_url}');background-size:cover;background-position:center"` : ''}>
            <span class="type-pill ${typeClass}">${typeLabel}</span>
            <button class="wish-remove" data-design-id="${d.id}"><i class="fa-solid fa-xmark"></i></button>
            ${escapeHtml(d.name || '')}
          </div>
          <div class="wish-info">
            <div class="wish-name">${escapeHtml(d.name || '')}</div>
            <div class="wish-by">by ${escapeHtml(d.creator_id || '-')}</div>
            <button class="wish-cta"><i class="fa-solid fa-pencil"></i>預 約 雷 刻</button>
          </div>
        </div>`;
    }).join('');

    // 綁刪除按鈕
    list.querySelectorAll('.wish-remove').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation();
        const did = btn.dataset.designId;
        if (!window.confirm('從想刻清單中移除?')) return;
        const { error } = await sb
          .from('engraving_wishlist')
          .delete()
          .eq('member_id', State.member.erpid)
          .eq('design_id', did);
        if (!error) loadWishlist();
      });
    });
  }


  /* =============================================================
     Stories · 我的故事 (member_stories)
     ============================================================= */

  async function loadStories() {
    const list = document.getElementById('myStoryList');
    const countEl = document.getElementById('storyCount');
    if (!list || !State.member) return;

    const sb = getSupabase();
    if (!sb) return;

    // 先抓所有故事
    const { data: stories, error } = await sb
      .from('member_stories')
      .select('id, title, content, status, reject_reason, created_at')
      .eq('member_id', State.member.erpid)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('[讀取故事失敗]', error);
      list.innerHTML = '<p class="empty-text">讀取失敗</p>';
      return;
    }

    const items = stories || [];
    if (countEl) countEl.textContent = items.length ? items.length + ' 篇' : '';

    if (items.length === 0) {
      list.innerHTML = `
        <div class="empty">
          <i class="fa-regular fa-comment"></i>
          <div class="empty-title">還沒寫過故事</div>
          <div>分享你的眼鏡故事,讓設計被看見</div>
          <button class="empty-cta"><i class="fa-solid fa-plus"></i>寫一篇新故事</button>
        </div>`;
      return;
    }

    // 抓每篇故事的收藏次數(可選 - 簡單方法是各打一次 count)
    const favCounts = {};
    for (const s of items) {
      const { count } = await sb
        .from('story_favorites')
        .select('story_id', { count: 'exact', head: true })
        .eq('story_id', s.id);
      favCounts[s.id] = count || 0;
    }

    list.innerHTML = items.map(s => `
      <div class="story-card" data-id="${s.id}">
        <div class="story-h">
          <h3 class="story-title">${escapeHtml(s.title)}</h3>
          <div class="story-menu-wrap">
            <button class="story-menu-btn" data-story="${s.id}"><i class="fa-solid fa-ellipsis"></i></button>
            <div class="story-menu" data-menu="${s.id}">
              <button data-action="edit" data-id="${s.id}"><i class="fa-regular fa-pen-to-square"></i>編輯</button>
              <button class="danger" data-action="delete" data-id="${s.id}"><i class="fa-regular fa-trash-can"></i>刪除故事</button>
            </div>
          </div>
        </div>
        <p class="story-content">${escapeHtml(s.content)}</p>
        <div class="story-meta">
          <span>發佈於 ${formatDate(s.created_at)} · ${s.status === 'approved' ? '已公開' : s.status === 'rejected' ? '未通過' : '審核中'}</span>
          <span class="story-fav"><i class="fa-solid fa-bookmark"></i>被加入收藏 <b>${favCounts[s.id]}</b> 次</span>
        </div>
      </div>
    `).join('') + `
      <button class="story-add"><i class="fa-solid fa-plus"></i><span>寫 一 篇 新 故 事</span></button>`;

    // 綁選單按鈕
    list.querySelectorAll('.story-menu-btn').forEach(b => {
      b.addEventListener('click', e => {
        e.stopPropagation();
        const key = b.dataset.story;
        const menu = list.querySelector(`.story-menu[data-menu="${key}"]`);
        const wasOn = menu && menu.classList.contains('on');
        list.querySelectorAll('.story-menu').forEach(m => m.classList.remove('on'));
        if (menu && !wasOn) menu.classList.add('on');
      });
    });

    list.querySelectorAll('.story-menu').forEach(m => {
      m.addEventListener('click', e => e.stopPropagation());
    });

    list.querySelectorAll('[data-action="delete"]').forEach(btn => {
      btn.addEventListener('click', () => deleteStory(btn.dataset.id));
    });
  }

  async function deleteStory(id) {
    if (!id) return;
    if (!window.confirm('確定刪除這篇故事?')) return;
    const sb = getSupabase();
    const { error } = await sb
      .from('member_stories')
      .delete()
      .eq('id', id)
      .eq('member_id', State.member.erpid);
    if (error) {
      window.alert('刪除失敗');
      return;
    }
    loadStories();
  }


  /* =============================================================
     Designs · 我的刻圖設計 (Creator only)
     ============================================================= */

  async function loadMyDesigns() {
    const list = document.getElementById('myDesignList');
    const designsBlock = document.getElementById('myDesignsBlock');
    const becomeBlock = document.getElementById('becomeCreatorBlock');

    if (!list || !State.member) return;

    // Member (非 Creator) 看到 onboard CTA
    if (!State.isCreator) {
      if (designsBlock) designsBlock.style.display = 'none';
      if (becomeBlock) becomeBlock.style.display = 'block';
      return;
    }

    if (designsBlock) designsBlock.style.display = 'block';
    if (becomeBlock) becomeBlock.style.display = 'none';

    const sb = getSupabase();
    if (!sb) return;

    const { data, error } = await sb
      .from('engraving_designs')
      .select('id, name, image_url, status, reject_reason, created_at')
      .eq('creator_id', State.member.erpid)
      .order('created_at', { ascending: false });

    if (error) {
      list.innerHTML = '<p class="empty-text">讀取失敗</p>';
      return;
    }

    const designs = data || [];

    if (designs.length === 0) {
      // Creator 但還沒上架任何設計
      if (designsBlock) designsBlock.style.display = 'none';
      if (becomeBlock) becomeBlock.style.display = 'block';
      return;
    }

    // 抓每個 design 被加入想刻清單的次數
    const wishCounts = {};
    for (const d of designs) {
      const { count } = await sb
        .from('engraving_wishlist')
        .select('design_id', { count: 'exact', head: true })
        .eq('design_id', d.id);
      wishCounts[d.id] = count || 0;
    }

    const grads = ['dg1', 'dg2', 'dg3'];
    list.innerHTML = designs.map((d, i) => {
      const grad = grads[i % grads.length];
      const isApproved = d.status === 'approved';
      const isPending = d.status === 'pending';
      return `
        <div class="design-card">
          <div class="design-img ${grad}" ${d.image_url ? `style="background-image:url('${d.image_url}');background-size:cover;background-position:center"` : ''}>
            <span class="design-status ${d.status}">${isApproved ? '已 上 架' : isPending ? '審 核 中' : '未 通 過'}</span>
            ${escapeHtml(d.name || '')}
          </div>
          <div class="design-info">
            <div class="design-name">${escapeHtml(d.name || '')}</div>
            ${isApproved
              ? `<div class="design-wish"><i class="fa-solid fa-pencil"></i>被加入想刻清單 <b>${wishCounts[d.id]}</b> 次</div>`
              : `<div class="design-wish" style="color:var(--lohas-mute)"><i class="fa-regular fa-clock" style="color:var(--lohas-mute)"></i>${isPending ? '審核通過後開放收藏' : '未通過審核'}</div>`
            }
          </div>
        </div>`;
    }).join('') + `
      <button class="add-tile"><i class="fa-solid fa-plus"></i><span>上 傳 新 設 計</span></button>`;
  }


  /* =============================================================
     Analytics · 創作數據 (Creator only)
     ============================================================= */

  async function loadAnalytics() {
    if (!State.isCreator) return;
    const sb = getSupabase();
    if (!sb || !State.member) return;

    // 累計訂單(設計被使用次數 + 累計分潤)
    const { data: orders } = await sb
      .from('engraving_orders')
      .select('design_id, royalty_amount, ordered_at')
      .eq('creator_id', State.member.erpid);

    const totalUsed = (orders || []).length;
    const totalRoyalty = (orders || []).reduce((sum, o) => sum + Number(o.royalty_amount || 0), 0);

    // 上架設計數
    const { count: listedCount } = await sb
      .from('engraving_designs')
      .select('id', { count: 'exact', head: true })
      .eq('creator_id', State.member.erpid)
      .eq('status', 'approved');

    // 套到 KPI
    document.querySelectorAll('[data-stat="usedCount"]').forEach(el => el.textContent = totalUsed);
    document.querySelectorAll('[data-stat="listedCount"]').forEach(el => el.textContent = listedCount || 0);
    document.querySelectorAll('[data-stat="profileViews"]').forEach(el => el.textContent = '--'); // 需要另一個 table 紀錄
    document.querySelectorAll('[data-stat="totalRoyalty"]').forEach(el => el.textContent = '$' + totalRoyalty.toLocaleString());

    // 月柱狀圖(過去 10 個月)
    const monthly = {};
    const now = new Date();
    for (let i = 9; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0');
      monthly[key] = 0;
    }
    (orders || []).forEach(o => {
      const d = new Date(o.ordered_at);
      const key = d.getFullYear() + '/' + String(d.getMonth() + 1).padStart(2, '0');
      if (monthly[key] !== undefined) monthly[key]++;
    });

    const max = Math.max(1, ...Object.values(monthly));
    const chart = document.getElementById('analyticsChart');
    const axis = document.getElementById('analyticsAxis');
    if (chart) {
      chart.innerHTML = Object.values(monthly).map((v, i) =>
        `<div class="bar ${i % 2 ? 'high' : ''}" style="height:${Math.max(4, v / max * 100)}%"></div>`
      ).join('');
    }
    if (axis) {
      const keys = Object.keys(monthly);
      axis.innerHTML = `<span>${keys[0]}</span><span>${keys[3]}</span><span>${keys[6]}</span><span>${keys[9]}</span>`;
    }

    // 各設計表現
    const designPerf = document.getElementById('analyticsDesignPerf');
    if (designPerf) {
      const { data: designs } = await sb
        .from('engraving_designs')
        .select('id, name, image_url, listed_at, created_at')
        .eq('creator_id', State.member.erpid)
        .eq('status', 'approved');

      if (!designs || designs.length === 0) {
        designPerf.innerHTML = '<p class="empty-text">還沒有上架設計</p>';
      } else {
        const designStats = {};
        designs.forEach(d => { designStats[d.id] = { used: 0, royalty: 0 }; });
        (orders || []).forEach(o => {
          if (designStats[o.design_id]) {
            designStats[o.design_id].used++;
            designStats[o.design_id].royalty += Number(o.royalty_amount || 0);
          }
        });

        // 抓每個 design 的 wishlist 數
        const wishCounts = {};
        for (const d of designs) {
          const { count } = await sb
            .from('engraving_wishlist')
            .select('design_id', { count: 'exact', head: true })
            .eq('design_id', d.id);
          wishCounts[d.id] = count || 0;
        }

        const thumbs = ['', 't2', 't3'];
        designPerf.innerHTML = designs.map((d, i) => {
          const stats = designStats[d.id];
          const days = d.listed_at
            ? Math.floor((Date.now() - new Date(d.listed_at)) / (1000 * 60 * 60 * 24))
            : 0;
          return `
            <div class="design-perf-row">
              <div class="perf-thumb ${thumbs[i % thumbs.length]}"></div>
              <div class="perf-info">
                <div class="perf-name">${escapeHtml(d.name)}</div>
                <div class="perf-meta">已上架 ${days} 天 · 被加入想刻清單 ${wishCounts[d.id]} 次</div>
              </div>
              <div class="perf-stats">
                <div><div class="perf-stat-num purple">${stats.used}</div><div class="perf-stat-lbl">被 使 用</div></div>
                <div><div class="perf-stat-num gold">$${stats.royalty.toLocaleString()}</div><div class="perf-stat-lbl">累 計 分 潤</div></div>
              </div>
            </div>`;
        }).join('');
      }
    }
  }


  /* =============================================================
     Earnings · 分潤紀錄 (Creator only)
     ============================================================= */

  async function loadEarnings() {
    if (!State.isCreator) return;
    const sb = getSupabase();
    if (!sb || !State.member || !State.creatorInfo) return;

    const ci = State.creatorInfo;

    // 匯款資料 banner
    const banner = document.getElementById('bankBanner');
    if (banner && ci.bank_name) {
      const bs = document.getElementById('bankBannerSub');
      if (bs) bs.textContent = `${ci.bank_name}(${ci.bank_code || '--'})· 帳號末四碼 ${(ci.bank_account || '').slice(-4)} · 戶名:${ci.account_holder || '--'}`;
      banner.style.display = '';
    }

    // 匯款資料明細
    const bankInfo = document.getElementById('bankInfoList');
    if (bankInfo) {
      bankInfo.innerHTML = `
        <div class="bank-info-row"><div class="bank-info-label">收 款 戶 名</div><div class="bank-info-value">${escapeHtml(ci.account_holder || '-')}</div></div>
        <div class="bank-info-row"><div class="bank-info-label">銀 行</div><div class="bank-info-value">${escapeHtml(ci.bank_name || '-')}(${escapeHtml(ci.bank_code || '-')})</div></div>
        <div class="bank-info-row"><div class="bank-info-label">分 行</div><div class="bank-info-value">${escapeHtml(ci.bank_branch || '-')}</div></div>
        <div class="bank-info-row"><div class="bank-info-label">帳 號</div><div class="bank-info-value masked">${maskBankAccount(ci.bank_account)}</div></div>`;
    }

    // 累計分潤、本月、下次匯款
    const { data: orders } = await sb
      .from('engraving_orders')
      .select('royalty_amount, ordered_at')
      .eq('creator_id', State.member.erpid);

    const total = (orders || []).reduce((s, o) => s + Number(o.royalty_amount || 0), 0);
    const now = new Date();
    const thisMonth = (orders || [])
      .filter(o => {
        const d = new Date(o.ordered_at);
        return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
      })
      .reduce((s, o) => s + Number(o.royalty_amount || 0), 0);

    document.querySelectorAll('[data-stat="thisMonth"]').forEach(el => el.textContent = '$' + thisMonth.toLocaleString());
    document.querySelectorAll('[data-stat="totalRoyalty"]').forEach(el => el.textContent = '$' + total.toLocaleString());
    document.querySelectorAll('[data-stat="nextPayout"]').forEach(el => el.textContent = '$' + thisMonth.toLocaleString());

    // 匯款進度
    const payoutList = document.getElementById('payoutList');
    if (payoutList) {
      const { data: payouts } = await sb
        .from('royalty_payouts')
        .select('*')
        .eq('creator_id', State.member.erpid)
        .order('scheduled_date', { ascending: false })
        .limit(10);

      const items = payouts || [];
      if (items.length === 0) {
        payoutList.innerHTML = '<p class="empty-text">尚無匯款紀錄</p>';
      } else {
        payoutList.innerHTML = items.map(p => {
          const isPaid = p.status === 'paid';
          return `
            <div class="payout-row ${isPaid ? '' : 'upcoming'}">
              <div class="payout-icon ${isPaid ? 'paid-icon' : 'upcoming-icon'}">
                <i class="fa-solid fa-${isPaid ? 'check' : 'clock'}"></i>
              </div>
              <div class="payout-info">
                <div class="payout-date">${p.paid_date || p.scheduled_date || '-'} · ${isPaid ? '已匯款' : '待匯款'}</div>
                <div class="payout-meta">${escapeHtml(p.period || '')} 分潤${p.bank_account_masked ? ' · ' + p.bank_account_masked : ''}</div>
              </div>
              <div class="payout-amt">$${Number(p.amount || 0).toLocaleString()}</div>
            </div>`;
        }).join('');
      }
    }
  }


  /* =============================================================
     Photo Modal
     ============================================================= */

  const modalBg = document.getElementById('modalBg');
  const modalTitle = document.getElementById('modalTitle');
  const modalDate = document.getElementById('modalDate');
  const modalFav = document.getElementById('modalFav');
  const modalStatus = document.getElementById('modalStatus');
  const modalImg = document.getElementById('modalImg');
  const modalImgLabel = document.getElementById('modalImgLabel');
  const modalReason = document.getElementById('modalReason');
  const modalReasonText = document.getElementById('modalReasonText');
  const modalActions = document.getElementById('modalActions');

  const statusLabels = { pending: '待審核', approved: '已公開', rejected: '未通過' };
  const statusIcons = { pending: 'clock', approved: 'check', rejected: 'xmark' };

  function openPhotoModal(cover) {
    const id = cover.dataset.id;
    const name = cover.dataset.name;
    const date = cover.dataset.date;
    const status = cover.dataset.status;
    const fav = parseInt(cover.dataset.fav, 10) || 0;
    const reason = cover.dataset.reason || '';

    modalTitle.textContent = name;
    modalDate.textContent = date;
    modalImgLabel.textContent = name;

    // 大圖背景跟原本卡片一樣
    modalImg.style.background = cover.style.background || cover.style.backgroundImage || '';
    modalImg.style.backgroundSize = 'cover';
    modalImg.style.backgroundPosition = 'center';

    modalStatus.className = 'modal-status ' + status;
    modalStatus.innerHTML = `<i class="fa-solid fa-${statusIcons[status]}"></i>${statusLabels[status]}`;

    if (status === 'approved') {
      modalFav.style.display = 'inline-flex';
      modalFav.innerHTML = `<i class="fa-solid fa-bookmark"></i>被加入收藏 <b>${fav}</b> 次`;
    } else {
      modalFav.style.display = 'none';
    }

    if (status === 'rejected' && reason) {
      modalReason.classList.add('on');
      modalReasonText.textContent = reason;
    } else {
      modalReason.classList.remove('on');
    }

    let html = '';
    if (status === 'rejected') {
      html += '<button class="btn warn"><i class="fa-solid fa-rotate"></i> 重新上傳</button>';
    }
    html += `<button class="btn danger" data-action="delete-photo" data-id="${id}"><i class="fa-regular fa-trash-can"></i> 刪除照片</button>`;
    html += '<button class="btn secondary" id="modalCloseBtn">關閉</button>';
    modalActions.innerHTML = html;

    document.getElementById('modalCloseBtn').addEventListener('click', closeModal);
    const delBtn = modalActions.querySelector('[data-action="delete-photo"]');
    if (delBtn) delBtn.addEventListener('click', () => deletePhoto(delBtn.dataset.id));

    modalBg.classList.add('on');
  }

  function closeModal() { modalBg.classList.remove('on'); }


  /* =============================================================
     Avatar 上傳 (沿用現有 localStorage 邏輯)
     ============================================================= */

  function bindAvatar() {
    const btn = document.getElementById('avatarUploadBtn');
    const input = document.getElementById('avatarInput');
    const preview = document.getElementById('avatarPreview');

    if (btn && input) {
      btn.addEventListener('click', () => input.click());
    }

    if (input) {
      input.addEventListener('change', e => {
        const file = e.target.files[0];
        if (!file) return;
        if (!file.type.startsWith('image/')) {
          window.alert('請選擇圖片檔案');
          return;
        }
        const reader = new FileReader();
        reader.onload = function (ev) {
          if (preview) {
            preview.innerHTML = `<img src="${ev.target.result}" alt="會員頭像">`;
          }
          localStorage.setItem('lohasMemberAvatar', ev.target.result);
        };
        reader.readAsDataURL(file);
      });
    }
  }


  /* =============================================================
     Navigation · 頁面切換 + 登出
     ============================================================= */

  function bindNavigation() {
    // 側邊欄頁面切換
    root.querySelectorAll('.nav-link[data-page]').forEach(n => {
      n.addEventListener('click', () => goTo(n.dataset.page));
    });

    // 快捷功能跳轉
    root.querySelectorAll('.shortcut-card[data-jump]').forEach(c => {
      c.addEventListener('click', () => goTo(c.dataset.jump));
    });

    // 登出
    document
      .querySelectorAll('#logout-btn-sidebar, #mobile-logout-btn')
      .forEach(b => b.addEventListener('click', () => Auth.logout && Auth.logout()));

    // Modal 關閉
    document.getElementById('modalClose').addEventListener('click', closeModal);
    modalBg.addEventListener('click', e => { if (e.target === modalBg) closeModal(); });
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && modalBg.classList.contains('on')) closeModal();
    });

    // 點外面關閉故事選單
    document.addEventListener('click', () => {
      root.querySelectorAll('.story-menu').forEach(m => m.classList.remove('on'));
    });
  }

  function goTo(page) {
    root.querySelectorAll('.nav-link').forEach(x => x.classList.remove('on'));
    const navLink = root.querySelector(`.nav-link[data-page="${page}"]`);
    if (navLink) navLink.classList.add('on');

    root.querySelectorAll('.content-page').forEach(p => {
      p.classList.toggle('on', p.dataset.page === page);
    });

    // 進入頁面時延遲載入該頁資料
    if (page === 'photos') loadPhotos();
    if (page === 'inspo') loadInspos();
    if (page === 'wishlist') loadWishlist();
    if (page === 'stories') loadStories();
    if (page === 'my-designs') loadMyDesigns();
    if (page === 'analytics') loadAnalytics();
    if (page === 'earnings') loadEarnings();

    root.querySelector('.main').scrollTop = 0;
  }


  /* =============================================================
     Init
     ============================================================= */

  async function init() {
    const ok = await loadIdentity();
    if (!ok) return;

    applyIdentity();
    bindAvatar();
    bindNavigation();

    // 預載入首頁需要的東西
    if (State.isCreator) loadAnalytics(); // 首頁累計數據
  }

  document.addEventListener('DOMContentLoaded', init);


  /* =============================================================
     Export
     ============================================================= */

  window.LohasMemberPortal = {
    State,
    loadPhotos,
    loadInspos,
    loadWishlist,
    loadStories,
    loadMyDesigns,
    loadAnalytics,
    loadEarnings,
    goTo
  };

})(window);
