// =========================================
//  MÜŞTERİ YÖNETİMİ – MODERN CRM
// =========================================

document.addEventListener("DOMContentLoaded", () => {
  loadMusteriler();
});

let tumMusteriler = [];

// ---------------------------------------------------------
//  TOAST BİLDİRİM SİSTEMİ
// ---------------------------------------------------------
function showToast(message, type = "info", duration = 3000) {
  const container = document.getElementById("toastContainer");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    ${type === "success" ? "✅" : type === "error" ? "❌" : "ℹ️"}
    <span>${message}</span>
  `;
  container.appendChild(toast);
  setTimeout(() => {
    toast.style.transition = "all 0.3s ease";
    toast.style.opacity = "0";
    toast.style.transform = "translateX(30px)";
    setTimeout(() => toast.remove(), 300);
  }, duration);
}

// ---------------------------------------------------------
//  TELEFON FORMATLAMA YARDIMCISI
// ---------------------------------------------------------
function formatTelForWhatsApp(tel) {
  if (!tel) return "";
  const clean = tel.replace(/\D/g, "");
  if (clean.length === 10 && clean.startsWith("5")) return "90" + clean;
  if (clean.length === 11 && clean.startsWith("05")) return "90" + clean.substring(1);
  if (clean.length === 12 && clean.startsWith("90")) return clean;
  return clean;
}

// ---------------------------------------------------------
//  1. MÜŞTERİ LİSTESİ
// ---------------------------------------------------------
async function loadMusteriler() {
  const tbody = document.getElementById("musteriTableBody");

  try {
    const res = await fetch("/api/admin/musteriler");
    if (!res.ok) throw new Error("Veri çekilemedi");

    tumMusteriler = await res.json();
    tbody.innerHTML = "";

    // Stat kartlarını güncelle
    updateStats();

    if (tumMusteriler.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:40px; color:#94a3b8;">
        <div style="font-size:2rem; margin-bottom:8px;">👤</div>
        Henüz kayıtlı müşteri yok.
      </td></tr>`;
      return;
    }

    tumMusteriler.forEach(m => {
      const tarihObj = new Date(m.kayit_tarih);
      const tarihStr = tarihObj.toLocaleDateString("tr-TR", { day: "2-digit", month: "short", year: "numeric" });
      const waTel = formatTelForWhatsApp(m.telefon);

      const tr = document.createElement("tr");
      tr.setAttribute("data-search", `${m.ad_soyad} ${m.telefon || ""} ${m.email || ""}`.toLowerCase());
      tr.innerHTML = `
        <td class="customer-id">#${m.musteri_id}</td>
        <td class="customer-name">${m.ad_soyad}</td>
        <td class="customer-tel">${m.telefon || '<span class="no-tel">Kayıtsız</span>'}</td>
        <td class="customer-email">${m.email || '<span class="no-tel">–</span>'}</td>
        <td><span class="badge-puan">⭐ ${m.puan}</span></td>
        <td class="customer-date">${tarihStr}</td>
        <td style="text-align:right;">
          <div style="display:flex; gap:6px; justify-content:flex-end;">
            <button class="action-btn" style="background:#e0f2fe; color:#0369a1;" onclick="acDetailModal(${m.musteri_id})" title="Müşteri Detayı & Puan Geçmişi">
              🔍 Detay
            </button>
            ${m.telefon ? `
              <button class="action-btn action-btn-copy" onclick="kopyalaTek(this, '${m.telefon}')" title="Numarayı Kopyala">
                📋 Kopyala
              </button>
              <a href="https://wa.me/${waTel}" target="_blank" class="action-btn action-btn-wa" title="WhatsApp Sohbet">
                💬 Mesaj
              </a>
            ` : ''}
          </div>
        </td>
      `;
      tbody.appendChild(tr);
    });

  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="7" style="color:#ef4444; text-align:center; padding:30px;">Hata: Müşteri listesi yüklenemedi.</td></tr>`;
  }
}

// ---------------------------------------------------------
//  STAT KARTLARI
// ---------------------------------------------------------
function updateStats() {
  const toplam = tumMusteriler.length;
  const telefonlu = tumMusteriler.filter(m => m.telefon && m.telefon.trim().length > 0).length;
  const toplamPuan = tumMusteriler.reduce((sum, m) => sum + (Number(m.puan) || 0), 0);

  animateCounter("statToplam", toplam);
  animateCounter("statTelefon", telefonlu);
  animateCounter("statToplamPuan", toplamPuan);
}

function animateCounter(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const duration = 600;
  const start = performance.now();
  const startVal = 0;

  function step(now) {
    const progress = Math.min((now - start) / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    el.textContent = Math.floor(startVal + (target - startVal) * eased).toLocaleString("tr-TR");
    if (progress < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ---------------------------------------------------------
//  ARAMA FİLTRE
// ---------------------------------------------------------
function filterTable() {
  const query = document.getElementById("searchInput").value.toLowerCase().trim();
  const rows = document.querySelectorAll("#musteriTableBody tr[data-search]");
  rows.forEach(row => {
    const search = row.getAttribute("data-search") || "";
    row.style.display = search.includes(query) ? "" : "none";
  });
}

// ---------------------------------------------------------
//  TEKLİ KOPYALAMA
// ---------------------------------------------------------
function kopyalaTek(btn, tel) {
  if (!tel) return;
  navigator.clipboard.writeText(tel).then(() => {
    btn.classList.add("copied");
    btn.innerHTML = "✅ Kopyalandı";
    showToast(`${tel} kopyalandı`, "success");
    setTimeout(() => {
      btn.classList.remove("copied");
      btn.innerHTML = "📋 Kopyala";
    }, 2000);
  }).catch(() => {
    showToast("Kopyalama başarısız", "error");
  });
}

// ---------------------------------------------------------
//  TOPLU KOPYALAMA MODAL
// ---------------------------------------------------------
function acCopyModal() {
  const telefonlu = tumMusteriler.filter(m => m.telefon && m.telefon.trim().length > 0);
  if (telefonlu.length === 0) {
    return showToast("Telefon numarası kayıtlı müşteri bulunamadı.", "error");
  }
  document.getElementById("copyModal").classList.remove("hidden");
  updateCopyText();
}

function kapatCopyModal() {
  document.getElementById("copyModal").classList.add("hidden");
}

// Overlay'a tıklayınca kapat
document.addEventListener("click", e => {
  if (e.target.id === "copyModal") kapatCopyModal();
});

// ESC tuşu ile kapat
document.addEventListener("keydown", e => {
  if (e.key === "Escape") kapatCopyModal();
});

function updateCopyText() {
  const separator = document.querySelector('input[name="separator"]:checked')?.value || "newline";
  const addTR = document.getElementById("addCountryCode")?.checked;
  const onlyDigits = document.getElementById("cleanNonNumeric")?.checked;

  const numbersList = tumMusteriler
    .map(m => m.telefon)
    .filter(t => t && t.trim().length > 0);

  const processedNumbers = numbersList.map(tel => {
    let clean = tel.trim();
    if (onlyDigits) clean = clean.replace(/\D/g, "");

    if (addTR) {
      let digits = clean.replace(/\D/g, "");
      if (digits.length === 10 && digits.startsWith("5")) clean = "90" + digits;
      else if (digits.length === 11 && digits.startsWith("05")) clean = "90" + digits.substring(1);
      else if (digits.length === 12 && digits.startsWith("90")) clean = digits;
      else if (digits.length > 0 && !digits.startsWith("90")) clean = "90" + digits;
    }
    return clean;
  });

  const separatorChar = separator === "newline" ? "\n" : ", ";
  document.getElementById("numbersTextArea").value = processedNumbers.join(separatorChar);
  document.getElementById("numbersCountBadge").textContent = `${processedNumbers.length} numara hazır`;
}

// ---------------------------------------------------------
//  KOPYALA & WHATSAPP WEB'E GİT
// ---------------------------------------------------------
function kopyalaVeWhatsAppAc() {
  const text = document.getElementById("numbersTextArea").value;
  if (!text) {
    return showToast("Kopyalanacak numara yok.", "error");
  }

  navigator.clipboard.writeText(text).then(() => {
    showToast(`${text.split(/[\n,]/).filter(Boolean).length} numara panoya kopyalandı! WhatsApp Web açılıyor...`, "success", 4000);
    kapatCopyModal();

    // WhatsApp Web açılış – kısa gecikme ile kullanıcı toast'u görsün
    setTimeout(() => {
      window.open("https://web.whatsapp.com/", "_blank");
    }, 800);
  }).catch(() => {
    showToast("Kopyalama başarısız oldu.", "error");
  });
}

// ---------------------------------------------------------
//  4. DETAY & PUAN GEÇMİŞİ YÖNETİMİ
// ---------------------------------------------------------
let seciliMusteriId = null;

function acDetailModal(id) {
  try {
    const m = tumMusteriler.find(x => String(x.musteri_id) === String(id));
    if (!m) return showToast("Müşteri bulunamadı (ID: " + id + ")", "error");

    seciliMusteriId = m.musteri_id;
    document.getElementById("detailMusteriAd").textContent = m.ad_soyad || "İsimsiz Müşteri";
    document.getElementById("detailMusteriPuan").textContent = m.puan || 0;
    document.getElementById("yeniPuanInput").value = m.puan || 0;
    document.getElementById("detailModal").classList.remove("hidden");
    
    // Sipariş & Puan geçmişini çek
    yuklePuanGecmisi(m.musteri_id);
  } catch (err) {
    console.error("Detay açılırken hata:", err);
    showToast("Bir hata oluştu: " + err.message, "error");
  }
}

function kapatDetailModal() {
  const modal = document.getElementById("detailModal");
  if (modal) modal.classList.add("hidden");
  seciliMusteriId = null;
}

// Overlay ve Klavye Kısayolları ile kapatma
document.addEventListener("click", e => {
  if (e.target.id === "detailModal") kapatDetailModal();
});
document.addEventListener("keydown", e => {
  if (e.key === "Escape") kapatDetailModal();
});

async function yuklePuanGecmisi(musteriId) {
  const tbody = document.getElementById("detailGecmisTbody");
  tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: #94a3b8;">Yükleniyor...</td></tr>`;

  try {
    const res = await fetch(`/api/admin/musteri/${musteriId}/puan-gecmisi`);
    if (!res.ok) throw new Error("Veri alınamadı");
    const data = await res.json();
    tbody.innerHTML = "";

    if (!Array.isArray(data)) {
      throw new Error("Gelen veri bir dizi değil");
    }

    if (data.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 20px; color: #94a3b8;">Sipariş geçmişi bulunmuyor.</td></tr>`;
      return;
    }

    data.forEach((row, index) => {
      try {
        const tarihObj = new Date(row.tarih);
        const tarihStr = isNaN(tarihObj) ? "-" : tarihObj.toLocaleString("tr-TR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
        
        // Puan Durumu Gösterimi (+ / -)
        let puanHTML = "";
        const kazanilan = Number(row.kazanilan_puan) || 0;
        const harcanan = Number(row.harcanan_puan) || 0;

        if (row.durum === 'İptal') {
          const parts = [];
          if (kazanilan > 0) parts.push('+' + kazanilan);
          if (harcanan > 0) parts.push('-' + harcanan);
          puanHTML = `<span style="color:#94a3b8; text-decoration: line-through;">${parts.join(" / ") || '0'}</span>`;
        } else {
          const parts = [];
          if (kazanilan > 0) parts.push(`<span style="color:#10b981; font-weight:700;">+${kazanilan}</span>`);
          if (harcanan > 0) parts.push(`<span style="color:#ef4444; font-weight:700;">-${harcanan}</span>`);
          puanHTML = parts.join(" / ") || '<span style="color:#94a3b8;">0</span>';
        }

        // Durum Rozeti
        let durumStyle = "background: #f1f5f9; color: #475569;";
        if (row.durum === 'Teslim Edildi') durumStyle = "background: #dcfce7; color: #166534;";
        else if (row.durum === 'Hazır') durumStyle = "background: #dbeafe; color: #1e40af;";
        else if (row.durum === 'Hazırlanıyor') durumStyle = "background: #fef3c7; color: #92400e;";
        else if (row.durum === 'İptal') durumStyle = "background: #fee2e2; color: #991b1b;";

        const durumBadge = `<span style="padding: 2px 8px; border-radius: 20px; font-size: 0.72rem; font-weight: 600; display: inline-block; ${durumStyle}">${row.durum || '-'}</span>`;

        // Aksiyon (İptal Butonu)
        let actionBtn = "";
        if (row.durum !== 'İptal') {
          actionBtn = `
            <button class="action-btn" style="background:#fee2e2; color:#ef4444; padding: 4px 8px; font-size: 0.72rem;" onclick="iptalEtSiparisVePuan(${row.siparis_id || 0}, ${kazanilan})">
              İptal Et
            </button>
          `;
        } else {
          actionBtn = `<span style="color:#94a3b8; font-size:0.75rem;">–</span>`;
        }

        // Detay Gösterimi (Ürünler & Kampanyalar)
        let detayStr = `<div style="font-weight: 500; font-size: 0.8rem; color: #334155;">${row.urunler || 'Bilinmeyen Ürünler'}</div>`;
        if (row.kullanilan_kampanyalar) {
          detayStr += `<div style="font-size: 0.72rem; color: #ef4444; margin-top: 2px; font-weight: 600;">🎁 ${row.kullanilan_kampanyalar}</div>`;
        }

        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td style="font-size: 0.78rem; padding: 10px 8px; line-height: 1.3;">
            <div style="font-weight: 600; color: #334155;">#${row.siparis_id || '-'}</div>
            <div style="color: var(--text-gray); font-size: 0.7rem;">${tarihStr}</div>
          </td>
          <td style="padding: 10px 8px;">${detayStr}</td>
          <td style="text-align: center; padding: 10px 8px; font-size: 0.8rem;">${puanHTML}</td>
          <td style="text-align: center; padding: 10px 8px;">${durumBadge}</td>
          <td style="text-align: right; padding: 10px 8px;">${actionBtn}</td>
        `;
        tbody.appendChild(tr);
      } catch (err) {
        console.error("Satır render hatası:", err, row);
      }
    });

  } catch (err) {
    console.error("yuklePuanGecmisi hatası:", err);
    tbody.innerHTML = `<tr><td colspan="5" style="color:#ef4444; text-align:center; padding:20px;">Hata: Geçmiş listesi işlenirken sorun oluştu.</td></tr>`;
  }
}

async function guncelleMusteriPuanManuel() {
  if (!seciliMusteriId) return;
  const yeniPuan = Number(document.getElementById("yeniPuanInput").value);
  if (isNaN(yeniPuan) || yeniPuan < 0) {
    return showToast("Geçersiz puan değeri.", "error");
  }

  try {
    const res = await fetch(`/api/admin/musteri/${seciliMusteriId}/puan-guncelle`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ yeni_puan: yeniPuan })
    });
    if (!res.ok) throw new Error("Güncellenemedi");
    
    showToast("Puan başarıyla güncellendi.", "success");
    document.getElementById("detailMusteriPuan").textContent = yeniPuan;
    
    // Tablodaki puanı da anında güncelle
    loadMusteriler();
  } catch (err) {
    showToast("Hata: Puan güncellenemedi.", "error");
  }
}

async function iptalEtSiparisVePuan(siparisId, kazanilanPuan) {
  const onay = confirm(`#${siparisId} nolu siparişi iptal etmek ve bu siparişten kazanılan ${kazanilanPuan} puanı geri almak istediğinize emin misiniz?`);
  if (!onay) return;

  try {
    const res = await fetch(`/api/siparis/${siparisId}/durum`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durum: "İptal" })
    });
    if (!res.ok) throw new Error("İptal edilemedi");

    showToast("Sipariş iptal edildi ve kazanılan puanlar düşüldü.", "success");
    
    // Tablodaki veriyi ve modal içindeki puan bilgisini güncelle
    await loadMusteriler();
    
    setTimeout(() => {
      const must = tumMusteriler.find(m => m.musteri_id === seciliMusteriId);
      if (must) {
        document.getElementById("detailMusteriPuan").textContent = must.puan;
        document.getElementById("yeniPuanInput").value = must.puan;
      }
      yuklePuanGecmisi(seciliMusteriId);
    }, 100);
  } catch (err) {
    showToast("Hata: Sipariş iptal edilemedi.", "error");
  }
}