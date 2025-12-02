// Patron Paneli — Tamamen Yenilenmiş JS

let gunlukChart = null;
let kategoriChart = null;
let saatChart = null;
let urunChart = null;

const state = {
  range: "today", // Şimdilik sadece özet için anlamlı; backend genişletilirse kullanılabilir
};

function formatTL(value) {
  const num = Number(value || 0);
  return "₺" + num.toFixed(2);
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

async function fetchJSON(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`İstek başarısız: ${res.status}`);
  return res.json();
}

async function loadAll() {
  try {
    await Promise.all([
      loadOzet(),
      loadGunluk(),
      loadKategori(),
      loadSaatGrafik(),
      loadTopUrunler(),
      loadMusteriAnaliz(),
      loadTumSiparisler(),
    ]);
  } catch (err) {
    console.error(err);
    alert("Veriler yüklenirken bir hata oluştu: " + err.message);
  }
}

// === 1) Özet Kartlar ===
async function loadOzet() {
  // İleride ?range= eklenebilir: `/api/analiz/ozet?range=${state.range}`
  const data = await fetchJSON("/api/analiz/ozet");

  const elTodayCiro = document.getElementById("kpiTodayCiro");
  const elTotalCiro = document.getElementById("kpiTotalCiro");
  const elTodayOrders = document.getElementById("kpiTodayOrders");
  const elTotalOrders = document.getElementById("kpiTotalOrders");
  const elAvgTicket = document.getElementById("kpiAvgTicket");
  const elActiveOrders = document.getElementById("kpiActiveOrders");
  const elDelivered = document.getElementById("kpiDelivered");
  const elCancelled = document.getElementById("kpiCancelled");

  if (!data) return;

  elTodayCiro.textContent = formatTL(data.bugun_ciro);
  elTotalCiro.textContent = formatTL(data.toplam_ciro);
  elTodayOrders.textContent = safeNumber(data.bugun_siparis);
  elTotalOrders.textContent = safeNumber(data.toplam_siparis);
  elAvgTicket.textContent = formatTL(data.ortalama_tutar);
  elActiveOrders.textContent = safeNumber(data.aktif_siparis);
  elDelivered.textContent = safeNumber(data.teslim_sayisi);
  elCancelled.textContent = safeNumber(data.iptal_sayisi);
}

// === 2) Günlük Ciro Grafiği ===
async function loadGunluk() {
  const data = await fetchJSON("/api/analiz/gunluk");

  const labels = data.map((d) => {
    const dt = new Date(d.tarih);
    if (Number.isNaN(dt.getTime())) return d.tarih;
    return dt.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
  });

  const values = data.map((d) => safeNumber(d.toplam_tutar));

  const ctx = document.getElementById("gunlukChart");
  if (!ctx) return;

  if (gunlukChart) gunlukChart.destroy();

  gunlukChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "Günlük Ciro (₺)",
          data: values,
          borderWidth: 2,
          borderColor: "#6366f1",
          backgroundColor: "rgba(99, 102, 241, 0.15)",
          fill: true,
          tension: 0.25,
          pointRadius: 3,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: { display: false },
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: (value) => "₺" + value,
          },
        },
      },
    },
  });
}

// === 3) Kategori Bazlı Ciro Grafiği ===
async function loadKategori() {
  const data = await fetchJSON("/api/analiz/kategori");
  const ctx = document.getElementById("kategoriChart");
  if (!ctx) return;

  const labels = data.map((d) => d.kategori_adi);
  const values = data.map((d) => safeNumber(d.toplam_ciro));

  if (kategoriChart) kategoriChart.destroy();

  kategoriChart = new Chart(ctx, {
    type: "doughnut",
    data: {
      labels,
      datasets: [
        {
          data: values,
          borderWidth: 0,
        },
      ],
    },
    options: {
      plugins: {
        legend: {
          position: "bottom",
          labels: { boxWidth: 12 },
        },
      },
    },
  });
}

// === 4) Saat Bazlı Sipariş Grafiği ===
async function loadSaatGrafik() {
  const data = await fetchJSON("/api/analiz/saatlik");
  const ctx = document.getElementById("saatChart");
  if (!ctx) return;

  const labels = data.map((d) => `${safeNumber(d.saat)}:00`);
  const values = data.map((d) => safeNumber(d.siparis_sayisi));

  if (saatChart) saatChart.destroy();

  saatChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "Sipariş",
          data: values,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        y: { beginAtZero: true, precision: 0 },
      },
    },
  });
}

// === 5) En Çok Satan Ürünler (Tablo + Mini Graf) ===
async function loadTopUrunler() {
  const data = await fetchJSON("/api/analiz/en-cok-satan");
  const tbody = document.querySelector("#urunTablosu tbody");
  const ctx = document.getElementById("urunChart");

  if (!tbody) return;

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="4">Henüz satış verisi yok.</td></tr>`;
  } else {
    tbody.innerHTML = data
      .map(
        (u, idx) => `
      <tr>
        <td>${idx + 1}</td>
        <td>${u.urun_adi}</td>
        <td>${safeNumber(u.satis_sayisi)}</td>
        <td>${formatTL(u.toplam_tutar)}</td>
      </tr>
    `
      )
      .join("");
  }

  if (!ctx) return;

  if (urunChart) urunChart.destroy();

  const topForChart = data.slice(0, 5);
  urunChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: topForChart.map((u) => u.urun_adi),
      datasets: [
        {
          label: "Satış Adedi",
          data: topForChart.map((u) => safeNumber(u.satis_sayisi)),
        },
      ],
    },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: {
        x: { beginAtZero: true, precision: 0 },
      },
    },
  });
}

// === 6) Müşteri Analizi ===
async function loadMusteriAnaliz() {
  const data = await fetchJSON("/api/analiz/en-cok-musteri");
  const tbody = document.querySelector("#musteriTablosu tbody");
  if (!tbody) return;

  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="4">Henüz müşteri verisi yok.</td></tr>`;
    return;
  }

  tbody.innerHTML = data
    .map(
      (m, idx) => `
    <tr>
      <td>${idx + 1}</td>
      <td>${m.ad_soyad || "(Anonim)"}</td>
      <td>${safeNumber(m.siparis_sayisi)}</td>
      <td>${formatTL(m.toplam_tutar)}</td>
    </tr>
  `
    )
    .join("");
}

// === 7) Canlı Sipariş Listesi ===
async function loadTumSiparisler() {
  const payload = await fetchJSON("/api/siparisler?limit=200");
  const tbody = document.querySelector("#tumSiparisler tbody");
  if (!tbody) return;

  const data = payload.data || [];
  if (!data.length) {
    tbody.innerHTML = `<tr><td colspan="6">Henüz sipariş yok.</td></tr>`;
    return;
  }

  tbody.innerHTML = "";
  let index = 1;
  for (const o of data) {
    const kalemler = (o.kalemler || [])
      .map((k) => `${k.urun_adi} ×${k.adet}`)
      .join("<br>");

    const statusClass = (o.durum || "").replace(/\s/g, "");

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${index++}</td>
      <td>${o.masa_no || "-"}</td>
      <td><span class="status ${statusClass}">${o.durum}</span></td>
      <td>${new Date(o.tarih).toLocaleString("tr-TR")}</td>
      <td>${formatTL(o.toplam_tutar)}</td>
      <td class="urunler-cell">${kalemler}</td>
    `;
    tbody.appendChild(tr);
  }
}

// === 8) Gün Sonu Arşiv ===
async function arsivle() {
  const onay = confirm("Teslim edilen siparişleri arşive kaydetmek istiyor musunuz?");
  if (!onay) return;

  try {
    const res = await fetch("/api/arsivle", { method: "POST" });
    const data = await res.json();
    alert(data.message || "Arşivleme tamamlandı.");
    await loadAll();
  } catch (err) {
    alert("Bir hata oluştu: " + err.message);
  }
}

// === Başlangıç ===
function initPatronPanel() {
  // Tarihi sidebar'a yaz
  const todayEl = document.getElementById("todayText");
  if (todayEl) {
    const now = new Date();
    todayEl.textContent = now.toLocaleDateString("tr-TR", {
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  }

  const refreshBtn = document.getElementById("refresh");
  const arsivBtn = document.getElementById("arsivleBtn");
  const rangeButtons = document.querySelectorAll(".range-btn");
  const navLinks = document.querySelectorAll(".nav-link");

  if (refreshBtn) {
    refreshBtn.addEventListener("click", loadAll);
  }

  if (arsivBtn) {
    arsivBtn.addEventListener("click", arsivle);
  }

  rangeButtons.forEach((btn) => {
    btn.addEventListener("click", () => {
      rangeButtons.forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.range = btn.dataset.range || "today";
      // Şimdilik sadece görsel; backend genişletilirse burada yeniden istek atılabilir
      loadAll();
    });
  });

  navLinks.forEach((link) => {
    link.addEventListener("click", () => {
      navLinks.forEach((l) => l.classList.remove("active"));
      link.classList.add("active");
    });
  });

  loadAll();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initPatronPanel);
} else {
  initPatronPanel();
}
