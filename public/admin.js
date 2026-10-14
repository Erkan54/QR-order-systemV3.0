// admin.js - Masa Siparişlerini Birleştiren + İptal Butonlu Final Versiyon

let ALL_TABLES = [];
let ALL_ORDERS = [];
let ACTIVE_VIEW = 'list'; 
let timer = null;

// DOM Elementleri
const btnList = document.getElementById("btnViewList");
const btnGrid = document.getElementById("btnViewGrid");
const divList = document.getElementById("view-list-container");
const divGrid = document.getElementById("view-grid-container");
const tbody = document.getElementById("orders-body");
const refreshBtn = document.getElementById("refresh");

// Başlangıç
document.addEventListener("DOMContentLoaded", async () => {
  setupViewSwitcher();
  await loadTables();
  loadData();         
  startAutoRefresh();
});

// --- GÖRÜNÜM DEĞİŞTİRME ---
function setupViewSwitcher() {
  btnList.addEventListener("click", () => {
    ACTIVE_VIEW = 'list';
    btnList.classList.add("active");
    btnGrid.classList.remove("active");
    divList.classList.remove("hidden");
    divGrid.classList.add("hidden");
    render(); 
  });

  btnGrid.addEventListener("click", () => {
    ACTIVE_VIEW = 'grid';
    btnGrid.classList.add("active");
    btnList.classList.remove("active");
    divGrid.classList.remove("hidden");
    divList.classList.add("hidden");
    render(); 
  });

  refreshBtn.addEventListener("click", () => loadData(true));
  
  // Yan Panel Kapatma
  document.getElementById("sp-close").onclick = closeSidePanel;
  document.getElementById("sideOverlay").onclick = closeSidePanel;
}

// --- VERİ ÇEKME ---
async function loadTables() {
  try {
    const res = await fetch("/api/masalar");
    if(res.ok) ALL_TABLES = await res.json();
  } catch(e) { console.error("Masa hatası", e); }
}

async function loadData(manual = false) {
  try {
    if(manual) {
      refreshBtn.disabled = true; refreshBtn.textContent = "...";
    }
    
    const res = await fetch("/api/siparisler?limit=200"); 
    const json = await res.json();
    
    ALL_ORDERS = json.data || [];
    render(); 

  } catch(err) {
    console.error(err);
  } finally {
    if(manual) {
      setTimeout(() => { refreshBtn.disabled=false; refreshBtn.textContent="🔄 Yenile"; }, 500);
    }
  }
}

function startAutoRefresh() {
  if(timer) clearInterval(timer);
  timer = setInterval(() => loadData(), 5000); 
}

// --- RENDER MERKEZİ ---
function render() {
  if (ACTIVE_VIEW === 'list') {
    renderListView();
  } else {
    renderGridView();
  }
}

// 1. LİSTE GÖRÜNÜMÜ
function renderListView() {
  if (!ALL_ORDERS.length) {
    tbody.innerHTML = `<tr><td colspan="8">Sipariş yok.</td></tr>`;
    return;
  }
  tbody.innerHTML = "";
  const sorted = [...ALL_ORDERS].sort((a,b) => new Date(b.tarih) - new Date(a.tarih));

  for (const o of sorted) {
    const tr = document.createElement("tr");
    const kalemler = (o.kalemler || []).map(k => {
      let txt = k.urun_adi;
      if (k.varyasyon_adi) txt += ` <span style="color:#0f766e; font-size:0.8em">(${k.varyasyon_adi})</span>`;
      if (k.ekstra_not) txt += ` <span style="color:#888; font-size:0.75em">[${k.ekstra_not}]</span>`;
      return `${txt} x${k.adet}`;
    }).join("<br>");
    const statusClass = (o.durum || "").replace(/\s/g, ""); 
// DÜZELTİLMİŞ KOD (Bunu yapıştır):
const notHtml = o.siparis_notu ? `<span style="color:red; font-weight:bold;">📝 ${o.siparis_notu}</span>` : "";

    tr.innerHTML = `
      <td>#${o.siparis_id}</td>
      <td>${o.masa_no}</td>
      <td><span class="status ${statusClass}">${o.durum}</span></td>
      <td>${new Date(o.tarih).toLocaleTimeString()}</td>
      <td>${notHtml}</td>
      <td>₺${Number(o.toplam_tutar).toFixed(2)}</td>
      <td style="font-size:0.85rem; text-align:left;">${kalemler}</td>
      <td>${renderActionButtons(o.siparis_id, o.durum)}</td>
    `;
    tbody.appendChild(tr);
  }
}

// 2. SALON (GRID) GÖRÜNÜMÜ
// 2. SALON (GRID) GÖRÜNÜMÜ - GÜNCELLENMİŞ (Ürün Listeli)
function renderGridView() {
  const container = document.getElementById("floor-plan");
  container.innerHTML = "";

  // Aktif siparişleri filtrele (Tamamlananlar hariç)
  const activeOrders = ALL_ORDERS.filter(o => o.durum !== 'Teslim Edildi' && o.durum !== 'İptal');

  ALL_TABLES.forEach(masa => {
    // Bu masaya ait siparişleri bul
    const tableOrders = activeOrders.filter(o => o.masa_id === masa.masa_id);

    const card = document.createElement("div");
    let statusClass = "empty";
    let statusText = "Boş";
    let totalAmount = 0;
    let itemsHtml = ""; // Ürünleri burada toplayacağız

    if (tableOrders.length > 0) {
      const hasPending = tableOrders.some(o => o.durum === 'Hazırlanıyor');
      if (hasPending) {
        statusClass = "occupied"; // Kırmızı
        statusText = "Sipariş Bekliyor";
      } else {
        statusClass = "ready";    // Yeşil
        statusText = "Servis Edildi";
      }
      totalAmount = tableOrders.reduce((sum, o) => sum + Number(o.toplam_tutar || 0), 0);

      // --- ÜRÜN LİSTESİNİ OLUŞTURMA KISMI ---
      itemsHtml = `<div style="margin: 10px 0; background: rgba(255,255,255,0.5); padding: 5px; border-radius: 4px; max-height: 300px; overflow-y: auto; font-size: 0.8rem; text-align: left; color: #333;">`;
      
      tableOrders.forEach(order => {
        if(order.kalemler && order.kalemler.length) {
           order.kalemler.forEach(k => {
              let txt = k.urun_adi;
              if (k.varyasyon_adi) txt += ` <span style="color:#0f766e; font-size:0.85em">(${k.varyasyon_adi})</span>`;
              if (k.ekstra_not) txt += `<br><span style="color:#888; font-size:0.75em; padding-left:8px;">↳ ${k.ekstra_not}</span>`;
              itemsHtml += `<div style="border-bottom: 1px dashed #ccc; padding: 2px 0;">${txt} <strong style="float:right">x${k.adet}</strong></div>`;
           });
        }
      });
      itemsHtml += `</div>`;
      // ---------------------------------------
    }

    card.className = `table-card ${statusClass}`;
    // Kartın minimum yüksekliğini biraz artırdık ki liste sığsın
    card.style.minHeight = "260px"; 
    
    card.innerHTML = `
      <div class="t-name" style="font-size:1.2rem; font-weight:bold;">${masa.masa_no}</div>
      <div class="t-status" style="font-size:0.9rem; margin-bottom:5px;">${statusText}</div>
      
      ${itemsHtml}
      
      <div class="t-amount" style="font-size:1.3rem; margin-top:auto; font-weight:bold;">${tableOrders.length > 0 ? '₺' + totalAmount.toFixed(2) : '-'}</div>
    `;

    if (tableOrders.length > 0) {
      card.onclick = () => openSidePanel(masa, tableOrders, totalAmount);
    }

    container.appendChild(card);
  });
}

// --- YAN PANEL İŞLEMLERİ ---
function openSidePanel(masa, orders, totalAmount) {
  const panel = document.getElementById("sidePanel");
  const overlay = document.getElementById("sideOverlay");
  const content = document.getElementById("sp-content");
  const title = document.getElementById("sp-masa-title");
  const actions = document.getElementById("sp-actions");

  title.textContent = `${masa.masa_no} - Adisyon`;
  
  let html = "";

  orders.forEach(order => {
    html += `
      <div style="background:#f8f9fa; padding:10px; border-radius:8px; margin-bottom:15px; border:1px solid #eee;">
        <div style="display:flex; justify-content:space-between; font-size:0.85rem; color:#666; margin-bottom:5px;">
          <span>Sipariş #${order.siparis_id}</span>
          <span>${new Date(order.tarih).toLocaleTimeString()}</span>
        </div>
        <div style="font-weight:bold; color:${order.durum==='Hazırlanıyor'?'#d35400':'#27ae60'}; margin-bottom:5px;">
          Durum: ${order.durum}
        </div>
    `;

    if(order.kalemler && order.kalemler.length) {
      order.kalemler.forEach(k => {
        let detay = '';
        if (k.varyasyon_adi) detay += `<span style="color:#0f766e; font-size:0.85em; margin-left:4px;">(${k.varyasyon_adi})</span>`;
        if (k.ekstra_not) detay += `<div style="color:#888; font-size:0.78em; padding-left:12px;">↳ ${k.ekstra_not}</div>`;
        html += `
          <div class="sp-item-row" style="padding:3px 0;">
            <span>${k.urun_adi} ${detay}</span>
            <strong>x${k.adet}</strong>
          </div>
        `;
      });
    }

    if (order.siparis_notu) {
      html += `<div class="sp-note">📝 Not: ${order.siparis_notu}</div>`;
    }

    // BUTONLARI BURADA ÇAĞIRIYORUZ (true = geniş butonlar)
    html += `<div style="margin-top:10px; padding-top:5px; border-top:1px dashed #ddd;">
              ${renderActionButtons(order.siparis_id, order.durum, true)}
             </div>`;
    
    html += `</div>`;
  });
  
  html += `<div style="margin-top:20px; font-size:1.4rem; text-align:right; font-weight:bold; color:#2c3e50;">
            Genel Toplam: ₺${totalAmount.toFixed(2)}
           </div>`;

  content.innerHTML = html;
  actions.innerHTML = `<button class="action-btn" style="width:100%; background:#7f8c8d; padding:10px;" onclick="closeSidePanel()">Kapat</button>`;

  panel.classList.add("open");
  overlay.classList.remove("hidden");
}

function closeSidePanel() {
  document.getElementById("sidePanel").classList.remove("open");
  document.getElementById("sideOverlay").classList.add("hidden");
}

// --- GÜNCELLENMİŞ BUTON ÜRETİCİ (İPTAL GERİ GELDİ) ---
// Mevcut renderActionButtons fonksiyonunu bununla değiştir:
function renderActionButtons(id, durum, isFull = false) {
  // Tamamlanmışsa buton gösterme
  if (durum === "Teslim Edildi" || durum === "İptal") {
    return `<span style="color:#999; font-size:0.8rem">Tamamlandı (${durum})</span>`;
  }

  // Stil Ayarları
  let progressStyle = "";
  let cancelStyle = "background:#e74c3c;";

  if (isFull) {
    // Yan Panel Modu (Geniş butonlar)
    progressStyle = "width:100%; padding:10px; margin-bottom:5px; display:block;";
    cancelStyle   = "width:100%; padding:10px; background:#e74c3c; display:block;";
  } else {
    // Liste Modu (Yan yana butonlar)
    progressStyle = "margin-right:5px;";
    cancelStyle   = "background:#e74c3c;";
  }

  const btnCancel = `<button class="action-btn" style="${cancelStyle}" onclick="changeStatus(${id}, 'İptal')">İptal</button>`;

  if (durum === "Hazırlanıyor") {
    // Mutfak Hazır butonu
    return `<button class="action-btn" style="background:#f39c12; ${progressStyle}" onclick="changeStatus(${id}, 'Hazır')">👨‍🍳 Mutfak Hazır</button> ${btnCancel}`;
  } 
  else if (durum === "Hazır") {
    // BURASI DEĞİŞTİ: İKİ SEÇENEK GELDİ
    const btnNakit = `<button class="action-btn" style="background:#27ae60; ${progressStyle}" onclick="changeStatus(${id}, 'Teslim Edildi', 'Nakit')">💵 Nakit</button>`;
    const btnKart  = `<button class="action-btn" style="background:#2980b9; ${progressStyle}" onclick="changeStatus(${id}, 'Teslim Edildi', 'Kredi Kartı')">💳 Kart</button>`;
    
    return `${btnNakit} ${btnKart} ${btnCancel}`;
  }

  return btnCancel;
}

// Durum Değiştirme
async function changeStatus(id, durum, odemeTuru = null) {
  if(durum === 'İptal' && !confirm("Siparişi İPTAL etmek istediğine emin misin?")) return;

  try {
    const bodyData = { durum };
    if (odemeTuru) bodyData.odeme_turu = odemeTuru;

    const res = await fetch(`/api/siparis/${id}/durum`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(bodyData)
    });

    if(res.ok) {
      closeSidePanel();
      loadData(true); 
      
      // SİLDİK: window.open satırı artık yok.
      // İstersen bildirim verebilirsin:
      if(durum === 'Teslim Edildi') {
          // notify("Adisyon arşivlendi ✅"); // Eğer notify fonksiyonun varsa
      }

    } else {
      alert("Hata oluştu");
    }
  } catch(e) { console.error(e); }
}
// Temizle Butonu
// Temizle Butonu (Veritabanı Destekli Soft-Delete)
document.getElementById("temizleBtn")?.addEventListener("click", async () => {
  if(!confirm("Tamamlanan ve İptal edilen siparişleri ekrandan kaldırmak istiyor musunuz?")) return;
  
  try {
    const res = await fetch("/api/siparisler/temizle", { method: "DELETE" });
    const json = await res.json();
    
    // Kullanıcıya bilgi verip listeyi anında yeniliyoruz
    // alert(json.message); // İstersen açabilirsin
    loadData(true); 
  } catch(e) {
    console.error("Temizleme hatası:", e);
    alert("Bir hata oluştu.");
  }
});