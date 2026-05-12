/* =============================================================
   創作者刻圖市集 · market.js
   -------------------------------------------------------------
   功能:
   - 從 Supabase engraving_designs 載入設計 (status='approved')
   - 從 creator_info 載入創作者資料 (含本月精選)
   - 三大區塊 grid 渲染 (Creator / Member / Collab 各 9 件)
   - Sidebar 分類切換
   - 搜尋框即時過濾
   - 設計卡點開 Modal (含縮圖切換、願望清單、立即使用)
   - 願望清單 toggle (透過 wishlist_designs)
   - Toast 提示
   - Fallback: Supabase 失敗時用內建示範資料
   ============================================================= */

(function(){
  'use strict';

  // ===== State =====
  var State = {
    designs: [],          // 全部設計
    creators: {},         // member_id → creator_info
    featuredCreator: null,
    wishlistIds: new Set(),
    activeTier: 'all',
    searchTerm: '',
    member: null,
  };

  var root, ovl, toast;
  var tierName = { member:'Member', creator:'Creator', collab:'Collab' };
  var tierIcon = {
    member: '',
    creator: '<i class="fa-solid fa-star"></i>',
    collab: '<i class="fa-solid fa-crown"></i>',
  };
  var coverMap = {
    'cover-1':'#A8927A','cover-2':'#9D8868','cover-3':'#765F4A',
    'cover-4':'#5A4A35','cover-5':'#7A6B5C','cover-6':'#3D2F2C',
    'cover-7':'#A85A4A','cover-8':'#7A6230','cover-9':'#8B7558',
    'cover-10':'#A8927A','cover-11':'#765F4A','cover-12':'#5A4A35',
    'cover-13':'#9D8868','cover-14':'#A8927A','cover-15':'#765F4A',
  };


  // ===== DOM Ready =====
  document.addEventListener('DOMContentLoaded', init);

  async function init(){
    root  = document.getElementById('cm');
    ovl   = document.getElementById('ovl');
    toast = document.getElementById('toast');

    if(!root) return;

    // 取會員 (若已登入)
    try {
      State.member = window.LohasAuth?.getStoredMember?.() || null;
    } catch(e){ State.member = null }

    bindEvents();

    // 從 Supabase 取資料,失敗就用示範資料
    try {
      await loadFromSupabase();
    } catch(e) {
      console.warn('[market] Supabase 載入失敗, 用示範資料:', e);
      loadFallbackData();
    }

    renderFeatured();
    renderAllSections();
    if(State.member) await loadWishlist();
  }


  // ===== Supabase 載入 =====
  function getSupabaseClient(){
    return window.LohasSupabase?.getClient?.() || window.Supabase?.client || null;
  }

  async function loadFromSupabase(){
    var sb = getSupabaseClient();
    if(!sb) throw new Error('Supabase client not available');

    // 取已通過設計
    var { data: rawDesigns, error: e1 } = await sb
      .from('engraving_designs')
      .select('id, name, type, creator_id, member_id, image_url, mock_url, story_text, created_at')
      .eq('status', 'approved')
      .order('created_at', { ascending: false })
      .limit(60);
    if(e1) throw e1;

    rawDesigns = rawDesigns || [];

    // 取所有相關創作者 / 會員資料
    var creatorIds = Array.from(new Set(rawDesigns.map(function(d){
      return d.creator_id || d.member_id;
    }).filter(Boolean)));

    if(creatorIds.length){
      var { data: creators, error: e2 } = await sb
        .from('creator_info')
        .select('member_id, display_name, short_tag, avatar_url, joining_story, status')
        .in('member_id', creatorIds);
      if(e2) throw e2;
      (creators || []).forEach(function(c){ State.creators[String(c.member_id)] = c });
    }

    State.designs = rawDesigns.map(normalizeDesign);

    // 取本月精選: 優先選第一位創作者, 若沒有就用第一筆作品的作者資訊
    var featuredDesign = State.designs.find(function(d){ return d.tier === 'creator' && d.creator_id; }) || State.designs[0];
    if(featuredDesign){
      var fc = State.creators[String(featuredDesign.creator_id || featuredDesign.member_id)] || null;
      State.featuredCreator = fc ? {
        member_id: fc.member_id,
        display_name: fc.display_name || featuredDesign.by,
        short_tag: fc.short_tag || '精選創作者',
        avatar_url: fc.avatar_url,
        joining_story: fc.joining_story,
        quote: fc.joining_story || featuredDesign.quote,
        design_count: State.designs.filter(function(d){ return String(d.creator_id || d.member_id) === String(fc.member_id); }).length,
        use_count: 87,
        story_count: 2
      } : {
        display_name: featuredDesign.by || '精選創作者',
        short_tag: '本月精選',
        avatar_initials: (featuredDesign.by || 'LO').substring(0,2).toUpperCase(),
        quote: featuredDesign.quote || '每一張設計,都是一個被認真活過的故事。',
        design_count: 1,
        use_count: 0,
        story_count: 0
      };
    }
  }

  function normalizeDesign(d, index){
    var type = String(d.type || '').toLowerCase();
    var tier = d.tier || (type === 'kol' || type === 'creator' ? 'creator' : (type === 'ip' || type === 'collab' ? 'collab' : 'member'));
    var creator = State.creators[String(d.creator_id || d.member_id)] || {};
    var by = d.by || creator.display_name || d.creator_name || d.member_name || maskMemberName(d.member_id || d.creator_id);
    var n = typeof index === 'number' ? index : Math.abs(hashCode(String(d.id || d.name || '0')) % 15);

    return Object.assign({}, d, {
      tier: tier,
      by: by || 'LOHAS Member',
      coverCls: d.coverCls || ('cover-' + ((n % 15) + 1)),
      coverText: d.coverText || d.name || '刻 圖 設 計',
      quote: d.quote || d.story_text || creator.joining_story || '每一張設計,都是一個被認真活過的故事。'
    });
  }

  function maskMemberName(v){
    if(!v) return '';
    var s = String(v);
    return s.length > 3 ? s.charAt(0) + '*' + s.slice(-1) : s;
  }

  function hashCode(s){
    var h = 0;
    for(var i=0; i<s.length; i++){ h = ((h << 5) - h) + s.charCodeAt(i); h |= 0; }
    return h;
  }

  // ===== Fallback 示範資料 =====
  function loadFallbackData(){
    var samples = [
      // Creator (9)
      { tier:'creator', name:'兔子蛋糕',         by:'EMO Bonnie',         coverCls:'cover-1',  coverText:'兔 子 蛋 糕',   quote:'她吃過很多種蛋糕,但只有這一個讓她想刻在眼鏡上。' },
      { tier:'creator', name:'情緒表情包 · 哭哭', by:'EMO Bonnie',         coverCls:'cover-4',  coverText:'哭 哭 表 情',   quote:'眼淚不是壞事,只是它有時候比話還誠實。' },
      { tier:'creator', name:'小兔愛心',         by:'EMO Bonnie',         coverCls:'cover-7',  coverText:'小 兔 愛 心',   quote:'愛是把自己藏在最容易看見的地方。' },
      { tier:'creator', name:'狐狐好朋友',       by:'插畫家二毛',         coverCls:'cover-10', coverText:'狐 狐 好 朋 友', quote:'有些朋友只在森林裡見得到。' },
      { tier:'creator', name:'兔子失眠',         by:'EMO Bonnie',         coverCls:'cover-13', coverText:'兔 子 失 眠',   quote:'凌晨三點的兔子,跟你一樣睡不著。' },
      { tier:'creator', name:'歪嘴鳥',           by:'插畫家二毛',         coverCls:'cover-2',  coverText:'歪 嘴 鳥',      quote:'歪一點才有風格。' },
      { tier:'creator', name:'裝睡的貓',         by:'米雅繪圖筆記',       coverCls:'cover-9',  coverText:'裝 睡 的 貓',   quote:'貓不裝睡,只是看穿了你。' },
      { tier:'creator', name:'第一次流淚',       by:'EMO Bonnie',         coverCls:'cover-3',  coverText:'第 一 次 流 淚', quote:'第一次流淚的人,從此學會了一種語言。' },
      { tier:'creator', name:'夜晚月光',         by:'鴨梨子',             coverCls:'cover-6',  coverText:'夜 晚 月 光',   quote:'月光不是燈,是某個人留下的影子。' },

      // Member (9)
      { tier:'member',  name:'月契之紋',         by:'黃*哲',              coverCls:'cover-3',  coverText:'月 契 之 紋',   quote:'答應自己的事,要刻在看得見的地方。' },
      { tier:'member',  name:'哭哭貓咪',         by:'孫*丞',              coverCls:'cover-5',  coverText:'哭 哭 貓 咪',   quote:'我家的貓不哭,所以我替他哭。' },
      { tier:'member',  name:'初戀簽名',         by:'林*婕',              coverCls:'cover-8',  coverText:'初 戀 簽 名',   quote:'那年的字,沒有電子簽名能取代。' },
      { tier:'member',  name:'媽媽的字',         by:'陳*萱',              coverCls:'cover-11', coverText:'媽 媽 的 字',   quote:'她的字寫在我的眼鏡裡,看世界的時候帶著她。' },
      { tier:'member',  name:'外婆食譜',         by:'王*荷',              coverCls:'cover-1',  coverText:'外 婆 食 譜',   quote:'她的鹹度沒有公克,只有「再多一點」。' },
      { tier:'member',  name:'小學同學',         by:'吳*翰',              coverCls:'cover-14', coverText:'小 學 同 學',   quote:'長大後才知道,那些名字不會消失。' },
      { tier:'member',  name:'第一次約會',       by:'葉*臻',              coverCls:'cover-7',  coverText:'第 一 次 約 會', quote:'記住那一天,比戀愛本身更珍貴。' },
      { tier:'member',  name:'大學畢業',         by:'許*綸',              coverCls:'cover-8',  coverText:'大 學 畢 業',   quote:'四年的開始與結束,都在一張照片裡。' },
      { tier:'member',  name:'外公的釣竿',       by:'賴*斌',              coverCls:'cover-15', coverText:'外 公 的 釣 竿', quote:'他釣的不是魚,是耐心。' },

      // Collab (9)
      { tier:'collab',  name:'DINU 狗狗',         by:'DTTO FRIENDS',       coverCls:'cover-2',  coverText:'DINU 狗狗',     quote:'每隻狗都應該被允許不完美。' },
      { tier:'collab',  name:'魔杖 · 限定刻字',   by:'WIZARDING WORLD',    coverCls:'cover-6',  coverText:'哈 利 波 特',   quote:'魔法不在杖裡,在揮動之間。' },
      { tier:'collab',  name:'吉伊卡娃 · 害羞',   by:'CHIIKAWA OFFICIAL',  coverCls:'cover-9',  coverText:'C H I I K A W A', quote:'有點害羞,但還是想跟你打招呼。' },
      { tier:'collab',  name:'喵喵怪 · 翻肚',     by:'胸毛公寓',           coverCls:'cover-12', coverText:'野 生 喵 喵 怪', quote:'信任你,才會這樣躺著。' },
      { tier:'collab',  name:'杏仁ミル',         by:'マカ猫',             coverCls:'cover-4',  coverText:'杏 仁 ミ ル',   quote:'軟糯,但有自己的形狀。' },
      { tier:'collab',  name:'DINU 飯糰',         by:'DTTO FRIENDS',       coverCls:'cover-15', coverText:'D I N U 飯 糰',  quote:'再小的事,圓圓的就是好的。' },
      { tier:'collab',  name:'霍格華茲徽章',     by:'WIZARDING WORLD',    coverCls:'cover-13', coverText:'哈 利 波 特 II', quote:'你的學院,選擇了你。' },
      { tier:'collab',  name:'烏薩奇 · 派對',     by:'CHIIKAWA OFFICIAL',  coverCls:'cover-14', coverText:'烏 薩 奇',      quote:'派對才正要開始,不要先睡。' },
      { tier:'collab',  name:'喵喵跳跳',         by:'胸毛公寓',           coverCls:'cover-5',  coverText:'喵 喵 跳 跳',   quote:'跳起來不是為了什麼,只是想跳。' },
    ];

    State.designs = samples.map(function(s, i){
      return { id:'sample-'+i, tier:s.tier, name:s.name, by:s.by, coverCls:s.coverCls, coverText:s.coverText, quote:s.quote };
    });

    State.featuredCreator = {
      display_name: 'EMO Bonnie',
      short_tag: '情緒化的兔子',
      avatar_initials: 'EM',
      design_count: 5,
      use_count: 87,
      story_count: 2,
      quote: '眼鏡居然可以自己設計?我把兔子蛋糕刻進去了。每次戴上的時候,就像把心情藏在最容易看見的地方。',
    };
  }


  // ===== 本月精選 =====
  function renderFeatured(){
    var c = State.featuredCreator;
    if(!c) return;
    setText('featuredName',    c.display_name || '');
    setText('featuredTag',     (c.short_tag || '') + ' · 上架 ' + (c.design_count || 0) + ' 件設計');
    setText('featuredQuote',   c.quote || c.joining_story || '');
    setText('featuredUses',    c.use_count || 0);
    setText('featuredStories', c.story_count || 0);

    var avatar = document.getElementById('featuredAvatar');
    if(avatar){
      if(c.avatar_url){
        avatar.style.backgroundImage = 'url(' + c.avatar_url + ')';
        avatar.style.backgroundSize = 'cover';
        avatar.style.backgroundPosition = 'center';
        avatar.textContent = '';
      } else {
        avatar.textContent = c.avatar_initials || (c.display_name || '?').substring(0,2).toUpperCase();
      }
    }

    var hero = document.getElementById('featuredHero');
    if(hero && c.member_id){
      hero.href = 'creator-public.html?id=' + encodeURIComponent(c.member_id);
    } else if(hero) {
      hero.addEventListener('click', function(e){
        e.preventDefault();
        showToast('進入 ' + (c.display_name || '創作者') + ' 個人頁');
      });
    }
  }


  // ===== 三大區塊 grid =====
  function renderAllSections(){
    var byTier = { creator:[], member:[], collab:[] };
    State.designs.forEach(function(d){
      var t = d.tier || (d.type === 'kol' ? 'creator' : (d.type === 'ip' ? 'collab' : 'member'));
      if(byTier[t]) byTier[t].push(d);
    });

    setText('countAll',      State.designs.length);
    setText('countMember',   byTier.member.length);
    setText('countCreator',  byTier.creator.length);
    setText('countCollab',   byTier.collab.length);
    setText('seeAllMember',  byTier.member.length);
    setText('seeAllCreator', byTier.creator.length);
    setText('seeAllCollab',  byTier.collab.length);

    renderGrid('creator', byTier.creator.slice(0,9));
    renderGrid('member',  byTier.member.slice(0,9));
    renderGrid('collab',  byTier.collab.slice(0,9));
    renderCollabGrid(byTier.collab.slice(0,4));
  }

  function renderGrid(tier, list){
    var grid = root.querySelector('.design-grid[data-grid="'+tier+'"]');
    if(!grid) return;

    if(!list.length){
      grid.innerHTML = '<div class="design-empty">這個分類還沒有作品</div>';
      return;
    }

    grid.innerHTML = list.map(function(d){
      var coverCls = d.coverCls || ('cover-'+ (Math.floor(Math.random()*15)+1));
      var coverText = d.coverText || (d.name || '');
      var imageStyle = d.image_url ? ' style="background-image:url('+escapeAttr(d.image_url)+');background-size:cover;background-position:center;"' : '';
      var imageText = d.image_url ? '' : escapeHtml(coverText);
      return '<div class="design-card" data-id="'+escapeAttr(d.id)+'" data-tier="'+tier+'">' +
        '<div class="design-cover '+coverCls+'"'+imageStyle+'>' +
          '<span class="design-card-pill"><span class="pill '+tier+'">'+tierIcon[tier]+tierName[tier]+'</span></span>' +
          imageText +
        '</div>' +
        '<div class="design-info">' +
          '<div class="design-name">'+escapeHtml(d.name || '')+'</div>' +
          '<div class="design-by">by '+escapeHtml(d.by || '')+'</div>' +
        '</div>' +
      '</div>';
    }).join('');

    // 綁卡片點擊
    grid.querySelectorAll('.design-card').forEach(function(card){
      card.addEventListener('click', function(){
        var id = card.dataset.id;
        var design = State.designs.find(function(x){ return String(x.id) === String(id) });
        if(design) openModal(design, tier);
      });
    });
  }

  function renderCollabGrid(list){
    var grid = document.getElementById('collabGrid');
    if(!grid) return;

    if(!list.length){
      grid.innerHTML = '<div class="design-empty">目前尚無官方授權聯名</div>';
      return;
    }

    grid.innerHTML = list.map(function(d, i){
      var coverCls = 'col-cov-' + ((i % 4) + 1);
      var imageStyle = d.image_url ? ' style="background-image:url('+escapeAttr(d.image_url)+');background-size:cover;background-position:center;"' : '';
      var imageText = d.image_url ? '' : escapeHtml(d.coverText || d.name || '');
      return '<div class="collab-card" data-id="'+escapeAttr(d.id)+'">' +
        '<div class="collab-card-badge"><i class="fa-solid fa-crown"></i>Official</div>' +
        '<div class="collab-cover '+coverCls+'"'+imageStyle+'>'+imageText+'</div>' +
        '<div class="collab-info">' +
          '<div class="collab-name">'+escapeHtml(d.name || '')+'</div>' +
          '<div class="collab-by">'+escapeHtml(d.by || '')+'</div>' +
        '</div>' +
      '</div>';
    }).join('');

    grid.querySelectorAll('.collab-card').forEach(function(card){
      card.addEventListener('click', function(){
        var id = card.dataset.id;
        var design = State.designs.find(function(x){ return String(x.id) === String(id) });
        if(design) openModal(design, 'collab');
      });
    });
  }


  // ===== Sidebar 分類切換 =====
  function bindCategoryFilter(){
    root.querySelectorAll('.cat-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        root.querySelectorAll('.cat-btn').forEach(function(b){ b.classList.remove('on') });
        btn.classList.add('on');
        State.activeTier = btn.dataset.tier;
        root.querySelectorAll('.market-block[data-section]').forEach(function(blk){
          var show = (State.activeTier === 'all' || blk.dataset.section === State.activeTier);
          blk.style.display = show ? '' : 'none';
        });
      });
    });
  }


  // ===== 搜尋 =====
  function bindSearch(){
    var input = document.getElementById('marketSearch');
    if(!input) return;
    var timer;
    input.addEventListener('input', function(){
      clearTimeout(timer);
      timer = setTimeout(function(){
        State.searchTerm = input.value.trim().toLowerCase();
        applySearch();
      }, 200);
    });
  }

  function applySearch(){
    var term = State.searchTerm;
    root.querySelectorAll('.design-card').forEach(function(card){
      if(!term){ card.style.display = ''; return }
      var text = (card.textContent || '').toLowerCase();
      card.style.display = text.indexOf(term) >= 0 ? '' : 'none';
    });
  }


  // ===== Modal =====
  function openModal(d, tier){
    var coverCls = d.coverCls || 'cover-1';
    var coverText = d.coverText || d.name || '';
    var by = d.by || '';
    var byInit = (by || '?').charAt(0);

    var slideDesign = document.getElementById('slide-design');
    var thumbDesign = document.getElementById('thumb-design');
    if(d.image_url){
      slideDesign.style.background = 'url(' + d.image_url + ') center/cover no-repeat';
      thumbDesign.style.background = 'url(' + d.image_url + ') center/cover no-repeat';
      document.getElementById('modalDesignText').textContent = '';
    } else {
      slideDesign.style.background = coverMap[coverCls] || '#A8927A';
      thumbDesign.style.background = coverMap[coverCls] || '#A8927A';
      document.getElementById('modalDesignText').textContent = coverText;
    }
    if(d.mock_url){
      document.getElementById('slide-mock').style.background = 'url(' + d.mock_url + ') center/cover no-repeat';
    } else {
      document.getElementById('slide-mock').style.background = 'linear-gradient(135deg,#765F4A,#3D2F2C)';
    }
    document.getElementById('modalPill').innerHTML = '<span class="pill ' + tier + '">' + tierIcon[tier] + tierName[tier] + '</span>';

    var avatar = document.getElementById('modalByAvatar');
    avatar.className = 'modal-by-avatar ' + tier;
    avatar.textContent = byInit;

    document.getElementById('modalByLabel').textContent = 'designed by · ' + tierName[tier];
    document.getElementById('modalByName').innerHTML = escapeHtml(by) + ' <span class="pill ' + tier + '" style="font-size:10px;padding:1.5px 7px">' + tierIcon[tier] + tierName[tier] + '</span>';
    document.getElementById('modalTitle').textContent = d.name || '';
    document.getElementById('modalCat').textContent = '圖案 · 客製作品';
    document.getElementById('modalQuote').textContent = d.quote || '每一張設計,都是一個被認真活過的故事。';

    setSlide('design');

    // 願望清單狀態
    var inWish = State.wishlistIds.has(String(d.id));
    setWishlistState(inWish);

    // 立即使用 → 跳到雷刻服務頁
    document.getElementById('useBtn').onclick = function(){
      window.location.href = 'engraving.html?design=' + encodeURIComponent(d.id);
    };

    // 願望清單 toggle
    document.getElementById('wishBtn').onclick = function(){
      toggleWishlist(d.id);
    };

    ovl.classList.add('show');
    ovl.setAttribute('aria-hidden', 'false');
  }

  function closeModal(){
    ovl.classList.remove('show');
    ovl.setAttribute('aria-hidden', 'true');
  }

  function setSlide(which){
    var sd = document.getElementById('slide-design');
    var sm = document.getElementById('slide-mock');
    var td = document.getElementById('thumb-design');
    var tm = document.getElementById('thumb-mock');
    if(which === 'design'){
      sd.classList.add('on'); sm.classList.remove('on');
      td.classList.add('on'); tm.classList.remove('on');
    } else {
      sm.classList.add('on'); sd.classList.remove('on');
      tm.classList.add('on'); td.classList.remove('on');
    }
  }


  // ===== Wishlist =====
  async function loadWishlist(){
    if(!State.member) return;
    var sb = getSupabaseClient();
    if(!sb) return;
    try {
      var { data } = await sb
        .from('wishlist_designs')
        .select('design_id')
        .eq('member_id', String(State.member.erpid));
      State.wishlistIds = new Set((data || []).map(function(r){ return String(r.design_id) }));
    } catch(e){
      console.warn('[market] 願望清單載入失敗:', e);
    }
  }

  async function toggleWishlist(designId){
    if(!State.member){
      showToast('請先登入才能加入願望清單');
      try { localStorage.setItem('redirectAfterLogin', 'market.html'); } catch(e){}
      setTimeout(function(){ window.location.href = 'login.html' }, 1200);
      return;
    }

    var sb = getSupabaseClient();
    var memberId = String(State.member.erpid || State.member.member_id || State.member.id || '');
    var idStr = String(designId);

    if(State.wishlistIds.has(idStr)){
      // 移除
      State.wishlistIds.delete(idStr);
      setWishlistState(false);
      showToast('已從願望清單移除');
      if(sb){
        await sb.from('wishlist_designs').delete()
          .eq('member_id', memberId).eq('design_id', idStr);
      }
    } else {
      // 加入
      State.wishlistIds.add(idStr);
      setWishlistState(true);
      showToast('已加入願望清單');
      if(sb){
        await sb.from('wishlist_designs').insert({
          member_id: memberId,
          design_id: idStr,
          created_at: new Date().toISOString(),
        });
      }
    }
  }

  function setWishlistState(inWish){
    var btn  = document.getElementById('wishBtn');
    var txt  = document.getElementById('wishText');
    var icon = btn.querySelector('i');
    if(inWish){
      btn.classList.add('added');
      txt.textContent = '已 在 願 望 清 單';
      icon.className = 'fa-solid fa-heart';
    } else {
      btn.classList.remove('added');
      txt.textContent = '加 入 願 望 清 單';
      icon.className = 'fa-regular fa-heart';
    }
  }


  // ===== Toast =====
  function showToast(msg){
    document.getElementById('toastText').textContent = msg;
    toast.classList.add('show');
    setTimeout(function(){ toast.classList.remove('show') }, 1800);
  }


  // ===== 事件繫結 =====
  function bindEvents(){
    bindCategoryFilter();
    bindSearch();

    // Modal 關閉
    var closeBtn = document.getElementById('closeBtn');
    if(closeBtn) closeBtn.addEventListener('click', closeModal);
    if(ovl) ovl.addEventListener('click', closeModal);
    document.addEventListener('keydown', function(e){
      if(ovl && ovl.classList.contains('show') && e.key === 'Escape') closeModal();
    });

    // 縮圖切換
    var tD = document.getElementById('thumb-design');
    var tM = document.getElementById('thumb-mock');
    if(tD) tD.addEventListener('click', function(){ setSlide('design') });
    if(tM) tM.addEventListener('click', function(){ setSlide('mock') });
  }


  // ===== Utils =====
  function setText(id, v){
    var el = document.getElementById(id);
    if(el) el.textContent = v;
  }
  function escapeHtml(s){
    return String(s == null ? '' : s).replace(/[&<>"']/g, function(c){
      return { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c];
    });
  }
  function escapeAttr(s){
    return String(s == null ? '' : s).replace(/"/g, '&quot;');
  }

})();
