// yonetici.js — Fixlenmiş Tam Sürüm
let ALL_GROUPS = [];
let ALL_CATEGORIES = [];
let ALL_PRODUCTS = []; // Artık bu dolacak!

function notify(msg) { alert(msg); }

document.addEventListener("DOMContentLoaded", async () => {
  // Global Listenerlar
  document.getElementById("refresh")?.addEventListener("click", initPage);
  document.getElementById("logout")?.addEventListener("click", logout);
  
  // Ürün Ekleme
  document.getElementById("urunEkleBtn")?.addEventListener("click", addProduct);
  setupMenuTableEvents();

  // Kampanya Eventleri
  document.getElementById("addKosulBtn")?.addEventListener("click", () => addKosulRow());
  document.getElementById("addOdulBtn")?.addEventListener("click", () => addOdulRow());
  document.getElementById("kampEkleBtn")?.addEventListener("click", saveCampaign);
  setupCampaignTableEvents();

  // Varyasyon ve Ekstra Eventleri
  document.getElementById("addVaryasyonBtn")?.addEventListener("click", addVaryasyonRow);
  document.getElementById("addEkstraBtn")?.addEventListener("click", addEkstraRow);

  // Drag & Drop Görsel Yükleme
  setupDropZone();

  // Başlat
  await initPage();
});

// --- VARYASYON VE EKSTRA SATIRLARI EKLEME FONKSİYONLARI ---
function addVaryasyonRow() {
  const container = document.getElementById("varyasyonList");
  const div = document.createElement("div");
  div.className = "var-row";
  div.style.display = "flex"; div.style.gap = "5px"; div.style.alignItems = "center";
  div.innerHTML = `
    <input type="text" class="input v-ad" placeholder="Ad (Örn: Büyük)" style="flex:2">
    <input type="number" class="input v-fark" placeholder="Fiyat Farkı (₺)" style="flex:1" value="0">
    <button class="btn btn-danger btn-xs" onclick="this.parentElement.remove()">X</button>
  `;
  container.appendChild(div);
}

function addEkstraRow() {
  const container = document.getElementById("ekstraList");
  const div = document.createElement("div");
  div.className = "eks-row";
  div.style.display = "flex"; div.style.gap = "5px"; div.style.alignItems = "center";
  div.innerHTML = `
    <input type="text" class="input e-ad" placeholder="Ad (Örn: Şurup)" style="flex:2">
    <input type="number" class="input e-fark" placeholder="Fark (₺)" style="flex:1" value="0">
    <select class="input e-tip" style="flex:1">
      <option value="ekstra">Ekstra (+Fiyat)</option>
      <option value="cikar">Çıkar (Ücretsiz)</option>
    </select>
    <button class="btn btn-danger btn-xs" onclick="this.parentElement.remove()">X</button>
  `;
  container.appendChild(div);
}

async function initPage() {
  // Önce ürünleri ve kategorileri çekelim
  await loadMenu(); // Menüyü çekince ALL_PRODUCTS dolacak
  await loadMetadata(); // Sonra kategoriler
  await loadGroups(); 
  loadCampaigns();      
}

// ===============================================
// 1. MENÜ YÖNETİMİ & ÜRÜN YÜKLEME
// ===============================================
async function loadMenu() {
  try {
    const res = await fetch("/api/admin/menu");
    if (!res.ok) throw new Error("Menü alınamadı");
    const items = await res.json();
    
    // CRITICAL FIX: Ürünleri global değişkene atıyoruz
    ALL_PRODUCTS = items; 

    const tbody = document.getElementById("menuTableBody");
    if (!tbody) return;
    tbody.innerHTML = "";

    items.forEach(row => {
      // Ana Satır
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td style="text-align:center;">
          <button class="chevron-btn" data-id="${row.urun_id}" title="Varyasyonları Göster">▶</button>
        </td>
        <td>${row.kategori_adi}</td>
        <td>${row.urun_adi}</td>
        <td>
          <div style="display:flex; gap:5px;">
            <input type="number" step="0.01" min="0" class="price-input input" data-id="${row.urun_id}" value="${Number(row.fiyat).toFixed(2)}" style="width:80px">
            <button class="btn btn-xs price-save" data-id="${row.urun_id}">💾</button>
          </div>
        </td>
        <td>
           <input type="number" step="0.01" min="0" class="maliyet-input input" data-id="${row.urun_id}" value="${Number(row.maliyet||0).toFixed(2)}" style="width:70px">
        </td>
        <td>
          <input type="number" class="kdv-input input" data-id="${row.urun_id}" value="${row.kdv||0}" style="width:60px">
        </td>
        <td>
          <input type="number" class="puan-input input" data-id="${row.urun_id}" value="${row.puan_degeri||1}" style="width:60px">
        </td>
        <td class="switch-cell"><input type="checkbox" class="aktif-toggle" data-id="${row.urun_id}" ${row.aktif?"checked":""}></td>
        <td class="switch-cell"><input type="checkbox" class="tukendi-toggle" data-id="${row.urun_id}" ${row.tukendi?"checked":""}></td>
        <td>
          <button class="btn btn-danger btn-xs delete-menu" data-id="${row.urun_id}">Sil</button>
        </td>
      `;
      tbody.appendChild(tr);

      // Accordion (Gizli Detay Satırı)
      const detailTr = document.createElement("tr");
      detailTr.className = "detail-row";
      detailTr.id = `detail-${row.urun_id}`;
      detailTr.innerHTML = `<td colspan="10"><div class="accordion-panel" id="acc-panel-${row.urun_id}">Yükleniyor...</div></td>`;
      tbody.appendChild(detailTr);
    });
  } catch (err) { console.error(err); }
}

async function addProduct() {
  const kategoriSelect = document.getElementById("kategoriSelect");
  const urunAdInput = document.getElementById("urunAd");
  const urunFiyatInput = document.getElementById("urunFiyat");
  const urunMaliyetInput = document.getElementById("urunMaliyet");
  const urunKdvInput = document.getElementById("urunKdv");
  const previewImg = document.getElementById("previewImg");
  const previewContainer = document.getElementById("imgPreviewContainer");
  const kategori_id = Number(kategoriSelect.value);
  const urun_adi = (urunAdInput.value || "").trim();
  const hiddenInput = document.getElementById("urunResim");
  let resim_url = "";
  let resim_original = "";
  if (previewContainer && previewContainer.style.display !== "none" && previewImg && previewImg.src) {
    resim_url = getCroppedBase64(previewContainer, previewImg);
    resim_original = (hiddenInput ? hiddenInput.value : "") || resim_url;
  }
  const fiyat = parseFloat(urunFiyatInput.value);
  const maliyet = parseFloat(urunMaliyetInput?.value || 0);
  const kdv = parseInt(urunKdvInput?.value || 0, 10);

  // Varyasyonları Topla
  const varyasyonlar = [];
  document.querySelectorAll("#varyasyonList .var-row").forEach(row => {
    const ad = row.querySelector(".v-ad").value.trim();
    const fark = parseFloat(row.querySelector(".v-fark").value || 0);
    if (ad) varyasyonlar.push({ ad, fiyat_farki: fark });
  });

  // Ekstraları Topla
  const ekstralar = [];
  document.querySelectorAll("#ekstraList .eks-row").forEach(row => {
    const ad = row.querySelector(".e-ad").value.trim();
    const fark = parseFloat(row.querySelector(".e-fark").value || 0);
    const tip = row.querySelector(".e-tip").value;
    if (ad) ekstralar.push({ ad, fiyat_farki: fark, tip });
  });

  if (!kategori_id || !urun_adi) return notify("Eksik bilgi.");

  try {
    const res = await fetch("/api/admin/menu/ekle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kategori_id, urun_adi, resim_url, resim_original, fiyat, maliyet, kdv, puan_degeri: 1, varyasyonlar, ekstralar }) 
    });
    if (res.ok) { 
        notify("Eklendi"); 
        await loadMenu(); // Menüyü ve ALL_PRODUCTS'ı yenile
        loadMetadata(); 
        urunAdInput.value = "";
        urunFiyatInput.value = "";
        if(urunResimInput) urunResimInput.value = "";
        if(urunMaliyetInput) urunMaliyetInput.value = "";
        document.getElementById("varyasyonList").innerHTML = "";
        document.getElementById("ekstraList").innerHTML = "";
        // Drop zone reset
        const dropZone = document.getElementById("dropZone");
        const previewContainer = document.getElementById("imgPreviewContainer");
        const fileInput = document.getElementById("urunResimFile");
        if(dropZone) dropZone.style.display = "flex";
        if(previewContainer) previewContainer.style.display = "none";
        if(fileInput) fileInput.value = "";
    }
  } catch (err) { console.error(err); }
}

// ===============================================
// 2. METADATA & GRUP DROPDOWN (KATEGORİ + ÜRÜN)
// ===============================================
async function loadMetadata() {
  try {
    const r1 = await fetch("/api/admin/kategoriler");
    ALL_CATEGORIES = await r1.json();
    
    // --- DROPDOWN GÜNCELLEMESİ (Hem Kategori Hem Ürün) ---
    const checkboxContainer = document.getElementById("catCheckboxList");
    if(checkboxContainer) {
      checkboxContainer.innerHTML = "";
      
      // 1. Kategoriler
      const catHeader = document.createElement("div");
      catHeader.style.padding = "5px";
      catHeader.style.fontWeight = "bold";
      catHeader.style.color = "#333";
      catHeader.style.backgroundColor = "#eee";
      catHeader.textContent = "KATEGORİLER";
      checkboxContainer.appendChild(catHeader);

      ALL_CATEGORIES.forEach(c => {
        const label = document.createElement("label");
        label.className = "checkbox-item";
        label.innerHTML = `
           <input type="checkbox" class="grup-checkbox" data-type="kategori" value="${c.kategori_id}">
           <span>📁 ${c.kategori_adi}</span>
        `;
        checkboxContainer.appendChild(label);
      });

      // 2. Ürünler (ALL_PRODUCTS artık dolu olduğu için çalışır)
      const prodHeader = document.createElement("div");
      prodHeader.style.padding = "5px";
      prodHeader.style.fontWeight = "bold";
      prodHeader.style.color = "#333";
      prodHeader.style.backgroundColor = "#eee";
      prodHeader.style.marginTop = "10px";
      prodHeader.textContent = "TEKİL ÜRÜNLER";
      checkboxContainer.appendChild(prodHeader);

      ALL_PRODUCTS.forEach(p => {
        const label = document.createElement("label");
        label.className = "checkbox-item";
        label.innerHTML = `
           <input type="checkbox" class="grup-checkbox" data-type="urun" value="${p.urun_id}">
           <span style="font-size:0.9em">☕ ${p.urun_adi}</span>
        `;
        checkboxContainer.appendChild(label);
      });
      
      checkboxContainer.addEventListener("change", updateDropdownLabel);
    }
    
    // Kategori Select (Ürün ekleme formu için)
    const sel = document.getElementById("kategoriSelect");
    if(sel) {
        sel.innerHTML = "";
        ALL_CATEGORIES.forEach(c => {
            sel.innerHTML += `<option value="${c.kategori_id}">${c.kategori_adi}</option>`;
        });
    }
  } catch (err) { console.error("Metadata hatası:", err); }
}

function updateDropdownLabel() {
    const checkedCount = document.querySelectorAll(".grup-checkbox:checked").length;
    const label = document.getElementById("dropdownLabel");
    if(checkedCount > 0) label.textContent = `${checkedCount} Öğe Seçildi`;
    else label.textContent = "Seçim Yapınız...";
}

// GRUP EKLEME BUTONU (GÜNCELLENMİŞ)
document.getElementById("grupEkleBtn")?.addEventListener("click", async () => {
  const ad = document.getElementById("grupAd").value;
  
  // Seçimleri ayıkla (Kategori mi, Ürün mü?)
  const checkboxes = document.querySelectorAll(".grup-checkbox:checked");
  
  const katIds = [];
  const urunIds = [];

  checkboxes.forEach(cb => {
      if(cb.dataset.type === 'kategori') katIds.push(Number(cb.value));
      else if(cb.dataset.type === 'urun') urunIds.push(Number(cb.value));
  });
  
  if(!ad || (katIds.length === 0 && urunIds.length === 0)) {
      return notify("Lütfen bir ad yazın ve en az 1 öğe seçin.");
  }

  await fetch("/api/admin/grup/ekle", {
    method: "POST", 
    headers: {"Content-Type":"application/json"},
    body: JSON.stringify({ 
        grup_adi: ad, 
        kategori_ids: katIds,
        urun_ids: urunIds // Server.js bunu karşılayacak
    })
  });
  
  notify("Grup Başarıyla Oluşturuldu!");
  
  // Temizlik
  document.getElementById("grupAd").value = "";
  document.querySelectorAll(".grup-checkbox").forEach(cb => cb.checked = false);
  updateDropdownLabel();
  
  loadGroups();
});

// ===============================================
// 3. DROPDOWN & KAMPANYA MANTIĞI
// ===============================================
window.toggleDropdown = function() {
  const menu = document.getElementById("catCheckboxList");
  menu.classList.toggle("show");
};

document.addEventListener("click", function(event) {
  const container = document.getElementById("catDropdownContainer");
  if (container && !container.contains(event.target)) {
    document.getElementById("catCheckboxList")?.classList.remove("show");
  }
});

async function loadGroups() {
  try {
    const res = await fetch("/api/admin/gruplar");
    ALL_GROUPS = await res.json();
    renderGroups();
  } catch(e) { console.error(e); }
}

function renderGroups() {
  const ul = document.getElementById("grupListesi");
  if(!ul) return;
  ul.innerHTML = "";
  if(ALL_GROUPS.length === 0) {
      ul.innerHTML = '<li style="justify-content:center; color:#999; border:none; background:transparent;">Henüz grup yok.</li>';
      return;
  }
  ALL_GROUPS.forEach(g => {
    ul.innerHTML += `
      <li>
        <span style="display:flex; align-items:center; gap:8px;">
            <span style="font-size:1.1em; color:#555;">📦</span> 
            <strong>${g.grup_adi}</strong>
        </span>
        <button onclick="deleteGroup(${g.grup_id})" class="btn-danger-text">Sil</button>
      </li>
    `;
  });
}

window.deleteGroup = async function(id) {
  if(!confirm("Bu grubu silmek istediğine emin misin?")) return;
  await fetch(`/api/admin/grup/${id}`, { method: "DELETE" });
  loadGroups();
};

function setupMenuTableEvents() {
  const tbody = document.getElementById("menuTableBody");
  tbody.addEventListener("click", async (e) => {
      // CHEVRON (Accordion Aç/Kapa)
      if(e.target.classList.contains("chevron-btn")){
          const id = e.target.dataset.id;
          const detailRow = document.getElementById(`detail-${id}`);
          const isOpen = detailRow.classList.contains("visible");

          // Tüm açık panelleri kapat
          document.querySelectorAll(".detail-row.visible").forEach(r => r.classList.remove("visible"));
          document.querySelectorAll(".chevron-btn.open").forEach(b => b.classList.remove("open"));

          if(!isOpen) {
            e.target.classList.add("open");
            detailRow.classList.add("visible");
            loadAccordionContent(id);
          }
          return;
      }
      if(e.target.classList.contains("delete-menu")){
          if(!confirm("Sil?")) return;
          await fetch(`/api/admin/menu/${e.target.dataset.id}`, {method:"DELETE"});
          loadMenu();
      }
      if(e.target.classList.contains("price-save")){
         const id = e.target.dataset.id;
         const pr = document.querySelector(`.price-input[data-id="${id}"]`).value;
         const ml = document.querySelector(`.maliyet-input[data-id="${id}"]`).value;
         const kdv = document.querySelector(`.kdv-input[data-id="${id}"]`).value;
         const puan = document.querySelector(`.puan-input[data-id="${id}"]`).value;

         await fetch("/api/admin/menu/fiyat", {
             method:"POST", headers:{"Content-Type":"application/json"},
             body: JSON.stringify({
                 urun_id: id, fiyat: pr, maliyet: ml, kdv: kdv, puan_degeri: puan
             })
         });
         notify("Güncellendi");
      }
  });
  
  tbody.addEventListener("change", async (e)=>{
      if(e.target.classList.contains("aktif-toggle")){
          await fetch("/api/admin/menu/aktif", {
              method:"POST", headers:{"Content-Type":"application/json"},
              body: JSON.stringify({urun_id:e.target.dataset.id, aktif: e.target.checked?1:0})
          });
      }
      if(e.target.classList.contains("tukendi-toggle")){
          await fetch(`/api/admin/urun/${e.target.dataset.id}/tukendi`, {
              method:"PUT", headers:{"Content-Type":"application/json"},
              body: JSON.stringify({tukendi: e.target.checked?1:0})
          });
      }
  });
}

// ===============================================
// ACCORDION İÇERİĞİ YÜKLEME & INLINE KAYDETME
// ===============================================
async function loadAccordionContent(urun_id) {
  const panel = document.getElementById(`acc-panel-${urun_id}`);
  if(!panel) return;
  panel.innerHTML = "Yükleniyor...";

  try {
    const res = await fetch(`/api/urun-detay/${urun_id}`);
    const data = await res.json();

    let varHtml = "";
    (data.varyasyonlar || []).forEach(v => {
      varHtml += `
        <div class="var-row">
          <input type="text" class="v-ad" placeholder="Ad" style="flex:2" value="${v.ad || ''}">
          <input type="number" class="v-fark" placeholder="Fark (₺)" style="flex:1" value="${v.fiyat_farki || 0}">
          <button class="btn btn-danger btn-xs" onclick="this.parentElement.remove()">X</button>
        </div>`;
    });

    let eksHtml = "";
    (data.ekstralar || []).forEach(e => {
      eksHtml += `
        <div class="eks-row">
          <input type="text" class="e-ad" placeholder="Ad" style="flex:2" value="${e.ad || ''}">
          <input type="number" class="e-fark" placeholder="Fark (₺)" style="flex:1" value="${e.fiyat_farki || 0}">
          <select class="e-tip" style="flex:1">
            <option value="ekstra" ${e.tip==='ekstra'?'selected':''}>Ekstra (+Fiyat)</option>
            <option value="cikar" ${e.tip==='cikar'?'selected':''}>Çıkar (Ücretsiz)</option>
          </select>
          <button class="btn btn-danger btn-xs" onclick="this.parentElement.remove()">X</button>
        </div>`;
    });

    const resim_original = data.resim_original || data.resim_url || "";
    const resim_url = data.resim_url || "";

    panel.innerHTML = `
      <div class="acc-columns">
        <div class="acc-col">
          <h4>Varyasyonlar <button class="btn btn-xs" onclick="addAccVarRow(${urun_id})">+ Ekle</button></h4>
          <div id="acc-var-${urun_id}">${varHtml || '<span style="color:#999; font-size:0.85rem;">Varyasyon yok</span>'}</div>
        </div>
        <div class="acc-col">
          <h4>Ekstralar / Çıkarılacaklar <button class="btn btn-xs" onclick="addAccEksRow(${urun_id})">+ Ekle</button></h4>
          <div id="acc-eks-${urun_id}">${eksHtml || '<span style="color:#999; font-size:0.85rem;">Ekstra yok</span>'}</div>
        </div>
        <!-- Ürün Görseli Sütunu -->
        <div class="acc-col" style="max-width: 140px; flex-shrink: 0;">
          <h4>Ürün Görseli</h4>
          <div class="drop-zone" id="acc-drop-zone-${urun_id}" style="width: 120px; height: 120px; ${resim_original ? 'display:none;' : 'display:flex;'}">
            <input type="file" id="acc-file-input-${urun_id}" accept="image/*" style="display:none;">
            <div class="drop-icon">📷</div>
            <div class="drop-text" style="font-size:0.65rem;">Sürükle / Tıkla</div>
          </div>
          <div class="img-preview-container" id="acc-preview-container-${urun_id}" style="width: 120px; height: 120px; ${resim_original ? 'display:block;' : 'display:none;'}">
            <button type="button" class="remove-preview" id="acc-remove-preview-${urun_id}" onclick="removeAccPreview(${urun_id})">✕</button>
            <img class="preview-img" id="acc-preview-img-${urun_id}" src="${resim_original}" style="left:0px; top:0px; position:absolute;">
            <input type="hidden" id="acc-original-url-${urun_id}" value="${resim_original}">
          </div>
        </div>
      </div>
      <div class="accordion-save-bar">
        <button class="btn-save-inline" onclick="saveAccordion(${urun_id})">💾 Kaydet</button>
      </div>
    `;

    // Drop zone ve önizleme ayarları (Orijinal yüksek çözünürlüklü resmi gönderiyoruz)
    setupAccDropZone(urun_id, resim_original);

  } catch(e) {
    panel.innerHTML = '<span style="color:red;">Detaylar yüklenemedi.</span>';
    console.error(e);
  }
}

window.addAccVarRow = function(urun_id) {
  const container = document.getElementById(`acc-var-${urun_id}`);
  // Eğer "yok" placeholder varsa temizle
  const placeholder = container.querySelector('span');
  if(placeholder) placeholder.remove();
  
  const div = document.createElement("div");
  div.className = "var-row";
  div.innerHTML = `
    <input type="text" class="v-ad" placeholder="Ad (Örn: Büyük)" style="flex:2">
    <input type="number" class="v-fark" placeholder="Fark (₺)" style="flex:1" value="0">
    <button class="btn btn-danger btn-xs" onclick="this.parentElement.remove()">X</button>
  `;
  container.appendChild(div);
};

window.addAccEksRow = function(urun_id) {
  const container = document.getElementById(`acc-eks-${urun_id}`);
  const placeholder = container.querySelector('span');
  if(placeholder) placeholder.remove();
  
  const div = document.createElement("div");
  div.className = "eks-row";
  div.innerHTML = `
    <input type="text" class="e-ad" placeholder="Ad (Örn: Şurup)" style="flex:2">
    <input type="number" class="e-fark" placeholder="Fark (₺)" style="flex:1" value="0">
    <select class="e-tip" style="flex:1">
      <option value="ekstra">Ekstra (+Fiyat)</option>
      <option value="cikar">Çıkar (Ücretsiz)</option>
    </select>
    <button class="btn btn-danger btn-xs" onclick="this.parentElement.remove()">X</button>
  `;
  container.appendChild(div);
};

window.saveAccordion = async function(urun_id) {
  const urun = ALL_PRODUCTS.find(p => p.urun_id == urun_id);
  if(!urun) return notify("Ürün bulunamadı!");

  const varyasyonlar = [];
  document.querySelectorAll(`#acc-var-${urun_id} .var-row`).forEach(row => {
    const ad = row.querySelector(".v-ad").value.trim();
    const fark = parseFloat(row.querySelector(".v-fark").value || 0);
    if (ad) varyasyonlar.push({ ad, fiyat_farki: fark });
  });

  const ekstralar = [];
  document.querySelectorAll(`#acc-eks-${urun_id} .eks-row`).forEach(row => {
    const ad = row.querySelector(".e-ad").value.trim();
    const fark = parseFloat(row.querySelector(".e-fark").value || 0);
    const tip = row.querySelector(".e-tip").value;
    if (ad) ekstralar.push({ ad, fiyat_farki: fark, tip });
  });

  // Görsel verisini al (pan pozisyonuna göre canvas'ta çizip base64 üretiyoruz)
  const previewImg = document.getElementById(`acc-preview-img-${urun_id}`);
  const previewContainer = document.getElementById(`acc-preview-container-${urun_id}`);
  const originalInput = document.getElementById(`acc-original-url-${urun_id}`);
  let resim_url = null;
  let resim_original = null;
  
  if (previewContainer && previewContainer.style.display !== "none" && previewImg && previewImg.src) {
    resim_url = getCroppedBase64(previewContainer, previewImg);
    resim_original = (originalInput ? originalInput.value : "") || resim_url;
  }

  try {
    const res = await fetch("/api/admin/menu/duzenle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ 
        urun_id, 
        urun_adi: urun.urun_adi, 
        resim_url: resim_url, // Backend'e kırpılmış veriyi gönder
        resim_original: resim_original, // Orijinal yüksek çözünürlüklü veriyi de gönder
        varyasyonlar, 
        ekstralar 
      })
    });
    if (res.ok) {
      notify("Varyasyonlar ve Görsel güncellendi!");
      await loadMenu();
    }
  } catch (err) { console.error(err); notify("Güncelleme hatası"); }
};

// Canvas üzerinden resmi tam hizalandığı haliyle (Pan offset dahil) kırpıp base64 döndüren genel fonksiyon
function getCroppedBase64(container, imgEl) {
  if (!imgEl || !imgEl.src) return "";
  
  const left = parseFloat(imgEl.style.left || 0);
  const top = parseFloat(imgEl.style.top || 0);

  // Eğer resim yerel bir URL ise ve sürüklenmediyse, direkt aynı URL'i koru (gereksiz base64 yapma)
  if (imgEl.src.startsWith("/") && left === 0 && top === 0) {
    return imgEl.getAttribute("src");
  }
  // Eğer url tam adres olup local path ise de koru
  if (imgEl.src.includes("/images/") && left === 0 && top === 0) {
    const relativePath = imgEl.src.substring(imgEl.src.indexOf("/images/"));
    return relativePath;
  }

  const canvas = document.createElement("canvas");
  canvas.width = 120;
  canvas.height = 120;
  const ctx = canvas.getContext("2d");

  // Çizim işlemi
  ctx.drawImage(
    imgEl, 
    left, 
    top, 
    parseFloat(imgEl.style.width || imgEl.offsetWidth || 120), 
    parseFloat(imgEl.style.height || imgEl.offsetHeight || 120)
  );

  return canvas.toDataURL("image/jpeg", 0.85);
}

window.removeAccPreview = function(urun_id) {
  const previewImg = document.getElementById(`acc-preview-img-${urun_id}`);
  const previewContainer = document.getElementById(`acc-preview-container-${urun_id}`);
  const dropZone = document.getElementById(`acc-drop-zone-${urun_id}`);
  const fileInput = document.getElementById(`acc-file-input-${urun_id}`);
  
  if (previewImg) previewImg.src = "";
  if (previewContainer) previewContainer.style.display = "none";
  if (dropZone) dropZone.style.display = "flex";
  if (fileInput) fileInput.value = "";
};

window.setupAccDropZone = function(urun_id, originalUrl) {
  const dropZone = document.getElementById(`acc-drop-zone-${urun_id}`);
  const fileInput = document.getElementById(`acc-file-input-${urun_id}`);
  const previewContainer = document.getElementById(`acc-preview-container-${urun_id}`);
  const previewImg = document.getElementById(`acc-preview-img-${urun_id}`);

  if(!dropZone || !fileInput) return;

  if (originalUrl) {
    const tempImg = new Image();
    tempImg.onload = () => {
      const containerSize = 120;
      const ratio = tempImg.width / tempImg.height;
      if(ratio > 1) {
        previewImg.style.height = containerSize + "px";
        previewImg.style.width = (containerSize * ratio) + "px";
      } else {
        previewImg.style.width = containerSize + "px";
        previewImg.style.height = (containerSize / ratio) + "px";
      }
      previewImg.style.left = "0px";
      previewImg.style.top = "0px";
    };
    tempImg.src = originalUrl;
  }

  dropZone.addEventListener("click", () => fileInput.click());

  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if(file && file.type.startsWith("image/")) {
      processFile(file);
    }
  });

  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if(file) processFile(file);
  });

  function processFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      previewImg.src = dataUrl;
      
      const originalInput = document.getElementById(`acc-original-url-${urun_id}`);
      if (originalInput) originalInput.value = dataUrl;

      dropZone.style.display = "none";
      previewContainer.style.display = "block";
      
      const tempImg = new Image();
      tempImg.onload = () => {
        const containerSize = 120;
        const ratio = tempImg.width / tempImg.height;
        if(ratio > 1) {
          previewImg.style.height = containerSize + "px";
          previewImg.style.width = (containerSize * ratio) + "px";
        } else {
          previewImg.style.width = containerSize + "px";
          previewImg.style.height = (containerSize / ratio) + "px";
        }
        previewImg.style.left = "0px";
        previewImg.style.top = "0px";
      };
      tempImg.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  let isDragging = false;
  let startX, startY, imgStartX, imgStartY;

  previewContainer.addEventListener("mousedown", (e) => {
    if(e.target.classList.contains("remove-preview")) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    imgStartX = parseInt(previewImg.style.left || 0);
    imgStartY = parseInt(previewImg.style.top || 0);
    e.preventDefault();
  });

  const onMouseMove = (e) => {
    if(!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    let newX = imgStartX + dx;
    let newY = imgStartY + dy;
    
    const containerSize = 120;
    const imgW = previewImg.offsetWidth;
    const imgH = previewImg.offsetHeight;
    
    newX = Math.min(0, Math.max(containerSize - imgW, newX));
    newY = Math.min(0, Math.max(containerSize - imgH, newY));
    
    previewImg.style.left = newX + "px";
    previewImg.style.top = newY + "px";
  };

  const onMouseUp = () => {
    isDragging = false;
  };

  document.addEventListener("mousemove", onMouseMove);
  document.addEventListener("mouseup", onMouseUp);

  const observer = new MutationObserver(() => {
    if(!document.body.contains(previewContainer)) {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      observer.disconnect();
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
};

// ===============================================
// DRAG & DROP GÖRSEL YÜKLEME
// ===============================================
function setupDropZone() {
  const dropZone = document.getElementById("dropZone");
  const fileInput = document.getElementById("urunResimFile");
  const previewContainer = document.getElementById("imgPreviewContainer");
  const previewImg = document.getElementById("previewImg");
  const removeBtn = document.getElementById("removePreview");
  const hiddenInput = document.getElementById("urunResim");

  if(!dropZone || !fileInput) return;

  // Tıklayınca dosya seç
  dropZone.addEventListener("click", () => fileInput.click());

  // Drag olayları
  dropZone.addEventListener("dragover", (e) => {
    e.preventDefault();
    dropZone.classList.add("drag-over");
  });

  dropZone.addEventListener("dragleave", () => {
    dropZone.classList.remove("drag-over");
  });

  dropZone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropZone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if(file && file.type.startsWith("image/")) {
      processImageFile(file);
    }
  });

  // Dosya seçilince
  fileInput.addEventListener("change", () => {
    const file = fileInput.files[0];
    if(file) processImageFile(file);
  });

  function processImageFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      const dataUrl = e.target.result;
      previewImg.src = dataUrl;
      hiddenInput.value = dataUrl;
      dropZone.style.display = "none";
      previewContainer.style.display = "block";
      
      // Görseli yükleyince boyutlarını ölç
      const tempImg = new Image();
      tempImg.onload = () => {
        // Kare container'a sığdır, fazlası sürükleme ile görünür
        const containerSize = 120;
        const ratio = tempImg.width / tempImg.height;
        if(ratio > 1) {
          // Yatay görsel
          previewImg.style.height = containerSize + "px";
          previewImg.style.width = (containerSize * ratio) + "px";
        } else {
          // Dikey görsel
          previewImg.style.width = containerSize + "px";
          previewImg.style.height = (containerSize / ratio) + "px";
        }
        previewImg.style.left = "0px";
        previewImg.style.top = "0px";
      };
      tempImg.src = dataUrl;
    };
    reader.readAsDataURL(file);
  }

  // Mouse ile sürükleme (Pan)
  let isDragging = false;
  let startX, startY, imgStartX, imgStartY;

  previewContainer.addEventListener("mousedown", (e) => {
    if(e.target === removeBtn) return;
    isDragging = true;
    startX = e.clientX;
    startY = e.clientY;
    imgStartX = parseInt(previewImg.style.left || 0);
    imgStartY = parseInt(previewImg.style.top || 0);
    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if(!isDragging) return;
    const dx = e.clientX - startX;
    const dy = e.clientY - startY;
    
    let newX = imgStartX + dx;
    let newY = imgStartY + dy;
    
    // Sınır kontrolleri
    const containerSize = 120;
    const imgW = previewImg.offsetWidth;
    const imgH = previewImg.offsetHeight;
    
    newX = Math.min(0, Math.max(containerSize - imgW, newX));
    newY = Math.min(0, Math.max(containerSize - imgH, newY));
    
    previewImg.style.left = newX + "px";
    previewImg.style.top = newY + "px";
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });

  // Görsel kaldırma
  removeBtn.addEventListener("click", () => {
    previewImg.src = "";
    hiddenInput.value = "";
    previewContainer.style.display = "none";
    dropZone.style.display = "flex";
    fileInput.value = "";
  });
}

// ===============================================
// ÜRÜN DÜZENLEME MODALI FONKSİYONLARI
// ===============================================
async function openEditModal(urun_id) {
    // 1. Ürün temel bilgilerini bul (ALL_PRODUCTS içinden)
    const urun = ALL_PRODUCTS.find(p => p.urun_id == urun_id);
    if(!urun) return notify("Ürün bulunamadı!");

    document.getElementById("editUrunId").value = urun.urun_id;
    document.getElementById("editUrunAd").value = urun.urun_adi;
    // Eğer resim verisi varsa göster (u.resim_url)
    document.getElementById("editUrunResim").value = urun.resim_url || "";

    // 2. Varyasyon ve Ekstraları Çek
    try {
        const res = await fetch(`/api/urun-detay/${urun_id}`);
        const data = await res.json();
        
        const varList = document.getElementById("editVaryasyonList");
        varList.innerHTML = "";
        data.varyasyonlar.forEach(v => {
            addEditVaryasyonRow(v.varyasyon_adi, v.fiyat_farki);
        });

        const eksList = document.getElementById("editEkstraList");
        eksList.innerHTML = "";
        data.ekstralar.forEach(e => {
            addEditEkstraRow(e.ekstra_adi, e.fiyat_farki, e.tip);
        });

        document.getElementById("editProductModal").style.display = "flex";
    } catch(e) { console.error(e); notify("Detaylar alınamadı"); }
}

function addEditVaryasyonRow(ad = "", fark = 0) {
  const container = document.getElementById("editVaryasyonList");
  const div = document.createElement("div");
  div.className = "var-row";
  div.style.display = "flex"; div.style.gap = "5px"; div.style.alignItems = "center";
  div.innerHTML = `
    <input type="text" class="input v-ad" placeholder="Ad (Örn: Büyük)" style="flex:2" value="${ad}">
    <input type="number" class="input v-fark" placeholder="Fiyat Farkı (₺)" style="flex:1" value="${fark}">
    <button class="btn btn-danger btn-xs" onclick="this.parentElement.remove()">X</button>
  `;
  container.appendChild(div);
}

function addEditEkstraRow(ad = "", fark = 0, tip = "ekstra") {
  const container = document.getElementById("editEkstraList");
  const div = document.createElement("div");
  div.className = "eks-row";
  div.style.display = "flex"; div.style.gap = "5px"; div.style.alignItems = "center";
  div.innerHTML = `
    <input type="text" class="input e-ad" placeholder="Ad" style="flex:2" value="${ad}">
    <input type="number" class="input e-fark" placeholder="Fark (₺)" style="flex:1" value="${fark}">
    <select class="input e-tip" style="flex:1">
      <option value="ekstra" ${tip==='ekstra'?'selected':''}>Ekstra (+Fiyat)</option>
      <option value="cikar" ${tip==='cikar'?'selected':''}>Çıkar (Ücretsiz)</option>
    </select>
    <button class="btn btn-danger btn-xs" onclick="this.parentElement.remove()">X</button>
  `;
  container.appendChild(div);
}

document.getElementById("editAddVaryasyonBtn")?.addEventListener("click", () => addEditVaryasyonRow());
document.getElementById("editAddEkstraBtn")?.addEventListener("click", () => addEditEkstraRow());

document.getElementById("saveEditProductBtn")?.addEventListener("click", async () => {
    const urun_id = document.getElementById("editUrunId").value;
    const urun_adi = document.getElementById("editUrunAd").value.trim();
    const resim_url = document.getElementById("editUrunResim").value.trim();

    const varyasyonlar = [];
    document.querySelectorAll("#editVaryasyonList .var-row").forEach(row => {
        const ad = row.querySelector(".v-ad").value.trim();
        const fark = parseFloat(row.querySelector(".v-fark").value || 0);
        if (ad) varyasyonlar.push({ ad, fiyat_farki: fark });
    });

    const ekstralar = [];
    document.querySelectorAll("#editEkstraList .eks-row").forEach(row => {
        const ad = row.querySelector(".e-ad").value.trim();
        const fark = parseFloat(row.querySelector(".e-fark").value || 0);
        const tip = row.querySelector(".e-tip").value;
        if (ad) ekstralar.push({ ad, fiyat_farki: fark, tip });
    });

    try {
        const res = await fetch("/api/admin/menu/duzenle", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ urun_id, urun_adi, resim_url, varyasyonlar, ekstralar }) 
        });
        if (res.ok) { 
            notify("Ürün güncellendi!"); 
            document.getElementById("editProductModal").style.display = "none";
            loadMenu(); 
        }
    } catch (err) { console.error(err); notify("Güncelleme hatası"); }
});

// ===============================================
// 4. KAMPANYA SEÇİMLERİ (CRITICAL FIX)
// ===============================================
function createSelect(options, placeholder) {
  let html = `<option value="">${placeholder}</option>`;
  options.forEach(o => {
    // Ürün array'i için
    if(o.urun_id) html += `<option value="${o.urun_id}">${o.urun_adi} (${Number(o.fiyat).toFixed(2)}₺)</option>`;
    // Kategori array'i için
    else if(o.kategori_id) html += `<option value="${o.kategori_id}">${o.kategori_adi}</option>`;
  });
  return html;
}

window.updateRowTarget = function(selectEl) {
  const row = selectEl.parentElement;
  const targetEl = row.querySelector(".k-hedef") || row.querySelector(".o-hedef");
  const val = selectEl.value;
  
  targetEl.style.display = "block";
  targetEl.innerHTML = ""; 

  if (val === "kategori") {
      targetEl.innerHTML = createSelect(ALL_CATEGORIES, "Kategori Seç");
  } else if (val === "urun") {
      // ARTIK BURASI ÇALIŞACAK ÇÜNKÜ ALL_PRODUCTS DOLU
      targetEl.innerHTML = createSelect(ALL_PRODUCTS, "Ürün Seç");
  } else if (val === "grup") {
      targetEl.innerHTML = `<option value="">Grup Seçiniz</option>`;
      ALL_GROUPS.forEach(g => {
          targetEl.innerHTML += `<option value="${g.grup_id}">${g.grup_adi}</option>`;
      });
  } else if (val === "tutar") {
      targetEl.style.display = "none";
  }
};

// ... Diğer AddRow ve SaveCampaign fonksiyonları aynı kalacak (Zaten yukarıda tanımlıydı) ...
// (Buraya kopyalamadım çünkü yukarıdaki kodda mantık aynı, sadece updateRowTarget'in çalışması için ALL_PRODUCTS önemliydi)

function addKosulRow() {
  const container = document.getElementById("kosullar-container");
  const div = document.createElement("div");
  div.className = "form-row kamp-row";
  div.style.marginBottom = "8px";
  div.style.alignItems = "center";
  
  // GÜNCELLEME: "grup" seçeneği eklendi, sepet tutarı kaldırıldı
  div.innerHTML = `
    <select class="input k-tip" style="flex:1" onchange="updateRowTarget(this)">
      <option value="kategori">Kategori</option>
      <option value="urun">Ürün</option>
      <option value="grup">Kategori Grubu (Havuz)</option>
    </select>
    <select class="input k-hedef" style="flex:2"></select>
    <input type="number" class="input k-miktar" style="flex:1" value="1" placeholder="Adet">
    <button class="btn btn-danger btn-xs remove-row">X</button>
  `;
  
  div.querySelector(".remove-row").onclick = () => div.remove();
  container.appendChild(div);
  
  // İlk açılışta dropdown'ı tetikle
  updateRowTarget(div.querySelector(".k-tip"));
}

function addOdulRow() {
  const container = document.getElementById("oduller-container");
  const div = document.createElement("div");
  div.className = "form-row odul-row";
  div.style.marginBottom = "8px";
  div.style.alignItems = "center";
  div.innerHTML = `
    <select class="input o-tip" style="flex:1" onchange="updateRowTarget(this)">
      <option value="urun">Ürün</option>
      <option value="kategori">Kategori</option>
      <option value="grup">Kategori Grubu (Havuz)</option>
    </select>
    <select class="input o-hedef" style="flex:2"></select>
    <input type="number" class="input o-adet" style="flex:0.8" value="1" placeholder="Adet">
    <input type="number" class="input o-indirim" style="flex:0.8" value="100" placeholder="% İndirim">
    <button class="btn btn-danger btn-xs remove-row">X</button>
  `;
  div.querySelector(".remove-row").onclick = () => div.remove();
  container.appendChild(div);
  updateRowTarget(div.querySelector(".o-tip"));
}

async function saveCampaign() {
  const ad = document.getElementById("kampAd").value.trim();
  const puan = Number(document.getElementById("gerekliPuan").value);
  const secim_sayisi = 0; // Kaldırıldı, varsayılan 0
  const uyelere_ozel = document.getElementById("uyelereOzel").checked; 

  if(!ad) return notify("Kampanya adı yazın.");

  const kosullar = [];
  document.querySelectorAll("#kosullar-container > div").forEach(row => {
    const tip = row.querySelector(".k-tip").value;
    const hedef = row.querySelector(".k-hedef").value;
    const miktar = row.querySelector(".k-miktar").value;
    
    if(tip !== 'tutar' && !hedef) return; 
    kosullar.push({
      tip: tip,
      hedef_id: tip === 'tutar' ? null : Number(hedef),
      miktar: Number(miktar)
    });
  });

  const oduller = [];
  document.querySelectorAll("#oduller-container > div").forEach(row => {
    const tip = row.querySelector(".o-tip").value;
    const hedef = row.querySelector(".o-hedef").value;
    const adet = row.querySelector(".o-adet").value;
    const indirim = row.querySelector(".o-indirim").value;

    if(!hedef) return;
    oduller.push({
      tip: tip,
      hedef_id: Number(hedef),
      adet: Number(adet),
      indirim_oran: Number(indirim)
    });
  });

  if(oduller.length === 0) return notify("En az 1 ödül eklemelisiniz!");

  try {
    const res = await fetch("/api/admin/kampanya/ekle", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ad, gerekli_puan: puan, secim_sayisi, uyelere_ozel, kosullar, oduller })
    });
    if(!res.ok) throw new Error("Hata oluştu");
    notify("Kampanya oluşturuldu!");
    document.getElementById("kosullar-container").innerHTML = "";
    document.getElementById("oduller-container").innerHTML = "";
    document.getElementById("kampAd").value = "";
    document.getElementById("uyelereOzel").checked = false;
    loadCampaigns();
  } catch (e) { notify("Hata: " + e.message); }
}

async function loadCampaigns() {
  const tbody = document.getElementById("kampanyaTableBody");
  if(!tbody) return;
  tbody.innerHTML = "<tr><td colspan='6'>Yükleniyor...</td></tr>";
  try {
    const res = await fetch("/api/kampanyalarim");
    const data = await res.json();
    tbody.innerHTML = "";
    if(data.length === 0) { tbody.innerHTML = "<tr><td colspan='6'>Hiç kampanya yok.</td></tr>"; return; }

    data.forEach(k => {
      let kosulHTML = "";
      if(k.kosullar && k.kosullar.length) {
        kosulHTML = "<ul style='margin:0; padding-left:15px; font-size:0.8rem'>";
        k.kosullar.forEach(c => {
          // İSİM SEÇİMİ GÜNCELLENDİ
          let h = c.urun_adi || c.kategori_adi || c.grup_adi || '?'; 
          
          if(c.tip === 'tutar') h = "Sepet Tutarı";
          kosulHTML += `<li>${c.tip}: ${h} (${c.miktar})</li>`;
        });
        kosulHTML += "</ul>";
      } else kosulHTML = "<i>Koşulsuz</i>";

      let odulHTML = "";
      if(k.oduller && k.oduller.length) {
        odulHTML = "<ul style='margin:0; padding-left:15px; font-size:0.8rem'>";
        k.oduller.forEach(o => {
          // İSİM SEÇİMİ GÜNCELLENDİ
          let h = o.urun_adi || o.kategori_adi || o.grup_adi || '?';
          
          odulHTML += `<li>${o.adet} x ${h} (%${o.indirim_oran})</li>`;
        });
        odulHTML += "</ul>";
      }
      const pRozet = k.gerekli_puan > 0 ? `<span class='status Hazırlanıyor'>${k.gerekli_puan} Puan</span>` : `<span class='status Hazır'>Fırsat</span>`;
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${k.kampanya_id}</td>
        <td><strong>${k.ad}</strong></td>
        <td>${pRozet}</td>
        <td>${kosulHTML}</td>
        <td>${odulHTML}</td>
        <td class="right"><button class="btn btn-danger btn-xs delete-kamp" data-id="${k.kampanya_id}">Sil</button></td>
      `;
      tbody.appendChild(tr);
    });
  } catch(e) { console.error(e); }
}

function setupCampaignTableEvents() {
    const tbody = document.getElementById("kampanyaTableBody");
    tbody.addEventListener("click", async (e) => {
        if(e.target.classList.contains("delete-kamp")) {
            if(!confirm("Silinsin mi?")) return;
            const id = e.target.dataset.id;
            await fetch(`/api/admin/kampanya/${id}`, { method: "DELETE" });
            loadCampaigns();
        }
    });
}

async function logout() {
  await fetch("/api/logout", { method: "POST" });
  window.location.href = "start.html";
}