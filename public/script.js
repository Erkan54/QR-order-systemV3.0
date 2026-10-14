// =========================
//  QR SİPARİŞ - script.js (FINAL + BADGE + ONAY + FIX)
// =========================
let IS_USER_LOGGED_IN = false; // Varsayılan: Giriş yok
window.cart = window.cart || [];
let MENU_BY_ID = {};        
let CATEGORY_MAP = {};      
let ALL_CAMPAIGNS = [];     
let SELECTED_KAMPANYA = null;

// SİHİRBAZ DURUMU
let WIZARD_STATE = {
  activeCamp: null,
  steps: [],
  currentStepIndex: 0,
  selections: {} 
};

function $(sel) { return document.querySelector(sel); }
function adjustPadding() {
  const header = document.querySelector("header");
  if (header) {
    document.body.style.paddingTop = (header.offsetHeight + 10) + "px";
  }
}
function money(n) { return Number(n || 0).toFixed(2) + " ₺"; }
function toast(m) { alert(m); }
const FETCH_OPTS = { credentials: "include", cache: "no-store" };

// Masa ID
function getMasaId() {
  const u = new URL(location.href);
  const q = u.searchParams.get("masa") || u.searchParams.get("masa_id");
  if (q && !isNaN(q)) sessionStorage.setItem("masa_id", String(parseInt(q, 10)));
  const saved = sessionStorage.getItem("masa_id");
  return saved ? Number(saved) : null;
}
function showMasaChip() { const el = $("#masa-chip"); if (el) el.textContent = getMasaId() ? `#${getMasaId()}` : "—"; }

// =========================================
// 1. MENÜ YÜKLEME
// =========================================
async function fetchAndRenderMenu() {
  try {
    const res = await fetch("/api/menu", FETCH_OPTS);
    const grouped = await res.json();

    const catRes = await fetch("/api/admin/kategoriler");
    const categories = await catRes.json();
    const catNameIdMap = {};
    categories.forEach(c => catNameIdMap[c.kategori_adi] = c.kategori_id);

    MENU_BY_ID = {};
    CATEGORY_MAP = {};
    
    const root = $("#menu");
    const navRoot = $("#category-nav");
    if (root) root.innerHTML = "";
    if (navRoot) navRoot.innerHTML = "";

    Object.keys(grouped).forEach((katName, index) => {
      const catId = catNameIdMap[katName];
      if(catId) CATEGORY_MAP[catId] = [];

      if (navRoot) {
        const btn = document.createElement("button");
        btn.className = `cat-btn ${index === 0 ? "active" : ""}`;
        btn.textContent = katName;
        btn.onclick = () => {
          document.querySelectorAll(".cat-btn").forEach(b => b.classList.remove("active"));
          btn.classList.add("active");
          document.getElementById(`cat-${index}`).scrollIntoView({ behavior: "smooth", block: "start" });
        };
        navRoot.appendChild(btn);
      }

      const sec = document.createElement("section");
      sec.id = `cat-${index}`;
      sec.className = "menu-section";
      sec.innerHTML = `<h3>${katName}</h3>`;
      const list = document.createElement("div");
      list.className = "menu-list";

grouped[katName].forEach(item => {
    MENU_BY_ID[item.urun_id] = { ...item, fiyat: Number(item.fiyat), kategori_id: catId };
    if(catId) CATEGORY_MAP[catId].push(item.urun_id);

    const card = document.createElement("div");
    card.className = "menu-item";
    
    // YENİ EKLENEN SATIR: Kartı bulabilmek için ID veriyoruz
    card.setAttribute("data-id", item.urun_id); 

    if (item.resim_url) card.style.backgroundImage = `url('${item.resim_url}')`;

    // Puan badge mantığı (mevcut kodun)
    // --- ŞU KISMI BUL VE SİL ---

    const puanBadgeHtml = IS_USER_LOGGED_IN ? `
      <div style="font-size:0.6rem; color:#000; font-weight:700; display:flex; align-items:center; background:#ffc107; padding:2px 6px; border-radius:12px; box-shadow:0 0 6px rgba(255, 193, 7, 0.6);">
        +${item.puan_degeri || 1} PUAN
      </div>
    ` : '';

    card.innerHTML = `
      <div class="menu-item-title">${item.urun_adi}</div>
      <div class="menu-item-desc">${item.aciklama || ""}</div>
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom: 10px; position:relative; z-index:2; width:100%;">
        <div class="menu-item-price" style="margin-bottom:0;">${money(item.fiyat)}</div>
        ${puanBadgeHtml}
      </div>
      <button class="btn add" onclick="openProductModal(${item.urun_id})">Ekle</button>
    `;
    list.appendChild(card);
    
    // YENİ EKLENEN SATIR: Sayfa açıldığında sepette varsa badge'i hemen göster
    updateProductBadge(item.urun_id);
      });
      sec.appendChild(list);
      if(root) root.appendChild(sec);
    });
    adjustPadding();
  } catch (e) { console.error(e); }
}

// =========================================
// 2. SEPET
// =========================================
function addToCart(id) {
  // Yeni ürün eklendi, mini sepet drawer'ını aç
  const drawer = document.querySelector("#fc-drawer");
  if (drawer) drawer.classList.remove("collapsed");
  const item = window.cart.find(x => x.urun_id === id);
  if (item) item.adet++;
  else {
    const info = MENU_BY_ID[id];
    window.cart.push({ urun_id: id, urun_adi: info.urun_adi, fiyat: info.fiyat, adet: 1 });
  }
  renderCart();
  updateProductBadge(id); // <--- BURAYA EKLE
}
function removeFromCart(id) {
  const removedItem = window.cart.find(x => x.urun_id === id);
  if (!removedItem) return;

  // Ürünü sil
  window.cart = window.cart.filter(x => x.urun_id !== id);

  // Eğer bu ürün bir koşul ürünüyse → aynı kampanyanın ödül ürünlerini de sil
  cleanupRewardsIfConditionRemoved(removedItem);

  renderCart();
  
  // EKLENEN KISIM: Silme işleminden sonra balonu güncelle/gizle
  updateProductBadge(id);
}

function updateQty(id, delta) {
  // 1. Sepetteki ürünü bul
  const item = window.cart.find(x => x.urun_id === id);
  if (!item) return;

  // 2. Sepet verisini güncelle (sayıyı artır veya azalt)
  item.adet += delta;

  // 3. Eğer sayı 0'a düştüyse ürünü sepetten tamamen sil
  if (item.adet <= 0) {
    const removed = { ...item };
    window.cart = window.cart.filter(x => x.urun_id !== id);
    // Varsa kampanya bağlantılarını temizle
    if (typeof cleanupRewardsIfConditionRemoved === "function") {
        cleanupRewardsIfConditionRemoved(removed);
    }
  }

  // 4. Sepet ekranını (gönderdiğin resimdeki alanı) yenile
  renderCart();

  // 5. KRİTİK NOKTA BURASI: 
  // Sepette işlem yapıldığı an, menüdeki o yeşil sayacı (badge) tetikle.
  updateProductBadge(id); 
}
function renderCart() {
  const root = $("#cart-items");
  root.innerHTML = "";
  if (window.cart.length === 0) {
    root.innerHTML = `<div style="text-align:center; padding:20px; color:#999">Sepetiniz boş</div>`;
    renderSummary(0);
    return;
  }

  let total = 0;
  window.cart.forEach(item => {
    const isDiscounted = item.indirim_oran > 0;
    const finalPrice = isDiscounted 
      ? item.fiyat * (1 - item.indirim_oran/100) 
      : item.fiyat;
    
    total += finalPrice * item.adet;

    const row = document.createElement("div");
    row.className = "cart-row";
    
    let priceHtml = money(item.fiyat * item.adet);
    if(isDiscounted) {
      priceHtml = `<s style="color:#999; font-size:0.8em">${money(item.fiyat * item.adet)}</s> <b>${money(finalPrice * item.adet)}</b>`;
    }

    row.innerHTML = `
      <div class="cart-name">
        ${item.urun_adi} 
        ${isDiscounted ? `<span style="color:var(--primary); font-size:0.7em">(${item.kampanya_adi})</span>` : ''}
      </div>
      <div style="display:flex; align-items:center; gap:5px;">
        ${!isDiscounted ? `<button class="btn add" style="padding:2px 8px" onclick="updateQty(${item.urun_id}, -1)">-</button>` : ''}
        <span style="font-weight:600; width:20px; text-align:center;">${item.adet}</span>
        ${!isDiscounted ? `<button class="btn add" style="padding:2px 8px" onclick="updateQty(${item.urun_id}, 1)">+</button>` : ''}
      </div>
      <div class="cart-price">${priceHtml}</div>
    `;
    root.appendChild(row);
  });
  renderSummary(total);
}

function renderSummary(total) {
  $("#ara-toplam").textContent = money(total);
  $("#genel-toplam").textContent = money(total);
  updateFloatingCart(total);
}

// =========================================
// FLOATING MINI CART
// =========================================
let _cartPanelVisible = false;

function updateFloatingCart(total) {
  const fc = $("#floatingCart");
  if (!fc) return;

  const fcTotal = $("#fc-total");
  if (fcTotal) fcTotal.textContent = money(total);

  // Ürün listesini çiz
  const itemsRoot = $("#fc-items");
  if (itemsRoot) {
    itemsRoot.innerHTML = "";
    window.cart.forEach(item => {
      const finalPrice = item.indirim_oran > 0
        ? item.fiyat * (1 - item.indirim_oran / 100)
        : item.fiyat;
      const row = document.createElement("div");
      row.className = "fc-row";
      row.innerHTML = `
        <div class="fc-name">${item.urun_adi}</div>
        <div class="fc-controls">
          <button onclick="updateQty(${item.urun_id}, -1)">−</button>
          <span class="fc-qty">${item.adet}</span>
          <button onclick="updateQty(${item.urun_id}, 1)">+</button>
        </div>
        <div class="fc-price">${money(finalPrice * item.adet)}</div>
      `;
      itemsRoot.appendChild(row);
    });
  }

  // Göster / Gizle (tüm fc)
  const count = window.cart.length;
  if (count > 0 && !_cartPanelVisible) {
    fc.classList.add("visible");
  } else {
    fc.classList.remove("visible");
  }

  // Sepet boşalırsa drawer'ı da aç (sonraki ekleme için hazır)
  if (count === 0) {
    const drawer = $("#fc-drawer");
    if (drawer) drawer.classList.remove("collapsed");
  }
}

// --- Drag-to-collapse (drawer'ı kapat, footer kalır) ---
function initFcDrag() {
  const drawer = $("#fc-drawer");
  const handle = $("#fc-handle");
  const footer = $("#fc-footer");
  if (!drawer || !handle) return;

  let startY = 0;
  let currentY = 0;
  let dragging = false;
  const drawerHeight = () => drawer.scrollHeight;

  function onStart(e) {
    if (drawer.classList.contains("collapsed")) return;
    dragging = true;
    startY = (e.touches ? e.touches[0].clientY : e.clientY);
    currentY = 0;
    drawer.classList.add("dragging");
    drawer.style.maxHeight = drawerHeight() + "px";
  }

  function onMove(e) {
    if (!dragging) return;
    const y = (e.touches ? e.touches[0].clientY : e.clientY);
    currentY = Math.max(0, y - startY);
    const newH = Math.max(0, drawerHeight() - currentY);
    drawer.style.maxHeight = newH + "px";
  }

  function onEnd() {
    if (!dragging) return;
    dragging = false;
    drawer.classList.remove("dragging");
    drawer.style.maxHeight = "";

    if (currentY > 60) {
      drawer.classList.add("collapsed");
    }
    currentY = 0;
  }

  handle.addEventListener("touchstart", onStart, { passive: true });
  document.addEventListener("touchmove", onMove, { passive: true });
  document.addEventListener("touchend", onEnd);
  handle.addEventListener("mousedown", onStart);
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onEnd);

  // Footer'a tıklayınca drawer'ı aç
  if (footer) {
    footer.addEventListener("click", () => {
      if (drawer.classList.contains("collapsed")) {
        drawer.classList.remove("collapsed");
      }
    });
  }
}

// =========================================
// 3. KAMPANYA SİHİRBAZI
// =========================================
async function fetchCampaigns() {
  try {
    const res = await fetch("/api/kampanyalarim", FETCH_OPTS);
    if (res.ok) ALL_CAMPAIGNS = await res.json();
  } catch (e) { console.error(e); }
}

function openCampaignModal() {
  $("#campaignModal").classList.remove("hidden");
  $("#wizardListScreen").classList.remove("hidden");
  $("#wizardStepScreen").classList.add("hidden");
  
  const fList = $("#firsatList");
  const pList = $("#puanList");
  fList.innerHTML = ""; pList.innerHTML = "";

  ALL_CAMPAIGNS.forEach(camp => {
    const isPuanli = camp.gerekli_puan > 0;
    const div = document.createElement("div");
    div.className = "camp-item";
    
    // --- YENİ KİLİT MANTIĞI ---
    const isLocked = (camp.uyelere_ozel === 1 && !IS_USER_LOGGED_IN);

    if(isLocked) {
        div.classList.add("locked"); // CSS ile grileştir
    } else if(isPuanli && camp.hak_sayisi <= 0) {
        div.classList.add("disabled"); // Puan yetersiz
    }

    let desc = "Tıkla ve seçimlerini yap";

    div.innerHTML = `
      <div class="camp-info">
        <span class="camp-name">${camp.ad}</span>
        <span class="camp-desc">${desc}</span>
      </div>
      <div class="camp-badge">${isPuanli ? camp.gerekli_puan+" Puan" : "Fırsat"}</div>
    `;

    div.onclick = () => {
      if(isLocked) return toast("🔒 Bu kampanya sadece üyelerimize özeldir. Lütfen giriş yapın."); // Tıklayınca uyarı
      if(!div.classList.contains("disabled")) startWizard(camp);
      else toast("Puanınız yetersiz.");
    };

    if (isPuanli) pList.appendChild(div);
    else fList.appendChild(div);
  });
}
// Mevcut startWizard fonksiyonunu bul ve şu kısımları güncelle/ekle:

function startWizard(camp) {
  WIZARD_STATE.activeCamp = camp;
  WIZARD_STATE.steps = [];
  WIZARD_STATE.currentStepIndex = 0;
  WIZARD_STATE.selections = {};

  // --- KOŞULLAR (CONDITIONS) ---
  if (camp.kosullar) {
    camp.kosullar.forEach(k => {
      if (k.tip !== 'tutar') {
        WIZARD_STATE.steps.push({
          type: 'condition',
          title: `Şartı Sağla: ${k.miktar} adet ürün seç`,
          targetType: k.tip, 
          targetId: k.hedef_id,
          // targetName güncellendi: Grup için "Grup Ürünleri" yazabiliriz veya API'den adını alabiliriz
          targetName: k.tip === 'kategori' ? k.kategori_adi : (k.tip === 'grup' ? 'Seçmeli Menü' : k.urun_adi),
          limit: k.miktar
        });
      }
    });
  }

  // --- ÖDÜLLER (REWARDS) ---
  if (camp.oduller) {
    camp.oduller.forEach(o => {
      WIZARD_STATE.steps.push({
        type: 'reward',
        title: `Hediyeni Seç: ${o.adet} adet ürün`,
        targetType: o.tip, // Artık 'grup' da gelebilir
        targetId: o.hedef_id,
        // targetName güncellendi
        targetName: o.tip === 'kategori' ? o.kategori_adi : (o.tip === 'grup' ? 'Seçmeli Menü' : o.urun_adi),
        limit: o.adet,
        discount: o.indirim_oran
      });
    });
  }

  if (WIZARD_STATE.steps.length === 0) {
    toast("Bu kampanya için seçim yapmaya gerek yok.");
    return;
  }
  renderStep(); // İlk adımı çizmeye git
}
// renderStep fonksiyonunu ASYNC yap ve içeriğini değiştir:

async function renderStep() {
  const step = WIZARD_STATE.steps[WIZARD_STATE.currentStepIndex];
  
  $("#wizardListScreen").classList.add("hidden");
  $("#wizardStepScreen").classList.remove("hidden");
  
  // Başlıkları güncelle
  $("#wizardTitle").textContent = WIZARD_STATE.activeCamp.ad;
  $("#wizardStepInfo").textContent = `${step.title} (${step.targetName || 'Seçenekler'})`;
  $("#wizardNextBtn").textContent = (WIZARD_STATE.currentStepIndex === WIZARD_STATE.steps.length - 1) ? "Tamamla & Sepete At" : "Devam Et";
  
  const grid = $("#wizardProductGrid");
  grid.innerHTML = '<div style="width:100%; text-align:center;">Yükleniyor...</div>'; // Yükleniyor göster

  let productsToShow = [];

  // --- 1. ÜRÜN İSE ---
  if (step.targetType === 'urun') {
    const p = MENU_BY_ID[step.targetId];
    if (p) productsToShow.push(p);
  } 
  // --- 2. KATEGORİ İSE ---
  else if (step.targetType === 'kategori') {
    const prodIds = CATEGORY_MAP[step.targetId] || [];
    prodIds.forEach(pid => {
      if(MENU_BY_ID[pid]) productsToShow.push(MENU_BY_ID[pid]);
    });
  } 
  // --- 3. GRUP (HAVUZ) İSE --- (YENİ KISIM)
  else if (step.targetType === 'grup') {
    try {
      // API'den grubun ürünlerini çek
      const res = await fetch(`/api/grup-urunleri/${step.targetId}`, FETCH_OPTS);
      const groupProducts = await res.json();
      
      // Gelen ürünleri formatla (MENU_BY_ID formatına benzet)
      productsToShow = groupProducts.map(gp => {
    // Gelen ürünü global menü listesine de tanıt ki finishWizard bulabilsin
    if(!MENU_BY_ID[gp.urun_id]) {
        MENU_BY_ID[gp.urun_id] = { 
            urun_id: gp.urun_id,
            urun_adi: gp.urun_adi,
            fiyat: Number(gp.fiyat),
            resim_url: gp.resim_url
        };
    }
    return MENU_BY_ID[gp.urun_id]; // Referansı döndür
});
    } catch (err) {
      console.error("Grup ürünleri çekilemedi", err);
      grid.innerHTML = '<div style="color:red">Ürünler yüklenemedi.</div>';
      return;
    }
  }

  // --- LİSTEYİ ÇİZ ---
  grid.innerHTML = ""; // Loader'ı temizle
  
  if(productsToShow.length === 0) {
      grid.innerHTML = '<div style="width:100%; text-align:center;">Bu seçenek için uygun ürün bulunamadı.</div>';
      return;
  }

  const currentSelection = WIZARD_STATE.selections[WIZARD_STATE.currentStepIndex] || [];

  productsToShow.forEach(prod => {
    const card = document.createElement("div");
    card.className = "w-card";
    
    // Seçili mi kontrol et
    const count = currentSelection.filter(item => {
        const id = typeof item === 'object' ? item.urun_id : item;
        return id === prod.urun_id;
    }).length;
    if (count > 0) card.classList.add("selected");

    // Fiyat gösterimi (Bedava mı?)
    let priceText = money(prod.fiyat);
    if(step.type === 'reward' && Number(step.discount) === 100) {
        priceText = "<b style='color:green'>BEDAVA</b>";
    }

    card.innerHTML = `
      <div class="w-badge">${count}</div>
      <img src="${prod.resim_url || '/images/default.jpg'}" alt="img" loading="lazy">
      <div class="w-title">${prod.urun_adi}</div>
      <div class="w-price">${priceText}</div>
      ${prod.aciklama ? `<div style="font-size:0.7em; color:#888;">${prod.aciklama}</div>` : ''}
    `;
    
    // Tıklama olayı
    card.onclick = () => toggleWizardSelection(prod.urun_id, step.limit);
    grid.appendChild(card);
  });

  updateWizardFooter();
}

function toggleWizardSelection(urunId, limit) {
  const stepIdx = WIZARD_STATE.currentStepIndex;
  const step = WIZARD_STATE.steps[stepIdx];
  let list = WIZARD_STATE.selections[stepIdx] || [];
  
  const existingIdx = list.findIndex(item => {
      const id = typeof item === 'object' ? item.urun_id : item;
      return id === urunId;
  });
  
  if (existingIdx !== -1) {
    // Kaldır
    list.splice(existingIdx, 1);
    WIZARD_STATE.selections[stepIdx] = list;
    renderStep();
  } else {
    // Ekle 
    if (list.length < limit) {
      if (step.type === 'reward') {
        // Ödül ürünü ise varyasyon sormadan doğrudan ekle
        list.push(urunId);
        WIZARD_STATE.selections[stepIdx] = list;
        renderStep();
      } else {
        // Koşul ürünü ise varyasyonlar için Modal aç
        openProductModal(urunId, (cartItem) => {
          if (!WIZARD_STATE.selections[stepIdx]) {
              WIZARD_STATE.selections[stepIdx] = [];
          }
          WIZARD_STATE.selections[stepIdx].push(cartItem);
          renderStep();
        });
      }
    } else {
      toast(`En fazla ${limit} ürün seçebilirsiniz.`);
    }
  }
}

function updateWizardFooter() {
  const step = WIZARD_STATE.steps[WIZARD_STATE.currentStepIndex];
  const list = WIZARD_STATE.selections[WIZARD_STATE.currentStepIndex] || [];
  const btn = $("#wizardNextBtn");
  $("#wizardCounter").textContent = `${list.length} / ${step.limit} Seçildi`;
  
  btn.disabled = (list.length !== step.limit);
  btn.onclick = btn.disabled ? null : nextWizardStep;
}

function nextWizardStep() {
  if (WIZARD_STATE.currentStepIndex < WIZARD_STATE.steps.length - 1) {
    WIZARD_STATE.currentStepIndex++;
    renderStep();
  } else {
    finishWizard();
  }
}

function finishWizard() {
  const camp = WIZARD_STATE.activeCamp;

  WIZARD_STATE.steps.forEach((step, idx) => {
    const selectedItems = WIZARD_STATE.selections[idx] || [];

    selectedItems.forEach(item => {
      let cartItem;
      if (typeof item === 'object') {
        cartItem = { ...item };
      } else {
        const prod = MENU_BY_ID[item];
        if(!prod) return;
        cartItem = {
           urun_id: prod.urun_id,
           cart_id: prod.urun_id + "-" + Date.now(),
           urun_adi: prod.urun_adi,
           fiyat: Number(prod.fiyat),
           adet: 1
        };
      }

      cartItem.kampanya_id = camp.kampanya_id;
      cartItem.kampanya_adi = camp.ad;
      cartItem.indirim_oran = 0;
      cartItem.isCondition = (step.type === "condition");

      if (step.type === 'reward') cartItem.indirim_oran = Number(step.discount);

      const existing = window.cart.find(x => 
        x.urun_id === cartItem.urun_id && 
        x.indirim_oran === cartItem.indirim_oran &&
        x.kampanya_id === cartItem.kampanya_id &&
        x.isCondition === cartItem.isCondition &&
        x.varyasyon_id === cartItem.varyasyon_id && 
        x.ekstra_not === cartItem.ekstra_not
      );

      if(existing) existing.adet += cartItem.adet;
      else window.cart.push(cartItem);
    });
  });

  $("#campaignModal").classList.add("hidden");
  renderCart();
  window.cart.forEach(item => updateProductBadge(item.urun_id));
  toast("Kampanya ürünleri sepete eklendi!");
}

// =========================================
// 4. ONAY MODALI (GERİ GELDİ)
// =========================================
function showConfirm() {
  fillConfirmModal();
  return new Promise(resolve => {
    const modal = $("#confirmModal");
    const ok = $("#confirmOk");
    const cancel = $("#confirmCancel");
    modal.classList.remove("hidden");
    
    const cleanup = () => {
        modal.classList.add("hidden");
        ok.onclick = null;
        cancel.onclick = null;
    }
    ok.onclick = () => { cleanup(); resolve(true); };
    cancel.onclick = () => { cleanup(); resolve(false); };
  });
}

function fillConfirmModal() {
  const list = $("#confirmList");
  list.innerHTML = "";
  let total = 0;

  window.cart.forEach(item => {
    const finalPrice = item.indirim_oran > 0 
      ? item.fiyat * (1 - item.indirim_oran/100) 
      : item.fiyat;
    const lineTotal = finalPrice * item.adet;
    total += lineTotal;

    const div = document.createElement("div");
    div.className = "confirm-item";
    div.innerHTML = `
        <span>${item.adet} x ${item.urun_adi}</span>
        <strong>${money(lineTotal)}</strong>
    `;
    list.appendChild(div);
  });

  $("#confirmAra").textContent = money(total);
  $("#confirmGenel").textContent = money(total);
}

// =========================================
// 5. USER BADGE (GERİ GELDİ)
// =========================================
// Kullanıcı Durumunu Kontrol Et (Promise döner)
async function initUserBadge() {
  const badge = $("#user-badge");
  try {
    const r = await fetch("/api/me", FETCH_OPTS);
    if (r.ok) {
      const me = await r.json();
      if(badge) {
          $("#ub-name").textContent = me.ad_soyad || me.email;
          $("#ub-puan").textContent = Number(me.puan || 0);
          badge.classList.remove("hidden");
      }
      IS_USER_LOGGED_IN = true; // Giriş Var
    } else {
      if(badge) badge.classList.add("hidden");
      IS_USER_LOGGED_IN = false; // Giriş Yok
    }
  } catch {
    IS_USER_LOGGED_IN = false;
  }
}
// =========================================
// 6. SİPARİŞİ GÖNDER (FİYAT DÜZELTMESİ)
// =========================================
async function sendOrder() {
  const masa = getMasaId();
  if (!masa) return toast("Masa bilgisi yok!");
  if (window.cart.length === 0) return toast("Sepet boş!");

  // Onay iste
  const confirmed = await showConfirm();
  if(!confirmed) return;

  const notu = $("#siparisNotuInput").value;
  const usedCamp = window.cart.find(x => x.kampanya_id)?.kampanya_id || null;

  // --- FİYAT DÜZELTMESİ BURADA ---
  // Backend'e sadece ID/Adet değil, hesaplanmış TUTARI da gönderiyoruz.
  const itemsPayload = window.cart.map(i => {
      // İndirimli birim fiyat
      let unitPrice = i.fiyat;
      if(i.indirim_oran > 0) {
          unitPrice = i.fiyat * (1 - i.indirim_oran/100);
      }
      return { 
          urun_id: i.urun_id, 
          adet: i.adet,
          tutar: unitPrice * i.adet,
          kampanya_id: i.kampanya_id,
          varyasyon_id: i.varyasyon_id || null,
          ekstra_not: i.ekstra_not || null
      };
  });

  const payload = {
    masa_id: masa,
    items: itemsPayload,
    siparis_notu: notu,
    kampanya_id: usedCamp 
  };

  try {
    const res = await fetch("/api/siparis", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error || "Hata");

    showTrackingModal(j.siparis_id);
    window.cart = [];
    $("#siparisNotuInput").value = "";
    renderCart();
    await initUserBadge();
    fetchCampaigns();
  } catch (e) {
    toast("Hata: " + e.message);
  } finally {
    if(btn) btn.disabled = false;
    if(btn) btn.textContent = "Sipariş Ver"
  }
}
const goCartBtn = $("#goCartBtn");
  if (goCartBtn) {
    goCartBtn.addEventListener("click", () => {
      const cart = document.getElementById("cart-panel") || document.querySelector(".panel");
      if (cart) {
        cart.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }

  function cleanupRewardsIfConditionRemoved(removedItem) {

  // 1) Sepetteki aktif kampanya ID'sini bul
  const campId = removedItem.kampanya_id 
    ? removedItem.kampanya_id 
    : window.cart.find(x => x.kampanya_id)?.kampanya_id;

  if (!campId) return;
  if (!removedItem.isCondition) return;
  const camp = ALL_CAMPAIGNS.find(c => c.kampanya_id === campId);
  if (!camp) return;

  // 2) Bu kampanyanın koşullarından biri bu ürün mü?
  const isConditionProduct = camp.kosullar?.some(k => {
    if (k.tip === "urun") return k.hedef_id === removedItem.urun_id;
    if (k.tip === "kategori") {
      const info = MENU_BY_ID[removedItem.urun_id];
      return info && info.kategori_id === k.hedef_id;
    }
    return false;
  });

  if (!isConditionProduct) return;

  // 3) Eğer koşul ürünü silindiyse → ödülleri duruma göre temizle
  let discountRemoved = false;
  
  // Önce %100 OLMAYAN indirimleri sıfırla (ürün sepette normal fiyattan kalır)
  window.cart.forEach(x => {
    if (x.kampanya_id === campId && x.indirim_oran > 0 && x.indirim_oran < 100) {
      x.indirim_oran = 0;
      x.kampanya_id = null;
      x.kampanya_adi = null;
      discountRemoved = true;
    }
  });

  // Sonra %100 (bedava) olan ödülleri sepetten tamamen sil
  const initialLength = window.cart.length;
  window.cart = window.cart.filter(x => {
    return !(x.kampanya_id === campId && x.indirim_oran === 100);
  });
  
  if (window.cart.length < initialLength || discountRemoved) {
    toast("Koşul ürünü sepetten çıkarıldığı için kampanya ödülleri güncellendi/kaldırıldı.");
  }
}

  // =========================================
// 🕵️‍♂️ KAMPANYA DEDEKTİFİ (VALIDASYON)
// =========================================
function validateCartCampaigns() {
  let changeMade = false;

  // Sepetteki indirimli ürünlerin hangi kampanyadan geldiğini bul
  const activeCampaignIds = new Set();
  window.cart.forEach(item => {
    if (item.kampanya_id && item.indirim_oran > 0) {
      activeCampaignIds.add(item.kampanya_id);
    }
  });

  // Her aktif kampanyayı kontrol et
  activeCampaignIds.forEach(campId => {
    const camp = ALL_CAMPAIGNS.find(c => c.kampanya_id === campId);
    if (!camp) return;

    // Bu kampanya için koşullar hala sağlanıyor mu?
    // ÖNEMLİ: Koşulları kontrol ederken SADECE İNDİRİMSİZ (Paralı) ürünleri saymalıyız.
    // Yoksa "3 Kahve al 1 Bedava" kampanyasında bedava olanı da sayıp döngüye girer.
    
    let conditionsMet = true;

    if (camp.kosullar) {
      camp.kosullar.forEach(cond => {
        let count = 0;

        if (cond.tip === 'kategori') {
          // Bu kategorideki PARALI ürünleri say
          count = window.cart.reduce((sum, item) => {
            const info = MENU_BY_ID[item.urun_id];
            // İndirimi olmayan (indirim_oran 0 veya null) ve kategorisi tutan ürünler
            if (info && info.kategori_adi === cond.kategori_adi && (!item.indirim_oran || item.indirim_oran === 0)) {
              return sum + item.adet;
            }
            return sum;
          }, 0);
        } 
        else if (cond.tip === 'urun') {
          // Bu üründen PARALI olanları say
          const item = window.cart.find(x => x.urun_id === cond.hedef_id && (!x.indirim_oran || x.indirim_oran === 0));
          count = item ? item.adet : 0;
        }

        // Eğer sayı yetersizse, koşul patladı demektir
        if (count < cond.miktar) {
          conditionsMet = false;
        }
      });
    }

    // Eğer koşul sağlanmıyorsa, bu kampanyaya ait indirimleri İPTAL ET
    if (!conditionsMet) {
      window.cart.forEach(item => {
        if (item.kampanya_id === campId && item.indirim_oran > 0) {
          item.indirim_oran = 0; // İndirimi sıfırla
          item.kampanya_adi = null;
          item.kampanya_id = null;
          changeMade = true;
        }
      });
    }
  });

  if (changeMade) {
    toast("⚠️ Koşul ürünleri silindiği için kampanya iptal edildi.");
  }
}

// =========================
//  BADGE GÜNCELLEME FONKSİYONU
// =========================
function updateProductBadge(urunId) {
  // 1. İlgili ürün kartını bul (data-id attribute ile)
  const card = document.querySelector(`.menu-item[data-id="${urunId}"]`);
  if (!card) return;

  // 2. Sepette bu üründen kaç tane var hesapla
  // (Not: Aynı ürün farklı kampanyalarla eklenmiş olabilir, toplamını alıyoruz)
  const totalQty = window.cart
    .filter(item => item.urun_id === urunId)
    .reduce((sum, item) => sum + item.adet, 0);

  // 3. Mevcut badge'i bul veya oluştur
  let badge = card.querySelector(".product-badge");

  if (totalQty > 0) {
    if (!badge) {
      badge = document.createElement("div");
      badge.className = "product-badge";
      card.appendChild(badge);
    }
    badge.textContent = totalQty;
  } else {
    if (badge) badge.remove();
  }
}
/* Bu fonksiyonu kodlarının genel bir yerine ekle. 
   Çağırırken 'silinenUrunId' kısmına, o an sildiğin ürünün ID'sini (örn: 15, 20 vs.) göndermelisin.
*/
function rozetiGizle(silinenUrunId) {
    // 1. Yukarıdaki ürün listesinde, silinen ürünün kartını ID'sine göre bulur.
    // DİKKAT: HTML'inde ürün kartında 'data-id="1"' gibi bir özellik olduğunu varsayıyoruz.
    // '.urun-item' kısmını kendi ürün kartı class isminle değiştirebilirsin.
    const urunKarti = document.querySelector(`.urun-item[data-id="${silinenUrunId}"]`);

    if (urunKarti) {
        // 2. Kartın içindeki yeşil balonu (badge) bulur.
        // '.badge' kısmını senin yeşil yuvarlağa verdiğin class ismiyle (örn: .sayac, .count) değiştir.
        const rozet = urunKarti.querySelector('.badge');

        if (rozet) {
            rozet.style.display = 'none'; // Rozeti görünmez yapar
            rozet.innerText = '0';        // İçeriğini sıfırlar (garanti olsun diye)
        }
    }
}
// INIT
document.addEventListener("DOMContentLoaded", async () => {
  showMasaChip();
  adjustPadding();
  window.addEventListener("resize", adjustPadding);
  
  await initUserBadge();    // 1. Önce giriş durumunu öğren
  await fetchAndRenderMenu(); // 2. Sonra menüyü (puana göre) çiz
  
  fetchCampaigns();
  
  // ... diğer event listenerlar aynı kalsın ...
  $("#siparisVerBtn")?.addEventListener("click", sendOrder);
  $("#openCampaignModalBtn")?.addEventListener("click", openCampaignModal);
  $("#closeCampaignModal")?.addEventListener("click", () => $("#campaignModal").classList.add("hidden"));
  $("#wizardNextBtn")?.addEventListener("click", () => {}); 
  $("#toggleNoteBtn")?.addEventListener("click", () => $("#siparisNotuInput").classList.toggle("hidden"));
  $("#goCartBtn")?.addEventListener("click", () => {
      document.getElementById("cart-panel")?.scrollIntoView({behavior:"smooth"});
  });

  // Floating mini cart drag-to-dismiss başlat
  initFcDrag();

  // Asıl sepet paneli ekrana girince floating bar'ı gizle
  const cartPanel = document.getElementById("cart-panel");
  if (cartPanel && typeof IntersectionObserver !== "undefined") {
    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        _cartPanelVisible = entry.isIntersecting;
        const bar = $("#floatingCart");
        if (!bar) return;
        if (entry.isIntersecting) {
          bar.classList.remove("visible");
        } else if (window.cart.length > 0) {
          bar.classList.add("visible");
        }
      });
    }, { threshold: 0.15 });
    observer.observe(cartPanel);
  }

  // Modal event listeners
  $("#closeProductModal")?.addEventListener("click", closeProductModal);
});

// =========================================
// PRODUCT MODAL LOGIC (SAAS VARIATIONS)
// =========================================
let currentModalProduct = null;
let currentModalQty = 1;
let currentModalSelections = { variation: null, extras: [] };

let wizardCallback = null;

async function openProductModal(urunId, callback = null) {
  wizardCallback = callback;
  
  // Buton metnini duruma göre ayarla
  const btn = document.getElementById("addToCartFinal");
  if (btn) {
    btn.innerHTML = wizardCallback 
      ? `Kampanyaya Ekle - <span id="modalTotalPrice">0.00</span> ₺`
      : `Sepete Ekle - <span id="modalTotalPrice">0.00</span> ₺`;
  }
  
  try {
    const res = await fetch(`/api/urun-detay/${urunId}`);
    if (!res.ok) throw new Error("Ürün detayları alınamadı");
    const prod = await res.json();

    currentModalProduct = prod;
    currentModalQty = 1;
    currentModalSelections = { variation: null, extras: [] };

    $("#modalProductName").textContent = prod.urun_adi;
    $("#modalProductDesc").textContent = prod.aciklama || "Tadına doyamayacağınız lezzet.";
    $("#modalProductImage").src = prod.resim_url || "https://via.placeholder.com/400x250?text=Urun+Gorseli";
    
    // API'den gelen varyasyon ve ekstraları gönderiyoruz
    renderModalOptions(prod.varyasyonlar, prod.ekstralar);
    updateModalPrice();

    $("#productModal").classList.remove("hidden");
  } catch (err) {
    console.error(err);
    toast("Ürün detayı yüklenirken hata oluştu.");
  }
}

function renderModalOptions(variations, extras) {
  const varCont = $("#variationContainer");
  const extCont = $("#extrasContainer");
  varCont.innerHTML = ""; extCont.innerHTML = "";

  if (variations && variations.length > 0) {
    $("#variationGroup").style.display = "block";
    variations.forEach((v, index) => {
      const chip = document.createElement("div");
      chip.className = `variation-chip ${index === 0 ? "selected" : ""}`;
      chip.innerHTML = v.ad + (v.fiyat_farki > 0 ? ` <span class="calibri-num">(+${v.fiyat_farki}₺)</span>` : "");
      
      if (index === 0) currentModalSelections.variation = v; // Varsayılan ilkini seç

      chip.onclick = () => {
        document.querySelectorAll(".variation-chip").forEach(c => c.classList.remove("selected"));
        chip.classList.add("selected");
        currentModalSelections.variation = v;
        updateModalPrice();
      };
      varCont.appendChild(chip);
    });
  } else {
    $("#variationGroup").style.display = "none";
  }

  if (extras && extras.length > 0) {
    $("#extrasGroup").style.display = "block";
    extras.forEach(ext => {
      const row = document.createElement("div");
      row.className = "extra-item";
      row.innerHTML = `
        <div class="extra-item-name">
          <input type="checkbox" class="extra-checkbox">
          ${ext.ad}
        </div>
        ${ext.fiyat_farki > 0 ? `<div class="extra-item-price">+${ext.fiyat_farki}₺</div>` : ''}
      `;
      row.onclick = () => {
        const checkbox = row.querySelector(".extra-checkbox");
        checkbox.checked = !checkbox.checked;
        if (checkbox.checked) {
          row.classList.add("selected");
          currentModalSelections.extras.push(ext);
        } else {
          row.classList.remove("selected");
          currentModalSelections.extras = currentModalSelections.extras.filter(e => e.id !== ext.id);
        }
        updateModalPrice();
      };
      extCont.appendChild(row);
    });
  } else {
    $("#extrasGroup").style.display = "none";
  }
}

function updateModalPrice() {
  let basePrice = Number(currentModalProduct.fiyat);
  if (currentModalSelections.variation) basePrice += currentModalSelections.variation.fiyat_farki;
  
  let extraTotal = 0;
  currentModalSelections.extras.forEach(ext => extraTotal += ext.fiyat_farki);

  const total = (basePrice + extraTotal) * currentModalQty;
  $("#modalTotalPrice").textContent = total.toFixed(2);
  $("#modalQtyNum").textContent = currentModalQty;
}

$("#modalQtyMinus")?.addEventListener("click", () => {
  if (currentModalQty > 1) {
    currentModalQty--;
    updateModalPrice();
  }
});

$("#modalQtyPlus")?.addEventListener("click", () => {
  currentModalQty++;
  updateModalPrice();
});

$("#addToCartFinal")?.addEventListener("click", () => {
  // Sepete ekleme mantığı
  let finalName = currentModalProduct.urun_adi;
  if (currentModalSelections.variation) {
    finalName += ` (${currentModalSelections.variation.ad})`;
  }
  
  if (currentModalSelections.extras.length > 0) {
    const extNames = currentModalSelections.extras.map(e => e.ad).join(", ");
    finalName += ` [+ ${extNames}]`;
  }

  let finalPrice = Number(currentModalProduct.fiyat);
  if (currentModalSelections.variation) finalPrice += currentModalSelections.variation.fiyat_farki;
  currentModalSelections.extras.forEach(e => finalPrice += e.fiyat_farki);

  // Benzersiz ID oluştur (Aynı ürün farklı ekstralarla ayrı satır olmalı)
  const uniqueId = currentModalProduct.urun_id + "-" + Date.now();

  const cartItem = { 
    urun_id: currentModalProduct.urun_id, // asıl id (backend için)
    cart_id: uniqueId, // frontend liste için
    urun_adi: finalName, 
    fiyat: finalPrice, 
    adet: currentModalQty,
    varyasyon_id: currentModalSelections.variation ? currentModalSelections.variation.id : null,
    ekstra_not: currentModalSelections.extras.length > 0 ? currentModalSelections.extras.map(e => e.ad).join(", ") : null
  };

  if (wizardCallback) {
    wizardCallback(cartItem);
    wizardCallback = null;
    closeProductModal();
    return;
  }

  window.cart.push(cartItem);
  
  renderCart();
  updateProductBadge(currentModalProduct.urun_id);
  closeProductModal();
  
  const drawer = $("#fc-drawer");
  if (drawer) drawer.classList.remove("collapsed");
});

function closeProductModal() {
  $("#productModal").classList.add("hidden");
}

// =========================================
// 🔄 SİPARİŞ DURUM TAKİP VE İPTAL MANTIĞI
// =========================================
let trackingInterval = null;
let currentTrackingOrderId = null;

function showTrackingModal(orderId) {
  currentTrackingOrderId = orderId;
  document.getElementById("trackingOrderId").textContent = "#" + orderId;
  document.getElementById("trackingStatus").textContent = "İletiliyor...";
  document.getElementById("trackingStatus").style.color = "#e28743";
  document.getElementById("trackingTitle").textContent = "Siparişiniz Alındı!";
  
  // Spinner & Buton durumları
  document.getElementById("trackingSpinner").classList.remove("hidden");
  document.getElementById("trackingSuccessTick").classList.add("hidden");
  
  const cancelBtn = document.getElementById("btnCancelOrder");
  cancelBtn.classList.remove("hidden");
  cancelBtn.disabled = false;
  
  document.getElementById("btnCloseTrackingModal").classList.add("hidden");
  document.getElementById("orderTrackingModal").classList.remove("hidden");

  let remaining = 10;
  document.getElementById("trackingDesc").textContent = `Siparişiniz iletiliyor. İptal etmek için son ${remaining} saniye...`;
  cancelBtn.textContent = `❌ Siparişi İptal Et (${remaining})`;

  if (trackingInterval) clearInterval(trackingInterval);
  trackingInterval = setInterval(() => {
    remaining--;
    if (remaining > 0) {
      document.getElementById("trackingDesc").textContent = `Siparişiniz iletiliyor. İptal etmek için son ${remaining} saniye...`;
      cancelBtn.textContent = `❌ Siparişi İptal Et (${remaining})`;
    } else {
      clearInterval(trackingInterval);
      completeOrderTracking();
    }
  }, 1000);
}

function completeOrderTracking() {
  if (trackingInterval) clearInterval(trackingInterval);
  
  document.getElementById("trackingStatus").textContent = "Onaylandı";
  document.getElementById("trackingStatus").style.color = "#0aa07a";
  document.getElementById("trackingTitle").textContent = "Siparişiniz İletildi!";
  document.getElementById("trackingDesc").textContent = "Siparişiniz mutfağa başarıyla iletildi ve hazırlanmaya başlandı! 👨‍🍳";
  
  // Spinner'ı gizle, yeşil tick'i göster
  document.getElementById("trackingSpinner").classList.add("hidden");
  document.getElementById("trackingSuccessTick").classList.remove("hidden");
  
  // İptal butonunu gizle, Kapat butonunu göster
  document.getElementById("btnCancelOrder").classList.add("hidden");
  document.getElementById("btnCloseTrackingModal").classList.remove("hidden");
}

async function cancelMyOrder() {
  if (!currentTrackingOrderId) return;
  if (!confirm("Siparişinizi iptal etmek istediğinize emin misiniz?")) return;

  try {
    const res = await fetch(`/api/siparis/${currentTrackingOrderId}/musteri-iptal`, {
      method: "POST"
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "İptal işlemi başarısız.");

    toast("Siparişiniz iptal edildi.");
    if (trackingInterval) clearInterval(trackingInterval);
    
    // UI'ı iptal durumuna çek
    document.getElementById("trackingStatus").textContent = "İptal Edildi";
    document.getElementById("trackingStatus").style.color = "#ef4444";
    document.getElementById("trackingTitle").textContent = "Sipariş İptal Edildi";
    document.getElementById("trackingDesc").textContent = "Siparişinizi başarıyla iptal ettiniz.";
    document.getElementById("trackingSpinner").classList.add("hidden");
    document.getElementById("btnCancelOrder").classList.add("hidden");
    document.getElementById("btnCloseTrackingModal").classList.remove("hidden");

  } catch (e) {
    toast("Hata: " + e.message);
  }
}

function closeTrackingModal() {
  document.getElementById("orderTrackingModal").classList.add("hidden");
  if (trackingInterval) clearInterval(trackingInterval);
}



