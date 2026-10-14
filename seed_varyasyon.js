const mysql = require("mysql2/promise");
require("dotenv").config();

async function run() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST, user: process.env.DB_USER,
    password: process.env.DB_PASS, database: process.env.DB_NAME
  });

  try {
    // Önce eski seedleri temizle
    await pool.query("DELETE FROM urun_varyasyonlari");
    await pool.query("DELETE FROM urun_ekstralari");
    console.log("Eski varyasyon/ekstralar temizlendi.\n");

    const [urunler] = await pool.query(
      "SELECT u.urun_id, u.urun_adi, k.kategori_adi FROM urunler u JOIN kategoriler k ON k.kategori_id=u.kategori_id"
    );

    for (const u of urunler) {
      const ad = u.urun_adi.toLowerCase();
      const kat = u.kategori_adi.toLowerCase();
      const id = u.urun_id;
      let vars = [];
      let eks = [];

      // =========== SICAK İÇECEKLER ===========
      if (kat.includes("cak") && kat.includes("cek")) {
        // Sıcak İçecekler
        if (ad.includes("sahlep")) {
          vars = [["Küçük", 0], ["Büyük", 15]];
          eks = [["Tarçın Ekle", 0, "ekstra"], ["Marshmallow", 5, "ekstra"], ["Şekersiz", 0, "cikar"]];
        } else if (ad.includes("çikolata")) {
          vars = [["Küçük", 0], ["Büyük", 15]];
          eks = [["Marshmallow", 5, "ekstra"], ["Krema Ekle", 5, "ekstra"], ["Tarçın Ekle", 0, "ekstra"], ["Şekersiz", 0, "cikar"]];
        } else {
          // Tüm çaylar
          vars = [["Tek Bardak", 0], ["Demlik (2 Kişilik)", 25]];
          eks = [["Limon Dilimi", 0, "ekstra"], ["Bal Ekle", 5, "ekstra"], ["Şekersiz", 0, "cikar"]];
        }
      }
      // =========== TÜRK KAHVELERİ ===========
      else if (kat === "kahveler") {
        vars = [["Tek Fincan", 0], ["İkili Fincan", 20]];
        eks = [["Sade", 0, "ekstra"], ["Az Şekerli", 0, "ekstra"], ["Orta Şekerli", 0, "ekstra"], ["Çok Şekerli", 0, "ekstra"], ["Lokum İle", 3, "ekstra"]];
      }
      // =========== SICAK ESPRESSOLAR ===========
      else if (kat === "espressolar") {
        if (ad === "espresso" || ad.includes("double shot")) {
          vars = [["Single", 0], ["Double", 12]];
          eks = [["Ekstra Shot", 10, "ekstra"], ["Kafeinsiz", 0, "ekstra"], ["Şekersiz", 0, "cikar"]];
        } else if (ad === "cortado") {
          vars = [["Standart", 0]];
          eks = [["Ekstra Shot", 10, "ekstra"], ["Kafeinsiz", 0, "ekstra"]];
        } else if (ad.includes("americano") || ad.includes("filtre")) {
          vars = [["Küçük (200ml)", 0], ["Büyük (400ml)", 12]];
          eks = [["Ekstra Shot", 10, "ekstra"], ["Süt Ekle", 3, "ekstra"], ["Kafeinsiz", 0, "ekstra"], ["Şekersiz", 0, "cikar"]];
        } else {
          // Latte, Cappucino, Mocha, Macchiato, Flat White, Aromalı Latte
          vars = [["Küçük (200ml)", 0], ["Orta (300ml)", 10], ["Büyük (400ml)", 18]];
          eks = [
            ["Ekstra Shot", 10, "ekstra"], ["Vanilya Şurup", 8, "ekstra"], ["Karamel Şurup", 8, "ekstra"],
            ["Fındık Şurup", 8, "ekstra"], ["Yulaf Sütü", 8, "ekstra"], ["Badem Sütü", 8, "ekstra"],
            ["Laktozsuz Süt", 5, "ekstra"], ["Kafeinsiz", 0, "ekstra"], ["Şekersiz", 0, "cikar"]
          ];
        }
      }
      // =========== SOĞUK ESPRESSOLAR ===========
      else if (kat.includes("espresso") && kat.includes("uk")) {
        vars = [["Küçük (300ml)", 0], ["Orta (400ml)", 10], ["Büyük (500ml)", 18]];
        eks = [
          ["Ekstra Shot", 10, "ekstra"], ["Vanilya Şurup", 8, "ekstra"], ["Karamel Şurup", 8, "ekstra"],
          ["Fındık Şurup", 8, "ekstra"], ["Yulaf Sütü", 8, "ekstra"], ["Badem Sütü", 8, "ekstra"],
          ["Kafeinsiz", 0, "ekstra"], ["Buzsuz", 0, "cikar"], ["Şekersiz", 0, "cikar"]
        ];
      }
      // =========== KOKTEYLLER ===========
      else if (kat.includes("kokteyl")) {
        if (ad.includes("mojito")) {
          vars = [["Klasik", 0], ["Çilekli", 10]];
          eks = [["Ekstra Nane", 0, "ekstra"], ["Buzsuz", 0, "cikar"]];
        } else if (ad.includes("ice tea")) {
          vars = [["Küçük (300ml)", 0], ["Büyük (500ml)", 15]];
          eks = [["Şeftalili", 0, "ekstra"], ["Buzsuz", 0, "cikar"], ["Şekersiz", 0, "cikar"]];
        } else {
          vars = [["Küçük (300ml)", 0], ["Büyük (500ml)", 15]];
          eks = [["Ekstra Meyve", 5, "ekstra"], ["Buzsuz", 0, "cikar"], ["Şekersiz", 0, "cikar"]];
        }
      }
      // =========== SOĞUK İÇECEKLER ===========
      else if (kat.includes("uk") && kat.includes("cek") && !kat.includes("espresso")) {
        if (ad === "su") {
          vars = [["0.5L", 0], ["1L", 10]];
          eks = [];
        } else if (ad.includes("soda")) {
          vars = [["Standart", 0]];
          eks = [["Limon Dilimi", 0, "ekstra"], ["Buzsuz", 0, "cikar"]];
        } else if (ad.includes("limonata")) {
          vars = [["Bardak", 0], ["Sürahi (1L)", 35]];
          eks = [["Naneli", 0, "ekstra"], ["Buzsuz", 0, "cikar"], ["Az Şekerli", 0, "cikar"]];
        } else if (ad.includes("milkshake")) {
          vars = [["Çilekli", 0], ["Çikolatalı", 0], ["Muzlu", 0], ["Oreo", 5]];
          eks = [["Krema Ekle", 5, "ekstra"], ["Ekstra Dondurma", 10, "ekstra"], ["Şekersiz", 0, "cikar"]];
        } else if (ad.includes("frozen")) {
          vars = [["Mango", 0], ["Çilek", 0], ["Limon", 0]];
          eks = [["Ekstra Meyve", 5, "ekstra"], ["Buzsuz", 0, "cikar"]];
        } else if (ad.includes("meyve suyu")) {
          vars = [["Küçük (200ml)", 0], ["Büyük (330ml)", 8]];
          eks = [];
        } else if (ad.includes("redbull")) {
          vars = [["Standart", 0]];
          eks = [];
        } else if (ad.includes("churchill")) {
          vars = [["Standart", 0]];
          eks = [["Limon Dilimi", 0, "ekstra"], ["Buzsuz", 0, "cikar"]];
        } else {
          // Düşes Armudu Soda vs.
          vars = [["Standart", 0]];
          eks = [["Buzsuz", 0, "cikar"]];
        }
      }
      // =========== PASTALAR & KEKLER ===========
      else if (kat.includes("pasta") || kat.includes("kek")) {
        if (ad.includes("magnolia")) {
          vars = [["Tek Kişilik", 0], ["Çift Kişilik", 40]];
          eks = [["Ekstra Krema", 10, "ekstra"], ["Çikolata Sos", 8, "ekstra"], ["Fıstık Serpme", 10, "ekstra"], ["Meyve Süsleme", 8, "ekstra"]];
        } else if (ad.includes("brownie")) {
          vars = [["Tek Dilim", 0], ["Çift Dilim", 30]];
          eks = [["Vanilya Dondurma", 15, "ekstra"], ["Çikolata Sos", 8, "ekstra"], ["Karamel Sos", 8, "ekstra"], ["Fıstık Serpme", 10, "ekstra"]];
        } else if (ad.includes("tiramisu")) {
          vars = [["Tek Kişilik", 0], ["Paylaşımlık", 35]];
          eks = [["Ekstra Kakao", 0, "ekstra"], ["Çikolata Parçacık", 8, "ekstra"]];
        } else if (ad.includes("san sebastian")) {
          vars = [["Dilim", 0], ["Bütün Kek", 200]];
          eks = [["Çilek Sos", 10, "ekstra"], ["Karamel Sos", 8, "ekstra"], ["Meyve Tabağı İle", 20, "ekstra"]];
        } else if (ad.includes("tart")) {
          vars = [["Tek Dilim", 0]];
          eks = [["Vanilya Dondurma", 15, "ekstra"], ["Krema Ekle", 8, "ekstra"]];
        } else if (ad.includes("pistachio")) {
          vars = [["Tek Kişilik", 0]];
          eks = [["Ekstra Antep Fıstığı", 12, "ekstra"], ["Dondurma Ekle", 15, "ekstra"]];
        } else {
          vars = [["Tek Kişilik", 0], ["Paylaşımlık", 35]];
          eks = [["Çikolata Sos", 8, "ekstra"], ["Dondurma Ekle", 15, "ekstra"], ["Meyve Süsleme", 8, "ekstra"]];
        }
      }
      // =========== FALLBACK ===========
      else {
        vars = [["Standart", 0]];
        eks = [["Şekersiz", 0, "cikar"]];
      }

      // INSERT
      for (const v of vars) {
        await pool.query("INSERT INTO urun_varyasyonlari (urun_id, ad, fiyat_farki) VALUES (?, ?, ?)", [id, v[0], v[1]]);
      }
      for (const e of eks) {
        await pool.query("INSERT INTO urun_ekstralari (urun_id, ad, fiyat_farki, tip) VALUES (?, ?, ?, ?)", [id, e[0], e[1], e[2]]);
      }
      console.log(`[OK] ${u.urun_adi} (${u.kategori_adi}) -> ${vars.length} var, ${eks.length} eks`);
    }

    console.log("\nTum urunlere akilli seed basariyla atandi!");
  } catch (err) {
    console.error("Seed hatasi:", err);
  } finally {
    await pool.end();
  }
}
run();
