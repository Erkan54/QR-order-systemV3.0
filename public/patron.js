// =========================================================
// PATRON PANELİ ANALİZ MOTORU (v3.0 - Final)
// =========================================================

const charts = {}; // Grafik nesnelerini saklamak için
let productListLoaded = false;
let categoryListLoaded = false;

// --- BAŞLANGIÇ ---
document.addEventListener("DOMContentLoaded", () => {
  // Varsayılan Tarih: Bugün
  const today = new Date().toISOString().split("T")[0];
  document.getElementById("startDate").value = today;
  document.getElementById("endDate").value = today;

  // İlk Veri Yükleme
  refreshData();
});

// =========================================================
// 1. NAVİGASYON & TABLAR
// =========================================================
function switchTab(tabId) {
  // Buton aktifliği
  document.querySelectorAll(".nav-btn").forEach(btn => btn.classList.remove("active"));
  event.currentTarget.classList.add("active");

  // Tab içeriği değişimi
  document.querySelectorAll(".tab-content").forEach(content => content.classList.remove("active"));
  document.getElementById(`tab-${tabId}`).classList.add("active");

  // Tab değişince ilgili verileri yükle (Performans için lazy load)
  if (tabId === 'urunler') {
    if (!productListLoaded) loadProductDropdown();
    loadProductTrends(getParams());
  }
  if (tabId === 'kategoriler' && !categoryListLoaded) {
    loadCategoryDropdown();
    analyzeAllCategories(); // Genel sıralamayı hemen yükle
  }
  if (tabId === 'kampanyalar') loadCampaignsTable();
  if (tabId === 'capraz') loadCrossSellAnalysis();
  if (tabId === 'heatmap') loadHeatmapAnalysis();
  if (tabId === 'siparisler') loadActiveOrders();
}

// =========================================================
// 2. ANA KONTROLÖR (REFRESH)
// =========================================================
async function refreshData() {
  const params = getParams();
  const activeTab = document.querySelector(".tab-content.active").id;

  // Genel özet her zaman güncellenir (KPI'lar için)
  await loadGeneralSummary(params);

  // Aktif sekmeye göre işlem yap
  if (activeTab === 'tab-ozet') {
    await loadMainChart(params);
    loadTopTables(params);
  } else if (activeTab === 'tab-urunler') {
    analyzeProduct(); // Seçili ürün varsa yenile
    loadProductTrends(params); // Yeni: Trend tabloları
  } else if (activeTab === 'tab-kategoriler') {
    analyzeCategory(); // Seçili kategori varsa yenile
    analyzeAllCategories();
  } else if (activeTab === 'tab-kampanyalar') {
    loadCampaignsTable();
  } else if (activeTab === 'tab-capraz') {
    loadCrossSellAnalysis();
  } else if (activeTab === 'tab-heatmap') {
    loadHeatmapAnalysis();
  } else if (activeTab === 'tab-siparisler') {
    loadActiveOrders();
  }
}

function getParams() {
  return {
    start: document.getElementById("startDate").value,
    end: document.getElementById("endDate").value,
    compare: document.getElementById("compareDate").value
  };
}

// =========================================================
// HIZLI TARİH SEÇİMİ (YENİ)
// =========================================================
function setQuickDate(range) {
  const startInput = document.getElementById("startDate");
  const endInput = document.getElementById("endDate");
  const today = new Date();
  
  const formatDate = (d) => d.toISOString().split("T")[0];

  if (range === 'bugun') {
    startInput.value = formatDate(today);
    endInput.value = formatDate(today);
  } else if (range === 'buhafta') {
    // Pazartesiyi bul
    const day = today.getDay() || 7; // Pazar=0 ise 7 yap
    const monday = new Date(today);
    monday.setDate(today.getDate() - day + 1);
    
    startInput.value = formatDate(monday);
    endInput.value = formatDate(today); // Bugüne kadar
  } else if (range === 'buay') {
    const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
    startInput.value = formatDate(firstDay);
    endInput.value = formatDate(today);
  } else if (range === 'buyil') {
    const firstDay = new Date(today.getFullYear(), 0, 1);
    startInput.value = formatDate(firstDay);
    endInput.value = formatDate(today);
  }

  // Tarih değişti, verileri yenile
  refreshData();
}

// API İSTEK YARDIMCISI
async function fetchAPI(endpoint, params = {}) {
  const qs = new URLSearchParams(params).toString();
  try {
    const res = await fetch(`${endpoint}?${qs}`);
    if (!res.ok) throw new Error(`API Hatası: ${res.statusText}`);
    return await res.json();
  } catch (err) {
    console.error(err);
    return null;
  }
}

// =========================================================
// 3. GENEL ÖZET (KPI & SAATLİK GRAFİK)
// =========================================================
async function loadGeneralSummary(params) {
  const data = await fetchAPI("/api/patron/ozet", { start: params.start, end: params.end });
  if (!data) return;

  animateValue("kpi-ciro", data.ciro, "₺");
  animateValue("kpi-kar", data.net_kar, "₺");
  animateValue("kpi-maliyet", data.maliyet, "₺");
  animateValue("kpi-siparis", data.toplam_siparis, "");
}

// =========================================================
// GRAFİK YÜKLEME (Ciro, Kar ve Adet - Multi Axis)
// =========================================================
async function loadMainChart(params) {
  const ctx = document.getElementById("mainChart").getContext("2d");

  // Verileri Çek
  const data1 = await fetchAPI("/api/patron/saatlik", { start: params.start, end: params.end });
  if (!data1) return;

  const labels = data1.saatlik.map(x => `${x.saat}:00`);
  
  // Veri Setlerini Hazırla
  const datasets = [
    {
      label: 'Ciro (₺)',
      data: data1.saatlik.map(x => x.ciro),
      borderColor: '#6366f1', // İndigo (Mavi)
      backgroundColor: 'rgba(99, 102, 241, 0.1)',
      borderWidth: 3,
      tension: 0.4,
      yAxisID: 'y', // Sol Eksen
      order: 2
    },
    {
      label: 'Net Kâr (₺)',
      data: data1.saatlik.map(x => x.net_kar),
      borderColor: '#10b981', // Yeşil
      backgroundColor: 'rgba(16, 185, 129, 0.1)',
      borderWidth: 3,
      tension: 0.4,
      fill: true,
      yAxisID: 'y', // Sol Eksen
      order: 3
    },
    {
      label: 'Satış Adedi',
      data: data1.saatlik.map(x => x.adet),
      borderColor: '#f59e0b', // Turuncu
      backgroundColor: 'rgba(245, 158, 11, 0.2)',
      borderWidth: 2,
      borderDash: [5, 5], // Kesikli çizgi olsun karışmasın
      tension: 0.4,
      yAxisID: 'y1', // SAĞ Eksen (Adetler burada görünecek)
      type: 'line', 
      order: 1
    }
  ];

  // Eğer eski grafik varsa yok et
  if (charts.main) charts.main.destroy();

  // Yeni Grafiği Oluştur
  charts.main = new Chart(ctx, {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: 'index',
        intersect: false,
      },
      plugins: {
        legend: {
          position: 'top',
          labels: {
            usePointStyle: true,
            padding: 20,
            font: { size: 12, family: "'Outfit', sans-serif" }
          },
          // Tıklayınca Aç/Kapa özelliği Chart.js'de otomatiktir.
          onClick: function(e, legendItem, legend) {
            const index = legendItem.datasetIndex;
            const ci = legend.chart;
            if (ci.isDatasetVisible(index)) {
              ci.hide(index);
              legendItem.hidden = true;
            } else {
              ci.show(index);
              legendItem.hidden = false;
            }
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              let label = context.dataset.label || '';
              if (label) {
                label += ': ';
              }
              if (context.dataset.yAxisID === 'y') {
                label += new Intl.NumberFormat('tr-TR', { style: 'currency', currency: 'TRY' }).format(context.raw);
              } else {
                label += context.raw + ' Adet';
              }
              return label;
            }
          }
        }
      },
      scales: {
        y: {
          type: 'linear',
          display: true,
          position: 'left',
          beginAtZero: true,
          title: { display: true, text: 'Tutar (TL)' },
          grid: { color: 'rgba(0,0,0,0.05)' }
        },
        y1: {
          type: 'linear',
          display: true,
          position: 'right',
          beginAtZero: true,
          title: { display: true, text: 'Satış Adedi' },
          grid: {
            drawOnChartArea: false, 
          },
          // EKLENECEK KISIM BURASI:
          ticks: {
            stepSize: 1,   // 0.5, 1.5 gibi küsuratlı sayıları engeller, tam sayı yapar.
            precision: 0   // Kesinlikle tam sayı zorlar.
          },
          suggestedMax: 5 // Eğer veri azsa en az 5'e kadar çiz, veri çoksa (örn 50) otomatik artır.
        }
      }
    }
  });
}

function loadTopTables(params) {
  // En Çok Satanlar (Adet)
  fetchAPI("/api/patron/top-urunler", { ...params, limit: 67 }).then(data => {
    if (data) renderTable("table-top-urunler", data.urunler, ["urun_adi", "adet", "ciro", "net_kar"]);
  });

  // En Çok Ciro Getirenler
  fetchAPI("/api/patron/top-urunler/tam", { ...params, sort: "ciro" }).then(data => {
    if (data) renderTable("table-top-ciro", data.urunler.slice(0, 67), ["urun_adi", "adet", "ciro", "net_kar"]);
  });
}

// =========================================================
// 4. ÜRÜN ANALİZİ
// =========================================================
async function loadProductDropdown() {
  const products = await fetchAPI("/api/patron/urunler");
  const select = document.getElementById("select-urun");
  if (!products) return;

  products.forEach(p => {
    const opt = document.createElement("option");
    opt.value = p.urun_id;
    opt.textContent = p.urun_adi;
    select.appendChild(opt);
  });
  productListLoaded = true;
}

async function analyzeProduct() {
  const id = document.getElementById("select-urun").value;
  if (!id) return;

  const params = getParams();
  const data = await fetchAPI(`/api/patron/urun-satis/${id}`, params);
  if (!data) return;

  document.getElementById("product-details").classList.remove("hidden");

  // Mini KPI
  document.getElementById("p-adet").innerText = data.toplam.adet;
  document.getElementById("p-ciro").innerText = money(data.toplam.ciro);
  document.getElementById("p-kar").innerText = money(data.toplam.net_kar);

  // Günlük Grafik
  const ctx = document.getElementById("productChart").getContext("2d");
  const labels = data.gunluk.map(x => formatDate(x.gun));
  const values = data.gunluk.map(x => x.adet);

  if (charts.product) charts.product.destroy();
  charts.product = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Satış Adedi',
        data: values,
        backgroundColor: '#10b981',
        borderRadius: 6
      }]
    },
    options: { responsive: true, maintainAspectRatio: false }
  });
}

// =========================================================
// 4.1. ÜRÜN TRENDLERİ (YENİ)
// =========================================================
async function loadProductTrends(params) {
  const tbodyBottom = document.querySelector("#table-bottom-urunler tbody");
  const tbodyUp = document.querySelector("#table-trend-up tbody");
  const tbodyDown = document.querySelector("#table-trend-down tbody");
  
  if(!tbodyBottom) return;

  const data = await fetchAPI("/api/patron/urun-trendleri", params);
  if (!data) {
    const errorMsg = "<tr><td colspan='2' class='text-center' style='color:red;'>Veri çekilemedi. Server.js güncellenmemiş (yeniden başlatın) veya tarih geçersiz.</td></tr>";
    tbodyBottom.innerHTML = errorMsg;
    tbodyUp.innerHTML = errorMsg;
    tbodyDown.innerHTML = errorMsg;
    return;
  }

  // En Az Satanlar
  tbodyBottom.innerHTML = "";
  if(data.bottom.length === 0) tbodyBottom.innerHTML = "<tr><td colspan='2' class='text-center'>Veri yok</td></tr>";
  data.bottom.forEach(d => {
    tbodyBottom.innerHTML += `<tr>
      <td style="font-weight:500;">${d.urun_adi}</td>
      <td style="font-weight:bold; color:var(--danger);">${d.adet} Adet</td>
    </tr>`;
  });

  // Yükselen Trendler
  tbodyUp.innerHTML = "";
  if(data.up.length === 0) tbodyUp.innerHTML = "<tr><td colspan='2' class='text-center'>Veri yok</td></tr>";
  data.up.forEach(d => {
    tbodyUp.innerHTML += `<tr>
      <td style="font-weight:500;">${d.urun_adi}</td>
      <td style="font-weight:bold; color:var(--success);">+ %${d.yuzde} <small style="color:gray;">(${d.prev_adet} → ${d.adet})</small></td>
    </tr>`;
  });

  // Düşen Trendler
  tbodyDown.innerHTML = "";
  if(data.down.length === 0) tbodyDown.innerHTML = "<tr><td colspan='2' class='text-center'>Veri yok</td></tr>";
  data.down.forEach(d => {
    tbodyDown.innerHTML += `<tr>
      <td style="font-weight:500;">${d.urun_adi}</td>
      <td style="font-weight:bold; color:gray;">%${d.yuzde} <small style="color:gray;">(${d.prev_adet} → ${d.adet})</small></td>
    </tr>`;
  });
}

// =========================================================
// 5. KATEGORİ ANALİZİ
// =========================================================
async function loadCategoryDropdown() {
  const cats = await fetchAPI("/api/patron/kategoriler");
  const select = document.getElementById("select-kategori");
  if (!cats) return;

  cats.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.kategori_id;
    opt.textContent = c.kategori_adi;
    select.appendChild(opt);
  });
  categoryListLoaded = true;
}

async function analyzeCategory() {
  const id = document.getElementById("select-kategori").value;
  if (!id) return;

  const params = getParams();
  const data = await fetchAPI(`/api/patron/kategori-satis/${id}`, params);
  if (!data) return;

  document.getElementById("category-details").classList.remove("hidden");

  // Grafik (Ciro Trendi)
  const ctx = document.getElementById("categoryChart").getContext("2d");
  if (charts.category) charts.category.destroy();
  charts.category = new Chart(ctx, {
    type: 'line',
    data: {
      labels: data.gunluk.map(x => formatDate(x.gun)),
      datasets: [{
        label: 'Günlük Ciro',
        data: data.gunluk.map(x => x.ciro),
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245, 158, 11, 0.1)',
        fill: true,
        tension: 0.3
      }]
    },
    options: { responsive: true }
  });

  // Ürün Tablosu
  renderTable("table-cat-products", data.urun_siralama, ["urun_adi", "adet", "net_kar"]);
}

async function analyzeAllCategories() {
  const params = getParams();
  const data = await fetchAPI("/api/patron/kategori-siralama", { ...params, sort: "kar" });
  if (data) renderTable("table-all-categories", data.kategoriler, ["kategori_adi", "adet", "ciro", "net_kar"]);
}

// =========================================================
// 6. KAMPANYA ANALİZİ (Tıklanabilir Satırlar + Detay Modalı)
// =========================================================
async function loadCampaignsTable() {
  console.log("Kampanya tablosu yükleniyor..."); // Kontrol 1
  const params = getParams();
  const data = await fetchAPI("/api/patron/kampanyalar", params);
  
  const tbody = document.querySelector("#table-campaigns tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!data || data.kampanyalar.length === 0) {
    tbody.innerHTML = "<tr><td colspan='6' class='text-center'>Veri bulunamadı.</td></tr>";
    return;
  }

  data.kampanyalar.forEach(k => {
    const tr = document.createElement("tr");
    tr.style.cursor = "pointer";
    tr.title = "Detay için tıkla";

    // Tıklama Olayı
    tr.onclick = function(e) {
      // Eğer tıklanan yer buton değilse modalı aç
      if(e.target.tagName !== 'BUTTON') {
        console.log("Satıra tıklandı! ID:", k.kampanya_id); // Kontrol 2
        openCampaignModal(k.kampanya_id);
      }
    };

    tr.innerHTML = `
      <td style="font-weight:600;">${k.kampanya_adi}</td>
      <td>${k.siparis_sayisi}</td>
      <td>${money(k.kosul_ciro)}</td>
      <td style="color:red">${money(k.hediye_maliyet)}</td>
      <td style="font-weight:bold; color:${k.net_kar>=0?'green':'red'}">${money(k.net_kar)}</td>
      <td><button class="btn-primary" onclick="openCampaignModal(${k.kampanya_id})">İncele</button></td>
    `;
    tbody.appendChild(tr);
  });
}

async function openCampaignModal(id) {
  try {
    console.log("Modal açılıyor... ID:", id); // Kontrol 3
    const params = getParams();
    const data = await fetchAPI(`/api/patron/kampanya/${id}`, params);
    
    if (!data) {
      alert("Veri çekilemedi!");
      return;
    }

    const modal = document.getElementById("campaign-detail-modal");
    if(!modal) {
      alert("HATA: HTML'de 'campaign-detail-modal' id'li div bulunamadı!");
      return;
    }

    // Modal Başlığı
    const titleEl = document.getElementById("modal-camp-title");
    if(titleEl) titleEl.innerHTML = `${data.kampanya_adi} <span style="font-size:0.7em; color:${data.toplam.net_kar>=0?'green':'red'}">(${money(data.toplam.net_kar)})</span>`;

    // Grafik
    const ctx = document.getElementById("campaignChart");
    if(ctx) {
      if (charts.campaign) charts.campaign.destroy();
      charts.campaign = new Chart(ctx.getContext("2d"), {
        type: 'bar',
        data: {
          labels: data.gunluk.map(x => formatDate(x.gun)),
          datasets: [
            { label: 'Ciro', data: data.gunluk.map(x => x.ciro), backgroundColor: '#6366f1' },
            { label: 'Maliyet', data: data.gunluk.map(x => x.maliyet + x.hediye_maliyet), backgroundColor: '#ef4444' }
          ]
        },
        options: { responsive: true, maintainAspectRatio: false }
      });
    }

    // Tablo
    renderTable("table-camp-products", data.urunler, ["urun_adi", "kampanya_turu", "adet", "maliyet"]);

    // Modalı Göster (CSS class'ını değiştirerek)
    modal.classList.remove("hidden");
    
  } catch (err) {
    console.error("Modal hatası:", err);
    alert("Bir hata oluştu: " + err.message);
  }
}

// =========================================================
// 7. YARDIMCI FONKSİYONLAR
// =========================================================
function money(val) {
  return "₺" + Number(val || 0).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatDate(isoStr) {
  const d = new Date(isoStr);
  return d.toLocaleDateString("tr-TR", { day: "numeric", month: "short" });
}

function animateValue(id, value, prefix = "") {
  const el = document.getElementById(id);
  if (!el) return;
  el.innerText = prefix + Number(value).toLocaleString("tr-TR", { minimumFractionDigits: 2 });
}

function renderTable(tableId, data, columns) {
  const tbody = document.querySelector(`#${tableId} tbody`);
  if (!tbody) return;
  tbody.innerHTML = "";

  if (!data || data.length === 0) {
    tbody.innerHTML = `<tr><td colspan="${columns.length}" class="text-center">Veri yok</td></tr>`;
    return;
  }

  data.forEach(row => {
    const tr = document.createElement("tr");
    columns.forEach(col => {
      const td = document.createElement("td");
      let val = row[col];

      // Özel formatlamalar
      if (['ciro', 'kar', 'net_kar', 'maliyet', 'fiyat'].includes(col) || col.includes('maliyet')) {
        td.innerText = money(val);
        if (col === 'net_kar' || col === 'kar') {
          td.style.color = val >= 0 ? "var(--success)" : "var(--danger)";
          td.style.fontWeight = "bold";
        }
      } else if (col === 'kampanya_turu') {
        td.innerHTML = val === 'kosul' 
          ? '<span style="color:#6366f1; font-weight:500">Satılan</span>' 
          : '<span style="color:#10b981; font-weight:bold">Hediye</span>';
      } else {
        td.innerText = val;
      }
      tr.appendChild(td);
    });
    tbody.appendChild(tr);
  });
}

// =========================================================
// 8. AKTİF SİPARİŞLER (BOSS PANEL)
// =========================================================
async function loadActiveOrders() {
  const tbody = document.querySelector("#table-active-orders tbody");
  if (!tbody) return;
  
  tbody.innerHTML = "<tr><td colspan='7' class='text-center'>Yükleniyor...</td></tr>";
  
  try {
    const res = await fetch("/api/siparisler?limit=200");
    if (!res.ok) throw new Error("Siparişler yüklenemedi");
    const json = await res.json();
    const orders = json.data || [];
    
    tbody.innerHTML = "";
    if (orders.length === 0) {
      tbody.innerHTML = "<tr><td colspan='7' class='text-center'>Aktif sipariş bulunmamaktadır.</td></tr>";
      return;
    }
    
    const sorted = [...orders].sort((a, b) => new Date(b.tarih) - new Date(a.tarih));
    
    const statusColors = {
      "Beklemede": { bg: "rgba(107, 114, 128, 0.15)", text: "#6b7280" },
      "Hazırlanıyor": { bg: "rgba(245, 158, 11, 0.15)", text: "#d97706" },
      "Hazır": { bg: "rgba(16, 185, 129, 0.15)", text: "#10b981" },
      "Teslim Edildi": { bg: "rgba(59, 130, 246, 0.15)", text: "#3b82f6" },
      "İptal": { bg: "rgba(239, 68, 68, 0.15)", text: "#ef4444" }
    };
    
    sorted.forEach(o => {
      const tr = document.createElement("tr");
      
      const kalemlerHtml = (o.kalemler || []).map(k => {
        let txt = `<strong>${k.urun_adi}</strong>`;
        if (k.varyasyon_adi) txt += ` <span style="color:var(--primary); font-size:0.8em">(${k.varyasyon_adi})</span>`;
        if (k.ekstra_not) txt += ` <br><small style="color:var(--text-muted); font-size:0.75em">[${k.ekstra_not}]</small>`;
        return `${txt} x${k.adet}`;
      }).join("<br>");
      
      const notHtml = o.siparis_notu ? `<span style="color:var(--accent); font-weight:600;">📝 ${o.siparis_notu}</span>` : "—";
      
      const timeStr = new Date(o.tarih).toLocaleTimeString("tr-TR", { hour: '2-digit', minute: '2-digit' });
      const dateStr = new Date(o.tarih).toLocaleDateString("tr-TR", { day: 'numeric', month: 'short' });
      
      const st = statusColors[o.durum] || { bg: "#f3f4f6", text: "#374151" };
      const statusHtml = `<span style="background:${st.bg}; color:${st.text}; padding:4px 10px; border-radius:50px; font-size:0.8rem; font-weight:700; white-space:nowrap; display:inline-block;">${o.durum}</span>`;
      
      tr.innerHTML = `
        <td style="font-weight:600;">#${o.siparis_id}</td>
        <td><strong style="color:var(--primary); font-size:1.05rem;">Masa ${o.masa_no || o.masa_id}</strong></td>
        <td><span style="font-weight:500;">${timeStr}</span> <small style="color:var(--text-muted); display:block; font-size:0.75rem;">${dateStr}</small></td>
        <td style="text-align:left; font-size:0.85rem; line-height:1.4;">${kalemlerHtml}</td>
        <td style="font-size:0.85rem;">${notHtml}</td>
        <td style="font-weight:bold; font-size:0.95rem; color:var(--primary);">${money(o.toplam_tutar)}</td>
        <td>${statusHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan='7' class='text-center' style='color:var(--danger);'>Siparişler yüklenirken hata oluştu!</td></tr>`;
  }
}

// =========================================================
// 9. ÇAPRAZ SATIŞ ANALİZİ (YENİ)
// =========================================================
async function loadCrossSellAnalysis() {
  const tbody = document.querySelector("#table-cross-sell tbody");
  const suggestionsBox = document.getElementById("cross-sell-suggestions");
  if (!tbody || !suggestionsBox) return;

  const params = getParams();
  tbody.innerHTML = "<tr><td colspan='4' class='text-center'>Veriler analiz ediliyor...</td></tr>";
  suggestionsBox.innerHTML = "";

  const data = await fetchAPI("/api/patron/capraz-satis", params);

  if (!data || !data.data || data.data.length === 0) {
    tbody.innerHTML = "<tr><td colspan='4' class='text-center'>Yeterli çapraz satış verisi bulunamadı.</td></tr>";
    suggestionsBox.innerHTML = "<li style='padding:15px;'>Henüz yeterli çapraz satış eşleşmesi oluşmadı. Daha fazla sipariş girildikçe öneriler burada belirecektir.</li>";
    return;
  }

  tbody.innerHTML = "";
  data.data.forEach(d => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td style="font-weight:600;">${d.ana_urun}</td>
      <td style="color:var(--primary); font-weight:500;">${d.birlikte_urun}</td>
      <td>
        <div style="display:flex; align-items:center; gap:10px;">
          <span style="font-weight:bold;">${d.oran}</span>
          <div style="flex:1; height:8px; background:rgba(0,0,0,0.1); border-radius:4px; overflow:hidden;">
            <div style="width:${d.oran_sayisal}%; height:100%; background:var(--primary);"></div>
          </div>
        </div>
      </td>
      <td style="color:var(--success); font-weight:bold;">${d.sepet_etkisi}</td>
    `;
    tbody.appendChild(tr);
  });

  // Fırsat Önerileri
  if (data.suggestions && data.suggestions.length > 0) {
    let suggestionsHtml = "";
    data.suggestions.forEach((s, i) => {
      const color = i % 2 === 0 ? 'var(--success)' : 'var(--primary)';
      const bg = i % 2 === 0 ? 'rgba(16, 185, 129, 0.1)' : 'rgba(99, 102, 241, 0.1)';
      const icon = i % 2 === 0 ? 'lightbulb' : 'trending_up';
      
      suggestionsHtml += `
        <li style="padding:15px; background:${bg}; border-left:4px solid ${color}; border-radius:4px; display:flex; align-items:flex-start; gap:10px;">
          <span class="material-icons-round" style="color:${color};">${icon}</span>
          <div>
            <strong style="display:block; margin-bottom:5px;">${s.title}</strong>
            <span style="font-size:0.9rem; color:var(--text-muted);">${s.desc}</span>
          </div>
        </li>
      `;
    });
    suggestionsBox.innerHTML = suggestionsHtml;
  }
}

// =========================================================
// 10. YOĞUNLUK HARİTASI (HEATMAP)
// =========================================================
async function loadHeatmapAnalysis() {
  const container = document.getElementById("heatmap-container");
  if (!container) return;

  container.innerHTML = "<div style='grid-column: 1 / -1; text-align:center;'>Harita hesaplanıyor...</div>";

  const params = getParams();
  const apiData = await fetchAPI("/api/patron/heatmap", params);

  if (!apiData || !apiData.data) {
    container.innerHTML = "<div style='grid-column: 1 / -1; text-align:center;'>Veri bulunamadı.</div>";
    return;
  }

  const gunler = ["Pzt", "Sal", "Çar", "Per", "Cum", "Cmt", "Paz"];
  const saatler = [9, 11, 13, 15, 17, 19, 21, 23];
  const saatlerLabels = ["09:00", "11:00", "13:00", "15:00", "17:00", "19:00", "21:00", "23:00"];

  let html = "";
  
  // Sol üst boşluk
  html += `<div></div>`; 
  
  // Üst saat başlıkları
  gunler.forEach(gun => {
    html += `<div style="text-align:center; font-weight:600; font-size:0.85rem; padding-bottom:5px; color:var(--text-muted);">${gun}</div>`;
  });

  // Izgara oluştur
  saatler.forEach((saat, saatIndex) => {
    // Sol saat başlığı
    html += `<div style="display:flex; align-items:center; justify-content:flex-end; padding-right:10px; font-size:0.8rem; font-weight:500; color:var(--text-muted);">${saatlerLabels[saatIndex]}</div>`;
    
    gunler.forEach((gun, gunIndex) => {
      // Backend'den gelen intensity'yi bul
      let cell = apiData.data.find(d => d.gun_index === gunIndex && d.saat_dilimi === saat);
      let intensity = 0.02;
      let siparis = 0;
      
      if (cell) {
        intensity = cell.intensity;
        siparis = cell.siparis_sayisi;
      }
      
      const bgColor = `rgba(99, 102, 241, ${intensity.toFixed(2)})`;
      const tooltip = `${gun} ${saatlerLabels[saatIndex]} | Yoğunluk Seviyesi: ${Math.round(intensity * 100)}% | Ortalama ${siparis} Sipariş`;

      html += `<div title="${tooltip}" style="background-color: ${bgColor}; border-radius: 4px; height: 35px; transition: transform 0.2s; cursor: pointer;" onmouseover="this.style.transform='scale(1.1)'" onmouseout="this.style.transform='scale(1)'"></div>`;
    });
  });

  container.innerHTML = html;
}

// =========================================================
// HEATMAP HAFTA SEÇİMİ (YENİ)
// =========================================================
function setHeatmapWeek() {
  const weekVal = document.getElementById("heatmapWeek").value;
  if (!weekVal) return;

  // weekVal örneği: "2024-W25"
  const [year, weekStr] = weekVal.split("-W");
  const w = parseInt(weekStr, 10);
  const y = parseInt(year, 10);

  // Belirli bir haftanın pazartesi gününü bulma
  const simple = new Date(y, 0, 1 + (w - 1) * 7);
  const dow = simple.getDay();
  const ISOweekStart = simple;
  if (dow <= 4)
      ISOweekStart.setDate(simple.getDate() - simple.getDay() + 1);
  else
      ISOweekStart.setDate(simple.getDate() + 8 - simple.getDay());

  const monday = new Date(ISOweekStart);
  
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);

  const formatDate = (d) => d.toISOString().split("T")[0];
  
  // Ana tarih girişlerini güncelle
  document.getElementById("startDate").value = formatDate(monday);
  document.getElementById("endDate").value = formatDate(sunday);

  // Sadece heatmap'i yenile
  loadHeatmapAnalysis();
}

