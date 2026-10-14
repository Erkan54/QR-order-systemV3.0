# QR Sipariş Sistemi · v3.0

![JavaScript](https://img.shields.io/badge/JavaScript-ES6-F7DF1E?logo=javascript&logoColor=black)
![Node.js](https://img.shields.io/badge/Node.js-Express-339933?logo=node.js&logoColor=white)
![MySQL](https://img.shields.io/badge/MySQL-Veritabanı-4479A1?logo=mysql&logoColor=white)

Kafe ve restoranlar için dijital QR menü, masa siparişi, müşteri ekranları ve işletme yönetimi. Masaüstündeki `qrrr_siparis` projesinin güncel kaynaklarıdır; V3 deposunun mevcut Git geçmişi korunmuştur.

## Bileşenler

- Node.js / Express sunucusu, MySQL veri katmanı ve oturum yönetimi.
- Müşteri, garson, yönetici ve işletme sahibi ekranları.
- Ürün/kategori yönetimi, varyasyonlar, kampanyalar, sipariş ve adisyon akışı.
- Ortam değişkenleriyle yapılandırılan WhatsApp entegrasyonu.

## Yerel kurulum

1. Node.js ve MySQL kurun; boş `qr_siparis` veritabanını ve uygulama kullanıcısını oluşturun.
2. `database/schema.sql` dosyasını boş veritabanına içe aktarın.
3. `.env.example` dosyasını `.env` olarak kopyalayıp DB ve SESSION_SECRET alanlarını doldurun.
4. `npm ci` ve `npm start` çalıştırın; varsayılan port 3000'dir.
5. Kullanıcı, kategori, ürün ve masaları kendi geliştirme verilerinizle oluşturun. Şema hazır kullanıcı veya parola içermez.

`seed_varyasyon.js` mevcut ürünler için yardımcı betiktir; tam başlangıç verisi değildir.

## Yayın kapsamı

Gerçek `.env`, müşteri/sipariş satırları içeren SQL yedekleri, adisyon PDF'leri ve `node_modules` paylaşılmaz. `database/schema.sql` yalnızca tablo yapıları içerir. Firebase veya bulut dağıtımı otomatik yapılmaz.

Bu aktarım kaynak kodunun korunmasına odaklanır. Mevcut kullanıcı girişi ve oturum tasarımının üretim güvenliği ayrıca incelenmelidir; yalnızca JavaScript sözdizimi doğrulaması uçtan uca işletme testi sayılmaz.

## Kaynak haritası ve sürüm ilişkisi

| Konum | Sorumluluk |
| --- | --- |
| [`server.js`](server.js) | Express REST uçları, oturumlar ve MySQL işlemleri |
| [`public/`](public/) | Müşteri, yönetici ve işletme sahibi ekranları |
| [`database/schema.sql`](database/schema.sql) | Veri satırı içermeyen 20 tablo tanımı |
| [`.env.example`](.env.example) | Yerel ortam değişkenlerinin örneği |
| [`seed_varyasyon.js`](seed_varyasyon.js) | Mevcut ürünler için varyasyon yardımcısı |

Sürüm ailesinin önceki kaynakları [V2 arşivi](https://github.com/Erkan54/QR-order-systemV2.0) ve [sunucu prototipi](https://github.com/Erkan54/QR-order-system) depolarındadır. Repo/sürüm adları tarihsel arşivi temsil eder; eski depolardaki paket sürümleriyle karıştırılmamalıdır. Bu README düzenlemesi canlı bir sunucuyu veya veritabanını güncellemez.
