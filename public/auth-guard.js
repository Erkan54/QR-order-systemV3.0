// auth-guard.js - Sayfa İçi Güvenlik Duvarı

(async function() {
  // CSS Stillerini JS ile ekleyelim (Tek dosya olsun diye)
  const style = document.createElement('style');
  style.innerHTML = `
    #auth-overlay {
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.85); backdrop-filter: blur(5px);
      z-index: 99999; display: flex; justify-content: center; align-items: center;
    }
    .auth-box {
      background: white; padding: 30px; border-radius: 12px;
      width: 90%; max-width: 350px; text-align: center;
      box-shadow: 0 10px 25px rgba(0,0,0,0.5);
    }
    .auth-box h2 { margin-top: 0; color: #333; }
    .auth-box input {
      width: 100%; padding: 12px; margin: 10px 0;
      border: 1px solid #ddd; border-radius: 6px; box-sizing: border-box;
    }
    .auth-box button {
      width: 100%; padding: 12px; background: #e74c3c; color: white;
      border: none; border-radius: 6px; font-weight: bold; cursor: pointer;
      font-size: 16px; margin-top: 10px;
    }
    .auth-box button:hover { background: #c0392b; }
    .auth-error { color: red; font-size: 14px; margin-top: 10px; display: none; }
  `;
  document.head.appendChild(style);

  // Hangi sayfadayız?
  const path = window.location.pathname;
  // Sadece Yöneticilerin Girebileceği Sayfalar
  const adminPages = ["yonetici.html", "patron.html"];
  
  try {
    const res = await fetch("/api/staff/check");
    
    if (res.ok) {
      const data = await res.json();
      const role = data.user.role;

      // Eğer sayfa admin sayfasıysa ve giren kişi admin değilse (örn: garson)
      if (adminPages.some(p => path.includes(p)) && role !== 'admin') {
        showLoginModal("⛔ Yetkisiz Erişim", "Bu alana sadece Yöneticiler girebilir.");
        return;
      }
      
      // Giriş yapılmış ve yetki tamamsa hiçbir şey yapma, bırak sayfa çalışsın.
      console.log("Giriş onaylandı: " + data.user.username);
      return; 
    }
  } catch (e) { console.error(e); }

  // Eğer buraya geldiyse giriş yapılmamış demektir -> KUTUYU GÖSTER
  showLoginModal();

})();

function showLoginModal(title = "🔒 Personel Girişi", msg = "") {
  // Eğer zaten varsa tekrar oluşturma
  if(document.getElementById("auth-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "auth-overlay";
  
  overlay.innerHTML = `
    <div class="auth-box">
      <h2>${title}</h2>
      ${msg ? `<p style="color:#666; font-size:14px;">${msg}</p>` : ''}
      <form id="guard-form">
        <input type="text" id="g-user" placeholder="Kullanıcı Adı" required autocomplete="off">
        <input type="password" id="g-pass" placeholder="Şifre" required>
        <button type="submit">Giriş Yap</button>
        <div id="g-error" class="auth-error"></div>
      </form>
    </div>
  `;
  
  document.body.appendChild(overlay);

  // Form submit işlemi
  document.getElementById("guard-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const u = document.getElementById("g-user").value;
    const p = document.getElementById("g-pass").value;
    const err = document.getElementById("g-error");
    
    err.style.display = "none";

    try {
      const res = await fetch("/api/staff/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password: p })
      });
      
      const json = await res.json();

      if (res.ok) {
        // Başarılı! Sayfayı yenile ki veriler yüklensin
        location.reload();
      } else {
        err.textContent = json.error || "Giriş başarısız!";
        err.style.display = "block";
      }
    } catch (error) {
      err.textContent = "Bağlantı hatası!";
      err.style.display = "block";
    }
  });
}