const tbody = document.getElementById("orders-body");
const refreshBtn = document.getElementById("refresh");

let timer = null;
let pollingMs = 3000; // 3 sn'de bir otomatik yenile

refreshBtn.addEventListener("click", () => loadOrders(true));

function startAutoRefresh() {
  stopAutoRefresh();
  timer = setInterval(loadOrders, pollingMs);
}
function stopAutoRefresh() {
  if (timer) { clearInterval(timer); timer = null; }
}

async function loadOrders(isManual = false) {
  try {
    if (isManual) {
      refreshBtn.disabled = true;
      refreshBtn.textContent = "Yükleniyor…";
      setTimeout(() => { refreshBtn.disabled = false; refreshBtn.textContent = "🔄 Yenile"; }, 500);
    }
    const res = await fetch("/api/siparisler");
    if (!res.ok) throw new Error("Sunucu hatası");
    const payload = await res.json();
    renderOrders(payload.data || []);
  } catch (err) {
    tbody.innerHTML = `<tr><td colspan="7" style="color:red;">Hata: ${err.message}</td></tr>`;
  }
}

function renderOrders(orders) {
  if (!orders.length) {
    tbody.innerHTML = `<tr><td colspan="7">Henüz sipariş yok.</td></tr>`;
    return;
  }
  tbody.innerHTML = "";
  for (const o of orders) {
    const tr = document.createElement("tr");
    const kalemler = (o.kalemler || []).map(k => `${k.urun_adi} x${k.adet}`).join("<br>");

    // Durum class'ı: boşlukları kaldır (Teslim Edildi -> TeslimEdildi)
    const statusClass = (o.durum || "").replace(/\s/g, "");

    tr.innerHTML = `
      <td>${o.siparis_id}</td>
      <td>${o.masa_no}</td>
      <td><span class="status ${statusClass}">${o.durum}</span></td>
      <td>${new Date(o.tarih).toLocaleString()}</td>
      <td>₺${Number(o.toplam_tutar || 0).toFixed(2)}</td>
      <td>${kalemler}</td>
      <td>${renderButtons(o.siparis_id, o.durum)}</td>
    `;
    tbody.appendChild(tr);
  }
}

function renderButtons(id, durum) {
  if (durum === "Teslim Edildi" || durum === "İptal") return "-";
  let next = null;
  if (durum === "Hazırlanıyor") next = "Hazır";
  else if (durum === "Hazır") next = "Teslim Edildi";

  const cancelBtn = `<button class="action-btn" onclick="changeStatus(${id}, 'İptal')">İptal</button>`;
  const nextBtn = next ? `<button class="action-btn" onclick="changeStatus(${id}, '${next}')">${next}</button>` : "";
  return `${cancelBtn} ${nextBtn}`;
}

async function changeStatus(id, durum) {
  const ok = confirm(`Sipariş #${id} durumunu '${durum}' yap?`);
  if (!ok) return;
  try {
    const res = await fetch(`/api/siparis/${id}/durum`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durum }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Durum güncellenemedi");
    loadOrders(true); // elle yenile + otomatik akış zaten devam ediyor
  } catch (e) {
    alert(e.message);
  }
}

// Sayfa açılır açılmaz:
loadOrders();
startAutoRefresh();

// Sayfa kapanırken temizle (opsiyonel)
window.addEventListener("beforeunload", stopAutoRefresh);
// 🧹 Siparişleri temizle
const temizleBtn = document.getElementById("temizleBtn");
if (temizleBtn) {
  temizleBtn.addEventListener("click", async () => {
    const onay = confirm("Teslim Edilen ve İptal siparişleri silmek istiyor musun?");
    if (!onay) return;

    try {
      const res = await fetch("/api/siparisler/temizle", { method: "DELETE" });
      const data = await res.json();
      alert(data.message || "Temizlik tamamlandı.");
      loadOrders && loadOrders(); // sayfayı yenile (fonksiyon varsa)
    } catch (err) {
      alert("Hata oluştu: " + err.message);
    }
  });
}
