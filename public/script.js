// =========================
//  QR SİPARİŞ - script.js
// =========================

window.cart = window.cart || []; 
let MENU_BY_ID = {};
let SELECTED_KAMPANYA = null;

function $(sel){ return document.querySelector(sel); }
function money(n){ return Number(n||0).toFixed(2)+" ₺"; }
function toast(m){ if(window?.alert) alert(m); else console.log("[INFO]",m); }
const FETCH_OPTS = { credentials:"include", cache:"no-store" };

function isPosInt(v){ const n=Number(v); return Number.isFinite(n)&&Math.trunc(n)>0; }

// Masa
function getMasaId(){
  const u=new URL(location.href);
  const q=u.searchParams.get("masa")||u.searchParams.get("masa_id");
  if(isPosInt(q)) sessionStorage.setItem("masa_id",String(parseInt(q,10)));
  const saved=sessionStorage.getItem("masa_id");
  return saved?Number(saved):null;
}
function showMasaChip(){ const el=$("#masa-chip"); if(!el) return; const m=getMasaId(); el.textContent=m?`#${m}`:"—"; }

// Menü
async function fetchMenuGrouped(){
  const res=await fetch("/api/menu", FETCH_OPTS);
  if(!res.ok) throw new Error("Menü alınamadı");
  const grouped=await res.json();
  MENU_BY_ID={};
  Object.values(grouped).flat().forEach(it=>{
    MENU_BY_ID[it.urun_id]={urun_adi:it.urun_adi,fiyat:Number(it.fiyat)};
  });
  return grouped;
}
// script.js dosyasındaki renderMenu fonksiyonunu tamamen bununla değiştir:

function renderMenu(grouped){
  const root = $("#menu");
  if (!root) return;
  root.innerHTML = "";

  const navRoot = $("#category-nav");
  if (navRoot) navRoot.innerHTML = "";

  const sections = [];

  // Kategorileri sırayla oluştur
  Object.keys(grouped).forEach(kat => {
    const sec = document.createElement("section");
    sec.className = "menu-section";
    sec.dataset.kategori = kat;

    const h = document.createElement("h3");
    h.textContent = kat;
    sec.appendChild(h);

    const list = document.createElement("div");
    list.className = "menu-list";

    grouped[kat].forEach(item => {
      const card = document.createElement("div");
      card.className = "menu-item";

      // 🖼️ Arkaplan resim
      if (item.resim_url) {
        card.style.backgroundImage = `url('${item.resim_url}')`;
      }

      const t = document.createElement("div");
      t.className = "menu-item-title";
      t.textContent = item.urun_adi;

      const d = document.createElement("div");
      d.className = "menu-item-desc";
      d.textContent = item.aciklama || "";

      const p = document.createElement("div");
      p.className = "menu-item-price";
      p.textContent = money(item.fiyat);

      const btn = document.createElement("button");
      btn.className = "btn add";
      btn.textContent = "Ekle";

      btn.addEventListener("click", () =>
        addToCart({
          urun_id: item.urun_id,
          urun_adi: item.urun_adi,
          fiyat: Number(item.fiyat),
          adet: 1
        })
      );

      card.append(t);
      if (d.textContent) card.append(d);
      card.append(p, btn);
      list.append(card);
    });

    sec.append(list);
    root.append(sec);
    sections.push({ kat, sec });
  });

  // Kategori çubuğunu doldur
  if (navRoot && sections.length) {
    sections.forEach(({ kat, sec }, index) => {
      const btn = document.createElement("button");
      btn.className = "cat-btn";
      btn.textContent = kat;

      btn.addEventListener("click", () => {
        // Aktif buton stili
        navRoot.querySelectorAll(".cat-btn").forEach(b =>
          b.classList.remove("active")
        );
        btn.classList.add("active");

        // İlgili kategoriye yumuşak scroll
        sec.scrollIntoView({ behavior: "smooth", block: "start" });
      });

      if (index === 0) btn.classList.add("active");
      navRoot.append(btn);
    });
  }
}

// Kampanyalar
// script.js içindeki loadKampanyalarim fonksiyonunu bununla güncelle:

async function loadKampanyalarim(){
  const sel=$("#kampanyaSelect"); 
  if(!sel) return;

  sel.innerHTML=`<option value="">Kampanya seç (opsiyonel)</option>`;
  sel.disabled=true;

  try{
    const res=await fetch("/api/kampanyalarim", FETCH_OPTS);
    if(res.status===401){ sel.disabled=true; return; }

    const list=await res.json();

    if(!Array.isArray(list)||list.length===0){
      sel.innerHTML=`<option value="">Kullanılabilir kampanya hakkınız yok</option>`;
      sel.disabled=false;
      sel.addEventListener("change",()=>{
        SELECTED_KAMPANYA=null;
        renderCart();
      });
      return;
    }

    list.forEach(k=>{
      const opt=document.createElement("option");
      opt.value=String(k.kampanya_id);
      const hak=Number(k.hak_sayisi)||0;
      opt.textContent=`${k.ad} (${hak} hak)`;

      // Dataset'e verileri ekliyoruz
      opt.dataset.tur=k.tur;
      if(k.odul_urun_id!=null) opt.dataset.odulUrunId=k.odul_urun_id;
      if(k.odul_fiyat!=null) opt.dataset.odulFiyat=k.odul_fiyat;
      
      // Server'dan gelen oran/tutar verisini HTML'e gömüyoruz
      if(k.indirim_oran!=null) opt.dataset.indirimOran=k.indirim_oran;
      if(k.indirim_tutar!=null) opt.dataset.indirimTutar=k.indirim_tutar;

      sel.append(opt);
    });

    sel.disabled=false;

    sel.addEventListener("change",()=>{
      const opt=sel.options[sel.selectedIndex];

      if(opt && opt.value){
        SELECTED_KAMPANYA={
          kampanya_id:Number(opt.value),
          tur:opt.dataset.tur,
          odul_urun_id:opt.dataset.odulUrunId?Number(opt.dataset.odulUrunId):null,
          odul_fiyat:opt.dataset.odulFiyat?Number(opt.dataset.odulFiyat):null,
          // Dataset'ten okurken camelCase dönüşümüne dikkat (indirim-oran -> indirimOran)
          indirim_oran: opt.dataset.indirimOran ? Number(opt.dataset.indirimOran) : 0,
          indirim_tutar: opt.dataset.indirimTutar ? Number(opt.dataset.indirimTutar) : 0
        };
      }else{
        SELECTED_KAMPANYA=null;
      }
      renderCart();
    });

  }catch(e){ console.error(e); }
}

// Sepet hesaplama
function addToCart({urun_id,urun_adi,fiyat,adet}){
  const i=window.cart.findIndex(x=>x.urun_id===urun_id);
  if(i>=0) window.cart[i].adet+=Number(adet||1);
  else window.cart.push({urun_id,urun_adi,fiyat:Number(fiyat),adet:Number(adet||1)});
  renderCart();
}
function removeFromCart(id){ window.cart=window.cart.filter(x=>x.urun_id!==id); renderCart(); }
function setQty(id,qty){ 
  const it=window.cart.find(x=>x.urun_id===id); 
  if(!it) return; 
  it.adet=Math.max(1,Number(qty||1)); 
  renderCart();
}

function calcSubtotal(){
  return window.cart.reduce((s,it)=>{
    const f=Number(it.fiyat ?? MENU_BY_ID[it.urun_id]?.fiyat ?? 0);
    return s + f*it.adet;
  },0);
}

function previewDiscount(sub){
  if(!SELECTED_KAMPANYA) return 0;

  if(SELECTED_KAMPANYA.tur==="ucretsiz_urun") return 0;

  if(SELECTED_KAMPANYA.tur==="yuzde_indirim"){
    const oran=Number(SELECTED_KAMPANYA.indirim_oran||0);
    return sub * (oran/100);
  }

  if(SELECTED_KAMPANYA.tur==="tutar_indirim"){
    return Number(SELECTED_KAMPANYA.indirim_tutar||0);
  }

  return 0;
}

function renderCartSummary(){
  const sub=calcSubtotal();
  const disc=previewDiscount(sub);
  const total=Math.max(0,sub-disc);

  $("#ara-toplam").textContent = money(sub);
  $("#genel-toplam").textContent = money(total);

  const row=$("#indirim-row"), val=$("#indirim-tutar");
  if(SELECTED_KAMPANYA && disc>0){
    row.classList.remove("hidden");
    val.textContent = "-"+money(disc);
  } else {
    row.classList.add("hidden");
    val.textContent="";
  }
}

// Render Cart
function renderCart(){
  const root=$("#cart-items");
  root.innerHTML="";

  const hasGift = SELECTED_KAMPANYA &&
                  SELECTED_KAMPANYA.tur==="ucretsiz_urun" &&
                  MENU_BY_ID[SELECTED_KAMPANYA.odul_urun_id];

  if(window.cart.length===0 && !hasGift){
    root.innerHTML=`<div class="empty">Sepet boş</div>`;
  }

  // Normal ürünler
  window.cart.forEach(it=>{
    const row=document.createElement("div"); row.className="cart-row";

    const n=document.createElement("div"); 
    n.className="cart-name"; 
    n.textContent=it.urun_adi;

    const q=document.createElement("input");
    q.type="number"; q.min="1";
    q.value=it.adet;
    q.className="cart-qty";
    q.addEventListener("change",()=>setQty(it.urun_id,q.value));

    const p=document.createElement("div");
    p.className="cart-price";
    p.textContent= money(it.fiyat);

    const del=document.createElement("button");
    del.className="btn danger"; 
    del.textContent="Sil";
    del.addEventListener("click",()=>removeFromCart(it.urun_id));

    row.append(n,q,p,del);
    root.append(row);
  });

  // 🎁 Ücretsiz ürün kampanyası satırı
  if(hasGift){
    const giftInfo=MENU_BY_ID[SELECTED_KAMPANYA.odul_urun_id];

    const row=document.createElement("div"); 
    row.className="cart-row gift-row";

    const n=document.createElement("div"); 
    n.className="cart-name"; 
    n.textContent=giftInfo.urun_adi+" (hediye)";

    const q=document.createElement("div"); 
    q.className="cart-qty"; 
    q.textContent="1";

    const p=document.createElement("div"); 
    p.className="cart-price"; 
    p.textContent=money(0);

    row.append(n,q,p);
    root.append(row);
  }

  // 💥 Kampanya bilgi satırı
  if(SELECTED_KAMPANYA && SELECTED_KAMPANYA.tur!=="ucretsiz_urun"){
    const row=document.createElement("div");
    row.className="cart-row kampanya-info";

    const n=document.createElement("div");
    n.className="cart-name"; 

    // script.js -> renderCart fonksiyonu içi:

    if(SELECTED_KAMPANYA.tur === "yuzde_indirim") {
      // Eğer veri yoksa 0 varsay, varsa sayıyı al
      const oran = Number(SELECTED_KAMPANYA.indirim_oran || 20);
      n.textContent = `%${oran} İndirim Kampanyası`;
    }
    else if(SELECTED_KAMPANYA.tur === "tutar_indirim") {
       const tutar = Number(SELECTED_KAMPANYA.indirim_tutar || 100).toFixed(2);
       n.textContent = `${tutar} ₺ İndirim Kampanyası`;
    }
    const q=document.createElement("div");
    q.className="cart-qty"; 
    q.textContent="";

    const p=document.createElement("div");
    p.className="cart-price"; 
    p.textContent="";

    row.append(n,q,p);
    root.append(row);
  }

  renderCartSummary();
}

// Sipariş
async function sendOrder(){
  const masa_id=getMasaId();
  if(!masa_id) return toast("Masa bulunamadı.");

  const kampanya_id=SELECTED_KAMPANYA ? SELECTED_KAMPANYA.kampanya_id : null;

  if(window.cart.length===0 && !kampanya_id){
    return toast("Sepet boş.");
  }

  const payload={
    masa_id,
    items: window.cart.map(it=>({urun_id:it.urun_id, adet:it.adet})),
    kampanya_id
  };

  try{
    const res=await fetch("/api/siparis",{
      method:"POST",
      headers:{"Content-Type":"application/json"},
      credentials:"include",
      body:JSON.stringify(payload)
    });

    const data=await res.json().catch(()=>({}));

    if(!res.ok) throw new Error(data.error||"Sipariş başarısız");

    window.cart=[];
    renderCart();
    toast("Siparişiniz alındı!");

  }catch(e){
    toast(e.message);
  }
}

// Kullanıcı Rozeti
async function initUserBadge(){
  const badge=$("#user-badge"); if(!badge) return;
  try{
    const r=await fetch("/api/me",FETCH_OPTS);
    if(!r.ok){ badge.classList.add("hidden"); return; }
    const me=await r.json();

    $("#ub-name").textContent=me.ad_soyad??me.email;
    $("#ub-puan").textContent=Number(me.puan||0);

    badge.classList.remove("hidden");
  }catch{
    badge.classList.add("hidden");
  }
}

// Init
document.addEventListener("DOMContentLoaded", async ()=>{
  showMasaChip();
  try{ const grouped=await fetchMenuGrouped(); renderMenu(grouped); }
  catch(e){ toast("Menü yüklenemedi"); }

  await loadKampanyalarim();
  renderCart();
  $("#siparisVerBtn")?.addEventListener("click",sendOrder);
  await initUserBadge();

  // Scroll oldukça header'ı biraz soluklaştır
  window.addEventListener("scroll", () => {
    const header = document.querySelector("header");
    if (!header) return;
    if (window.scrollY > 10) {
      header.classList.add("header-scrolled");
    } else {
      header.classList.remove("header-scrolled");
    }
  });

  await initUserBadge();

   // 🛒 Sepete Git butonu
  const goCartBtn = $("#goCartBtn");
  if (goCartBtn) {
    goCartBtn.addEventListener("click", () => {
      const cart = document.getElementById("cart-panel") || document.querySelector(".panel");
      if (cart) {
        cart.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }
});
