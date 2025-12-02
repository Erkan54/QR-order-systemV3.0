// server.js  — QR Sipariş Sistemi (Express + mysql2/promise)
// CommonJS kullanıyoruz; package.json'a "type": "module" EKLEME!
// Çalıştırmadan önce .env dosyanı oluştur (aşağıda örnek var).

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const session = require("express-session");
const path = require("path");

dotenv.config();

const app = express();
app.use(cors());
app.use(bodyParser.json());

app.use(
  session({
    secret: "supersecret",
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false }, // http'de çalışıyorsan false kalmalı
  })
);

// ---- MySQL Pool ----
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "root",
  password: process.env.DB_PASS || "1234",
  database: process.env.DB_NAME || "qr_siparis",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "Z", // MySQL tarih-timestamp tutarlılığı
});

// ---- Basit yardımcılar ----
const ALLOWED_DURUM = new Set(["Hazırlanıyor", "Hazır", "Teslim Edildi", "İptal"]);

function assert(condition, message, status = 400) {
  if (!condition) {
    const err = new Error(message);
    err.status = status;
    throw err;
  }
}

async function getConn() {
  return pool.getConnection();
}

// ---- Healthcheck ----
app.get("/api/health", async (_req, res) => {
  try {
    const [rows] = await pool.query("SELECT 1 AS ok");
    res.json({ ok: true, db: rows[0].ok === 1 });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

// ---- MENÜ: SQL'den okur (aktif ve tükendi=0 ürünler) ----
app.get("/api/menu", async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        k.kategori_adi,
        u.urun_id,
        u.urun_adi,
        u.aciklama,
        u.fiyat,
        u.resim_url  
      FROM urunler u
      JOIN kategoriler k ON k.kategori_id = u.kategori_id
      WHERE u.aktif = 1 AND u.tukendi = 0
      ORDER BY k.kategori_adi, u.urun_adi
    `);
    const grouped = rows.reduce((acc, r) => {
      (acc[r.kategori_adi] ||= []).push({
        urun_id: r.urun_id,
        urun_adi: r.urun_adi,
        aciklama: r.aciklama,
        fiyat: Number(r.fiyat),
        resim_url: r.resim_url // <--- BURAYI DA EKLE
      });
      return acc;
    }, {});
    res.json(grouped);
  } catch (e) {
    next(e);
  }
});

// ---- MASALAR: (opsiyonel) hızlı liste ----
app.get("/api/masalar", async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT masa_id, masa_no, qr_kod FROM masalar ORDER BY masa_id`);
    res.json(rows);
  } catch (e) {
    next(e);
  }
});

// === MÜŞTERİ KAYIT ===
app.post("/api/register", async (req, res, next) => {
  const { ad_soyad, email, telefon, sifre } = req.body;
  try {
    assert(ad_soyad && email && sifre, "Zorunlu alanlar eksik");
    const hash = await bcrypt.hash(sifre, 10);

    const [result] = await pool.query(
      "INSERT INTO musteriler (ad_soyad, email, telefon, sifre_hash) VALUES (?, ?, ?, ?)",
      [ad_soyad, email, telefon || null, hash]
    );

    res.status(201).json({ message: "Kayıt başarılı", id: result.insertId });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") e.message = "Bu e-posta zaten kayıtlı";
    next(e);
  }
});

// === MÜŞTERİ GİRİŞ ===
app.post("/api/login", async (req, res, next) => {
  const { email, sifre } = req.body;
  try {
    assert(email && sifre, "E-posta ve şifre gerekli");

    const [rows] = await pool.query("SELECT * FROM musteriler WHERE email = ?", [email]);
    assert(rows.length === 1, "Kullanıcı bulunamadı");

    const user = rows[0];
    const match = await bcrypt.compare(sifre, user.sifre_hash);
    assert(match, "Hatalı şifre");

    req.session.user = { id: user.musteri_id, ad_soyad: user.ad_soyad, puan: user.puan };
    res.json({ message: "Giriş başarılı", user: req.session.user });
  } catch (e) {
    next(e);
  }
});

// === OTURUM DURUMU ===
// GİRİŞ YOKSA 401
// GİRİŞ VARSA: { id, ad_soyad, email, puan }
app.get("/api/me", async (req, res) => {
  if (!req.session?.user?.id) return res.status(401).json({ error: "Giriş gerekli" });
  const id = req.session.user.id;
  const [[row]] = await pool.query(
    "SELECT musteri_id AS id, ad_soyad, email, puan FROM musteriler WHERE musteri_id = ?",
    [id]
  );
  if (!row) return res.status(404).json({ error: "Kullanıcı bulunamadı" });
  res.set("Cache-Control", "no-store");
  res.json(row);
});

// === ÇIKIŞ ===
app.post("/api/logout", (req, res) => {
  req.session.destroy(() => res.json({ message: "Çıkış yapıldı" }));
});

// === 🧭 KAMPANYA SİSTEMİ ===
// İSTENEN DAVRANIŞ: Kampanyalar HER ZAMAN görünsün.
// - Misafirler de listeyi görür; hak_sayisi = 0 (kullanamaz).
// - Giriş yapanlar için hak_sayisi = floor(puan / gerekli_puan).
// Front zaten /api/kampanyalarim çağırıyor; bu endpoint'i bu yeni davranışla güncelliyoruz.

app.get("/api/kampanyalarim", async (req, res) => {
  try {
    let puan = 0;
    let logged = false;

    if (req.session?.user?.id) {
      logged = true;
      const [[mu]] = await pool.query(
        "SELECT puan FROM musteriler WHERE musteri_id = ?",
        [req.session.user.id]
      );
      puan = Number(mu?.puan || 0);
    }

    const [rows] = await pool.query(`
      SELECT 
        k.kampanya_id,
        k.ad,
        k.tur,
        k.gerekli_puan,
        k.odul_urun_id,
        u.urun_adi   AS odul_urun_adi,
        u.fiyat      AS odul_fiyat
      FROM kampanyalar k
      LEFT JOIN urunler u ON u.urun_id = k.odul_urun_id
      WHERE k.aktif = 1
      ORDER BY k.olusturma_tarih DESC, k.gerekli_puan ASC
    `);

    const out = rows.map(r => ({
      kampanya_id: r.kampanya_id,
      ad: r.ad,
      tur: r.tur || "ucretsiz_urun",
      odul_urun_id: r.odul_urun_id,
      odul_urun_adi: r.odul_urun_adi,
      odul_fiyat: r.odul_fiyat != null ? Number(r.odul_fiyat) : null,
      gerekli_puan: Number(r.gerekli_puan || 0),
      hak_sayisi: logged ? Math.floor(puan / Math.max(1, Number(r.gerekli_puan || 0))) : 0
    }));

    res.json(out);
  } catch (err) {
    console.error("kampanyalarim hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 KAMPANYA KULLAN (manuel kullanım)
// Not: Sipariş akışında kampanya_id gönderilirse /api/siparis içinde de uygulanır.
app.post("/api/kampanya/kullan", async (req, res) => {
  try {
    const musteri_id = req.session.user?.id;
    const { kampanya_id } = req.body;

    if (!musteri_id) return res.status(401).json({ error: "Giriş gerekli" });
    if (!kampanya_id) return res.status(400).json({ error: "Kampanya ID gerekli" });

    const [[kamp]] = await pool.query(
      "SELECT gerekli_puan, odul_urun_id, ad FROM kampanyalar WHERE kampanya_id = ? AND aktif = 1",
      [kampanya_id]
    );
    if (!kamp) return res.status(404).json({ error: "Kampanya bulunamadı" });

    const [[mus]] = await pool.query("SELECT puan FROM musteriler WHERE musteri_id = ?", [musteri_id]);
    if (!mus || mus.puan < kamp.gerekli_puan) {
      return res.status(400).json({ error: "Yetersiz puan" });
    }

    await pool.query("UPDATE musteriler SET puan = puan - ? WHERE musteri_id = ?", [
      kamp.gerekli_puan,
      musteri_id
    ]);

    await pool.query(
      "INSERT INTO musteri_kampanyalari (musteri_id, kampanya_id, kullanildi) VALUES (?, ?, 1)",
      [musteri_id, kampanya_id]
    );

    res.json({
      success: true,
      message: `${kamp.ad} kampanyası kullanıldı.`,
      odul_urun_id: kamp.odul_urun_id || null
    });
  } catch (err) {
    console.error("Kampanya kullanım hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 KAMPANYA GEÇMİŞİ
app.get("/api/musteri/kampanyagecmis", async (req, res) => {
  try {
    const musteri_id = req.session.user?.id;
    if (!musteri_id) return res.status(401).json({ error: "Giriş gerekli" });

    const [rows] = await pool.query(`
      SELECT 
        mk.kampanya_id,
        k.ad AS kampanya_ad,
        mk.kazanma_tarih,
        mk.kullanildi
      FROM musteri_kampanyalari mk
      JOIN kampanyalar k ON k.kampanya_id = mk.kampanya_id
      WHERE mk.musteri_id = ?
      ORDER BY mk.kazanma_tarih DESC
    `, [musteri_id]);

    res.json(rows);
  } catch (err) {
    console.error("Kampanya geçmiş hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// ==========================================
// 🧭 YÖNETİCİ PANELİ (MENÜ, KAMPANYA, MÜŞTERİ)
// ==========================================

// 🔹 TÜM ÜRÜNLERİ GETİR (Menü tablosu ve ödül dropdown için)
app.get("/api/admin/menu", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        u.urun_id,
        u.urun_adi,
        u.fiyat,
        u.kdv,
        u.tukendi,
        u.aktif,
        k.kategori_adi
      FROM urunler u
      JOIN kategoriler k ON k.kategori_id = u.kategori_id
      ORDER BY k.kategori_adi, u.urun_adi
    `);
    res.json(
      rows.map(r => ({
        ...r,
        fiyat: Number(r.fiyat || 0),
        kdv:   Number(r.kdv   || 0)
      }))
    );

  } catch (err) {
    console.error("Menü getirme hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 KATEGORİLERİ GETİR (ürün ekleme modalı için)
app.get("/api/admin/kategoriler", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT kategori_id, kategori_adi
      FROM kategoriler
      ORDER BY kategori_adi
    `);
    res.json(rows);
  } catch (err) {
    console.error("Kategori listesi hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 YENİ ÜRÜN EKLE (tukendi varsayılan 0)
app.post("/api/admin/menu/ekle", async (req, res) => {
  try {
    const { kategori_id, urun_adi, fiyat } = req.body;
    if (!kategori_id || !urun_adi)
      return res.status(400).json({ error: "Eksik bilgi" });

    await pool.query(
      `INSERT INTO urunler (kategori_id, urun_adi, fiyat, aktif, tukendi) 
       VALUES (?, ?, ?, 1, 0)`,
      [kategori_id, urun_adi, fiyat ?? 0]
    );

    res.json({ success: true, message: "Ürün başarıyla eklendi." });
  } catch (err) {
    console.error("Ürün ekleme hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 FİYAT GÜNCELLE
// 🔹 FİYAT + KDV GÜNCELLE
app.post("/api/admin/menu/fiyat", async (req, res) => {
  try {
    const { urun_id, fiyat, kdv } = req.body;
    if (!urun_id || fiyat == null)
      return res.status(400).json({ error: "Eksik parametre" });

    const kdvOran = kdv == null ? 0 : Number(kdv);

    await pool.query(
      "UPDATE urunler SET fiyat = ?, kdv = ? WHERE urun_id = ?",
      [fiyat, kdvOran, urun_id]
    );

    res.json({ success: true, message: "Fiyat/KDV güncellendi." });

  } catch (err) {
    console.error("Fiyat güncelleme hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 STOK GÜNCELLE (legacy → tukendi'ye map edilir)
app.post("/api/admin/menu/stok", async (req, res) => {
  try {
    const { urun_id, stok } = req.body;
    if (!urun_id) return res.status(400).json({ error: "Eksik ID" });
    const tukendi = Number(stok) === 0 ? 1 : 0;
    await pool.query("UPDATE urunler SET tukendi = ? WHERE urun_id = ?", [tukendi, urun_id]);
    res.json({ success: true, message: "Tükendi durumu güncellendi (legacy endpoint)." });
  } catch (err) {
    console.error("Tükendi (stok legacy) güncelleme hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 AKTİFLİK GÜNCELLE
app.post("/api/admin/menu/aktif", async (req, res) => {
  try {
    const { urun_id, aktif } = req.body;
    if (!urun_id) return res.status(400).json({ error: "Eksik ID" });

    await pool.query("UPDATE urunler SET aktif = ? WHERE urun_id = ?", [
      aktif,
      urun_id,
    ]);
    res.json({ success: true, message: "Aktiflik durumu güncellendi." });
  } catch (err) {
    console.error("Aktiflik güncelleme hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 ÜRÜN SİL
app.delete("/api/admin/menu/:id", async (req, res) => {
  try {
    const { id } = req.params;
    await pool.query("DELETE FROM urunler WHERE urun_id = ?", [id]);
    res.json({ success: true, message: "Ürün silindi." });
  } catch (err) {
    console.error("Ürün silme hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 ÖDÜL ÜRÜNLERİ (Kampanya formu dropdown)
app.get("/api/admin/odul-urunler", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        u.urun_id, 
        u.urun_adi, 
        k.kategori_adi, 
        u.aktif
      FROM urunler u
      JOIN kategoriler k ON k.kategori_id = u.kategori_id
      ORDER BY k.kategori_adi, u.urun_adi
    `);
    res.json(rows);
  } catch (err) {
    console.error("Ödül ürünleri hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 Tükendi toggle (resmi endpoint)
app.put("/api/admin/urun/:id/tukendi", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { tukendi } = req.body; // 0 veya 1
    if (!Number.isInteger(id)) return res.status(400).json({ error: "Geçersiz ID" });
    if (tukendi !== 0 && tukendi !== 1) return res.status(400).json({ error: "tukendi 0/1 olmalı" });

    await pool.query("UPDATE urunler SET tukendi = ? WHERE urun_id = ?", [tukendi, id]);
    res.json({ success: true, message: "Tükendi güncellendi." });
  } catch (err) {
    console.error("Tükendi güncelleme hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 KAMPANYALARI GETİR (admin tablo)
// server.js içinde bu endpoint'i bul ve bununla değiştir:

app.get("/api/kampanyalarim", async (req, res) => {
  try {
    let puan = 0;
    let logged = false;

    if (req.session?.user?.id) {
      logged = true;
      const [[mu]] = await pool.query(
        "SELECT puan FROM musteriler WHERE musteri_id = ?",
        [req.session.user.id]
      );
      puan = Number(mu?.puan || 0);
    }

    // HATA BURADAYDI: k.indirim_oran ve k.indirim_tutar SQL'e eklendi.
    const [rows] = await pool.query(`
      SELECT 
        k.kampanya_id,
        k.ad,
        k.tur,
        k.gerekli_puan,
        k.odul_urun_id,
        k.indirim_oran,    
        k.indirim_tutar,
        u.urun_adi   AS odul_urun_adi,
        u.fiyat      AS odul_fiyat
      FROM kampanyalar k
      LEFT JOIN urunler u ON u.urun_id = k.odul_urun_id
      WHERE k.aktif = 1
      ORDER BY k.olusturma_tarih DESC, k.gerekli_puan ASC
    `);

    const out = rows.map(r => ({
      kampanya_id: r.kampanya_id,
      ad: r.ad,
      tur: r.tur || "ucretsiz_urun",
      odul_urun_id: r.odul_urun_id,
      odul_urun_adi: r.odul_urun_adi,
      odul_fiyat: r.odul_fiyat != null ? Number(r.odul_fiyat) : null,
      gerekli_puan: Number(r.gerekli_puan || 0),
      // Veriyi frontend'e gönderiyoruz:
      indirim_oran: r.indirim_oran,
      indirim_tutar: r.indirim_tutar,
      hak_sayisi: logged ? Math.floor(puan / Math.max(1, Number(r.gerekli_puan || 0))) : 0
    }));

    res.json(out);
  } catch (err) {
    console.error("kampanyalarim hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});
// 🔹 KAMPANYA SİL
app.delete("/api/admin/kampanya/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id, 10);
    await pool.query("DELETE FROM kampanyalar WHERE kampanya_id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Kampanya silme hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

app.post("/api/admin/kampanya/ekle", async (req, res) => {
  try {
    const {
      ad,
      gerekli_puan,
      tur,
      odul_urun_id,
      indirim_oran,
      indirim_tutar
    } = req.body;

    // genel kontroller
    if (!ad || !gerekli_puan || !tur) {
      return res.status(400).json({ error: "Eksik bilgi." });
    }

    // tür kontrol
    if (!["ucretsiz_urun", "yuzde_indirim", "tutar_indirim"].includes(tur)) {
      return res.status(400).json({ error: "Geçersiz kampanya türü." });
    }

    // türlere göre zorunlu alanlar
    let odul = null;
    let oran = null;
    let tutar = null;

    if (tur === "ucretsiz_urun") {
      if (!odul_urun_id) {
        return res.status(400).json({
          error: "Ücretsiz ürün kampanyası için ödül ürün seçmelisiniz."
        });
      }
      odul = Number(odul_urun_id);
    }

    if (tur === "yuzde_indirim") {
      const o = Number(indirim_oran);
      if (!o || o <= 0 || o > 100) {
        return res.status(400).json({
          error: "Geçerli bir indirim oranı girin (1-100)."
        });
      }
      oran = o;
    }

    if (tur === "tutar_indirim") {
      const t = Number(indirim_tutar);
      if (!t || t <= 0) {
        return res.status(400).json({
          error: "Geçerli bir indirim tutarı girin (>0)."
        });
      }
      tutar = t;
    }

    // SQL düzgün sıralama
    const sql = `
      INSERT INTO kampanyalar
      (ad, gerekli_puan, tur, odul_urun_id, indirim_oran, indirim_tutar, aktif)
      VALUES (?, ?, ?, ?, ?, ?, 1)
    `;

    await pool.query(sql, [
      ad,
      Number(gerekli_puan),
      tur,
      odul,
      oran,
      tutar
    ]);

    return res.json({ message: "Kampanya eklendi." });

  } catch (err) {
    console.error("Kampanya ekleme hatası:", err);

    if (err.sqlState === "45000") {
      return res.status(400).json({ error: err.sqlMessage });
    }

    if (err.errno === 3819) {
      return res.status(400).json({ error: err.sqlMessage });
    }

    return res.status(500).json({ error: "Sunucu hatası" });
  }
});


// ---- SİPARİŞ OLUŞTUR (KAMPANYA DESTEKLİ) ----
// ---- SİPARİŞ OLUŞTUR (KAMPANYA DESTEKLİ; SEPET BOŞ + KAMPANYA OK) ----
app.post("/api/siparis", async (req, res, next) => {
  const { masa_id, items = [], kampanya_id } = req.body || {};
  try {
    assert(Number.isInteger(masa_id) && masa_id > 0, "Geçersiz masa_id");

    const isCartEmpty = !Array.isArray(items) || items.length === 0;
    // Sepet boşsa sadece kampanya ile izin ver
    assert(!isCartEmpty || kampanya_id, "Sepet boş veya kampanya seçilmedi");

    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      // Masa kontrolü
      const [mrows] = await conn.execute("SELECT masa_id FROM masalar WHERE masa_id = ?", [masa_id]);
      assert(mrows.length > 0, "Masa bulunamadı", 404);

      // Sipariş oluştur
      const [ins] = await conn.execute(
        "INSERT INTO siparisler (masa_id, musteri_id) VALUES (?, ?)",
        [masa_id, req.session?.user?.id || null]
      );
      const siparis_id = ins.insertId;

      // Müşteri eşle (analitik)
      if (req.session?.user?.id) {
        await conn.execute(
          "INSERT IGNORE INTO musteri_siparisleri (musteri_id, siparis_id) VALUES (?, ?)",
          [req.session.user.id, siparis_id]
        );
      }

      // Ürünleri ekle (varsa)
      if (!isCartEmpty) {
        const urunIds = items.map(i => i.urun_id);
        const placeholders = urunIds.map(() => "?").join(",");
        const [urows] = await conn.query(
          `SELECT urun_id FROM urunler WHERE aktif = 1 AND tukendi = 0 AND urun_id IN (${placeholders})`,
          urunIds
        );
        assert(urows.length === urunIds.length, "Listede olmayan/aktif olmayan/tükendi ürün var");

        for (const it of items) {
          await conn.execute(
            "INSERT INTO siparis_urunleri (siparis_id, urun_id, adet) VALUES (?,?,?)",
            [siparis_id, it.urun_id, it.adet || 1]
          );
        }
      }

      // Kampanya uygula (varsa)
      let campaignApplied = false;
      if (kampanya_id && req.session?.user?.id) {
        const musteri_id = req.session.user.id;
        const [[k]] = await conn.query(
          "SELECT kampanya_id, tur, gerekli_puan, odul_urun_id, indirim_oran, indirim_tutar FROM kampanyalar WHERE kampanya_id = ? AND aktif = 1",
          [kampanya_id]
        );

        if (k) {
          const [[mus]] = await conn.query("SELECT puan FROM musteriler WHERE musteri_id = ?", [musteri_id]);
          if (mus && Number(mus.puan) >= Number(k.gerekli_puan)) {
            // puanı düş, kullanım kaydı aç
            await conn.query("UPDATE musteriler SET puan = puan - ? WHERE musteri_id = ?", [k.gerekli_puan, musteri_id]);
            await conn.query(
              "INSERT INTO musteri_kampanyalari (musteri_id, kampanya_id, kullanildi) VALUES (?,?,1)",
              [musteri_id, kampanya_id]
            );

            if (k.tur === "ucretsiz_urun" && k.odul_urun_id) {
              // hediye ürünü 0₺ ekle
              await conn.execute(
                "INSERT INTO siparis_urunleri (siparis_id, urun_id, adet, tutar) VALUES (?,?,1,0)",
                [siparis_id, k.odul_urun_id]
              );
              campaignApplied = true;
            } else if (k.tur === "yuzde_indirim") {
              const [[sumRow]] = await conn.query(
                "SELECT IFNULL(SUM(tutar),0) AS ara FROM siparis_urunleri WHERE siparis_id = ?",
                [siparis_id]
              );
              const ara = Number(sumRow?.ara || 0);
              const ind = Math.max(0, (ara * Number(k.indirim_oran || 0)) / 100);
              if (ind > 0) {
                await conn.query(
                  "INSERT INTO siparis_kampanyalari (siparis_id, kampanya_id, indirim_tutar, aciklama) VALUES (?,?,?,?)",
                  [siparis_id, kampanya_id, ind, `Kampanya: %${k.indirim_oran} indirim`]
                );
                campaignApplied = true;
              }
            } else if (k.tur === "tutar_indirim") {
              const [[sumRow]] = await conn.query(
                "SELECT IFNULL(SUM(tutar),0) AS ara FROM siparis_urunleri WHERE siparis_id = ?",
                [siparis_id]
              );
              const ara = Number(sumRow?.ara || 0);
              const ind = Math.min(ara, Math.max(0, Number(k.indirim_tutar || 0)));
              if (ind > 0) {
                await conn.query(
                  "INSERT INTO siparis_kampanyalari (siparis_id, kampanya_id, indirim_tutar, aciklama) VALUES (?,?,?,?)",
                  [siparis_id, kampanya_id, ind, "Kampanya: tutar indirimi"]
                );
                campaignApplied = true;
              }
            }
          }
        }
      }

      // Sepet boşsa ve kampanya uygulanamadıysa iptal et
      if (isCartEmpty && !campaignApplied) {
        throw new Error("Sepet boş ve kampanya uygulanamadı");
      }

      // Toplamı güncelle
      await conn.query("CALL sp_siparis_toplam_guncelle(?)", [siparis_id]);

      // Yanıt
      const [[sip]] = await conn.query(
        "SELECT siparis_id, masa_id, durum, tarih, toplam_tutar FROM siparisler WHERE siparis_id = ?",
        [siparis_id]
      );

      await conn.commit();
      res.status(201).json({ message: "Sipariş oluşturuldu", siparis: { ...sip, toplam_tutar:Number(sip.toplam_tutar||0) } });
    } catch (txErr) {
      await conn.rollback();
      throw txErr;
    } finally {
      conn.release();
    }
  } catch (e) {
    next(e);
  }
});

// ---- SİPARİŞLERİ LİSTELE (Admin) ----
// /api/siparisler?durum=Hazır&sayfa=1&limit=20
app.get("/api/siparisler", async (req, res, next) => {
  try {
    const durum = req.query.durum;
    const sayfa = Math.max(parseInt(req.query.sayfa || "1", 10), 1);
    const limit = Math.max(parseInt(req.query.limit || "50", 10), 1);
    const offset = (sayfa - 1) * limit;

    const params = [];
    let where = "";
    if (durum) {
      assert(ALLOWED_DURUM.has(durum), "Geçersiz durum filtresi");
      where = "WHERE s.durum = ?";
      params.push(durum);
    }

    const [rows] = await pool.query(
      `
      SELECT 
        s.siparis_id, s.masa_id, m.masa_no, s.durum, s.tarih, s.toplam_tutar
      FROM siparisler s
      JOIN masalar m ON m.masa_id = s.masa_id
      ${where}
      ORDER BY s.tarih DESC
      LIMIT ? OFFSET ?
      `,
      [...params, limit, offset]
    );

    // Her siparişin kalemlerini getir
    const siparisIds = rows.map(r => r.siparis_id);
    let kalemMap = {};
    if (siparisIds.length > 0) {
      const ph = siparisIds.map(() => "?").join(",");
      const [kalemler] = await pool.query(
        `
        SELECT su.siparis_id, su.adet, su.tutar, u.urun_adi
        FROM siparis_urunleri su
        JOIN urunler u ON u.urun_id = su.urun_id
        WHERE su.siparis_id IN (${ph})
        ORDER BY su.id
        `,
        siparisIds
      );
      kalemMap = kalemler.reduce((acc, k) => {
        acc[k.siparis_id] = acc[k.siparis_id] || [];
        acc[k.siparis_id].push({
          urun_adi: k.urun_adi,
          adet: k.adet,
          tutar: Number(k.tutar || 0),
        });
        return acc;
      }, {});
    }

    const data = rows.map(r => ({
      ...r,
      toplam_tutar: Number(r.toplam_tutar || 0),
      kalemler: kalemMap[r.siparis_id] || [],
    }));

    res.json({
      sayfa,
      limit,
      adet: data.length,
      data,
    });
  } catch (e) {
    next(e);
  }
});

// === PATRON ANALİZLERİ ===

// Genel özet (bugün + tüm zaman)
app.get("/api/analiz/ozet", async (req, res, next) => {
  try {
    const [[genel]] = await pool.query(`
      SELECT 
        COUNT(*)                   AS toplam_siparis,
        COALESCE(SUM(toplam_tutar), 0) AS toplam_ciro,
        COALESCE(AVG(toplam_tutar), 0) AS ortalama_tutar
      FROM siparisler
    `);

    const [[bugun]] = await pool.query(`
      SELECT 
        COUNT(*)                   AS bugun_siparis,
        COALESCE(SUM(toplam_tutar), 0) AS bugun_ciro
      FROM siparisler
      WHERE DATE(tarih) = CURDATE()
    `);

    const [[durumlar]] = await pool.query(`
      SELECT
        COALESCE(SUM(durum NOT IN ('Teslim Edildi','İptal')), 0) AS aktif_siparis,
        COALESCE(SUM(durum = 'Teslim Edildi'), 0)                AS teslim_sayisi,
        COALESCE(SUM(durum = 'İptal'), 0)                        AS iptal_sayisi
      FROM siparisler
    `);

    res.json({
      toplam_siparis: Number(genel?.toplam_siparis || 0),
      toplam_ciro: Number(genel?.toplam_ciro || 0),
      ortalama_tutar: Number(genel?.ortalama_tutar || 0),
      bugun_siparis: Number(bugun?.bugun_siparis || 0),
      bugun_ciro: Number(bugun?.bugun_ciro || 0),
      aktif_siparis: Number(durumlar?.aktif_siparis || 0),
      teslim_sayisi: Number(durumlar?.teslim_sayisi || 0),
      iptal_sayisi: Number(durumlar?.iptal_sayisi || 0),
    });
  } catch (e) {
    next(e);
  }
});

// Günlük satış özeti (son N gün, default 7)
app.get("/api/analiz/gunluk", async (req, res, next) => {
  try {
    const days = Math.min(
      Math.max(parseInt(req.query.days || "7", 10), 1),
      60
    );

    const [rows] = await pool.query(
      `
      SELECT 
        DATE(tarih)                       AS tarih,
        COUNT(*)                          AS siparis_sayisi,
        COALESCE(SUM(toplam_tutar), 0)    AS toplam_tutar
      FROM siparisler
      GROUP BY DATE(tarih)
      ORDER BY tarih DESC
      LIMIT ?
      `,
      [days]
    );

    res.json(
      rows
        .reverse()
        .map((r) => ({
          tarih: r.tarih,
          siparis_sayisi: Number(r.siparis_sayisi || 0),
          toplam_tutar: Number(r.toplam_tutar || 0),
        }))
    );
  } catch (e) {
    next(e);
  }
});

// Kategori bazlı ciro
app.get("/api/analiz/kategori", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        k.kategori_adi,
        COALESCE(SUM(su.adet), 0)  AS toplam_adet,
        COALESCE(SUM(su.tutar), 0) AS toplam_ciro
      FROM siparis_urunleri su
      JOIN urunler u    ON u.urun_id = su.urun_id
      JOIN kategoriler k ON k.kategori_id = u.kategori_id
      GROUP BY k.kategori_id
      ORDER BY toplam_ciro DESC
    `);

    res.json(
      rows.map((r) => ({
        kategori_adi: r.kategori_adi,
        toplam_adet: Number(r.toplam_adet || 0),
        toplam_ciro: Number(r.toplam_ciro || 0),
      }))
    );
  } catch (e) {
    next(e);
  }
});

// En çok satan ürünler (adet ve ciro)
app.get("/api/analiz/en-cok-satan", async (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      50
    );

    const [rows] = await pool.query(
      `
      SELECT 
        u.urun_adi,
        COALESCE(SUM(su.adet), 0)  AS satis_sayisi,
        COALESCE(SUM(su.tutar), 0) AS toplam_tutar
      FROM siparis_urunleri su
      JOIN urunler u ON u.urun_id = su.urun_id
      GROUP BY su.urun_id
      ORDER BY satis_sayisi DESC
      LIMIT ?
      `,
      [limit]
    );

    res.json(
      rows.map((r) => ({
        urun_adi: r.urun_adi,
        satis_sayisi: Number(r.satis_sayisi || 0),
        toplam_tutar: Number(r.toplam_tutar || 0),
      }))
    );
  } catch (e) {
    next(e);
  }
});

// En çok sipariş veren müşteriler
app.get("/api/analiz/en-cok-musteri", async (req, res, next) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "10", 10), 1),
      50
    );

    const [rows] = await pool.query(
      `
      SELECT 
        m.ad_soyad,
        COUNT(s.siparis_id)              AS siparis_sayisi,
        COALESCE(SUM(s.toplam_tutar), 0) AS toplam_tutar
      FROM musteriler m
      JOIN musteri_siparisleri ms ON m.musteri_id = ms.musteri_id
      JOIN siparisler s          ON ms.siparis_id = s.siparis_id
      GROUP BY m.musteri_id
      ORDER BY siparis_sayisi DESC
      LIMIT ?
      `,
      [limit]
    );

    res.json(
      rows.map((r) => ({
        ad_soyad: r.ad_soyad,
        siparis_sayisi: Number(r.siparis_sayisi || 0),
        toplam_tutar: Number(r.toplam_tutar || 0),
      }))
    );
  } catch (e) {
    next(e);
  }
});

// Saat bazlı sipariş dağılımı (bugün)
app.get("/api/analiz/saatlik", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        HOUR(tarih)     AS saat,
        COUNT(*)        AS siparis_sayisi
      FROM siparisler
      WHERE DATE(tarih) = CURDATE()
      GROUP BY HOUR(tarih)
      ORDER BY saat ASC
    `);

    res.json(
      rows.map((r) => ({
        saat: Number(r.saat || 0),
        siparis_sayisi: Number(r.siparis_sayisi || 0),
      }))
    );
  } catch (e) {
    next(e);
  }
});

// 🗃️ Gün Sonu Arşivleme
app.post("/api/arsivle", async (req, res, next) => {
  try {
    const [siparisler] = await pool.query(`
      SELECT s.siparis_id, m.masa_no, s.toplam_tutar
      FROM siparisler s
      JOIN masalar m ON m.masa_id = s.masa_id
      WHERE s.durum = 'Teslim Edildi'
    `);

    if (!siparisler.length) {
      return res
        .status(200)
        .json({ message: "Teslim edilmiş sipariş bulunamadı." });
    }

    for (const s of siparisler) {
      await pool.query(
        "INSERT INTO arsiv (siparis_id, masa_no, toplam_tutar) VALUES (?, ?, ?)",
        [s.siparis_id, s.masa_no, s.toplam_tutar]
      );
    }

    res.json({ message: `${siparisler.length} sipariş arşivlendi.` });
  } catch (err) {
    next(err);
  }
});

// 🧹 Sipariş Temizleme (Teslim Edildi veya İptal)
app.delete("/api/siparisler/temizle", async (req, res, next) => {
  try {
    const [result] = await pool.query(`
      DELETE FROM siparisler WHERE durum IN ('Teslim Edildi', 'İptal')
    `);

    res.json({
      message: `${result.affectedRows} sipariş temizlendi.`,
    });
  } catch (err) {
    next(err);
  }
});

// ---- SİPARİŞ DURUMU GÜNCELLE ----
// Body: { "durum": "Hazır" }
app.put("/api/siparis/:id/durum", async (req, res, next) => {
  const siparis_id = parseInt(req.params.id, 10);
  const { durum } = req.body;
  try {
    assert(Number.isInteger(siparis_id) && siparis_id > 0, "Geçersiz siparis_id");
    assert(typeof durum === "string" && ALLOWED_DURUM.has(durum), "Geçersiz durum");

    const [result] = await pool.execute(
      "UPDATE siparisler SET durum = ? WHERE siparis_id = ?",
      [durum, siparis_id]
    );
    assert(result.affectedRows === 1, "Sipariş bulunamadı", 404);

    const [[row]] = await pool.query(
      "SELECT siparis_id, masa_id, durum, tarih, toplam_tutar FROM siparisler WHERE siparis_id = ?",
      [siparis_id]
    );

    res.json({
      message: "Durum güncellendi",
      siparis: {
        ...row,
        toplam_tutar: Number(row.toplam_tutar || 0),
      },
    });
  } catch (e) {
    next(e);
  }
});

// === 🗃️ Gün Sonu Arşivleme (örnek) ===
app.post("/api/arsivle", async (req, res, next) => {
  try {
    const [siparisler] = await pool.query(`
      SELECT s.siparis_id, m.masa_no, s.toplam_tutar
      FROM siparisler s
      JOIN masalar m ON m.masa_id = s.masa_id
      WHERE s.durum = 'Teslim Edildi'
    `);

    if (!siparisler.length) {
      return res.status(200).json({ message: "Bugün teslim edilmiş sipariş yok." });
    }

    for (const s of siparisler) {
      await pool.query(
        "INSERT INTO arsiv (siparis_id, masa_no, toplam_tutar) VALUES (?, ?, ?)",
        [s.siparis_id, s.masa_no, s.toplam_tutar]
      );
    }

    res.json({ message: `${siparisler.length} sipariş arşivlendi.` });
  } catch (err) {
    next(err);
  }
});

// === 🧹 Sipariş Temizleme (Teslim Edildi veya İptal) ===
app.delete("/api/siparisler/temizle", async (req, res, next) => {
  try {
    const [result] = await pool.query(`
      DELETE FROM siparisler WHERE durum IN ('Teslim Edildi', 'İptal')
    `);

    res.json({
      message: `${result.affectedRows} sipariş temizlendi.`,
    });
  } catch (err) {
    next(err);
  }
});

// ---- Hata Orta Katmanı ----
app.use((err, _req, res, _next) => {
  const status = err.status || 500;
  res.status(status).json({
    ok: false,
    error: err.message || "Bilinmeyen hata",
  });
});

// Statik dosyalar
app.use(express.static(path.join(__dirname, "public")));

// ---- Sunucu ----
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ Sunucu çalışıyor: http://localhost:${PORT}`);
});
