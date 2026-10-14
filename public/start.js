function $(s){return document.querySelector(s);}

// URL'den sadece masa ID al (Token aramıyoruz artık)
const extractMasa = () => {
    const p = new URLSearchParams(location.search);
    return parseInt(p.get("masa")) || null;
};

document.addEventListener("DOMContentLoaded", () => {
    const okDiv = $("#ok");
    const errDiv = $("#err");
    const gpsBox = $("#gps-box"); // Ekranda varsa gizleyeceğiz
    const btnHizli = $("#btnHizli");
    const btnGiris = $("#btnGiris");
    const masaChip = $("#masa-chip");

    const masa = extractMasa();

    // Sadece Masa ID yoksa hata ver
    if(!masa){
        errDiv.classList.remove("hidden");
        if(gpsBox) gpsBox.style.display = 'none';
        return;
    }

    // Masa ID'sini kaydet
    sessionStorage.setItem("masa_id", masa);
    
    if(masaChip) masaChip.textContent = masa;
    
    // --- DEĞİŞİKLİK BURADA ---
    // Konum (GPS) sormuyoruz.
    // Token kontrolü yapmıyoruz.
    // Direkt olarak başarı ekranını açıyoruz.

    if(gpsBox) gpsBox.style.display = 'none'; // "Konum aranıyor" kutusunu gizle
    okDiv.classList.remove("hidden");         // Butonların olduğu alanı aç

    // Butonları aktif et
    if(btnHizli) btnHizli.disabled = false;
    if(btnGiris) btnGiris.disabled = false;

    // Yönlendirme Linkleri (Artık token parametresi eklemiyoruz)
    const targetUrl = `?masa=${masa}`;
    
    if(btnHizli) {
        btnHizli.addEventListener("click", async () => {
            // İsteğe bağlı logout (önceki oturumu temizlemek için), hata verirse umursama
            try { await fetch("/api/logout", {method:"POST"}); } catch{}
            
            // Token parametresi OLMADAN yönlendir
            location.href = `index.html${targetUrl}`;
        });
    }

    if(btnGiris) {
        btnGiris.addEventListener("click", () => {
            location.href = `login.html${targetUrl}`;
        });
    }
});