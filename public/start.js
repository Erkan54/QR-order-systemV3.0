// start.js — QR zorunlu; manuel masa girişi yok

function $(s){return document.querySelector(s);}
function parsePos(v){const n=Number(v);const i=Math.trunc(n);return Number.isFinite(i)&&i>0?i:null;}

function extractMasa(){
  const u=new URL(location.href);
  const keys=["masa_id","masa","table","t","m"];
  for(const k of keys){
    const v=u.searchParams.get(k);
    const n=parsePos(v); if(n) return n;
  }
  if(u.hash){
    const sp=new URLSearchParams(u.hash.replace(/^#/,""));
    for(const k of keys){
      const v=sp.get(k); const n=parsePos(v); if(n) return n;
    }
  }
  return null;
}

function setMasa(id){
  sessionStorage.setItem("masa_id",String(id));
  const chip=$("#masa-chip"); if(chip) chip.textContent="#"+id;
}

document.addEventListener("DOMContentLoaded",()=>{
  const ok=$("#ok"), err=$("#err");
  const masa=extractMasa();
  if(!masa){ err.classList.remove("hidden"); return; }
  setMasa(masa);
  ok.classList.remove("hidden");

  // 🔒 Hızlı Sipariş = her zaman anonim (oturumu kapatıp gönderiyoruz)
  $("#btnHizli")?.addEventListener("click", async ()=>{
    try{ await fetch("/api/logout",{method:"POST",credentials:"include"}); }catch{}
    location.href=`index.html?masa=${masa}`;
  });

  $("#btnGiris")?.addEventListener("click",()=>location.href=`login.html?masa=${masa}`);
});
