-- Empty schema extracted from the local development database. No customer data.
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS=0;

CREATE TABLE `arsiv` (
  `id` int NOT NULL AUTO_INCREMENT,
  `siparis_id` int NOT NULL,
  `masa_no` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `toplam_tutar` decimal(10,2) NOT NULL,
  `arsiv_tarih` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `ix_arsiv_tarih` (`arsiv_tarih`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `kampanya_kosullari` (
  `id` int NOT NULL AUTO_INCREMENT,
  `kampanya_id` int NOT NULL,
  `tip` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `hedef_id` int DEFAULT NULL,
  `miktar` int DEFAULT '1',
  PRIMARY KEY (`id`),
  KEY `fk_kosul_kampanya` (`kampanya_id`),
  CONSTRAINT `fk_kosul_kampanya` FOREIGN KEY (`kampanya_id`) REFERENCES `kampanyalar` (`kampanya_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `kampanya_odulleri` (
  `id` int NOT NULL AUTO_INCREMENT,
  `kampanya_id` int NOT NULL,
  `tip` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `hedef_id` int NOT NULL,
  `adet` int DEFAULT '1',
  `indirim_oran` decimal(5,2) DEFAULT '100.00',
  PRIMARY KEY (`id`),
  KEY `fk_odul_kampanya` (`kampanya_id`),
  CONSTRAINT `fk_odul_kampanya` FOREIGN KEY (`kampanya_id`) REFERENCES `kampanyalar` (`kampanya_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `kampanyalar` (
  `kampanya_id` int NOT NULL AUTO_INCREMENT,
  `ad` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `gerekli_puan` int NOT NULL,
  `tur` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `odul_urun_id` int DEFAULT NULL,
  `indirim_oran` decimal(5,2) DEFAULT NULL,
  `indirim_tutar` decimal(10,2) DEFAULT NULL,
  `odul_aciklama` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `aktif` tinyint(1) DEFAULT '1',
  `olusturma_tarih` datetime DEFAULT CURRENT_TIMESTAMP,
  `secim_sayisi` int DEFAULT '0',
  `uyelere_ozel` tinyint DEFAULT '0',
  PRIMARY KEY (`kampanya_id`),
  KEY `fk_kampanya_odul` (`odul_urun_id`),
  CONSTRAINT `fk_kampanya_odul` FOREIGN KEY (`odul_urun_id`) REFERENCES `urunler` (`urun_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `ck_oran` CHECK (((`indirim_oran` is null) or ((`indirim_oran` > 0) and (`indirim_oran` <= 100)))),
  CONSTRAINT `ck_tutar` CHECK (((`indirim_tutar` is null) or (`indirim_tutar` > 0)))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `kategori_grup_detay` (
  `id` int NOT NULL AUTO_INCREMENT,
  `grup_id` int NOT NULL,
  `kategori_id` int DEFAULT NULL,
  `urun_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_kgd_grup` (`grup_id`),
  KEY `fk_kgd_kat` (`kategori_id`),
  CONSTRAINT `fk_kgd_grup` FOREIGN KEY (`grup_id`) REFERENCES `kategori_gruplari` (`grup_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_kgd_kat` FOREIGN KEY (`kategori_id`) REFERENCES `kategoriler` (`kategori_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `kategori_gruplari` (
  `grup_id` int NOT NULL AUTO_INCREMENT,
  `grup_adi` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  PRIMARY KEY (`grup_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `kategoriler` (
  `kategori_id` int NOT NULL AUTO_INCREMENT,
  `kategori_adi` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  PRIMARY KEY (`kategori_id`),
  UNIQUE KEY `uk_kategori_adi` (`kategori_adi`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `kullanicilar` (
  `id` int NOT NULL AUTO_INCREMENT,
  `kullanici_adi` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `sifre_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `rol` enum('admin','garson','mutfak') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'garson',
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_kullanici_adi` (`kullanici_adi`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `masa_token` (
  `token` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `masa_id` int NOT NULL,
  `expire_at` datetime NOT NULL,
  PRIMARY KEY (`token`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `masalar` (
  `masa_id` int NOT NULL AUTO_INCREMENT,
  `masa_no` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `qr_kod` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  PRIMARY KEY (`masa_id`),
  UNIQUE KEY `uk_masa_no` (`masa_no`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `musteri_kampanya_haklari` (
  `hak_id` int NOT NULL AUTO_INCREMENT,
  `musteri_id` int NOT NULL,
  `kampanya_id` int NOT NULL,
  `kazanma_tarih` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `kullanildi` tinyint(1) NOT NULL DEFAULT '0',
  `kullanma_tarih` datetime DEFAULT NULL,
  `kullanilan_siparis_id` int DEFAULT NULL,
  PRIMARY KEY (`hak_id`),
  KEY `fk_mkh_kampanya` (`kampanya_id`),
  KEY `ix_mkh_musteri_kampanya` (`musteri_id`,`kampanya_id`,`kullanildi`),
  CONSTRAINT `fk_mkh_kampanya` FOREIGN KEY (`kampanya_id`) REFERENCES `kampanyalar` (`kampanya_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_mkh_musteri` FOREIGN KEY (`musteri_id`) REFERENCES `musteriler` (`musteri_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `musteri_kampanyalari` (
  `id` int NOT NULL AUTO_INCREMENT,
  `musteri_id` int NOT NULL,
  `kampanya_id` int NOT NULL,
  `kazanma_tarih` datetime DEFAULT CURRENT_TIMESTAMP,
  `kullanildi` tinyint(1) DEFAULT '0',
  `kullanilan_siparis_id` int DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `ix_mk_musteri` (`musteri_id`),
  KEY `ix_mk_kampanya` (`kampanya_id`),
  CONSTRAINT `fk_mk_kampanya` FOREIGN KEY (`kampanya_id`) REFERENCES `kampanyalar` (`kampanya_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_mk_musteri` FOREIGN KEY (`musteri_id`) REFERENCES `musteriler` (`musteri_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `musteri_siparisleri` (
  `id` int NOT NULL AUTO_INCREMENT,
  `musteri_id` int NOT NULL,
  `siparis_id` int NOT NULL,
  `tarih` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_musteri_siparis` (`musteri_id`,`siparis_id`),
  KEY `fk_ms_siparis` (`siparis_id`),
  CONSTRAINT `fk_ms_musteri` FOREIGN KEY (`musteri_id`) REFERENCES `musteriler` (`musteri_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_ms_siparis` FOREIGN KEY (`siparis_id`) REFERENCES `siparisler` (`siparis_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `musteriler` (
  `musteri_id` int NOT NULL AUTO_INCREMENT,
  `ad_soyad` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `email` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `telefon` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `sifre_hash` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `puan` int NOT NULL DEFAULT '0',
  `kayit_tarih` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`musteri_id`),
  UNIQUE KEY `email` (`email`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `siparis_kampanyalari` (
  `id` int NOT NULL AUTO_INCREMENT,
  `siparis_id` int NOT NULL,
  `kampanya_id` int NOT NULL,
  `hak_id` int DEFAULT NULL,
  `etkilenen_urun_id` int DEFAULT NULL,
  `indirim_tutar` decimal(10,2) NOT NULL DEFAULT '0.00',
  `aciklama` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  PRIMARY KEY (`id`),
  KEY `fk_sk_siparis` (`siparis_id`),
  KEY `fk_sk_kampanya` (`kampanya_id`),
  KEY `fk_sk_hak` (`hak_id`),
  CONSTRAINT `fk_sk_hak` FOREIGN KEY (`hak_id`) REFERENCES `musteri_kampanya_haklari` (`hak_id`) ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT `fk_sk_kampanya` FOREIGN KEY (`kampanya_id`) REFERENCES `kampanyalar` (`kampanya_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_sk_siparis` FOREIGN KEY (`siparis_id`) REFERENCES `siparisler` (`siparis_id`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `siparis_urunleri` (
  `id` int NOT NULL AUTO_INCREMENT,
  `siparis_id` int NOT NULL,
  `urun_id` int NOT NULL,
  `adet` int NOT NULL DEFAULT '1',
  `tutar` decimal(10,2) DEFAULT NULL,
  `varyasyon_id` int DEFAULT NULL,
  `ekstra_not` text COLLATE utf8mb4_general_ci,
  PRIMARY KEY (`id`),
  KEY `ix_su_siparis` (`siparis_id`),
  KEY `ix_su_urun` (`urun_id`),
  KEY `fk_su_varyasyon` (`varyasyon_id`),
  CONSTRAINT `fk_su_siparis` FOREIGN KEY (`siparis_id`) REFERENCES `siparisler` (`siparis_id`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT `fk_su_urun` FOREIGN KEY (`urun_id`) REFERENCES `urunler` (`urun_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_su_varyasyon` FOREIGN KEY (`varyasyon_id`) REFERENCES `urun_varyasyonlari` (`varyasyon_id`) ON DELETE SET NULL,
  CONSTRAINT `ck_su_adet` CHECK ((`adet` > 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `siparisler` (
  `siparis_id` int NOT NULL AUTO_INCREMENT,
  `masa_id` int NOT NULL,
  `musteri_id` int DEFAULT NULL,
  `durum` enum('Hazırlanıyor','Hazır','Teslim Edildi','İptal') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Hazırlanıyor',
  `tarih` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `toplam_tutar` decimal(10,2) NOT NULL DEFAULT '0.00',
  `siparis_notu` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `odeme_turu` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL,
  `gorunurluk` tinyint DEFAULT '1',
  PRIMARY KEY (`siparis_id`),
  KEY `fk_siparis_musteri` (`musteri_id`),
  KEY `ix_siparis_masa_durum` (`masa_id`,`durum`),
  KEY `ix_siparis_tarih` (`tarih`),
  CONSTRAINT `fk_siparis_masa` FOREIGN KEY (`masa_id`) REFERENCES `masalar` (`masa_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `fk_siparis_musteri` FOREIGN KEY (`musteri_id`) REFERENCES `musteriler` (`musteri_id`) ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `urun_ekstralari` (
  `ekstra_id` int NOT NULL AUTO_INCREMENT,
  `urun_id` int NOT NULL,
  `ad` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `fiyat_farki` decimal(10,2) DEFAULT '0.00',
  `tip` enum('ekstra','cikar') COLLATE utf8mb4_general_ci DEFAULT 'ekstra',
  PRIMARY KEY (`ekstra_id`),
  KEY `fk_ekstra_urun` (`urun_id`),
  CONSTRAINT `fk_ekstra_urun` FOREIGN KEY (`urun_id`) REFERENCES `urunler` (`urun_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `urun_varyasyonlari` (
  `varyasyon_id` int NOT NULL AUTO_INCREMENT,
  `urun_id` int NOT NULL,
  `ad` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `fiyat_farki` decimal(10,2) DEFAULT '0.00',
  PRIMARY KEY (`varyasyon_id`),
  KEY `fk_varyasyon_urun` (`urun_id`),
  CONSTRAINT `fk_varyasyon_urun` FOREIGN KEY (`urun_id`) REFERENCES `urunler` (`urun_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE `urunler` (
  `urun_id` int NOT NULL AUTO_INCREMENT,
  `kategori_id` int NOT NULL,
  `urun_adi` varchar(255) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL,
  `aciklama` text CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci,
  `fiyat` decimal(10,2) NOT NULL,
  `aktif` tinyint(1) NOT NULL DEFAULT '1',
  `tukendi` tinyint(1) NOT NULL DEFAULT '0',
  `kdv` tinyint unsigned NOT NULL DEFAULT '0',
  `resim_url` longtext COLLATE utf8mb4_general_ci,
  `maliyet` decimal(10,2) DEFAULT '0.00',
  `puan_degeri` int NOT NULL DEFAULT '1',
  `resim_original` longtext COLLATE utf8mb4_general_ci,
  PRIMARY KEY (`urun_id`),
  UNIQUE KEY `uk_kategori_urun` (`kategori_id`,`urun_adi`),
  CONSTRAINT `fk_urun_kategori` FOREIGN KEY (`kategori_id`) REFERENCES `kategoriler` (`kategori_id`) ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT `ck_urun_fiyat` CHECK ((`fiyat` >= 0))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

SET FOREIGN_KEY_CHECKS=1;
