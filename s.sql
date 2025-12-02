-- =========================================
-- QR SİPARİŞ SİSTEMİ — TAM & TEMİZ KURULUM
-- =========================================
DROP DATABASE IF EXISTS qr_siparis;
CREATE DATABASE qr_siparis CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;
USE qr_siparis;

-- 1) KATEGORİLER
CREATE TABLE kategoriler (
  kategori_id   INT AUTO_INCREMENT PRIMARY KEY,
  kategori_adi  VARCHAR(100) NOT NULL,
  UNIQUE KEY uk_kategori_adi (kategori_adi)
) ENGINE=InnoDB;

-- 2) ÜRÜNLER (stok = yalnızca boolean: tukendi)
CREATE TABLE urunler (
  urun_id     INT AUTO_INCREMENT PRIMARY KEY,
  kategori_id INT NOT NULL,
  urun_adi    VARCHAR(255) NOT NULL,
  aciklama    TEXT,
  fiyat       DECIMAL(10,2) NOT NULL,
  aktif       TINYINT(1) NOT NULL DEFAULT 1,
  tukendi     TINYINT(1) NOT NULL DEFAULT 0,
  
  CONSTRAINT fk_urun_kategori
    FOREIGN KEY (kategori_id) REFERENCES kategoriler(kategori_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT ck_urun_fiyat CHECK (fiyat >= 0),
  UNIQUE KEY uk_kategori_urun (kategori_id, urun_adi)
) ENGINE=InnoDB;
ALTER TABLE urunler
  ADD COLUMN kdv TINYINT(3) UNSIGNED NOT NULL DEFAULT 0;

-- 3) MASALAR
CREATE TABLE masalar (
  masa_id  INT AUTO_INCREMENT PRIMARY KEY,
  masa_no  VARCHAR(20) NOT NULL,
  qr_kod   VARCHAR(255),
  UNIQUE KEY uk_masa_no (masa_no)
) ENGINE=InnoDB;

-- 4) PERSONEL
CREATE TABLE kullanicilar (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  kullanici_adi  VARCHAR(100) NOT NULL,
  sifre_hash     VARCHAR(255) NOT NULL,
  rol            ENUM('admin','garson','mutfak') NOT NULL DEFAULT 'garson',
  UNIQUE KEY uk_kullanici_adi (kullanici_adi)
) ENGINE=InnoDB;

-- 5) MÜŞTERİLER
CREATE TABLE musteriler (
  musteri_id   INT AUTO_INCREMENT PRIMARY KEY,
  ad_soyad     VARCHAR(100) NOT NULL,
  email        VARCHAR(100) UNIQUE,
  telefon      VARCHAR(20),
  sifre_hash   VARCHAR(255) NOT NULL,
  puan         INT NOT NULL DEFAULT 0,   -- her sipariş +1
  kayit_tarih  DATETIME DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;

DROP TABLE IF EXISTS kampanyalar;

CREATE TABLE kampanyalar (
  kampanya_id     INT AUTO_INCREMENT PRIMARY KEY,
  ad              VARCHAR(100) NOT NULL,
  gerekli_puan    INT NOT NULL,   -- UI: "Gerekli Puan"
  tur             VARCHAR(20) NOT NULL,   -- ucretsiz_urun | yuzde_indirim | tutar_indirim
  odul_urun_id    INT NULL,       -- sadece ucretsiz_urun için
  indirim_oran    DECIMAL(5,2) DEFAULT NULL,   -- 1–100 arası
  indirim_tutar   DECIMAL(10,2) DEFAULT NULL,  -- >0
  odul_aciklama   VARCHAR(255),
  aktif           TINYINT(1) DEFAULT 1,
  olusturma_tarih DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- Ödül ürün FK
  CONSTRAINT fk_kampanya_odul
    FOREIGN KEY (odul_urun_id)
    REFERENCES urunler(urun_id)
    ON UPDATE CASCADE
    ON DELETE SET NULL,

  -- basit numeric kontroller (bunlar HATA ÇIKARTMAZ)
  CONSTRAINT ck_oran CHECK (indirim_oran IS NULL OR (indirim_oran > 0 AND indirim_oran <= 100)),
  CONSTRAINT ck_tutar CHECK (indirim_tutar IS NULL OR (indirim_tutar > 0))
) ENGINE=InnoDB;

-- 7) MÜŞTERİ KAMPANYA HAKLARI (çoklu hak, harcanabilir)
CREATE TABLE musteri_kampanya_haklari (
  hak_id              INT AUTO_INCREMENT PRIMARY KEY,
  musteri_id          INT NOT NULL,
  kampanya_id         INT NOT NULL,
  kazanma_tarih       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  kullanildi          TINYINT(1) NOT NULL DEFAULT 0,
  kullanma_tarih      DATETIME NULL,
  kullanilan_siparis_id INT NULL,
  CONSTRAINT fk_mkh_musteri  FOREIGN KEY (musteri_id)  REFERENCES musteriler(musteri_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_mkh_kampanya FOREIGN KEY (kampanya_id) REFERENCES kampanyalar(kampanya_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  KEY ix_mkh_musteri_kampanya (musteri_id, kampanya_id, kullanildi)
) ENGINE=InnoDB;

-- 7.b) UYUMLULUK: musteri_kampanyalari (server.js'in referans verdiği basit log tablosu)
CREATE TABLE IF NOT EXISTS musteri_kampanyalari (
  id             INT AUTO_INCREMENT PRIMARY KEY,
  musteri_id     INT NOT NULL,
  kampanya_id    INT NOT NULL,
  kazanma_tarih  DATETIME DEFAULT CURRENT_TIMESTAMP,
  kullanildi     TINYINT(1) DEFAULT 0,
  CONSTRAINT fk_mk_musteri  FOREIGN KEY (musteri_id)  REFERENCES musteriler(musteri_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_mk_kampanya FOREIGN KEY (kampanya_id) REFERENCES kampanyalar(kampanya_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  INDEX ix_mk_musteri (musteri_id),
  INDEX ix_mk_kampanya (kampanya_id)
) ENGINE=InnoDB;

-- 8) SİPARİŞLER
CREATE TABLE siparisler (
  siparis_id   INT AUTO_INCREMENT PRIMARY KEY,
  masa_id      INT NOT NULL,
  musteri_id   INT NULL,  -- anonim siparişlerde NULL
  durum        ENUM('Hazırlanıyor','Hazır','Teslim Edildi','İptal') NOT NULL DEFAULT 'Hazırlanıyor',
  tarih        DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  toplam_tutar DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  CONSTRAINT fk_siparis_masa     FOREIGN KEY (masa_id)    REFERENCES masalar(masa_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT fk_siparis_musteri  FOREIGN KEY (musteri_id) REFERENCES musteriler(musteri_id)
    ON UPDATE CASCADE ON DELETE SET NULL,
  KEY ix_siparis_masa_durum (masa_id, durum),
  KEY ix_siparis_tarih (tarih)
) ENGINE=InnoDB;

-- 9) SİPARİŞ ÜRÜNLERİ (fiyat snapshot)
CREATE TABLE siparis_urunleri (
  id          INT AUTO_INCREMENT PRIMARY KEY,
  siparis_id  INT NOT NULL,
  urun_id     INT NOT NULL,
  adet        INT NOT NULL DEFAULT 1,
  tutar       DECIMAL(10,2) DEFAULT NULL,
  CONSTRAINT fk_su_siparis FOREIGN KEY (siparis_id) REFERENCES siparisler(siparis_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_su_urun   FOREIGN KEY (urun_id)   REFERENCES urunler(urun_id)
    ON UPDATE CASCADE ON DELETE RESTRICT,
  CONSTRAINT ck_su_adet CHECK (adet > 0),
  KEY ix_su_siparis (siparis_id),
  KEY ix_su_urun (urun_id)
) ENGINE=InnoDB;

-- 10) MÜŞTERİ-SİPARİŞ EŞLEŞME (analitik)
CREATE TABLE musteri_siparisleri (
  id         INT AUTO_INCREMENT PRIMARY KEY,
  musteri_id INT NOT NULL,
  siparis_id INT NOT NULL,
  tarih      DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ms_musteri FOREIGN KEY (musteri_id) REFERENCES musteriler(musteri_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_ms_siparis FOREIGN KEY (siparis_id) REFERENCES siparisler(siparis_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  UNIQUE KEY uk_musteri_siparis (musteri_id, siparis_id)
) ENGINE=InnoDB;

-- 11) SİPARİŞE UYGULANAN KAMPANYALAR (indirim snapshot)
CREATE TABLE siparis_kampanyalari (
  id                INT AUTO_INCREMENT PRIMARY KEY,
  siparis_id        INT NOT NULL,
  kampanya_id       INT NOT NULL,
  hak_id            INT NULL,
  etkilenen_urun_id INT NULL,               -- ucretsiz_urun için
  indirim_tutar     DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  aciklama          VARCHAR(255),
  CONSTRAINT fk_sk_siparis  FOREIGN KEY (siparis_id)  REFERENCES siparisler(siparis_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_sk_kampanya FOREIGN KEY (kampanya_id) REFERENCES kampanyalar(kampanya_id)
    ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_sk_hak      FOREIGN KEY (hak_id)      REFERENCES musteri_kampanya_haklari(hak_id)
    ON UPDATE CASCADE ON DELETE SET NULL
) ENGINE=InnoDB;

-- 12) GÜN SONU ARŞİV (patron ekranı)
CREATE TABLE arsiv (
  id INT AUTO_INCREMENT PRIMARY KEY,
  siparis_id INT NOT NULL,
  masa_no VARCHAR(20) NOT NULL,
  toplam_tutar DECIMAL(10,2) NOT NULL,
  arsiv_tarih DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX ix_arsiv_tarih (arsiv_tarih)
) ENGINE=InnoDB;

-- =========================================
-- HESAPLAMA / TRIGGER / PROCEDURE
-- =========================================
DELIMITER $$

-- 12.a) Satır tutarı = adet * ürün.fiyat
CREATE FUNCTION fn_satir_tutar_hesapla(p_urun_id INT, p_adet INT)
RETURNS DECIMAL(10,2)
DETERMINISTIC
BEGIN
  DECLARE v DECIMAL(10,2);
  SELECT fiyat INTO v FROM urunler WHERE urun_id = p_urun_id;
  RETURN IFNULL(v,0) * IFNULL(p_adet,0);
END$$

-- 12.b) Sipariş toplamı = satırlar - indirimler
CREATE PROCEDURE sp_siparis_toplam_guncelle(IN p_siparis_id INT)
BEGIN
  DECLARE v_ara DECIMAL(10,2) DEFAULT 0;
  DECLARE v_ind DECIMAL(10,2) DEFAULT 0;

  SELECT IFNULL(SUM(IFNULL(tutar,0)),0) INTO v_ara
  FROM siparis_urunleri
  WHERE siparis_id = p_siparis_id;

  SELECT IFNULL(SUM(IFNULL(indirim_tutar,0)),0) INTO v_ind
  FROM siparis_kampanyalari
  WHERE siparis_id = p_siparis_id;

  UPDATE siparisler
  SET toplam_tutar = v_ara - v_ind
  WHERE siparis_id = p_siparis_id;

  UPDATE siparisler
  SET toplam_tutar = 0.00
  WHERE siparis_id = p_siparis_id
    AND NOT EXISTS (SELECT 1 FROM siparis_urunleri su WHERE su.siparis_id = p_siparis_id);
END$$

-- 12.c) Ürün eklenmeden önce: tükendi/pasif kontrol + tutar (BEFORE INSERT)
CREATE TRIGGER trg_su_bi
BEFORE INSERT ON siparis_urunleri
FOR EACH ROW
BEGIN
  DECLARE v_tukendi TINYINT;
  DECLARE v_aktif   TINYINT;
  SELECT tukendi, aktif INTO v_tukendi, v_aktif FROM urunler WHERE urun_id = NEW.urun_id;
  IF v_tukendi = 1 OR v_aktif = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ürün tükendi veya pasif.';
  END IF;
  SET NEW.tutar = fn_satir_tutar_hesapla(NEW.urun_id, NEW.adet);
END$$

-- 12.d) Ürün/adet değişirse aynı kontroller + tutar (BEFORE UPDATE)
CREATE TRIGGER trg_su_bu
BEFORE UPDATE ON siparis_urunleri
FOR EACH ROW
BEGIN
  DECLARE v_t2 TINYINT DEFAULT 0;
  DECLARE v_a2 TINYINT DEFAULT 0;

  IF (NEW.urun_id <> OLD.urun_id) OR (NEW.adet <> OLD.adet) THEN
    SELECT tukendi, aktif INTO v_t2, v_a2
    FROM urunler WHERE urun_id = NEW.urun_id;

    IF v_t2 = 1 OR v_a2 = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ürün tükendi veya pasif.';
    END IF;

    SET NEW.tutar = fn_satir_tutar_hesapla(NEW.urun_id, NEW.adet);
  END IF;
END$$

-- 12.e) Toplam güncelle (AFTER INSERT/UPDATE/DELETE)
CREATE TRIGGER trg_su_ai AFTER INSERT ON siparis_urunleri
FOR EACH ROW BEGIN CALL sp_siparis_toplam_guncelle(NEW.siparis_id); END$$

CREATE TRIGGER trg_su_au AFTER UPDATE ON siparis_urunleri
FOR EACH ROW BEGIN CALL sp_siparis_toplam_guncelle(NEW.siparis_id); END$$

CREATE TRIGGER trg_su_ad AFTER DELETE ON siparis_urunleri
FOR EACH ROW BEGIN CALL sp_siparis_toplam_guncelle(OLD.siparis_id); END$$

-- 12.f) Kampanya satırı doğrulama (CHECK yerine güvenli trigger)
CREATE TRIGGER trg_kampanya_bi
BEFORE INSERT ON kampanyalar
FOR EACH ROW
BEGIN
  IF NEW.tur = 'ucretsiz_urun' AND NEW.odul_urun_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ucretsiz_urun için odul_urun_id zorunlu.';
  END IF;

  IF NEW.tur = 'yuzde_indirim' AND (NEW.indirim_oran IS NULL OR NEW.indirim_oran <= 0 OR NEW.indirim_oran > 100) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'yuzde_indirim için indirim_oran (0-100] zorunlu.';
  END IF;

  IF NEW.tur = 'tutar_indirim' AND (NEW.indirim_tutar IS NULL OR NEW.indirim_tutar <= 0) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'tutar_indirim için indirim_tutar (>0) zorunlu.';
  END IF;
END$$

CREATE TRIGGER trg_kampanya_bu
BEFORE UPDATE ON kampanyalar
FOR EACH ROW
BEGIN
  IF NEW.tur = 'ucretsiz_urun' AND NEW.odul_urun_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'ucretsiz_urun için odul_urun_id zorunlu.';
  END IF;

  IF NEW.tur = 'yuzde_indirim' AND (NEW.indirim_oran IS NULL OR NEW.indirim_oran <= 0 OR NEW.indirim_oran > 100) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'yuzde_indirim için indirim_oran (0-100] zorunlu.';
  END IF;

  IF NEW.tur = 'tutar_indirim' AND (NEW.indirim_tutar IS NULL OR NEW.indirim_tutar <= 0) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'tutar_indirim için indirim_tutar (>0) zorunlu.';
  END IF;
END$$

-- 12.g) Sipariş müşteriyle eşleşince: puan + hak (her gerekli_puan'da 1 hak)
CREATE TRIGGER trg_musteri_puan_ai
AFTER INSERT ON musteri_siparisleri
FOR EACH ROW
BEGIN
  DECLARE v_has_campaign INT DEFAULT 0;

  -- Bu siparişte kampanya kullanıldı mı?
  SELECT COUNT(*) INTO v_has_campaign
  FROM siparis_kampanyalari
  WHERE siparis_id = NEW.siparis_id;

  -- Eğer kampanya YOKSA → puan ekle
  IF v_has_campaign = 0 THEN
    UPDATE musteriler
    SET puan = puan + 1
    WHERE musteri_id = NEW.musteri_id;
  END IF;

END;


-- 12.h) Kampanya uygula: hak tüket + indirim yaz + toplam güncelle
CREATE PROCEDURE sp_kampanya_uygula(
  IN p_musteri_id INT,
  IN p_siparis_id INT,
  IN p_kampanya_id INT,
  IN p_urun_id INT   -- ucretsiz_urun'da opsiyonel; NULL ise kampanyanın odul_urun_id'si kullanılır
)
BEGIN
  DECLARE v_tur VARCHAR(20);
  DECLARE v_odul_urun INT;
  DECLARE v_oran DECIMAL(5,2);
  DECLARE v_tutar DECIMAL(10,2);
  DECLARE v_hak_id INT;
  DECLARE v_ind DECIMAL(10,2);
  DECLARE v_fiyat DECIMAL(10,2);

  IF NOT EXISTS (SELECT 1 FROM siparisler WHERE siparis_id=p_siparis_id AND musteri_id=p_musteri_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Kampanya sadece girişli müşterinin siparişinde kullanılabilir.';
  END IF;

  SELECT hak_id INTO v_hak_id
  FROM musteri_kampanya_haklari
  WHERE musteri_id = p_musteri_id AND kampanya_id = p_kampanya_id AND kullanildi = 0
  ORDER BY kazanma_tarih ASC LIMIT 1;

  IF v_hak_id IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Kullanılabilir kampanya hakkı yok.';
  END IF;

  SELECT tur, odul_urun_id, indirim_oran, indirim_tutar
    INTO v_tur, v_odul_urun, v_oran, v_tutar
  FROM kampanyalar
  WHERE kampanya_id = p_kampanya_id AND aktif = 1;

  IF v_tur IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Kampanya pasif veya bulunamadı.';
  END IF;

  IF v_tur = 'ucretsiz_urun' THEN
    IF p_urun_id IS NULL THEN
      SET p_urun_id = v_odul_urun;
    END IF;
    SELECT fiyat INTO v_fiyat FROM urunler WHERE urun_id = p_urun_id;
    SET v_ind = v_fiyat;
    INSERT INTO siparis_kampanyalari (siparis_id, kampanya_id, hak_id, etkilenen_urun_id, indirim_tutar, aciklama)
    VALUES (p_siparis_id, p_kampanya_id, v_hak_id, p_urun_id, v_ind, 'Kampanya: 1 adet ücretsiz');

  ELSEIF v_tur = 'yuzde_indirim' THEN
    SELECT IFNULL(SUM(tutar),0) INTO v_ind FROM siparis_urunleri WHERE siparis_id = p_siparis_id;
    SET v_ind = ROUND(v_ind * (v_oran/100.0), 2);
    INSERT INTO siparis_kampanyalari (siparis_id, kampanya_id, hak_id, indirim_tutar, aciklama)
    VALUES (p_siparis_id, p_kampanya_id, v_hak_id, v_ind, CONCAT('Kampanya: %', v_oran, ' indirim'));

  ELSEIF v_tur = 'tutar_indirim' THEN
    SET v_ind = v_tutar;
    INSERT INTO siparis_kampanyalari (siparis_id, kampanya_id, hak_id, indirim_tutar, aciklama)
    VALUES (p_siparis_id, p_kampanya_id, v_hak_id, v_ind, 'Kampanya: tutar indirimi');
  END IF;

  UPDATE musteri_kampanya_haklari
  SET kullanildi = 1, kullanma_tarih = NOW(), kullanilan_siparis_id = p_siparis_id
  WHERE hak_id = v_hak_id;

  CALL sp_siparis_toplam_guncelle(p_siparis_id);
END$$

DELIMITER ;


-- =========================================
-- GÖRÜNÜMLER
-- =========================================
CREATE OR REPLACE VIEW v_menu AS
SELECT k.kategori_adi, u.urun_id, u.urun_adi, u.aciklama, u.fiyat
FROM urunler u
JOIN kategoriler k ON k.kategori_id = u.kategori_id
WHERE u.aktif = 1 AND u.tukendi = 0
ORDER BY k.kategori_adi, u.urun_adi;

CREATE OR REPLACE VIEW v_kampanya_gecmis AS
SELECT mkh.musteri_id, k.ad AS kampanya, mkh.kazanma_tarih AS tarih, 'Kazandı' AS durum
FROM musteri_kampanya_haklari mkh
JOIN kampanyalar k ON k.kampanya_id = mkh.kampanya_id
UNION ALL
SELECT mkh.musteri_id, k.ad AS kampanya, mkh.kullanma_tarih AS tarih, 'Kullanıldı' AS durum
FROM musteri_kampanya_haklari mkh
JOIN kampanyalar k ON k.kampanya_id = mkh.kampanya_id
WHERE mkh.kullanildi = 1;

USE qr_siparis;

-- 1) GÜVENLİK VE TEMİZLİK (Eski verileri silme)
SET FOREIGN_KEY_CHECKS = 0; -- İlişki hatalarını geçici olarak kapat

-- Eksik sütun varsa eklemeyi dene (Eğer zaten varsa hata verebilir, ama script durmaz)
-- Not: Bu satır hata verirse "Duplicate column" demektir, görmezden gelip devam edebilirsiniz.
SET @exist := (SELECT COUNT(*) FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'urunler' AND column_name = 'resim_url');
SET @sql := IF(@exist = 0, 'ALTER TABLE urunler ADD COLUMN resim_url VARCHAR(255)', 'SELECT "Sütun zaten var"');
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Tabloları boşalt (ID'leri sıfırlar ve temiz kurulum yapar)
TRUNCATE TABLE siparis_kampanyalari;
TRUNCATE TABLE siparis_urunleri;
TRUNCATE TABLE musteri_siparisleri; -- Sipariş geçmişini de temizler (ID uyuşmazlığı olmaması için)
TRUNCATE TABLE siparisler;
TRUNCATE TABLE musteri_kampanya_haklari;
TRUNCATE TABLE kampanyalar;
TRUNCATE TABLE urunler;
TRUNCATE TABLE kategoriler;
TRUNCATE TABLE masalar;

-- 2) YENİ KATEGORİLERİ EKLE
INSERT INTO kategoriler (kategori_adi) VALUES 
('Sıcak İçecekler'),
('Kahveler'),
('Espressolar'),
('Soğuk Espressolar'),
('Kokteyller'),
('Soğuk İçecekler'),
('Pastalar & Kekler');

-- 3) YENİ ÜRÜNLERİ EKLE

-- A) SICAK İÇECEKLER (Kategori ID: 1)
INSERT INTO urunler (kategori_id, urun_adi, aciklama, fiyat, resim_url) VALUES
(1, 'Çay', 'Taze demlenmiş Rize çayı', 45.00, '/images/cay.jpg'),
(1, 'Sahlep', 'Tarçın süslemesi ile', 120.00, '/images/sahlep.jpg'),
(1, 'Sıcak Çikolata', 'Yoğun çikolata kıvamı', 120.00, '/images/sicak_cikolata.jpg'),
(1, 'Papatya Çayı', 'Rahatlatıcı bitki çayı', 110.00, '/images/papatya.jpg'),
(1, 'Hibiscus', 'Doğal hibiskus çayı', 110.00, '/images/hibiscus_hot.jpg'),
(1, 'Ihlamur', 'Limon dilimi ile', 110.00, '/images/ihlamur.jpg'),
(1, 'Kuşburnu', 'C vitamini deposu', 110.00, '/images/kusburnu.jpg'),
(1, 'Adaçayı', 'Doğal adaçayı', 110.00, '/images/adacayi.jpg'),
(1, 'Nane-Limon', 'Taze nane ve limon', 110.00, '/images/nane_limon.jpg'),
(1, 'Nar Çayı', 'Aromatik nar çayı', 110.00, '/images/nar_cayi.jpg'),
(1, 'Kış Çayı', 'Özel bitki karışımı', 110.00, '/images/kis_cayi.jpg');

-- B) KAHVELER (TÜRK KAHVESİ TÜREVLERİ) (Kategori ID: 2)
INSERT INTO urunler (kategori_id, urun_adi, aciklama, fiyat, resim_url) VALUES
(2, 'Türk Kahvesi', 'Geleneksel lezzet', 100.00, '/images/turk_kahvesi.jpg'),
(2, 'Dibek Kahvesi', 'Yumuşak içim', 100.00, '/images/dibek.jpg'),
(2, 'Menengiç Kahvesi', 'Sütlü ve yumuşak', 100.00, '/images/menengic.jpg'),
(2, 'Damla Sakızlı Türk Kahvesi', 'Ege esintisi', 100.00, '/images/sakizli_tk.jpg'),
(2, 'Dağ Çilekli Türk Kahvesi', 'Çilek aromalı', 100.00, '/images/cilekli_tk.jpg'),
(2, 'Çikolatalı Türk Kahvesi', 'Çikolata sevenlere', 100.00, '/images/cikolatali_tk.jpg'),
(2, 'Böğürtlen Aromalı Türk Kahvesi', 'Meyvemsi tat', 100.00, '/images/bogurtlenli_tk.jpg');

-- C) ESPRESSOLAR (Kategori ID: 3)
INSERT INTO urunler (kategori_id, urun_adi, aciklama, fiyat, resim_url) VALUES
(3, 'Latte', 'Espresso ve sıcak süt', 120.00, '/images/latte.jpg'),
(3, 'Aromalı Latte', 'Seçenekler: Vanilya, Karamel, Fındık, Toffee Nut, Pecan, Almond, Salted Caramel, Cookie', 140.00, '/images/aromali_latte.jpg'),
(3, 'Filtre Kahve', 'Günün kahvesi', 120.00, '/images/filtre_kahve.jpg'),
(3, 'Cortado', 'Eşit oranlı espresso ve süt', 130.00, '/images/cortado.jpg'),
(3, 'Americano', 'Sıcak su ile inceltilmiş espresso', 130.00, '/images/americano.jpg'),
(3, 'Caramel Macchiato', 'Vanilya, süt, espresso ve karamel sos', 140.00, '/images/caramel_macchiato.jpg'),
(3, 'Espresso', 'Tek shot yoğun kahve', 100.00, '/images/espresso.jpg'),
(3, 'Mocha', 'Çikolata (Mocha) veya Beyaz Çikolata (White Choc.)', 150.00, '/images/mocha.jpg'),
(3, 'Double Shot Espresso', 'Çift shot enerji', 130.00, '/images/double_espresso.jpg'),
(3, 'Flat White', 'İnce süt köpüğü ve double espresso', 130.00, '/images/flat_white.jpg'),
(3, 'Cappucino', 'Bol köpüklü', 140.00, '/images/cappucino.jpg');

-- D) SOĞUK ESPRESSOLAR (Kategori ID: 4)
INSERT INTO urunler (kategori_id, urun_adi, aciklama, fiyat, resim_url) VALUES
(4, 'Ice Americano', 'Buzlu espresso', 130.00, '/images/ice_americano.jpg'),
(4, 'Ice Latte', 'Buzlu sütlü kahve', 130.00, '/images/ice_latte.jpg'),
(4, 'Ice Macchiato', 'Soğuk süt lekesi', 130.00, '/images/ice_macchiato.jpg'),
(4, 'Ice Aromalı Latte', 'Soğuk Seçenekler: Vanilya, Karamel, Fındık, Toffee Nut, Cookie...', 140.00, '/images/ice_aromali_latte.jpg'),
(4, 'Ice Caramel Macchiato', 'Buzlu karamel rüyası', 140.00, '/images/ice_caramel_macchiato.jpg'),
(4, 'Ice Mocha', 'Buzlu çikolatalı kahve (White/Dark)', 150.00, '/images/ice_mocha.jpg'),
(4, 'Ice Filtre Kahve', 'Soğuk demlenmiş filtre kahve', 130.00, '/images/ice_filtre.jpg');

-- E) KOKTEYLLER (Kategori ID: 5)
INSERT INTO urunler (kategori_id, urun_adi, aciklama, fiyat, resim_url) VALUES
(5, 'Berry Hibiscus', 'Soğuk hibiskus, nar ve nanenin buluştuğu ferahlatıcı kokteyl.', 160.00, '/images/berry_hibiscus.jpg'),
(5, 'Cool Lime', 'Lime şurubu, buz ve kurutulmuş lime ile hazırlanmış serinletici kokteyl.', 160.00, '/images/cool_lime.jpg'),
(5, 'Mango Passion', 'Mango ve passion meyvesinin tropikal uyumu.', 160.00, '/images/mango_passion.jpg'),
(5, 'Homemade Ice Tea Lemon', 'Ev yapımı, doğal limonlu Ice Tea.', 160.00, '/images/icetea_lemon.jpg'),
(5, 'Ocean Jade', 'Elma, taze nane ve limonun Red Bull White ile buluşması.', 160.00, '/images/ocean_jade.jpg'),
(5, 'Sunset Breeze', 'Elma, çilek, nane ve soda.', 160.00, '/images/sunset_breeze.jpg'),
(5, 'Mojito', 'Taze nane, limon, soda ve Sprite.', 160.00, '/images/mojito.jpg'),
(5, 'Midnight Bloom', 'Nar, elma ve yaban mersininin Red Bull ile buluşması.', 160.00, '/images/midnight_bloom.jpg');

-- F) SOĞUK İÇECEKLER (Kategori ID: 6)
INSERT INTO urunler (kategori_id, urun_adi, aciklama, fiyat, resim_url) VALUES
(6, 'Frozen', 'Çilek, Mango, Yeşil Elma veya Çarkıfelek', 150.00, '/images/frozen.jpg'),
(6, 'Milkshake', 'Vanilya, Çikolata, Çilek veya Karamel', 150.00, '/images/milkshake.jpg'),
(6, 'Limonata', 'Çilek, Yeşil Elma veya Karpuz Çilek', 140.00, '/images/limonata.jpg'),
(6, 'Churchill', 'Tuz, limon suyu ve soda', 100.00, '/images/churchill.jpg'),
(6, 'Redbull', 'Enerji İçeceği', 120.00, '/images/redbull.jpg'),
(6, 'Karadut ve Frenk Üzümlü Soda', 'Aromalı soda', 75.00, '/images/soda_karadut.jpg'),
(6, 'Düşes Armudu Soda', 'Armut ve nektarin aromalı', 75.00, '/images/soda_armut.jpg'),
(6, 'Vişneli Meyve Suyu', 'Şişe', 60.00, '/images/visne_suyu.jpg'),
(6, 'Şeftalili Meyve Suyu', 'Şişe', 60.00, '/images/seftali_suyu.jpg'),
(6, 'Sade Soda', 'Mineral suyu', 50.00, '/images/sade_soda.jpg'),
(6, 'Su', 'Pet şişe su', 30.00, '/images/su.jpg'),
(6, 'Limonlu Soda', 'Limon aromalı', 75.00, '/images/limonlu_soda.jpg');

-- G) PASTALAR & KEKLER (Kategori ID: 7)
INSERT INTO urunler (kategori_id, urun_adi, aciklama, fiyat, resim_url) VALUES
(7, 'Brownie', 'İsteğe Bağlı Extra Belçika Çikolatası +30 TL', 270.00, '/images/brownie.jpg'),
(7, 'Lotuslu Tart', 'Lotus bisküvili özel tart', 280.00, '/images/lotus_tart.jpg'),
(7, 'San Sebastian', 'İsteğe Bağlı Extra Belçika Çikolatası +30 TL', 270.00, '/images/san_sebastian.jpg'),
(7, 'Blueberry Bomb', 'Yaban mersini şöleni', 270.00, '/images/blueberry_bomb.jpg'),
(7, 'Blueberry Tart', 'Taze yaban mersinli', 280.00, '/images/blueberry_tart.jpg'),
(7, 'Çikolatalı Magnolia', 'Özel krema ve çikolata', 180.00, '/images/mag_cikolata.jpg'),
(7, 'Red Velvet Magnolia', 'Kadife dokulu kek ile', 180.00, '/images/mag_redvelvet.jpg'),
(7, 'Yaban Mersini Magnolia', 'Meyveli hafif tatlı', 180.00, '/images/mag_yaban.jpg'),
(7, 'Mangolu Magnolia', 'Tropikal lezzet', 180.00, '/images/mag_mango.jpg'),
(7, 'Pistachio', 'Antep fıstıklı özel pasta', 330.00, '/images/pistachio.jpg'),
(7, 'Tiramisu', 'Orijinal italyan lezzeti', 280.00, '/images/tiramisu.jpg');

-- 4) MASALAR (5 Masa Örneği)
INSERT INTO masalar (masa_no, qr_kod) VALUES 
('Masa-1','QR001'), ('Masa-2','QR002'), ('Masa-3','QR003'), ('Bahçe-1','QR004'), ('Bahçe-2','QR005');

-- 5) ÖRNEK KAMPANYA: 5 puana 1 Espresso ücretsiz (Kategori ve ürün adı güncellendi)
INSERT INTO kampanyalar (ad, gerekli_puan, tur, odul_aciklama, odul_urun_id, aktif)
VALUES (
  '5 kahve alana 1 kahve bedava',
  5,
  'ucretsiz_urun',
  'Sonraki kahve ücretsiz (1 adet)',
  (SELECT u.urun_id FROM urunler u
     JOIN kategoriler k ON k.kategori_id=u.kategori_id
   WHERE k.kategori_adi='Espressolar' AND u.urun_adi='Espresso'
   LIMIT 1),
  1
);

SET FOREIGN_KEY_CHECKS = 1; -- Kontrolleri geri aç
-- MASALAR
INSERT INTO masalar (masa_no, qr_kod) VALUES
('masa1','QR001'),('masa2','QR002'),('masa3','QR003'),('masa4','QR004'),('masa5','QR005');

ALTER TABLE urunler ADD COLUMN maliyet DECIMAL(10,2) DEFAULT 0.00;
-- Örnek: Burger'in satış fiyatı 150 ama maliyeti 80 ise kârını hesaplayabiliriz.


DELIMITER $$

DROP TRIGGER IF EXISTS trg_su_bi$$

CREATE TRIGGER trg_su_bi
BEFORE INSERT ON siparis_urunleri
FOR EACH ROW
BEGIN
  DECLARE v_tukendi TINYINT;
  DECLARE v_aktif   TINYINT;

  -- Stok ve aktiflik kontrolü
  SELECT tukendi, aktif INTO v_tukendi, v_aktif FROM urunler WHERE urun_id = NEW.urun_id;
  IF v_tukendi = 1 OR v_aktif = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Ürün tükendi veya pasif.';
  END IF;

  -- FİYAT KONTROLÜ (DÜZELTME BURADA)
  -- Eğer Node.js tarafından bir tutar (örneğin 0) gönderildiyse ona dokunma.
  -- Sadece tutar boş (NULL) gelirse veritabanı kendisi hesaplasın.
  IF NEW.tutar IS NULL THEN
    SET NEW.tutar = fn_satir_tutar_hesapla(NEW.urun_id, NEW.adet);
  END IF;
  
END$$

DELIMITER ;