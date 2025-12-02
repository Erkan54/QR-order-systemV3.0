// Basit bildirim
function notify(msg) {
  alert(msg);
}

// Ödül ürün adları için map
const rewardProductMap = {};

// DOM hazır olunca
document.addEventListener("DOMContentLoaded", () => {
  const refreshBtn = document.getElementById("refresh");
  const logoutBtn = document.getElementById("logout");

  refreshBtn?.addEventListener("click", () => {
    loadCategories();
    loadMenu();
    loadRewardProducts();
    loadCampaigns();
  });

  logoutBtn?.addEventListener("click", logout);

  document.getElementById("urunEkleBtn")?.addEventListener("click", addProduct);
  document.getElementById("kampEkleBtn")?.addEventListener("click", addCampaign);

  const kampTurSelect = document.getElementById("kampTur");
  kampTurSelect?.addEventListener("change", onCampaignTypeChange);

  // Tablolarda event delegation
  setupMenuTableEvents();
  setupCampaignTableEvents();

  // İlk yükleme
  loadCategories();
  loadMenu();
  loadRewardProducts();
  loadCampaigns();
});

// ================= LOGOUT =================
async function logout() {
  try {
    await fetch("/api/logout", { method: "POST" });
  } catch (e) {
    // yoksay
  }
  window.location.href = "start.html";
}

// ================= MENÜ / ÜRÜN =================

// Kategorileri çek (ürün ekleme formu için)
async function loadCategories() {
  try {
    const res = await fetch("/api/admin/kategoriler");
    if (!res.ok) throw new Error("Kategoriler alınamadı");
    const categories = await res.json();
    const sel = document.getElementById("kategoriSelect");
    if (!sel) return;
    sel.innerHTML = "";
    categories.forEach(c => {
      const opt = document.createElement("option");
      opt.value = c.kategori_id;
      opt.textContent = c.kategori_adi;
      sel.appendChild(opt);
    });
  } catch (err) {
    console.error(err);
  }
}

// Ürünleri çek & tabloya bas
async function loadMenu() {
  try {
    const res = await fetch("/api/admin/menu");
    if (!res.ok) throw new Error("Menü alınamadı");
    const items = await res.json();
    const tbody = document.getElementById("menuTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    items.forEach(row => {
  const tr = document.createElement("tr");
  tr.innerHTML = `
    <td>${row.kategori_adi}</td>
    <td>${row.urun_adi}</td>
    <td>
      <input type="number" step="0.01" min="0" 
             class="price-input" 
             data-id="${row.urun_id}"
             value="${Number(row.fiyat || 0).toFixed(2)}">
      <button class="btn btn-xs price-save" data-id="${row.urun_id}">Kaydet</button>
    </td>
    <td>
      <input type="number" step="1" min="0" max="40"
             class="kdv-input"
             data-id="${row.urun_id}"
             value="${Number(row.kdv || 0)}">
    </td>
    <td class="switch-cell">
      <input type="checkbox" class="aktif-toggle" data-id="${row.urun_id}" ${row.aktif ? "checked" : ""}>
    </td>

      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    notify("Menü yüklenirken hata oluştu.");
  }
}

// Yeni ürün ekle
async function addProduct() {
  const kategoriSelect = document.getElementById("kategoriSelect");
  const urunAdInput = document.getElementById("urunAd");
  const urunFiyatInput = document.getElementById("urunFiyat");
  const urunKdvInput = document.getElementById("urunKdv");

  const kategori_id = Number(kategoriSelect.value);
  const urun_adi = (urunAdInput.value || "").trim();
  const fiyat = parseFloat(urunFiyatInput.value);

  // KDV input boşsa 0 kabul edelim
  let kdv = 0;
  if (urunKdvInput && urunKdvInput.value !== "") {
    kdv = parseInt(urunKdvInput.value, 10);
  }

  if (!kategori_id || !urun_adi) {
    return notify("Kategori ve ürün adını doldurun.");
  }
  if (isNaN(fiyat) || fiyat < 0) {
    return notify("Geçerli bir fiyat girin.");
  }
  if (isNaN(kdv) || kdv < 0 || kdv > 40) {
    return notify("Geçerli bir KDV oranı girin (0-40 arası).");
  }

  try {
    const res = await fetch("/api/admin/menu/ekle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kategori_id, urun_adi, fiyat, kdv })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Ürün eklenemedi");

    notify("Ürün eklendi.");
    urunAdInput.value = "";
    urunFiyatInput.value = "";
    if (urunKdvInput) urunKdvInput.value = "";
    loadMenu();
    loadRewardProducts();
  } catch (err) {
    console.error(err);
    notify(err.message);
  }
}


// Menü tablosu event delegation
function setupMenuTableEvents() {
  const tbody = document.getElementById("menuTableBody");
  if (!tbody) return;

  // Click events: fiyat kaydet & sil
  tbody.addEventListener("click", async (e) => {
    const target = e.target;

    // Fiyat kaydet
    if (target.classList.contains("price-save")) {
  const id = target.dataset.id;

  const fiyatInput = document.querySelector(`.price-input[data-id="${id}"]`);
  const kdvInput   = document.querySelector(`.kdv-input[data-id="${id}"]`);

  if (!fiyatInput) return;

  const fiyat = parseFloat(fiyatInput.value);
  if (isNaN(fiyat) || fiyat < 0) {
    return notify("Geçerli bir fiyat girin.");
  }

  let kdv = 0;
  if (kdvInput && kdvInput.value !== "") {
    kdv = parseInt(kdvInput.value, 10);
  }
  if (isNaN(kdv) || kdv < 0 || kdv > 40) {
    return notify("Geçerli bir KDV oranı girin (0-40 arası).");
  }

  try {
    const res = await fetch("/api/admin/menu/fiyat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ urun_id: Number(id), fiyat, kdv })
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Fiyat/KDV güncellenemedi");
    notify("Fiyat/KDV güncellendi.");
    loadMenu();
  } catch (err) {
    console.error(err);
    notify(err.message);
  }
}


    // Ürün sil
    if (target.classList.contains("delete-menu")) {
      const id = target.dataset.id;
      if (!confirm("Bu ürünü silmek istediğine emin misin?")) return;
      try {
        const res = await fetch(`/api/admin/menu/${id}`, {
          method: "DELETE"
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "Silinemedi");
        notify("Ürün silindi.");
        loadMenu();
        loadRewardProducts();
      } catch (err) {
        console.error(err);
        notify(err.message);
      }
    }
  });

  // Change events: aktif / tukendi
  tbody.addEventListener("change", async (e) => {
    const target = e.target;

    // Aktif toggle
    if (target.classList.contains("aktif-toggle")) {
      const id = target.dataset.id;
      const aktif = target.checked ? 1 : 0;
      try {
        const res = await fetch("/api/admin/menu/aktif", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ urun_id: Number(id), aktif })
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "Aktif durumu güncellenemedi");
      } catch (err) {
        console.error(err);
        notify(err.message);
      }
    }

    // Tükendi toggle
    if (target.classList.contains("tukendi-toggle")) {
      const id = target.dataset.id;
      const tukendi = target.checked ? 1 : 0;
      try {
        const res = await fetch(`/api/admin/urun/${id}/tukendi`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tukendi })
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.error || "Tükendi bilgisi güncellenemedi");
        // Menü listesi tetikleyebilirsin ama şart değil
      } catch (err) {
        console.error(err);
        notify(err.message);
      }
    }
  });
}

// ================= KAMPANYA =================

// Ödül ürünleri çek (kampanya formu için)
async function loadRewardProducts() {
  try {
    const res = await fetch("/api/admin/odul-urunler");
    if (!res.ok) throw new Error("Ödül ürünleri alınamadı");
    const rows = await res.json();
    const sel = document.getElementById("kampOdulUrun");
    if (!sel) return;
    sel.innerHTML = "";
    rows.forEach(u => {
      const opt = document.createElement("option");
      opt.value = u.urun_id;
      opt.textContent = `${u.kategori_adi} - ${u.urun_adi}`;
      sel.appendChild(opt);
      rewardProductMap[u.urun_id] = `${u.kategori_adi} - ${u.urun_adi}`;
    });
  } catch (err) {
    console.error(err);
  }
}

// Kampanya türü değiştiğinde formu güncelle
function onCampaignTypeChange() {
  const tur = document.getElementById("kampTur").value;
  const secUcretsiz = document.getElementById("kmp-ucretsiz");
  const secYuzde = document.getElementById("kmp-yuzde");
  const secTutar = document.getElementById("kmp-tutar");

  secUcretsiz.style.display = tur === "ucretsiz_urun" ? "block" : "none";
  secYuzde.style.display = tur === "yuzde_indirim" ? "block" : "none";
  secTutar.style.display = tur === "tutar_indirim" ? "block" : "none";
}

// Kampanya ekle
async function addCampaign() {
  const ad = (document.getElementById("kampAd").value || "").trim();
  const gerekli_puan = Number(document.getElementById("gerekliPuan").value);
  const tur = document.getElementById("kampTur").value;

  if (!ad || !gerekli_puan || !tur) {
    return notify("Kampanya adı, puan ve tür zorunlu.");
  }

  // Backend'in beklediği tarlaları doğru adlarla dolduruyoruz
  const body = {
    ad,
    gerekli_puan,
    tur,
    odul_urun_id: null,
    indirim_oran: null,
    indirim_tutar: null
  };

  // Türlere göre gerekli alanları doldur
  if (tur === "ucretsiz_urun") {
    body.odul_urun_id = Number(document.getElementById("kampOdulUrun").value);
    if (!body.odul_urun_id) {
      return notify("Ücretsiz ürün kampanyasında ödül ürünü seçmelisiniz.");
    }
  }

  if (tur === "yuzde_indirim") {
    body.indirim_oran = Number(document.getElementById("kampIndirimOran").value);
    if (!body.indirim_oran || body.indirim_oran <= 0 || body.indirim_oran > 100) {
      return notify("İndirim oranı 1-100 arasında olmalıdır.");
    }
  }

  if (tur === "tutar_indirim") {
    body.indirim_tutar = Number(document.getElementById("kampIndirimTutar").value);
    if (!body.indirim_tutar || body.indirim_tutar <= 0) {
      return notify("İndirim tutarı 0'dan büyük olmalıdır.");
    }
  }

  try {
    const res = await fetch("/api/admin/kampanya/ekle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(j.error || "Kampanya eklenemedi.");

    notify("Kampanya başarıyla eklendi.");
    document.getElementById("kampAd").value = "";
    loadCampaigns();
  } catch (err) {
    console.error(err);
    notify(err.message);
  }
}



// Kampanyaları çek & tabloya bas
async function loadCampaigns() {
  try {
    const res = await fetch("/api/kampanyalarim");
    if (!res.ok) throw new Error("Kampanyalar alınamadı");
    const rows = await res.json();
    const tbody = document.getElementById("kampanyaTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    rows.forEach(k => {
      let turLabel = k.tur;
      if (k.tur === "ucretsiz_urun") turLabel = "Ücretsiz Ürün";
      if (k.tur === "yuzde_indirim") turLabel = "Yüzde İndirim";
      if (k.tur === "tutar_indirim") turLabel = "Tutar İndirimi";

      let valueText = "-";
      if (k.tur === "ucretsiz_urun" && k.odul_urun_id) {
        valueText = rewardProductMap[k.odul_urun_id] || `Ürün ID: ${k.odul_urun_id}`;
      } else if (k.tur === "yuzde_indirim") {
        valueText = `%${k.indirim_oran}`;
      } else if (k.tur === "tutar_indirim") {
        valueText = `${k.indirim_tutar} ₺`;
      }

      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${k.ad}</td>
        <td>${turLabel}</td>
        <td>${k.gerekli_puan}</td>
        <td>${valueText}</td>
        <td>${k.aktif ? "Aktif" : "Pasif"}</td>
        <td class="right">
          <button class="btn btn-xs btn-danger kamp-delete" data-id="${k.kampanya_id}">Sil</button>
        </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    notify("Kampanyalar yüklenirken hata oluştu.");
  }
}

// Kampanya tablosu event delegation
function setupCampaignTableEvents() {
  const tbody = document.getElementById("kampanyaTableBody");
  if (!tbody) return;

  tbody.addEventListener("click", async (e) => {
    const target = e.target;
    if (!target.classList.contains("kamp-delete")) return;

    const id = target.dataset.id;
    if (!confirm("Bu kampanyayı silmek istediğine emin misin?")) return;

    try {
      const res = await fetch(`/api/admin/kampanya/${id}`, {
        method: "DELETE"
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || "Silinemedi");
      notify("Kampanya silindi.");
      loadCampaigns();
    } catch (err) {
      console.error(err);
      notify(err.message);
    }
  });
}
