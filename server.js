// server.js  — QR Sipariş Sistemi (Express + mysql2/promise)
// CommonJS kullanıyoruz; package.json'a "type": "module" EKLEME!
// Çalıştırmadan önce .env dosyanı oluştur (aşağıda örnek var).
require('dotenv').config();
console.log({
  DB_HOST: process.env.DB_HOST,
  DB_USER: process.env.DB_USER,
  DB_PASS: process.env.DB_PASS,
  DB_NAME: process.env.DB_NAME,
});

const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const mysql = require("mysql2/promise");
const dotenv = require("dotenv");
const bcrypt = require("bcrypt");
const session = require("express-session");
const path = require("path");
const fs = require("fs");
const PDFDocument = require("pdfkit");
dotenv.config();
if (!process.env.SESSION_SECRET || !process.env.DB_PASS) {
  throw new Error("Configure SESSION_SECRET and DB_PASS in .env before starting.");
}
const app = express(); // 1. Uygulamayı başlat

// 2. Gerekli Ayarlar (Middleware)
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// 3. Oturum (Session) Ayarı (Giriş işlemleri için şart)
app.use(session({
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { secure: false } // Localhostta false olmalı
}));

// ---- MySQL Pool ----
const pool = mysql.createPool({
  host: process.env.DB_HOST || "localhost",
  user: process.env.DB_USER || "qr_user",
  password: process.env.DB_PASS,
  database: process.env.DB_NAME || "qr_siparis",
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: "+03:00", // MySQL tarih-timestamp tutarlılığı
});
pool.on('connection', function (connection) {
  connection.query('SET time_zone="+03:00";');
});
// Database self-healing for base64 storage support and original image support
pool.query("ALTER TABLE urunler MODIFY COLUMN resim_url LONGTEXT").catch(err => {
  console.error("resim_url migration failed:", err);
});
pool.query("ALTER TABLE urunler ADD COLUMN resim_original LONGTEXT NULL").catch(() => {});
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
// ---- MENÜ: SQL'den okur (aktif ve tükendi=0 ürünler) ----
app.get("/api/menu", async (_req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        k.kategori_id,  -- <--- BUNU EKLEDİK
        k.kategori_adi,
        u.urun_id,
        u.urun_adi,
        u.aciklama,
        u.fiyat,
        u.resim_url,
        u.puan_degeri
      FROM urunler u
      JOIN kategoriler k ON k.kategori_id = u.kategori_id
      WHERE u.aktif = 1 AND u.tukendi = 0
      ORDER BY k.kategori_adi, u.urun_adi
    `);
    const grouped = rows.reduce((acc, r) => {
      (acc[r.kategori_adi] ||= []).push({
        urun_id: r.urun_id,
        kategori_id: r.kategori_id, // <--- ARTIK FRONTEND BUNU BİLECEK
        urun_adi: r.urun_adi,
        aciklama: r.aciklama,
        fiyat: Number(r.fiyat),
        resim_url: r.resim_url,
        puan_degeri: Number(r.puan_degeri || 1)
      });
      return acc;
    }, {});
    res.json(grouped);
  } catch (e) {
    next(e);
  }
});

// ==========================================
// SAAS: ÜRÜN DETAYI (Varyasyon ve Ekstralar)
// ==========================================
app.get("/api/urun-detay/:urun_id", async (req, res, next) => {
  try {
    const urun_id = Number(req.params.urun_id);
    if (!urun_id) return res.status(400).json({ error: "Geçersiz Ürün ID" });

    // 1. Ürün temel bilgisi
    const [[urun]] = await pool.query("SELECT * FROM urunler WHERE urun_id = ?", [urun_id]);
    if (!urun) return res.status(404).json({ error: "Ürün bulunamadı." });

    // 2. Varyasyonlar (Boyut vs.)
    const [varyasyonlar] = await pool.query("SELECT varyasyon_id as id, ad, fiyat_farki FROM urun_varyasyonlari WHERE urun_id = ?", [urun_id]);

    // 3. Ekstralar
    const [ekstralar] = await pool.query("SELECT ekstra_id as id, ad, fiyat_farki, tip FROM urun_ekstralari WHERE urun_id = ?", [urun_id]);

    res.json({
      ...urun,
      fiyat: Number(urun.fiyat),
      varyasyonlar: varyasyonlar.map(v => ({...v, fiyat_farki: Number(v.fiyat_farki)})),
      ekstralar: ekstralar.map(e => ({...e, fiyat_farki: Number(e.fiyat_farki)}))
    });
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
// === MÜŞTERİ KAYIT (TELEFON ZORUNLU) ===
app.post("/api/register", async (req, res, next) => {
  const { ad_soyad, email, telefon, sifre } = req.body;
  try {
    // 1. Validasyon: Telefonu da kontrol listesine ekledik
    assert(ad_soyad && email && sifre && telefon, "Ad Soyad, E-posta, Şifre ve Telefon zorunludur.");
    
    const hash = await bcrypt.hash(sifre, 10);

    // 2. Kayıt: Telefon verisini doğrudan kaydediyoruz (artık null kontrolüne gerek yok)
    const [result] = await pool.query(
      "INSERT INTO musteriler (ad_soyad, email, telefon, sifre_hash) VALUES (?, ?, ?, ?)",
      [ad_soyad, email, telefon, hash]
    );

    res.status(201).json({ message: "Kayıt başarılı", id: result.insertId });
  } catch (e) {
    if (e.code === "ER_DUP_ENTRY") e.message = "Bu e-posta veya telefon zaten kayıtlı";
    next(e);
  }
});
// POST /api/login gibi yerlerin üstüne ekleyin

app.get("/qr/:masa_id", async (req, res, next) => {
  const masa_id = parseInt(req.params.masa_id, 10);
  if (!masa_id) return res.status(400).send("Geçersiz Masa ID");
  
  // Direkt start sayfasına at, token yok.
  res.redirect(`/start.html?masa=${masa_id}`);
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

// =================================================
// 🛡️ PERSONEL (ADMİN/GARSON) GİRİŞ API'LARI
// =================================================

// 1. Personel Girişi
app.post("/api/staff/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    // Kullanıcılar tablosundan bak (Müşterilerden değil)
    const [rows] = await pool.query("SELECT * FROM kullanicilar WHERE kullanici_adi = ?", [username]);

    if (rows.length === 0) return res.status(401).json({ error: "Kullanıcı bulunamadı" });

    const user = rows[0];
    if (user.sifre_hash !== password) return res.status(401).json({ error: "Hatalı şifre" });

    // Session'a kaydet
    req.session.staff = {
      id: user.id,
      username: user.kullanici_adi,
      role: user.rol // 'admin' veya 'garson'
    };
    
    req.session.save(); // Garantilemek için
    res.json({ success: true, role: user.rol });

  } catch (err) {
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 2. Yetki Kontrolü
app.get("/api/staff/check", (req, res) => {
  if (req.session && req.session.staff) {
    res.json({ logged: true, user: req.session.staff });
  } else {
    res.status(401).json({ logged: false });
  }
});

// 3. Çıkış
app.post("/api/staff/logout", (req, res) => {
  if (req.session && req.session.staff) delete req.session.staff;
  res.json({ success: true });
});



// ==========================================
// 🧭 YÖNETİCİ PANELİ (MENÜ, KAMPANYA, MÜŞTERİ)
// ==========================================

// 🔹 TÜM ÜRÜNLERİ GETİR (Menü tablosu ve ödül dropdown için)
// 🔹 TÜM ÜRÜNLERİ GETİR (Menü tablosu ve ödül dropdown için)
// 🔹 TÜM ÜRÜNLERİ GETİR (Menü tablosu ve ödül dropdown için)
app.get("/api/admin/menu", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        u.urun_id,
        u.urun_adi,
        u.fiyat,
        u.maliyet, 
        u.kdv,
        u.puan_degeri,
        u.tukendi,
        u.aktif,
        u.resim_url,
        u.resim_original,
        k.kategori_adi
      FROM urunler u
      JOIN kategoriler k ON k.kategori_id = u.kategori_id
      ORDER BY k.kategori_adi, u.urun_adi
    `);
    res.json(
      rows.map(r => ({
        ...r,
        fiyat: Number(r.fiyat || 0),
        maliyet: Number(r.maliyet || 0), 
        kdv:   Number(r.kdv   || 0),
        puan_degeri: Number(r.puan_degeri || 1) // Frontend'e gönderiyoruz
      }))
    );

  } catch (err) {
    console.error("Menü getirme hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});
// 🔹 TÜM MÜŞTERİLERİ GETİR (CRM İÇİN)
app.get("/api/admin/musteriler", async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        musteri_id,
        ad_soyad,
        email,
        telefon,
        puan,
        kayit_tarih
      FROM musteriler
      ORDER BY kayit_tarih DESC
    `);
    res.json(rows);
  } catch (err) {
    console.error("Müşteri listesi hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 MÜŞTERİ PUAN GEÇMİŞİ VE SİPARİŞ DETAYLARI
app.get("/api/admin/musteri/:id/puan-gecmisi", async (req, res) => {
  const musteri_id = parseInt(req.params.id, 10);
  try {
    const [rows] = await pool.query(`
      SELECT 
        s.siparis_id,
        s.tarih,
        s.durum,
        s.toplam_tutar,
        (
          SELECT COALESCE(SUM(su.adet * u.puan_degeri), 0)
          FROM siparis_urunleri su
          JOIN urunler u ON u.urun_id = su.urun_id
          WHERE su.siparis_id = s.siparis_id AND su.tutar > 0
        ) AS kazanilan_puan,
        (
          SELECT COALESCE(SUM(k.gerekli_puan), 0)
          FROM siparis_kampanyalari sk
          JOIN kampanyalar k ON k.kampanya_id = sk.kampanya_id
          WHERE sk.siparis_id = s.siparis_id
        ) AS harcanan_puan,
        (
          SELECT GROUP_CONCAT(k.ad SEPARATOR ', ')
          FROM siparis_kampanyalari sk
          JOIN kampanyalar k ON k.kampanya_id = sk.kampanya_id
          WHERE sk.siparis_id = s.siparis_id
        ) AS kullanilan_kampanyalar,
        (
          SELECT GROUP_CONCAT(CONCAT(su.adet, 'x ', u.urun_adi) SEPARATOR ', ')
          FROM siparis_urunleri su
          JOIN urunler u ON u.urun_id = su.urun_id
          WHERE su.siparis_id = s.siparis_id
        ) AS urunler
      FROM siparisler s
      WHERE s.musteri_id = ?
      ORDER BY s.tarih DESC
    `, [musteri_id]);
    
    res.json(rows);
  } catch (err) {
    console.error("Puan geçmişi hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  }
});

// 🔹 MÜŞTERİ PUANINI MANUEL GÜNCELLE
app.post("/api/admin/musteri/:id/puan-guncelle", async (req, res) => {
  const musteri_id = parseInt(req.params.id, 10);
  const { yeni_puan } = req.body;
  try {
    await pool.execute(
      "UPDATE musteriler SET puan = ? WHERE musteri_id = ?",
      [Number(yeni_puan) || 0, musteri_id]
    );
    res.json({ success: true, message: "Müşteri puanı başarıyla güncellendi." });
  } catch (err) {
    console.error("Puan güncelleme hatası:", err);
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
// YENİ ÜRÜN EKLE (Puan Değeri Destekli)
// 🔹 YENİ ÜRÜN EKLE (Puan Değeri Destekli)
app.post("/api/admin/menu/ekle", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { kategori_id, urun_adi, resim_url, resim_original, fiyat, maliyet, kdv, puan_degeri, varyasyonlar, ekstralar } = req.body;
    
    if (!kategori_id || !urun_adi)
      return res.status(400).json({ error: "Eksik bilgi" });

    await conn.beginTransaction();

    const [insRes] = await conn.query(
      `INSERT INTO urunler (kategori_id, urun_adi, resim_url, resim_original, fiyat, maliyet, kdv, puan_degeri, aktif, tukendi) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`,
      [
        kategori_id, 
        urun_adi, 
        resim_url || null,
        resim_original || resim_url || null,
        Number(fiyat) || 0, 
        Number(maliyet) || 0,
        Number(kdv) || 0, 
        Number(puan_degeri) || 1
      ]
    );
    const urun_id = insRes.insertId;

    if (varyasyonlar && Array.isArray(varyasyonlar)) {
      for (const v of varyasyonlar) {
        await conn.query("INSERT INTO urun_varyasyonlari (urun_id, ad, fiyat_farki) VALUES (?, ?, ?)",
          [urun_id, v.ad, Number(v.fiyat_farki) || 0]);
      }
    }

    if (ekstralar && Array.isArray(ekstralar)) {
      for (const e of ekstralar) {
        await conn.query("INSERT INTO urun_ekstralari (urun_id, ad, fiyat_farki, tip) VALUES (?, ?, ?, ?)",
          [urun_id, e.ad, Number(e.fiyat_farki) || 0, e.tip || 'ekstra']);
      }
    }

    await conn.commit();
    res.json({ success: true, message: "Ürün başarıyla eklendi." });
  } catch (err) {
    await conn.rollback();
    console.error("Ürün ekleme hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  } finally {
    conn.release();
  }
});

// 🔹 ÜRÜN DÜZENLE (Görsel, Ad, Varyasyonlar, Ekstralar)
app.post("/api/admin/menu/duzenle", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { urun_id, urun_adi, resim_url, resim_original, varyasyonlar, ekstralar } = req.body;
    
    if (!urun_id || !urun_adi)
      return res.status(400).json({ error: "Eksik parametre" });

    await conn.beginTransaction();

    if (resim_url !== undefined) {
      await conn.query(
        "UPDATE urunler SET urun_adi = ?, resim_url = ?, resim_original = ? WHERE urun_id = ?",
        [urun_adi, resim_url || null, resim_original || resim_url || null, urun_id]
      );
    } else {
      await conn.query(
        "UPDATE urunler SET urun_adi = ? WHERE urun_id = ?",
        [urun_adi, urun_id]
      );
    }

    // Mevcut varyasyon ve ekstraları temizle
    await conn.query("DELETE FROM urun_varyasyonlari WHERE urun_id = ?", [urun_id]);
    await conn.query("DELETE FROM urun_ekstralari WHERE urun_id = ?", [urun_id]);

    // Yenilerini ekle
    if (varyasyonlar && Array.isArray(varyasyonlar)) {
      for (const v of varyasyonlar) {
        await conn.query("INSERT INTO urun_varyasyonlari (urun_id, ad, fiyat_farki) VALUES (?, ?, ?)",
          [urun_id, v.ad, Number(v.fiyat_farki) || 0]);
      }
    }

    if (ekstralar && Array.isArray(ekstralar)) {
      for (const e of ekstralar) {
        await conn.query("INSERT INTO urun_ekstralari (urun_id, ad, fiyat_farki, tip) VALUES (?, ?, ?, ?)",
          [urun_id, e.ad, Number(e.fiyat_farki) || 0, e.tip || 'ekstra']);
      }
    }

    await conn.commit();
    res.json({ success: true, message: "Ürün detayları güncellendi." });
  } catch (err) {
    await conn.rollback();
    console.error("Ürün düzenleme hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  } finally {
    conn.release();
  }
});
// 🔹 FİYAT GÜNCELLE
// FİYAT, KDV ve PUAN GÜNCELLEME
// 🔹 FİYAT, KDV ve PUAN GÜNCELLEME
app.post("/api/admin/menu/fiyat", async (req, res) => {
  const conn = await pool.getConnection();
  try {
    const { urun_id, fiyat, maliyet, kdv, puan_degeri, varyasyonlar, ekstralar } = req.body;
    
    if (!urun_id || fiyat == null)
      return res.status(400).json({ error: "Eksik parametre" });

    await conn.beginTransaction();

    await conn.query(
      "UPDATE urunler SET fiyat = ?, maliyet = ?, kdv = ?, puan_degeri = ? WHERE urun_id = ?",
      [
        Number(fiyat), 
        Number(maliyet) || 0, 
        Number(kdv) || 0, 
        Number(puan_degeri) || 1, 
        urun_id
      ]
    );

    // Mevcut varyasyon ve ekstraları temizle
    await conn.query("DELETE FROM urun_varyasyonlari WHERE urun_id = ?", [urun_id]);
    await conn.query("DELETE FROM urun_ekstralari WHERE urun_id = ?", [urun_id]);

    // Yenilerini ekle
    if (varyasyonlar && Array.isArray(varyasyonlar)) {
      for (const v of varyasyonlar) {
        await conn.query("INSERT INTO urun_varyasyonlari (urun_id, ad, fiyat_farki) VALUES (?, ?, ?)",
          [urun_id, v.ad, Number(v.fiyat_farki) || 0]);
      }
    }

    if (ekstralar && Array.isArray(ekstralar)) {
      for (const e of ekstralar) {
        await conn.query("INSERT INTO urun_ekstralari (urun_id, ad, fiyat_farki, tip) VALUES (?, ?, ?, ?)",
          [urun_id, e.ad, Number(e.fiyat_farki) || 0, e.tip || 'ekstra']);
      }
    }

    await conn.commit();
    res.json({ success: true, message: "Ürün güncellendi." });
  } catch (err) {
    await conn.rollback();
    console.error("Güncelleme hatası:", err);
    res.status(500).json({ error: "Sunucu hatası" });
  } finally {
    conn.release();
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

// 🔹 KAMPANYALARI VE KOŞULLARINI GETİR (Hem Müşteri Hem Admin için)
// server.js içinde mevcut "/api/kampanyalarim" endpoint'ini bul ve tamamen bununla değiştir:

// MEVCUT "/api/kampanyalarim" KODUNU TAMAMEN SİL VE BUNU YAPIŞTIR:

app.get("/api/kampanyalarim", async (req, res) => {
  try {
    let puan = 0;
    let logged = false;

    // 1. Kullanıcı Puanı
    if (req.session?.user?.id) {
      logged = true;
      const [[mu]] = await pool.query(
        "SELECT puan FROM musteriler WHERE musteri_id = ?",
        [req.session.user.id]
      );
      puan = Number(mu?.puan || 0);
    }

    // 2. Kampanyaları Çek
    const [rows] = await pool.query(`
      SELECT k.*
      FROM kampanyalar k
      WHERE k.aktif = 1
      ORDER BY k.gerekli_puan ASC, k.olusturma_tarih DESC
    `);
    // 3. Koşulları Çek
    const [conditions] = await pool.query(`
      SELECT 
        kk.*, 
        k.kategori_adi, 
        u.urun_adi,
        kg.grup_adi  -- <--- EKLENDİ
      FROM kampanya_kosullari kk
      LEFT JOIN kategoriler k ON kk.tip = 'kategori' AND kk.hedef_id = k.kategori_id
      LEFT JOIN urunler u ON kk.tip = 'urun' AND kk.hedef_id = u.urun_id
      LEFT JOIN kategori_gruplari kg ON kk.tip = 'grup' AND kk.hedef_id = kg.grup_id -- <--- EKLENDİ
    `);

    // 4. Ödülleri Çek
    const [rewards] = await pool.query(`
      SELECT ko.*, k.kategori_adi, u.urun_adi 
      FROM kampanya_odulleri ko
      LEFT JOIN kategoriler k ON ko.tip = 'kategori' AND ko.hedef_id = k.kategori_id
      LEFT JOIN urunler u ON ko.tip = 'urun' AND ko.hedef_id = u.urun_id
    `);

    // 5. Verileri Birleştir (İŞTE EKSİK OLAN KISIM BURASIYDI)
    // 5. Verileri Birleştir (Burada küçük bir isim ataması yapacağız)
    const out = rows.map(r => {
      // ... (hak hesaplama kısmı aynı) ...
      const g_puan = Number(r.gerekli_puan || 0);
      let hak = 0;
      if (g_puan > 0) {
        hak = logged ? Math.floor(puan / Math.max(1, g_puan)) : 0;
      } else {
        hak = 999; 
      }

      // Koşul İsimlerini Düzenle
      const myConditions = conditions
        .filter(c => c.kampanya_id === r.kampanya_id)
        .map(c => {
            // Frontend'de hangi isim varsa onu 'kategori_adi' gibi bir alana atayalım ki
            // yonetici.js'de tekrar kod yazmayalım.
            // yonetici.js'de şu an: let h = c.tip === 'kategori' ? c.kategori_adi : c.urun_adi;
            // Oraya 'grup_adi'nı da eklemek yerine backend'den dolu gönderelim:
            
            if(c.tip === 'grup') c.kategori_adi = c.grup_adi; // Hile: Frontend kategori_adi alanına bakıyorsa oraya yaz
            return c;
        });

      // Ödül İsimlerini Düzenle
      const myRewards = rewards
        .filter(rew => rew.kampanya_id === r.kampanya_id)
        .map(o => {
            if(o.tip === 'grup') o.kategori_adi = o.grup_adi;
            return o;
        });

      return {
        kampanya_id: r.kampanya_id,
        ad: r.ad,
        tur: r.tur,
        gerekli_puan: g_puan,
        uyelere_ozel: r.uyelere_ozel || 0,
        secim_sayisi: r.secim_sayisi || 0,
        hak_sayisi: hak,
        kosullar: myConditions,
        oduller: myRewards
      }
    });

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

// server.js içinde mevcut "/api/admin/kampanya/ekle" endpoint'ini bul ve bununla değiştir:

// KAMPANYA EKLEME (DÜZELTİLMİŞ VERSİYON)
app.post("/api/admin/kampanya/ekle", async (req, res) => {
  // uyelere_ozel eklendi
  const { ad, gerekli_puan, kosullar, oduller, uyelere_ozel } = req.body;

  const secimSayisi = 0; // Havuz sistemi kaldırıldığı için 0 olarak sabitlendi
  const isUyeOzel = uyelere_ozel ? 1 : 0; // Checkbox true/false gelir, 1/0 yaparız

  if (!ad || !oduller || oduller.length === 0) {
    return res.status(400).json({ error: "Kampanya adı ve en az 1 ödül gerekli." });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // INSERT sorgusuna uyelere_ozel eklendi
    const [insRes] = await conn.query(
      "INSERT INTO kampanyalar (ad, gerekli_puan, tur, aktif, secim_sayisi, uyelere_ozel) VALUES (?, ?, 'gelismis', 1, ?, ?)",
      [ad, Number(gerekli_puan) || 0, secimSayisi, isUyeOzel]
    );
    const kampanyaId = insRes.insertId;

    // 2. Koşulları Kaydet
    if (kosullar && Array.isArray(kosullar)) {
      for (const k of kosullar) {
        await conn.query(
          "INSERT INTO kampanya_kosullari (kampanya_id, tip, hedef_id, miktar) VALUES (?, ?, ?, ?)",
          [kampanyaId, k.tip, k.hedef_id || null, Number(k.miktar) || 1]
        );
      }
    }

    // 3. Ödülleri Kaydet
    if (oduller && Array.isArray(oduller)) {
      for (const o of oduller) {
        await conn.query(
          "INSERT INTO kampanya_odulleri (kampanya_id, tip, hedef_id, adet, indirim_oran) VALUES (?, ?, ?, ?, ?)",
          [
            kampanyaId, 
            o.tip, 
            o.hedef_id, 
            Number(o.adet) || 1, 
            Number(o.indirim_oran) || 100
          ]
        );
      }
    }

    // Onayla
    await conn.commit();
    res.json({ success: true, message: "Kampanya başarıyla oluşturuldu.", id: kampanyaId });

  } catch (err) {
    await conn.rollback();
    console.error("Kampanya Ekleme Hatası:", err);
    res.status(500).json({ error: "Kampanya kaydedilirken hata oluştu: " + err.message });
  } finally {
    conn.release();
  }
});


// ===============================================
// 📦 KATEGORİ GRUPLARI (SANAL VIEW SİSTEMİ)
// ===============================================

// 1. Grupleri Getir
app.get("/api/admin/gruplar", async (req, res) => {
  try {
    const [rows] = await pool.query("SELECT * FROM kategori_gruplari ORDER BY grup_adi");
    res.json(rows);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// 2. Yeni Grup Oluştur (İçindeki kategorilerle birlikte)
app.post("/api/admin/grup/ekle", async (req, res) => {
  const { grup_adi, kategori_ids, urun_ids } = req.body; 

  if(!grup_adi) return res.status(400).json({ error: "Grup adı zorunlu" });
  if((!kategori_ids || kategori_ids.length === 0) && (!urun_ids || urun_ids.length === 0)) 
    return res.status(400).json({ error: "En az 1 kategori veya ürün seçilmeli" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    
    // Grubu oluştur
    const [resGrup] = await conn.query("INSERT INTO kategori_gruplari (grup_adi) VALUES (?)", [grup_adi]);
    const grupId = resGrup.insertId;

    // Kategorileri ekle
    if (kategori_ids && kategori_ids.length > 0) {
      for(const katId of kategori_ids) {
        await conn.query("INSERT INTO kategori_grup_detay (grup_id, kategori_id) VALUES (?, ?)", [grupId, katId]);
      }
    }

    // Ürünleri ekle (YENİ)
    if (urun_ids && urun_ids.length > 0) {
      for(const urunId of urun_ids) {
        await conn.query("INSERT INTO kategori_grup_detay (grup_id, urun_id) VALUES (?, ?)", [grupId, urunId]);
      }
    }

    await conn.commit();
    res.json({ success: true, message: "Grup oluşturuldu" });
  } catch(e) {
    await conn.rollback();
    res.status(500).json({ error: e.message });
  } finally {
    conn.release();
  }
});

// 3. Grubu Sil
app.delete("/api/admin/grup/:id", async (req, res) => {
  try {
    await pool.query("DELETE FROM kategori_gruplari WHERE grup_id = ?", [req.params.id]);
    res.json({ success: true });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// 4. (VIEW MANTIĞI) Bir Gruba Ait Tüm Ürünleri Getir
// Frontend'de kampanya seçimi yapıldığında bu endpoint çalışacak.
app.get("/api/grup-urunleri/:grup_id", async (req, res) => {
  try {
    const { grup_id } = req.params;
    
    const query = `
      SELECT DISTINCT u.urun_id, u.urun_adi, u.fiyat, u.resim_url, k.kategori_adi
      FROM urunler u
      JOIN kategoriler k ON k.kategori_id = u.kategori_id
      WHERE 
        /* 1. Kural: Gruba eklenmiş kategorilerdeki ürünler */
        u.kategori_id IN (SELECT kategori_id FROM kategori_grup_detay WHERE grup_id = ? AND kategori_id IS NOT NULL)
        
        OR 
        
        /* 2. Kural: Gruba doğrudan eklenmiş ürünler */
        u.urun_id IN (SELECT urun_id FROM kategori_grup_detay WHERE grup_id = ? AND urun_id IS NOT NULL)
      
      AND u.aktif = 1 AND u.tukendi = 0
      ORDER BY u.urun_adi
    `;
    
    const [rows] = await pool.query(query, [grup_id, grup_id]);
    res.json(rows);
  } catch(e) { res.status(500).json({ error: e.message }); }
});
// ---- SİPARİŞ OLUŞTUR (KAMPANYA DESTEKLİ) ----


// ================================================================
// SİPARİŞ OLUŞTUR (KAMPANYA KAYDI DÜZELTİLMİŞ VERSİYON)
// ================================================================
// ================================================================
// SİPARİŞ OLUŞTUR (KAMPANYA KAYDI DÜZELTİLMİŞ VERSİYON)
// ================================================================
app.post("/api/siparis", async (req, res, next) => {
  const { masa_id, items = [], siparis_notu } = req.body || {};
  
  // Basit validasyonlar
  if (!masa_id) return res.status(400).json({ error: "Masa ID eksik" });
  if (!items || items.length === 0) return res.status(400).json({ error: "Sepet boş" });

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // 1. SİPARİŞİ OLUŞTUR
    const trTime = new Date().toLocaleString("en-US", { timeZone: "Europe/Istanbul" });
    const localDate = new Date(trTime);

    const [orderRes] = await conn.execute(
      "INSERT INTO siparisler (masa_id, musteri_id, siparis_notu, tarih, durum, toplam_tutar) VALUES (?, ?, ?, ?, 'Hazırlanıyor', 0)",
      [masa_id, req.session?.user?.id || null, siparis_notu || null, localDate]
    );
    const siparis_id = orderRes.insertId;

    // 2. ÜRÜNLERİ İŞLE VE PUAN HESAPLA
    let toplamTutar = 0;
    let kazanilanPuan = 0; // <--- YENİ: Toplam kazanılacak puanı tutar
    const kullanilanKampanyalar = new Set();

    for (const item of items) {
      // Satır tutarını belirle
      const satirTutar = (item.tutar !== undefined && item.tutar !== null) 
        ? Number(item.tutar) 
        : (Number(item.fiyat) * Number(item.adet));

      // Ürünü Kaydet (Varyasyon ve Ekstralar ile)
      await conn.execute(
        "INSERT INTO siparis_urunleri (siparis_id, urun_id, adet, tutar, varyasyon_id, ekstra_not) VALUES (?, ?, ?, ?, ?, ?)",
        [siparis_id, item.urun_id, item.adet, satirTutar, item.varyasyon_id || null, item.ekstra_not || null]
      );

      toplamTutar += satirTutar;

      // Kampanya takibi
      if (item.kampanya_id) {
        kullanilanKampanyalar.add(item.kampanya_id);
      }

      // --- YENİ EKLENEN KISIM: ÜRÜN BAZLI PUAN HESAPLAMA ---
      // Sadece ücretli satılan ürünlerden puan kazanılır (Hediye ürün 0 TL ise puan vermez)
      if (satirTutar > 0) {
        // Ürünün veritabanındaki puan değerini çek
        const [uRows] = await conn.query("SELECT puan_degeri FROM urunler WHERE urun_id = ?", [item.urun_id]);
        if (uRows.length > 0) {
           const pDegeri = Number(uRows[0].puan_degeri || 1);
           // Adet * Puan Değeri kadar ekle
           kazanilanPuan += (pDegeri * Number(item.adet));
        }
      }
      // -----------------------------------------------------
    }

    // 3. KAMPANYA İLİŞKİLERİNİ KAYDET
    for (const kampId of kullanilanKampanyalar) {
      await conn.execute(
        "INSERT INTO siparis_kampanyalari (siparis_id, kampanya_id, indirim_tutar, aciklama) VALUES (?, ?, 0, 'Kampanyalı Sipariş')",
        [siparis_id, kampId]
      );
    }

    // 4. MÜŞTERİ İŞLEMLERİ (PUAN KAZANMA & HARCAMA)
    if (req.session?.user?.id) {
      
      // A) PUAN HARCAMA (Önceki cevaptaki düzeltme - Puanlı kampanya kullandıysa düş)
      for (const kampId of kullanilanKampanyalar) {
        const [campRows] = await conn.query("SELECT gerekli_puan FROM kampanyalar WHERE kampanya_id = ?", [kampId]);
        if (campRows.length > 0) {
          const gp = Number(campRows[0].gerekli_puan);
          if (gp > 0) {
             // Puan düşme işlemi
             await conn.query("UPDATE musteriler SET puan = puan - ? WHERE musteri_id = ?", [gp, req.session.user.id]);
          }
        }
      }

      // B) PUAN KAZANMA (DÜZELTİLEN KISIM: Sabit +1 yerine hesaplanan puanı ekle)
      if (kazanilanPuan > 0) {
        await conn.execute(
          "UPDATE musteriler SET puan = puan + ? WHERE musteri_id = ?", 
          [kazanilanPuan, req.session.user.id]
        );
      }

      // Sipariş geçmişine ekle
      await conn.execute(
        "INSERT IGNORE INTO musteri_siparisleri (musteri_id, siparis_id) VALUES (?, ?)",
        [req.session.user.id, siparis_id]
      );
    }

    // 5. TOPLAM TUTARI GÜNCELLE
    await conn.execute(
      "UPDATE siparisler SET toplam_tutar = ? WHERE siparis_id = ?",
      [toplamTutar, siparis_id]
    );

    await conn.commit();

    res.status(201).json({ 
      message: "Sipariş oluşturuldu", 
      siparis_id: siparis_id,
      toplam: toplamTutar,
      kazanilan_puan: kazanilanPuan // Frontend'de göstermek istersen dönebilirsin
    });

  } catch (err) {
    await conn.rollback();
    next(err);
  } finally {
    conn.release();
  }
});

// ---- SİPARİŞLERİ LİSTELE (Admin) ----
// /api/siparisler?durum=Hazır&sayfa=1&limit=20
// ---- SİPARİŞLERİ LİSTELE (Sadece Görünür Olanlar) ----
app.get("/api/siparisler", async (req, res, next) => {
  try {
    const durum = req.query.durum;
    // ... (Sayfalama kodları aynen kalabilir)
    const limit = Math.max(parseInt(req.query.limit || "50", 10), 1);
    const offset = 0; // Basitlik için offseti sıfırladık veya req.query.sayfa mantığını koruyabilirsin

    // DÜZELTME BURADA: "WHERE s.gorunurluk = 1" eklendi.
    let whereClause = "WHERE s.gorunurluk = 1"; 
    const params = [];

    if (durum) {
      assert(ALLOWED_DURUM.has(durum), "Geçersiz durum filtresi");
      whereClause += " AND s.durum = ?";
      params.push(durum);
    }

    const [rows] = await pool.query(
      `
      SELECT s.*, m.masa_no 
      FROM siparisler s
      JOIN masalar m ON m.masa_id = s.masa_id
      ${whereClause}
      ORDER BY s.tarih DESC
      LIMIT ?
      `,
      [...params, limit]
    );

    // ... (Kalemleri getirme ve response kısmı aynen kalacak) ...
    // Alt kısımdaki kalemleri çekme mantığına dokunmana gerek yok, sadece SQL sorgusuna
    // "s.gorunurluk = 1" şartını eklemen yeterliydi. 
    
    // Kodun devamlılığı için kalem çekme kısmını buraya kısa özet geçiyorum:
    const siparisIds = rows.map(r => r.siparis_id);
    let kalemMap = {};
    if (siparisIds.length > 0) {
      const ph = siparisIds.map(() => "?").join(",");
      const [kalemler] = await pool.query(
        `SELECT su.siparis_id, su.adet, su.tutar, u.urun_adi,
                su.ekstra_not,
                v.ad AS varyasyon_adi
         FROM siparis_urunleri su 
         JOIN urunler u ON u.urun_id = su.urun_id
         LEFT JOIN urun_varyasyonlari v ON v.varyasyon_id = su.varyasyon_id
         WHERE su.siparis_id IN (${ph})`, 
        siparisIds
      );
      kalemMap = kalemler.reduce((acc, k) => {
        (acc[k.siparis_id] ||= []).push(k);
        return acc;
      }, {});
    }
    
    const data = rows.map(r => ({
      ...r,
      kalemler: kalemMap[r.siparis_id] || []
    }));

    res.json({ data });

  } catch (e) {
    next(e);
  }
});

// ---- SİPARİŞ TEMİZLE (Soft Delete - Veriyi Silmez, Gizler) ----
app.delete("/api/siparisler/temizle", async (req, res, next) => {
  try {
    // DELETE yerine UPDATE yapıyoruz. 
    // Durumu 'Teslim Edildi' veya 'İptal' olanların görünürlüğünü 0 yapıyoruz.
    const [result] = await pool.query(`
      UPDATE siparisler 
      SET gorunurluk = 0 
      WHERE durum IN ('Teslim Edildi', 'İptal')
    `);

    res.json({
      message: `${result.affectedRows} sipariş ekrandan kaldırıldı (arşivlendi).`,
    });
  } catch (err) {
    next(err);
  }
});

// === PATRON ANALİZLERİ ===
// =============================
// PATRON ÖZET ANALİZİ
// =============================
app.get("/api/patron/ozet", async (req, res, next) => {
  try {
    const { start, end } = req.query;

    if (!start || !end)
      return res.status(400).json({ ok: false, error: "start ve end zorunlu" });

    const [[row]] = await pool.query(
      `
      SELECT
        COUNT(s.siparis_id) AS toplam_siparis,

        COALESCE(SUM(s.toplam_tutar), 0) AS ciro,

        -- MALİYET
        COALESCE(SUM(oi.maliyet), 0) AS maliyet,

        -- KOMİSYON
        COALESCE(
          SUM(
            CASE 
              WHEN s.odeme_turu = 'Kredi Kartı' 
              THEN s.toplam_tutar * 0.0214 
              ELSE 0 
            END
          ), 
          0
        ) AS komisyon,

        -- SEPET ORTALAMASI
        COALESCE(AVG(s.toplam_tutar), 0) AS sepet_ortalama

      FROM siparisler s
      
      -- Her siparişin toplam maliyeti bir alt sorgudan çekilir
      LEFT JOIN (
        SELECT 
          su.siparis_id,
          SUM(su.adet * u.maliyet) AS maliyet
        FROM siparis_urunleri su
        JOIN urunler u ON u.urun_id = su.urun_id
        GROUP BY su.siparis_id
      ) oi ON oi.siparis_id = s.siparis_id

      WHERE s.tarih BETWEEN ? AND ?
        AND s.durum != 'İptal'
      `,
      [start + " 00:00:00", end + " 23:59:59"]
    );

    const net_kar =
      Number(row.ciro) -
      Number(row.maliyet) -
      Number(row.komisyon);

    res.json({
      ok: true,
      toplam_siparis: Number(row.toplam_siparis),
      ciro: Number(row.ciro),
      maliyet: Number(row.maliyet),
      komisyon: Number(row.komisyon),
      sepet_ortalama: Number(row.sepet_ortalama),
      net_kar: Number(net_kar)
    });
    
  } catch (e) {
    next(e);
  }
});


// =============================
// PATRON ANALİZLERİ – SAATLİK YOĞUNLUK (09–23)
// =============================
// =============================
// PATRON ANALİZLERİ – SAATLİK YOĞUNLUK (09–23)
// =============================
app.get("/api/patron/saatlik", async (req, res, next) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: "start ve end zorunludur" });
    }

    const [rows] = await pool.query(
      `
      SELECT 
        HOUR(s.tarih) AS saat,
        
        /* Sipariş Sayısı (Masa sayısı gibi) */
        COUNT(DISTINCT s.siparis_id) AS siparis_sayisi,

        /* Ürün Adedi (Toplam satılan ürün) - YENİ EKLENDİ */
        COALESCE(SUM(su.adet), 0) AS adet,

        /* Ciro */
        COALESCE(SUM(su.tutar), 0) AS ciro,

        /* Maliyet */
        COALESCE(SUM(u.maliyet * su.adet), 0) AS maliyet,

        /* Komisyon */
        COALESCE(SUM(
          CASE 
            WHEN s.odeme_turu = 'Kredi Kartı' 
            THEN su.tutar * 0.0214
            ELSE 0
          END
        ), 0) AS komisyon

      FROM siparisler s
      JOIN siparis_urunleri su ON su.siparis_id = s.siparis_id
      JOIN urunler u ON u.urun_id = su.urun_id
      WHERE s.tarih BETWEEN ? AND ?
        AND s.durum != 'İptal'
        AND HOUR(s.tarih) BETWEEN 9 AND 23
      GROUP BY HOUR(s.tarih)
      ORDER BY saat ASC
      `,
      [start + " 00:00:00", end + " 23:59:59"]
    );

    const saatler = [];
    for (let h = 9; h <= 23; h++) {
      const row = rows.find(r => Number(r.saat) === h);
      if (row) {
        const net_kar = Number(row.ciro) - Number(row.maliyet) - Number(row.komisyon);
        saatler.push({
          saat: h,
          siparis_sayisi: Number(row.siparis_sayisi),
          adet: Number(row.adet), // Yeni veri
          ciro: Number(row.ciro),
          maliyet: Number(row.maliyet),
          komisyon: Number(row.komisyon),
          net_kar: Number(net_kar.toFixed(2))
        });
      } else {
        saatler.push({
          saat: h,
          siparis_sayisi: 0,
          adet: 0,
          ciro: 0,
          maliyet: 0,
          komisyon: 0,
          net_kar: 0
        });
      }
    }

    res.json({
      tarih_araligi: { start, end },
      saatlik: saatler
    });

  } catch (err) {
    next(err);
  }
});
// =============================
// PATRON ANALİZLERİ – SAATLİK DETAY (GÜN GÜN 09–23)
// =============================
app.get("/api/patron/saatlik/detay", async (req, res, next) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) {
      return res.status(400).json({ error: "start ve end zorunludur" });
    }

    // --- Ham SQL verisi ---
    const [rows] = await pool.query(
      `
      SELECT 
        DATE_FORMAT(s.tarih, '%Y-%m-%d') AS gun, -- DÜZELTME: String formatında gün alıyoruz
        HOUR(s.tarih) AS saat,

        COUNT(DISTINCT s.siparis_id) AS siparis_sayisi,

        /* Ciro */
        COALESCE(SUM(su.tutar * su.adet), 0) AS ciro,

        /* Maliyet */
        COALESCE(SUM(u.maliyet * su.adet), 0) AS maliyet,

        /* Komisyon (%2.14) */
        COALESCE(SUM(
            CASE WHEN s.odeme_turu = 'Kredi Kartı' 
                 THEN (su.tutar * su.adet) * 0.0214
                 ELSE 0
            END
        ), 0) AS komisyon

      FROM siparisler s
      JOIN siparis_urunleri su ON su.siparis_id = s.siparis_id
      JOIN urunler u ON u.urun_id = su.urun_id
      WHERE s.tarih BETWEEN ? AND ?
        AND s.durum != 'İptal'
        AND HOUR(s.tarih) BETWEEN 9 AND 23
      GROUP BY gun, saat
      ORDER BY gun ASC, saat ASC
      `,
      [start + " 00:00:00", end + " 23:59:59"]
    );

    // --- Gün listesi oluştur ---
    const startDate = new Date(start);
    const endDate = new Date(end);
    const gunHaritasi = {};

    // Tarih döngüsü
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
      const gunStr = d.toISOString().slice(0, 10); // '2025-12-07' formatı

      // Her gün için 09–23 saatleri default 0
      gunHaritasi[gunStr] = [];
      for (let h = 9; h <= 23; h++) {
        gunHaritasi[gunStr].push({
          saat: h,
          siparis_sayisi: 0,
          ciro: 0,
          maliyet: 0,
          komisyon: 0,
          net_kar: 0
        });
      }
    }

    // --- Gelen SQL sonuçlarını yerleştir ---
    for (const r of rows) {
      // DÜZELTME: r.gun SQL'den zaten '2025-12-07' string olarak geliyor
      const gun = r.gun; 
      const h = Number(r.saat);

      if (!gunHaritasi[gun]) continue;
      
      const net_kar =
        Number(r.ciro) -
        Number(r.maliyet) -
        Number(r.komisyon);

      const idx = gunHaritasi[gun].findIndex(s => s.saat === h);
      if (idx !== -1) {
        gunHaritasi[gun][idx] = {
          saat: h,
          siparis_sayisi: Number(r.siparis_sayisi),
          ciro: Number(r.ciro),
          maliyet: Number(r.maliyet),
          komisyon: Number(r.komisyon),
          net_kar: Number(net_kar.toFixed(2))
        };
      }
    }

    res.json({
      tarih_araligi: { start, end },
      gunler: gunHaritasi
    });

  } catch (err) {
    next(err);
  }
});
// =============================
// PATRON ANALİZLERİ – ÜRÜN LİSTESİ
// =============================
app.get("/api/patron/urunler", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        u.urun_id,
        u.urun_adi,
        u.fiyat,
        u.maliyet,
        k.kategori_id,
        k.kategori_adi
      FROM urunler u
      JOIN kategoriler k ON k.kategori_id = u.kategori_id
      ORDER BY k.kategori_adi ASC, u.urun_adi ASC
    `);

    res.json(
      rows.map(r => ({
        urun_id: r.urun_id,
        urun_adi: r.urun_adi,
        fiyat: Number(r.fiyat),
        maliyet: Number(r.maliyet),
        kategori_id: r.kategori_id,
        kategori_adi: r.kategori_adi
      }))
    );

  } catch (err) {
    next(err);
  }
});
// =============================
// PATRON ANALİZLERİ – ÜRÜN SATIŞ ANALİZİ
// =============================
app.get("/api/patron/urun-satis/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { start, end } = req.query;

    if (!start || !end) return res.status(400).json({ error: "start ve end zorunludur" });

    // 1) GENEL TOPLAM
    const [[toplam]] = await pool.query(
      `
      SELECT
        u.urun_id,
        u.urun_adi,
        COALESCE(SUM(su.adet), 0) AS adet,
        
        /* DÜZELTME: su.tutar zaten toplami verir */
        COALESCE(SUM(su.tutar), 0) AS ciro,
        
        COALESCE(SUM(su.adet * u.maliyet), 0) AS maliyet,
        
        COALESCE(SUM(
          CASE WHEN s.odeme_turu = 'Kredi Kartı' 
               THEN su.tutar * 0.0214
               ELSE 0
          END
        ), 0) AS komisyon
      FROM siparis_urunleri su
      JOIN siparisler s ON s.siparis_id = su.siparis_id
      JOIN urunler u ON u.urun_id = su.urun_id
      WHERE su.urun_id = ? AND s.tarih BETWEEN ? AND ?
        AND s.durum != 'İptal'
      `,
      [id, start + " 00:00:00", end + " 23:59:59"]
    );

    const net_kar = Number(toplam.ciro) - Number(toplam.maliyet) - Number(toplam.komisyon);

    // 2) GÜNLÜK GRAFİK VERİSİ
    const [gunluk] = await pool.query(
      `
      SELECT
        DATE(s.tarih) AS gun,
        COALESCE(SUM(su.adet), 0) AS adet,
        COALESCE(SUM(su.tutar), 0) AS ciro, /* DÜZELTİLDİ */
        COALESCE(SUM(su.adet * u.maliyet), 0) AS maliyet,
        COALESCE(SUM(
          CASE WHEN s.odeme_turu = 'Kredi Kartı' 
               THEN su.tutar * 0.0214
               ELSE 0
          END
        ), 0) AS komisyon
      FROM siparis_urunleri su
      JOIN siparisler s ON s.siparis_id = su.siparis_id
      JOIN urunler u ON u.urun_id = su.urun_id
      WHERE su.urun_id = ? AND s.tarih BETWEEN ? AND ?
        AND s.durum != 'İptal'
      GROUP BY DATE(s.tarih)
      ORDER BY gun ASC
      `,
      [id, start + " 00:00:00", end + " 23:59:59"]
    );

    const gunlukHarita = gunluk.map((r) => {
      const nk = Number(r.ciro) - Number(r.maliyet) - Number(r.komisyon);
      return {
        gun: r.gun,
        adet: Number(r.adet),
        ciro: Number(r.ciro),
        maliyet: Number(r.maliyet),
        komisyon: Number(r.komisyon),
        net_kar: Number(nk.toFixed(2))
      };
    });

    res.json({
      urun_id: toplam.urun_id,
      urun_adi: toplam.urun_adi,
      tarih_araligi: { start, end },
      toplam: {
        adet: Number(toplam.adet),
        ciro: Number(toplam.ciro),
        maliyet: Number(toplam.maliyet),
        komisyon: Number(toplam.komisyon),
        net_kar: Number(net_kar.toFixed(2))
      },
      gunluk: gunlukHarita
    });
  } catch (err) { next(err); }
});
// =============================
// PATRON ANALİZLERİ – TOP ÜRÜNLER (TOP 10)
// =============================
app.get("/api/patron/top-urunler", async (req, res, next) => {
  try {
    const { start, end, limit } = req.query;
    if (!start || !end) return res.status(400).json({ error: "start ve end zorunludur" });
    const max = Math.min(Math.max(parseInt(limit || "10"), 1), 100);

    const [rows] = await pool.query(
      `
      SELECT
        u.urun_id,
        u.urun_adi,
        COALESCE(SUM(su.adet), 0) AS adet,
        
        /* DÜZELTME: su.tutar direkt cirodur */
        COALESCE(SUM(su.tutar), 0) AS ciro,
        
        COALESCE(SUM(su.adet * u.maliyet), 0) AS maliyet,
        
        COALESCE(SUM(
          CASE WHEN s.odeme_turu='Kredi Kartı'
               THEN su.tutar * 0.0214
               ELSE 0 END
        ), 0) AS komisyon

      FROM siparis_urunleri su
      JOIN siparisler s ON s.siparis_id = su.siparis_id
      JOIN urunler u    ON u.urun_id = su.urun_id
      WHERE s.tarih BETWEEN ? AND ?
        AND s.durum != 'İptal'
      GROUP BY u.urun_id
      ORDER BY adet DESC
      LIMIT ?
      `,
      [start + " 00:00:00", end + " 23:59:59", max]
    );

    const mapped = rows.map(r => {
      const net = Number(r.ciro) - Number(r.maliyet) - Number(r.komisyon);
      return {
        urun_id: r.urun_id,
        urun_adi: r.urun_adi,
        adet: Number(r.adet),
        ciro: Number(r.ciro),
        maliyet: Number(r.maliyet),
        komisyon: Number(r.komisyon),
        net_kar: Number(net.toFixed(2))
      };
    });
    res.json({ tarih_araligi: { start, end }, urunler: mapped });
  } catch (err) { next(err); }
});

app.get("/api/patron/top-urunler/tam", async (req, res, next) => {
  try {
    const { start, end, sort } = req.query;
    if (!start || !end) return res.status(400).json({ error: "start ve end zorunludur" });

    const [rows] = await pool.query(`
      SELECT
        u.urun_id,
        u.urun_adi,
        COALESCE(SUM(su.adet), 0) AS adet,
        
        /* DÜZELTME */
        COALESCE(SUM(su.tutar), 0) AS ciro,
        
        COALESCE(SUM(su.adet * u.maliyet), 0) AS maliyet,
        COALESCE(SUM(
          CASE WHEN s.odeme_turu = 'Kredi Kartı'
               THEN su.tutar * 0.0214
               ELSE 0 END
        ), 0) AS komisyon
      FROM siparis_urunleri su
      JOIN siparisler s ON s.siparis_id = su.siparis_id
      JOIN urunler u ON u.urun_id = su.urun_id
      WHERE s.tarih BETWEEN ? AND ?
        AND s.durum != 'İptal'
      GROUP BY u.urun_id
    `, [start + " 00:00:00", end + " 23:59:59"]);

    const mapped = rows.map(r => {
      const net = Number(r.ciro) - Number(r.maliyet) - Number(r.komisyon);
      return {
        urun_id: r.urun_id,
        urun_adi: r.urun_adi,
        adet: Number(r.adet),
        ciro: Number(r.ciro),
        maliyet: Number(r.maliyet),
        komisyon: Number(r.komisyon),
        net_kar: Number(net.toFixed(2))
      };
    });

    mapped.sort((a, b) => {
      if (sort === "ciro") return b.ciro - a.ciro;
      if (sort === "kar") return b.net_kar - a.net_kar;
      return b.adet - a.adet;
    });

    res.json({
      tarih_araligi: { start, end },
      toplam_urun: mapped.length,
      siralama_turu: sort || "adet",
      urunler: mapped
    });
  } catch (err) { next(err); }
});
// =============================
// PATRON ANALİZLERİ – KATEGORİ LİSTESİ
// =============================
app.get("/api/patron/kategoriler", async (req, res, next) => {
  try {
    const [rows] = await pool.query(`
      SELECT 
        k.kategori_id,
        k.kategori_adi,

        COUNT(u.urun_id) AS urun_sayisi,

        COALESCE(AVG(u.fiyat), 0) AS ortalama_fiyat,
        COALESCE(AVG(u.maliyet), 0) AS ortalama_maliyet

      FROM kategoriler k
      LEFT JOIN urunler u ON u.kategori_id = k.kategori_id
      GROUP BY k.kategori_id
      ORDER BY k.kategori_adi ASC
    `);

    res.json(
      rows.map(r => ({
        kategori_id: r.kategori_id,
        kategori_adi: r.kategori_adi,
        urun_sayisi: Number(r.urun_sayisi),
        ortalama_fiyat: Number(r.ortalama_fiyat),
        ortalama_maliyet: Number(r.ortalama_maliyet)
      }))
    );

  } catch (err) {
    next(err);
  }
});
// =============================
// PATRON ANALİZLERİ – KATEGORİ SATIŞ ANALİZİ
// =============================
// =============================
// PATRON ANALİZLERİ – KATEGORİ SATIŞ ANALİZİ (DÜZELTİLDİ: Kaybolan Ürünler Geri Geldi)
// =============================
app.get("/api/patron/kategori-satis/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "start ve end zorunludur" });
    }

    // ---------------------------------------
    // 1) KATEGORİNİN TOPLAM PERFORMANSI
    // ---------------------------------------
    const [[toplam]] = await pool.query(
      `
      SELECT
        k.kategori_id,
        k.kategori_adi,

        /* Adet */
        COALESCE(SUM(su.adet), 0) AS adet,

        /* DÜZELTME: su.tutar zaten toplam fiyattır, tekrar adetle çarpılmaz */
        COALESCE(SUM(su.tutar), 0) AS ciro,

        /* Maliyet: Birim maliyet x Adet */
        COALESCE(SUM(su.adet * u.maliyet), 0) AS maliyet,

        /* Komisyon: Tutar üzerinden hesaplanır */
        COALESCE(SUM(
          CASE WHEN s.odeme_turu = 'Kredi Kartı'
               THEN su.tutar * 0.0214
               ELSE 0 END
        ), 0) AS komisyon

      FROM siparis_urunleri su
      JOIN siparisler s ON s.siparis_id = su.siparis_id
      JOIN urunler u ON u.urun_id = su.urun_id
      JOIN kategoriler k ON k.kategori_id = u.kategori_id
      WHERE k.kategori_id = ?
        AND s.tarih BETWEEN ? AND ?
        AND s.durum != 'İptal'
      `,
      [id, start + " 00:00:00", end + " 23:59:59"]
    );

    const net_kar =
      Number(toplam?.ciro || 0) -
      Number(toplam?.maliyet || 0) -
      Number(toplam?.komisyon || 0);

    // ---------------------------------------
    // 2) GÜNLÜK KATEGORİ SATIŞ GRAFİĞİ
    // ---------------------------------------
    const [gunluk] = await pool.query(
      `
      SELECT
        DATE(s.tarih) AS gun,

        COALESCE(SUM(su.adet), 0) AS adet,
        
        /* DÜZELTME: Günlük ciroda da sadece su.tutar toplanmalı */
        COALESCE(SUM(su.tutar), 0) AS ciro,
        
        COALESCE(SUM(su.adet * u.maliyet), 0) AS maliyet,
        COALESCE(SUM(
          CASE WHEN s.odeme_turu = 'Kredi Kartı'
               THEN su.tutar * 0.0214
               ELSE 0 END
        ), 0) AS komisyon

      FROM siparis_urunleri su
      JOIN siparisler s ON s.siparis_id = su.siparis_id
      JOIN urunler u ON u.urun_id = su.urun_id
      JOIN kategoriler k ON k.kategori_id = u.kategori_id
      WHERE k.kategori_id = ?
        AND s.tarih BETWEEN ? AND ?
        AND s.durum != 'İptal'
      GROUP BY DATE(s.tarih)
      ORDER BY gun ASC
      `,
      [id, start + " 00:00:00", end + " 23:59:59"]
    );

    const gunlukGrafik = gunluk.map((r) => {
      const net =
        Number(r.ciro) -
        Number(r.maliyet) -
        Number(r.komisyon);

      return {
        gun: r.gun,
        adet: Number(r.adet),
        ciro: Number(r.ciro),
        maliyet: Number(r.maliyet),
        komisyon: Number(r.komisyon),
        net_kar: Number(net.toFixed(2))
      };
    });

    // ---------------------------------------
    // 3) KATEGORİ İÇİNDE ÜRÜN SIRALAMASI
    // ---------------------------------------
    const [urunler] = await pool.query(
      `
      SELECT
        u.urun_id,
        u.urun_adi,

        COALESCE(SUM(su.adet), 0) AS adet,
        
        /* DÜZELTME: Ürün bazlı toplamda da su.tutar kullanılmalı */
        COALESCE(SUM(su.tutar), 0) AS ciro,
        
        COALESCE(SUM(su.adet * u.maliyet), 0) AS maliyet,
        COALESCE(SUM(
          CASE WHEN s.odeme_turu = 'Kredi Kartı'
               THEN su.tutar * 0.0214
               ELSE 0 END
        ), 0) AS komisyon

      FROM urunler u
      LEFT JOIN siparis_urunleri su ON su.urun_id = u.urun_id
      LEFT JOIN siparisler s ON s.siparis_id = su.siparis_id 
           AND s.tarih BETWEEN ? AND ?
           AND s.durum != 'İptal'
           
      WHERE u.kategori_id = ?
      GROUP BY u.urun_id
      ORDER BY adet DESC
      `,
      [start + " 00:00:00", end + " 23:59:59", id]
    );

    const urunlerMap = urunler.map((r) => {
      const net =
        Number(r.ciro) -
        Number(r.maliyet) -
        Number(r.komisyon);

      return {
        urun_id: r.urun_id,
        urun_adi: r.urun_adi,
        adet: Number(r.adet),
        ciro: Number(r.ciro),
        maliyet: Number(r.maliyet),
        komisyon: Number(r.komisyon),
        net_kar: Number(net.toFixed(2))
      };
    });

    res.json({
      kategori_id: toplam?.kategori_id || Number(id),
      kategori_adi: toplam?.kategori_adi || "Bilinmiyor",
      tarih_araligi: { start, end },
      toplam: {
        adet: Number(toplam?.adet || 0),
        ciro: Number(toplam?.ciro || 0),
        maliyet: Number(toplam?.maliyet || 0),
        komisyon: Number(toplam?.komisyon || 0),
        net_kar: Number(net_kar.toFixed(2))
      },
      gunluk: gunlukGrafik,
      urun_siralama: urunlerMap
    });

  } catch (err) {
    next(err);
  }
});

// =============================
// PATRON ANALİZLERİ – KATEGORİ SIRALAMASI (DÜZELTİLDİ)
// =============================
app.get("/api/patron/kategori-siralama", async (req, res, next) => {
  try {
    const { start, end, sort } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "start ve end zorunludur" });
    }

    const [rows] = await pool.query(
      `
      SELECT
        k.kategori_id,
        k.kategori_adi,

        /* Adet */
        COALESCE(SUM(t.adet), 0) AS adet,

        /* Ciro */
        COALESCE(SUM(t.tutar), 0) AS ciro,

        /* Maliyet */
        COALESCE(SUM(t.adet * u.maliyet), 0) AS maliyet,

        /* Komisyon */
        COALESCE(SUM(t.komisyon), 0) AS komisyon

      FROM kategoriler k
      LEFT JOIN urunler u ON u.kategori_id = k.kategori_id
      LEFT JOIN (
        SELECT 
          su.urun_id, 
          SUM(su.adet) AS adet, 
          SUM(su.tutar) AS tutar,
          SUM(CASE WHEN s.odeme_turu = 'Kredi Kartı' THEN su.tutar * 0.0214 ELSE 0 END) AS komisyon
        FROM siparis_urunleri su
        JOIN siparisler s ON s.siparis_id = su.siparis_id
        WHERE s.tarih BETWEEN ? AND ? AND s.durum != 'İptal'
        GROUP BY su.urun_id
      ) t ON t.urun_id = u.urun_id
      GROUP BY k.kategori_id
      `,
      [start + " 00:00:00", end + " 23:59:59"]
    );

    const mapped = rows.map((r) => {
      const net =
        Number(r.ciro) -
        Number(r.maliyet) -
        Number(r.komisyon);

      return {
        kategori_id: r.kategori_id,
        kategori_adi: r.kategori_adi,
        adet: Number(r.adet),
        ciro: Number(r.ciro),
        maliyet: Number(r.maliyet),
        komisyon: Number(r.komisyon),
        net_kar: Number(net.toFixed(2))
      };
    });

    // Sıralama
    mapped.sort((a, b) => {
      if (sort === "adet") return b.adet - a.adet;
      if (sort === "ciro") return b.ciro - a.ciro;
      return b.net_kar - a.net_kar; // default
    });

    res.json({
      tarih_araligi: { start, end },
      siralama_turu: sort || "kar",
      kategoriler: mapped
    });

  } catch (err) {
    next(err);
  }
});

// =============================
// PATRON ANALİZLERİ – ÇAPRAZ SATIŞ ANALİZİ (BİRLİKTE SATIN ALMA)
// =============================
app.get("/api/patron/capraz-satis", async (req, res, next) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "start ve end zorunludur" });
    }

    // Çapraz satış (Market Basket Analysis)
    // Aynı siparişte bulunan ürün çiftlerini (A ve B) bulup sayıyoruz
    const query = `
      SELECT 
        u1.urun_adi AS ana_urun, 
        u2.urun_adi AS birlikte_urun,
        COUNT(*) AS siparis_sayisi,
        (COUNT(*) * (u1.fiyat + u2.fiyat)) AS toplam_sepet_etkisi
      FROM siparis_urunleri su1
      JOIN siparis_urunleri su2 ON su1.siparis_id = su2.siparis_id AND su1.urun_id != su2.urun_id
      JOIN urunler u1 ON su1.urun_id = u1.urun_id
      JOIN urunler u2 ON su2.urun_id = u2.urun_id
      JOIN siparisler s ON su1.siparis_id = s.siparis_id
      WHERE s.durum != 'İptal'
        AND s.tarih >= ? AND s.tarih <= ?
      GROUP BY u1.urun_adi, u2.urun_adi
      HAVING siparis_sayisi > 0
      ORDER BY siparis_sayisi DESC
      LIMIT 20
    `;

    const [rows] = await pool.query(query, [`${start} 00:00:00`, `${end} 23:59:59`]);

    const [totalRes] = await pool.query(`SELECT COUNT(DISTINCT siparis_id) as total FROM siparisler WHERE durum != 'İptal' AND tarih >= ? AND tarih <= ?`, [`${start} 00:00:00`, `${end} 23:59:59`]);
    const totalOrders = totalRes[0].total || 1;

    const uniquePairs = [];
    const seen = new Set();
    
    rows.forEach(r => {
      const pairId = [r.ana_urun, r.birlikte_urun].sort().join("-");
      if (!seen.has(pairId)) {
        seen.add(pairId);
        
        let oranNum = (r.siparis_sayisi / totalOrders) * 100;
        if(oranNum > 100) oranNum = 100; // Güvenlik
        
        let oran = "%" + Math.round(oranNum);
        if (Math.round(oranNum) === 0) oran = "%" + oranNum.toFixed(1);
        
        uniquePairs.push({
          ana_urun: r.ana_urun,
          birlikte_urun: r.birlikte_urun,
          oran: oran,
          oran_sayisal: oranNum, // bar grafiği için
          siparis_sayisi: r.siparis_sayisi,
          sepet_etkisi: "+ ₺" + Number((r.toplam_sepet_etkisi / r.siparis_sayisi)).toFixed(2)
        });
      }
    });

    const suggestions = [];
    if (uniquePairs.length > 0) {
       suggestions.push({
         title: `${uniquePairs[0].ana_urun} + ${uniquePairs[0].birlikte_urun} Kampanyası!`,
         desc: `${uniquePairs[0].ana_urun} alanların ${uniquePairs[0].oran}'ı ${uniquePairs[0].birlikte_urun} da alıyor. Bu ikisini 'Menü' yapıp satarsanız sepet ortalamanızı anında yükseltebilirsiniz.`
       });
    }
    if (uniquePairs.length > 1) {
       suggestions.push({
         title: `${uniquePairs[1].ana_urun} & ${uniquePairs[1].birlikte_urun} İkilisi`,
         desc: `Bu ikilinin uyumu çok yüksek (${uniquePairs[1].oran}). 'Birini Alana Diğeri İndirimli' tarzı bir kampanya çok ilgi görebilir.`
       });
    }
    
    // Eğer veritabanında hiç çapraz eşleşme yoksa frontend'de göstermek üzere sahte veri dönebiliriz. Ancak gerçek veri istediğimiz için boş da dönebiliriz.

    res.json({
      success: true,
      data: uniquePairs.slice(0, 5),
      suggestions: suggestions
    });
  } catch (err) {
    next(err);
  }
});

// =============================
// PATRON ANALİZLERİ – YOĞUNLUK HARİTASI (HEATMAP)
// =============================
app.get("/api/patron/heatmap", async (req, res, next) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "start ve end zorunludur" });
    }

    const query = `
      SELECT 
        WEEKDAY(tarih) as gun_index,
        HOUR(tarih) as saat,
        COUNT(*) as siparis_sayisi
      FROM siparisler
      WHERE durum != 'İptal'
        AND tarih >= ? AND tarih <= ?
      GROUP BY WEEKDAY(tarih), HOUR(tarih)
    `;

    const [rows] = await pool.query(query, [`${start} 00:00:00`, `${end} 23:59:59`]);

    let maxSiparis = 0;
    
    const dilimler = [9, 11, 13, 15, 17, 19, 21, 23];
    const heatmapData = [];
    
    for (let g = 0; g < 7; g++) {
      for (let s of dilimler) {
        let toplam = 0;
        rows.forEach(r => {
          if (r.gun_index === g && (r.saat === s || r.saat === s + 1)) {
             toplam += r.siparis_sayisi;
          }
        });
        if(toplam > maxSiparis) maxSiparis = toplam;
      }
    }

    if (maxSiparis === 0) maxSiparis = 1;

    for (let g = 0; g < 7; g++) {
      for (let s of dilimler) {
        let toplam = 0;
        rows.forEach(r => {
          if (r.gun_index === g && (r.saat === s || r.saat === s + 1)) {
             toplam += r.siparis_sayisi;
          }
        });
        
        let intensity = toplam / maxSiparis; 
        if (intensity < 0.05 && toplam > 0) intensity = 0.1;
        if (intensity > 1) intensity = 1;
        if (toplam === 0) intensity = 0.02; // Hiç yoksa çok silik bir renk
        
        heatmapData.push({
          gun_index: g,
          saat_dilimi: s,
          siparis_sayisi: toplam,
          intensity: intensity
        });
      }
    }

    res.json({
      success: true,
      data: heatmapData
    });
  } catch (err) {
    next(err);
  }
});

// =============================
// PATRON ANALİZLERİ – ÜRÜN TRENDLERİ (YÜKSELEN, DÜŞEN, EN AZ SATAN)
// =============================
app.get("/api/patron/urun-trendleri", async (req, res, next) => {
  try {
    const { start, end } = req.query;
    if (!start || !end) return res.status(400).json({ error: "start ve end zorunludur" });

    const startDate = new Date(start);
    const endDate = new Date(end);
    const diffTime = Math.abs(endDate - startDate);
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) + 1; // Kaç günlük periyot seçilmiş?

    // Önceki periyodun tarihlerini hesapla
    const prevEndDate = new Date(startDate);
    prevEndDate.setDate(prevEndDate.getDate() - 1);
    
    const prevStartDate = new Date(prevEndDate);
    prevStartDate.setDate(prevStartDate.getDate() - diffDays + 1);

    const formatDt = (d) => d.toISOString().split('T')[0];

    // Şimdiki Periyot Satışları
    const currentQuery = `
      SELECT u.urun_id, u.urun_adi, SUM(su.adet) as adet
      FROM siparis_urunleri su
      JOIN siparisler s ON su.siparis_id = s.siparis_id
      JOIN urunler u ON su.urun_id = u.urun_id
      WHERE s.durum != 'İptal' AND s.tarih >= ? AND s.tarih <= ?
      GROUP BY u.urun_id, u.urun_adi
    `;
    const [currentRows] = await pool.query(currentQuery, [`${start} 00:00:00`, `${end} 23:59:59`]);

    // Önceki Periyot Satışları
    const prevQuery = `
      SELECT u.urun_id, SUM(su.adet) as adet
      FROM siparis_urunleri su
      JOIN siparisler s ON su.siparis_id = s.siparis_id
      JOIN urunler u ON su.urun_id = u.urun_id
      WHERE s.durum != 'İptal' AND s.tarih >= ? AND s.tarih <= ?
      GROUP BY u.urun_id
    `;
    const [prevRows] = await pool.query(prevQuery, [`${formatDt(prevStartDate)} 00:00:00`, `${formatDt(prevEndDate)} 23:59:59`]);

    // Verileri Birleştir
    const prevMap = {};
    prevRows.forEach(r => prevMap[r.urun_id] = r.adet);

    const trends = [];
    currentRows.forEach(r => {
      const prevAdet = prevMap[r.urun_id] || 0;
      const currentAdet = r.adet;
      let degisim = 0;
      let yuzde = 0;

      if (prevAdet === 0 && currentAdet > 0) {
        yuzde = 100; // Sonsuz artış yerine %100 diyelim
        degisim = currentAdet;
      } else if (prevAdet > 0) {
        degisim = currentAdet - prevAdet;
        yuzde = (degisim / prevAdet) * 100;
      }

      trends.push({
        urun_adi: r.urun_adi,
        adet: currentAdet,
        prev_adet: prevAdet,
        degisim_adet: degisim,
        yuzde: Math.round(yuzde)
      });
    });

    // En Az Satanlar (Sadece mevcut dönemde 0'dan büyük olanlar ama en az olanlar)
    const bottomList = [...trends].sort((a, b) => a.adet - b.adet).slice(0, 10);
    
    // Yükselen Trendler (Yüzde olarak en çok artanlar, anlamlı olması için adet > 5 olsun)
    const trendUp = [...trends]
      .filter(t => t.adet > 2 && t.yuzde > 0)
      .sort((a, b) => b.yuzde - a.yuzde)
      .slice(0, 10);
      
    // Düşen Trendler (Yüzde olarak en çok düşenler, eski adeti yüksek olanlar önemli)
    const trendDown = [...trends]
      .filter(t => t.prev_adet > 2 && t.yuzde < 0)
      .sort((a, b) => a.yuzde - b.yuzde)
      .slice(0, 10);

    res.json({
      success: true,
      bottom: bottomList,
      up: trendUp,
      down: trendDown
    });
  } catch (err) {
    next(err);
  }
});


// PATRON ANALİZLERİ – KAMPANYA PERFORMANSLARI (GARANTİ ÇALIŞAN MERGE YÖNTEMİ)
// =============================
// =============================
// PATRON ANALİZLERİ – KAMPANYA PERFORMANSLARI (DÜZELTİLDİ: Sadece İlgili Ürün Cirosu)
// =============================
app.get("/api/patron/kampanyalar", async (req, res, next) => {
  try {
    const { start, end } = req.query;

    if (!start || !end) {
      return res.status(400).json({ error: "start ve end zorunludur" });
    }

    // 1. Kampanyaların BİRİM (Sabit) Değerlerini Hesapla
    // Kullanıcının isteği: "Kampanya oluşturulduğunda kârı belli, sepete göre değişmesin"
    const [kampanyalar] = await pool.query(
      `
      SELECT 
        k.kampanya_id,
        k.ad AS kampanya_adi,

        -- BİRİM CİRO: Koşuldaki ürünlerin (veya kategorilerin ortalama) fiyatları * miktar
        COALESCE((
          SELECT SUM(
            kk.miktar * COALESCE(
              CASE WHEN kk.tip = 'urun' THEN u.fiyat
                   WHEN kk.tip = 'kategori' THEN (SELECT AVG(fiyat) FROM urunler WHERE kategori_id = kk.hedef_id)
                   WHEN kk.tip = 'grup' THEN (
                      SELECT AVG(fiyat) FROM urunler u2 
                      WHERE u2.kategori_id IN (SELECT kategori_id FROM kategori_grup_detay WHERE grup_id = kk.hedef_id)
                         OR u2.urun_id IN (SELECT urun_id FROM kategori_grup_detay WHERE grup_id = kk.hedef_id)
                   )
              END, 0
            )
          )
          FROM kampanya_kosullari kk
          LEFT JOIN urunler u ON u.urun_id = kk.hedef_id AND kk.tip = 'urun'
          WHERE kk.kampanya_id = k.kampanya_id
        ), 0) AS birim_ciro,

        -- BİRİM KOŞUL MALİYETİ
        COALESCE((
          SELECT SUM(
            kk.miktar * COALESCE(
              CASE WHEN kk.tip = 'urun' THEN u.maliyet
                   WHEN kk.tip = 'kategori' THEN (SELECT AVG(maliyet) FROM urunler WHERE kategori_id = kk.hedef_id)
                   WHEN kk.tip = 'grup' THEN (
                      SELECT AVG(maliyet) FROM urunler u2 
                      WHERE u2.kategori_id IN (SELECT kategori_id FROM kategori_grup_detay WHERE grup_id = kk.hedef_id)
                         OR u2.urun_id IN (SELECT urun_id FROM kategori_grup_detay WHERE grup_id = kk.hedef_id)
                   )
              END, 0
            )
          )
          FROM kampanya_kosullari kk
          LEFT JOIN urunler u ON u.urun_id = kk.hedef_id AND kk.tip = 'urun'
          WHERE kk.kampanya_id = k.kampanya_id
        ), 0) AS birim_kosul_maliyet,

        -- BİRİM HEDİYE MALİYETİ
        COALESCE((
          SELECT SUM(
            ko.adet * COALESCE(
              CASE WHEN ko.tip = 'urun' THEN u.maliyet
                   WHEN ko.tip = 'kategori' THEN (SELECT AVG(maliyet) FROM urunler WHERE kategori_id = ko.hedef_id)
                   WHEN ko.tip = 'grup' THEN (
                      SELECT AVG(maliyet) FROM urunler u2 
                      WHERE u2.kategori_id IN (SELECT kategori_id FROM kategori_grup_detay WHERE grup_id = ko.hedef_id)
                         OR u2.urun_id IN (SELECT urun_id FROM kategori_grup_detay WHERE grup_id = ko.hedef_id)
                   )
              END, 0
            )
          )
          FROM kampanya_odulleri ko
          LEFT JOIN urunler u ON u.urun_id = ko.hedef_id AND ko.tip = 'urun'
          WHERE ko.kampanya_id = k.kampanya_id
        ), 0) AS birim_hediye_maliyet

      FROM kampanyalar k
      WHERE k.aktif = 1
      `
    );

    // 2. Belirtilen Tarih Aralığındaki Kullanım (Sipariş) Sayılarını Çek
    const [usageStats] = await pool.query(
      `
      SELECT 
        sk.kampanya_id,
        COUNT(DISTINCT s.siparis_id) AS siparis_sayisi,
        SUM(CASE WHEN s.odeme_turu = 'Kredi Kartı' THEN 1 ELSE 0 END) AS kk_siparis_sayisi
      FROM siparis_kampanyalari sk
      JOIN siparisler s ON s.siparis_id = sk.siparis_id
      WHERE s.tarih BETWEEN ? AND ?
        AND s.durum != 'İptal'
      GROUP BY sk.kampanya_id
      `,
      [start + " 00:00:00", end + " 23:59:59"]
    );

    // 3. Verileri Birleştir (Mapping) - Sabit Değerler X Kullanım Sayısı
    const result = kampanyalar.map(k => {
      const usage = usageStats.find(u => u.kampanya_id === k.kampanya_id) || {};
      
      const siparis_sayisi = Number(usage.siparis_sayisi || 0);
      const kk_siparis_sayisi = Number(usage.kk_siparis_sayisi || 0);

      const ciro = siparis_sayisi * Number(k.birim_ciro || 0);
      const kosul_maliyet = siparis_sayisi * Number(k.birim_kosul_maliyet || 0);
      const hediye_maliyet = siparis_sayisi * Number(k.birim_hediye_maliyet || 0);
      
      // Komisyon sadece Kredi Kartı ile ödenen siparişlerin cirosu üzerinden alınır
      const komisyon = kk_siparis_sayisi * Number(k.birim_ciro || 0) * 0.0214;
      
      const toplam_maliyet = kosul_maliyet + hediye_maliyet;
      const net_kar = ciro - toplam_maliyet - komisyon;

      return {
        kampanya_id: k.kampanya_id,
        kampanya_adi: k.kampanya_adi,
        siparis_sayisi: siparis_sayisi,
        kosul_ciro: ciro,          
        kosul_maliyet: toplam_maliyet, 
        hediye_maliyet: hediye_maliyet,
        komisyon: komisyon,
        net_kar: Number(net_kar.toFixed(2))
      };
    });

    // Kâra göre sırala (En kârlı kampanya en üstte)
    result.sort((a, b) => b.net_kar - a.net_kar);

    res.json({
      tarih_araligi: { start, end },
      kampanyalar: result
    });

  } catch (err) {
    console.error("Kampanya Analiz Hatası:", err);
    next(err);
  }
});
// =============================
// PATRON ANALİZLERİ – TEK KAMPANYA DETAY (DÜZELTİLDİ: İsim Kaybolma Sorunu Çözüldü)
// =============================
// =============================
// PATRON ANALİZLERİ – TEK KAMPANYA DETAY (DÜZELTİLMİŞ SQL)
// =============================
// =============================
// PATRON ANALİZLERİ – TEK KAMPANYA DETAY (FİLTRELİ VERSİYON)
// =============================
app.get("/api/patron/kampanya/:id", async (req, res, next) => {
  try {
    const { id } = req.params;
    const { start, end } = req.query;

    if (!start || !end)
      return res.status(400).json({ error: "start ve end zorunludur" });

    // 0) Kampanya Adını Al
    const [[kampanyaBilgi]] = await pool.query(
      "SELECT ad FROM kampanyalar WHERE kampanya_id = ?",
      [id]
    );

    if (!kampanyaBilgi) {
      return res.status(404).json({ error: "Kampanya bulunamadı." });
    }

    // --- ORTAK FİLTRE MANTIĞI (SQL) ---
    // Bu filtre siparişin içindeki alakasız ürünleri (Soda vb.) eler.
    // Sadece koşula uyanları, ödülleri veya bedava ürünleri sayar.
    const FILTER_SQL = `
      AND (
        -- 1. Bedava ürünse kesin kampanyadır
        su.tutar = 0
        OR
        -- 2. Kampanya KOŞULLARINDA bu ürün/kategori/grup var mı?
        EXISTS (
          SELECT 1 FROM kampanya_kosullari kk
          WHERE kk.kampanya_id = sk.kampanya_id
          AND (
            (kk.tip = 'urun' AND kk.hedef_id = u.urun_id) OR
            (kk.tip = 'kategori' AND kk.hedef_id = u.kategori_id) OR
            (kk.tip = 'grup' AND (
                u.kategori_id IN (SELECT kategori_id FROM kategori_grup_detay WHERE grup_id = kk.hedef_id) OR
                u.urun_id IN (SELECT urun_id FROM kategori_grup_detay WHERE grup_id = kk.hedef_id)
            ))
          )
        )
        OR
        -- 3. Kampanya ÖDÜLLERİNDE bu ürün/kategori/grup var mı?
        EXISTS (
          SELECT 1 FROM kampanya_odulleri ko
          WHERE ko.kampanya_id = sk.kampanya_id
          AND (
            (ko.tip = 'urun' AND ko.hedef_id = u.urun_id) OR
            (ko.tip = 'kategori' AND ko.hedef_id = u.kategori_id) OR
            (ko.tip = 'grup' AND (
                u.kategori_id IN (SELECT kategori_id FROM kategori_grup_detay WHERE grup_id = ko.hedef_id) OR
                u.urun_id IN (SELECT urun_id FROM kategori_grup_detay WHERE grup_id = ko.hedef_id)
            ))
          )
        )
      )
    `;

    // ---------------------------------------------------
    // 1) Kampanyanın toplam performansı
    // ---------------------------------------------------
    const [[sum]] = await pool.query(
      `
      SELECT 
        COUNT(DISTINCT sk.siparis_id) AS siparis_sayisi,

        COALESCE(SUM(
          CASE WHEN su.tutar > 0 THEN su.tutar ELSE 0 END
        ), 0) AS kosul_ciro,

        COALESCE(SUM(
          CASE WHEN su.tutar > 0 THEN u.maliyet * su.adet ELSE 0 END
        ), 0) AS kosul_maliyet,

        COALESCE(SUM(
          CASE WHEN su.tutar = 0 THEN u.maliyet * su.adet ELSE 0 END
        ), 0) AS hediye_maliyet,

        COALESCE(SUM(
          CASE WHEN su.tutar > 0 AND s.odeme_turu='Kredi Kartı'
               THEN su.tutar * 0.0214 ELSE 0 END
        ), 0) AS komisyon

      FROM siparis_kampanyalari sk
      JOIN siparisler s ON s.siparis_id = sk.siparis_id
      JOIN siparis_urunleri su ON su.siparis_id = s.siparis_id
      JOIN urunler u ON u.urun_id = su.urun_id

      WHERE sk.kampanya_id = ?
        AND s.durum != 'İptal'
        AND s.tarih BETWEEN ? AND ?
        ${FILTER_SQL}  -- <--- FİLTRE EKLENDİ
      `,
      [id, start + " 00:00:00", end + " 23:59:59"]
    );

    const stats = sum || {};
    const net_kar =
      Number(stats.kosul_ciro || 0) -
      Number(stats.kosul_maliyet || 0) -
      Number(stats.hediye_maliyet || 0) -
      Number(stats.komisyon || 0);

    // ---------------------------------------------------
    // 2) Günlük performans (grafik)
    // ---------------------------------------------------
    const [gunluk] = await pool.query(
      `
      SELECT
        DATE(s.tarih) AS gun,
        COALESCE(SUM(CASE WHEN su.tutar > 0 THEN su.adet ELSE 0 END), 0) AS adet,
        COALESCE(SUM(CASE WHEN su.tutar > 0 THEN su.tutar ELSE 0 END), 0) AS ciro,
        COALESCE(SUM(CASE WHEN su.tutar > 0 THEN u.maliyet * su.adet ELSE 0 END), 0) AS maliyet,
        COALESCE(SUM(CASE WHEN su.tutar = 0 THEN u.maliyet * su.adet ELSE 0 END), 0) AS hediye_maliyet
      FROM siparis_kampanyalari sk
      JOIN siparisler s ON s.siparis_id = sk.siparis_id
      JOIN siparis_urunleri su ON su.siparis_id = sk.siparis_id
      JOIN urunler u ON u.urun_id = su.urun_id
      WHERE sk.kampanya_id = ?
        AND s.durum != 'İptal'
        AND s.tarih BETWEEN ? AND ?
        ${FILTER_SQL} -- <--- FİLTRE EKLENDİ
      GROUP BY DATE(s.tarih)
      ORDER BY gun ASC
      `,
      [id, start + " 00:00:00", end + " 23:59:59"]
    );

    const gunlukGrafik = gunluk.map(r => ({
      gun: r.gun,
      ciro: Number(r.ciro),
      maliyet: Number(r.maliyet),
      hediye_maliyet: Number(r.hediye_maliyet)
    }));

    // ---------------------------------------------------
    // 3) Kampanyada kullanılan ürünlerin sıralaması
    // ---------------------------------------------------
    const [urunler] = await pool.query(
      `
      SELECT
        u.urun_id,
        u.urun_adi,
        CASE WHEN SUM(su.tutar) = 0 THEN 'hediye' ELSE 'kosul' END AS kampanya_turu,
        COALESCE(SUM(su.adet), 0) AS adet,
        COALESCE(SUM(CASE WHEN su.tutar > 0 THEN su.tutar ELSE 0 END), 0) AS ciro,
        COALESCE(SUM(u.maliyet * su.adet), 0) AS maliyet

      FROM siparis_kampanyalari sk
      JOIN siparis_urunleri su ON su.siparis_id = sk.siparis_id
      JOIN urunler u ON u.urun_id = su.urun_id
      JOIN siparisler s ON s.siparis_id = su.siparis_id

      WHERE sk.kampanya_id = ?
        AND s.durum != 'İptal'
        AND s.tarih BETWEEN ? AND ?
        ${FILTER_SQL} -- <--- FİLTRE EKLENDİ

      GROUP BY u.urun_id, (CASE WHEN su.tutar = 0 THEN 'hediye' ELSE 'kosul' END)
      ORDER BY adet DESC
      `,
      [id, start + " 00:00:00", end + " 23:59:59"]
    );

    const urunMap = urunler.map(r => ({
      urun_id: r.urun_id,
      urun_adi: r.urun_adi,
      kampanya_turu: r.kampanya_turu, 
      adet: Number(r.adet),
      ciro: Number(r.ciro),
      maliyet: Number(r.maliyet)
    }));

    // ---------------------------------------------------
    // CEVAP
    // ---------------------------------------------------
    res.json({
      kampanya_id: Number(id),
      kampanya_adi: kampanyaBilgi.ad, 
      tarih_araligi: { start, end },
      toplam: {
        siparis_sayisi: Number(stats.siparis_sayisi || 0),
        kosul_ciro: Number(stats.kosul_ciro || 0),
        kosul_maliyet: Number(stats.kosul_maliyet || 0),
        hediye_maliyet: Number(stats.hediye_maliyet || 0),
        komisyon: Number(stats.komisyon || 0),
        net_kar: Number(net_kar.toFixed(2))
      },
      gunluk: gunlukGrafik,
      urunler: urunMap
    });

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
// ==========================================
// 1. PDF KAYDETME FONKSİYONU (En alta ekle)
// ==========================================
const ADISYON_KLASORU = path.join(__dirname, 'public', 'adisyonlar');
if (!fs.existsSync(ADISYON_KLASORU)) {
    fs.mkdirSync(ADISYON_KLASORU, { recursive: true });
}

async function adisyonuArsiveKaydet(siparis_id) {
  try {
    // Verileri Çek
    const [rows] = await pool.query(`
      SELECT s.*, m.masa_no, mus.ad_soyad 
      FROM siparisler s
      JOIN masalar m ON m.masa_id = s.masa_id
      LEFT JOIN musteriler mus ON mus.musteri_id = s.musteri_id
      WHERE s.siparis_id = ?
    `, [siparis_id]);

    if (rows.length === 0) return;
    const siparis = rows[0];

    const [urunler] = await pool.query(`
      SELECT su.adet, su.tutar, u.urun_adi 
      FROM siparis_urunleri su
      JOIN urunler u ON u.urun_id = su.urun_id
      WHERE su.siparis_id = ?
    `, [siparis_id]);

    // PDF Oluştur ve Dosyaya Yaz
    const doc = new PDFDocument({ margin: 50, size: 'A6' });
    const dosyaAdi = `adisyon-${siparis_id}-${Date.now()}.pdf`;
    const yol = path.join(ADISYON_KLASORU, dosyaAdi);
    const writeStream = fs.createWriteStream(yol);

    doc.pipe(writeStream);

    // --- TASARIM ---
    doc.fontSize(16).text('KAFE ADISYON', { align: 'center' });
    doc.moveDown(0.5);
    doc.fontSize(10);
    doc.text(`Tarih: ${new Date().toLocaleString("tr-TR")}`);
    doc.text(`Masa: ${siparis.masa_no}`);
    doc.text(`No: #${siparis.siparis_id}`);
    doc.text(`Ödeme: ${siparis.odeme_turu || 'Belirsiz'}`);
    
    doc.moveDown();
    doc.text('------------------------------------------------', { align: 'center' });
    
    urunler.forEach(u => {
      // Türkçe karakter basit düzeltme
      let ad = u.urun_adi.replace(/ğ/g,'g').replace(/Ğ/g,'G').replace(/ş/g,'s').replace(/Ş/g,'S').replace(/İ/g,'I').replace(/ı/g,'i');
      doc.text(`${u.adet} x ${ad}`, { continued: true }).text(`${Number(u.tutar).toFixed(2)} TL`, { align: 'right' });
    });

    doc.moveDown();
    doc.fontSize(14).font('Helvetica-Bold');
    doc.text(`TOPLAM: ${Number(siparis.toplam_tutar).toFixed(2)} TL`, { align: 'right' });
    
    doc.end();
    
    console.log(`✅ Adisyon arşivlendi: ${dosyaAdi}`);
    
  } catch (err) {
    console.error("PDF Kayıt Hatası:", err);
  }
}

// ==========================================
// 2. PUT İSTEĞİNİ GÜNCELLE (Mevcut kodunu bul ve değiştir)
// ==========================================
app.put("/api/siparis/:id/durum", async (req, res, next) => {
  const siparis_id = parseInt(req.params.id, 10);
  const { durum, odeme_turu } = req.body;

  try {
    assert(Number.isInteger(siparis_id) && siparis_id > 0, "Geçersiz siparis_id");
    
    // Durum Güncelleme SQL
    let sql, params;
    if (odeme_turu) {
        sql = "UPDATE siparisler SET durum = ?, odeme_turu = ? WHERE siparis_id = ?";
        params = [durum, odeme_turu, siparis_id];
    } else {
        sql = "UPDATE siparisler SET durum = ? WHERE siparis_id = ?";
        params = [durum, siparis_id];
    }

    const [result] = await pool.execute(sql, params);
    if (result.affectedRows === 0) return res.status(404).json({ error: "Sipariş bulunamadı" });

    // --- İPTAL EDİLEN SİPARİŞ İŞLEMLERİ ---
    if (durum === 'İptal') {
       // 1. Toplam tutarı 0'a çek (ciro hesaplamalarında sızma olmasın)
       await pool.execute("UPDATE siparisler SET toplam_tutar = 0 WHERE siparis_id = ?", [siparis_id]);

       // 2. Müşterinin kazandığı puanları geri al
       const [[siparis]] = await pool.query("SELECT musteri_id FROM siparisler WHERE siparis_id = ?", [siparis_id]);
       if (siparis && siparis.musteri_id) {
         // Siparişteki ücretli ürünlerin puan toplamını hesapla
         const [[puanData]] = await pool.query(`
           SELECT COALESCE(SUM(su.adet * u.puan_degeri), 0) AS toplam_puan
           FROM siparis_urunleri su
           JOIN urunler u ON u.urun_id = su.urun_id
           WHERE su.siparis_id = ? AND su.tutar > 0
         `, [siparis_id]);
         if (puanData.toplam_puan > 0) {
           await pool.execute("UPDATE musteriler SET puan = GREATEST(0, puan - ?) WHERE musteri_id = ?", [puanData.toplam_puan, siparis.musteri_id]);
         }
       }
    }
    // ------------------------------------------

    // --- YENİ EKLENEN KISIM: OTOMATİK PDF KAYDI ---
    if (durum === 'Teslim Edildi') {
       // Arka planda PDF oluşturup kaydetsin (await kullanmasak da olur, hız kesmesin)
       adisyonuArsiveKaydet(siparis_id);
    }
    // ----------------------------------------------

    // Güncel veriyi dön
    const [[row]] = await pool.query("SELECT * FROM siparisler WHERE siparis_id = ?", [siparis_id]);
    res.json({ message: "Durum güncellendi", siparis: row });

  } catch (e) {
    next(e);
  }
});

// ---- MÜŞTERİ SİPARİŞ DURUMU SORGULAMA ----
app.get("/api/siparis/:id/durum", async (req, res, next) => {
  try {
    const siparis_id = parseInt(req.params.id, 10);
    assert(Number.isInteger(siparis_id) && siparis_id > 0, "Geçersiz siparis_id");

    const [[row]] = await pool.query("SELECT siparis_id, durum, toplam_tutar FROM siparisler WHERE siparis_id = ?", [siparis_id]);
    if (!row) return res.status(404).json({ error: "Sipariş bulunamadı" });

    res.json(row);
  } catch (err) {
    next(err);
  }
});

// ---- MÜŞTERİ SİPARİŞ İPTAL ETME (Müşteri için ilk 10 sn/Hazırlanıyor aşaması) ----
app.post("/api/siparis/:id/musteri-iptal", async (req, res, next) => {
  try {
    const siparis_id = parseInt(req.params.id, 10);
    assert(Number.isInteger(siparis_id) && siparis_id > 0, "Geçersiz siparis_id");

    // Siparişin durumunu kontrol et
    const [[siparis]] = await pool.query("SELECT durum, musteri_id FROM siparisler WHERE siparis_id = ?", [siparis_id]);
    if (!siparis) return res.status(404).json({ error: "Sipariş bulunamadı" });

    // Sipariş henüz mutfakta hazırlanıyor aşamasındayken iptal edilebilir
    if (siparis.durum !== 'Hazırlanıyor') {
      return res.status(400).json({ error: "Bu sipariş hazırlık aşamasına geçtiği için iptal edilemez." });
    }

    // Durumu İptal yap
    await pool.execute("UPDATE siparisler SET durum = 'İptal', toplam_tutar = 0 WHERE siparis_id = ?", [siparis_id]);

    // Müşteri puanlarını geri al
    if (siparis.musteri_id) {
      const [[puanData]] = await pool.query(`
        SELECT COALESCE(SUM(su.adet * u.puan_degeri), 0) AS toplam_puan
        FROM siparis_urunleri su
        JOIN urunler u ON u.urun_id = su.urun_id
        WHERE su.siparis_id = ? AND su.tutar > 0
      `, [siparis_id]);
      if (puanData.toplam_puan > 0) {
        await pool.execute("UPDATE musteriler SET puan = GREATEST(0, puan - ?) WHERE musteri_id = ?", [puanData.toplam_puan, siparis.musteri_id]);
      }
    }

    res.json({ success: true, message: "Siparişiniz iptal edildi." });
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
async function sendWhatsAppTemplateMessage(to, templateName, variables = []) {
    const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

    const params = variables.map(text => ({
        type: "text",
        text: text
    }));

    const body = {
        messaging_product: "whatsapp",
        to: to,
        type: "template",
        template: {
            name: templateName,
            language: { code: "tr" },
            components: [
                {
                    type: "body",
                    parameters: params
                }
            ]
        }
    };

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
            "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
    });

    const result = await response.json();
    return result;
}
// ===============================================
// 📱 WHATSAPP MESAJ GÖNDERME (sablon1)
// ===============================================
app.post("/api/admin/send-whatsapp-sablon", async (req, res) => {
    try {
        // Frontend'den beklenen veriler: Telefon, Müşteri Adı, Kampanya Adı
        const { telefon, musteri_ismi, kampanya_adi } = req.body;

        if (!telefon || !musteri_ismi || !kampanya_adi) {
            return res.status(400).json({ error: "Eksik bilgi: Telefon, Müşteri İsmi ve Kampanya Adı zorunludur." });
        }

        // Telefon formatını temizle (Sadece rakamlar)
        let cleaned = telefon.replace(/\D/g, "");
        // Başında 0 varsa kaldır, 90 yoksa ekle (Türkiye formatı varsayımı)
        if (cleaned.startsWith("0")) cleaned = cleaned.substring(1);
        if (!cleaned.startsWith("90")) cleaned = "90" + cleaned;

        const url = `https://graph.facebook.com/v19.0/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

        const body = {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: cleaned,
            type: "template",
            template: {
                name: "sablon1", // Resimdeki şablon adı
                language: { code: "tr" },
                components: [
                    {
                        type: "body",
                        parameters: [
                            // DİKKAT: Meta API parametreleri {{1}}, {{2}} sırasına göre bekler.
                            // Görseldeki Değişken Örnekleri kısmına göre:
                            
                            // {{1}} -> Kampanya
                            { type: "text", text: kampanya_adi },
                            
                            // {{2}} -> Müşteri İsmi
                            { type: "text", text: musteri_ismi }
                        ]
                    }
                ]
            }
        };

        const response = await fetch(url, {
            method: "POST",
            headers: {
                "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
                "Content-Type": "application/json"
            },
            body: JSON.stringify(body)
        });

        const result = await response.json();
        
        if (result.error) {
            console.error("WhatsApp API Hatası:", result.error);
            return res.status(400).json({ error: result.error.message });
        }

        res.json({ success: true, result });

    } catch (err) {
        console.error("Sunucu Hatası:", err);
        res.status(500).json({ error: err.message });
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
