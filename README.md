# 🛡️ SteamWeb Authenticator — 100% Serverless Steam Guard & Onay Yöneticisi

[![Live Demo](https://img.shields.io/badge/Canl%C4%B1%20Uygulama-GitHub%20Pages-00d2ff?style=for-the-badge&logo=github)](https://srg-n.github.io/steamweb2fa/)

🌐 **Canlı Demo:** [https://srg-n.github.io/steamweb2fa/](https://srg-n.github.io/steamweb2fa/)

> **Sunucusuz (Zero-Backend), Tarayıcı İçi Steam Guard 2FA Kod Üretici & Toplu Takas/Pazar Onay Yöneticisi.**  
> Docker, harici veritabanı veya Node.js backend sunucusu gerektirmez. İster tek bir HTML dosyası olarak bilgisayarınızda çift tıklayarak açın, ister doğrudan GitHub Pages üzerinden kullanın!

---

## 🌟 Öne Çıkan Özellikler

- 🔐 **%100 İstemci Taraflı & Sunucusuz (Zero-Backend / Serverless):**  
  Tüm kriptografik hesaplamalar (RSA şifreleme, HMAC-SHA1 TOTP üretimi, HMAC-SHA256 oturum imzaları) doğrudan tarayıcınızın içinde `Web Crypto API` ve yerel `BigInt` ile gerçekleşir. Hiçbir veriniz üçüncü taraf sunuculara gitmez.
- ⚡ **Çevrimdışı (Offline) Steam Guard 2FA Kodları:**  
  Steam'in 5 karakterlik özel TOTP algoritması tamamen yerel olarak çalışır. İnternet bağlantınız olmasa dahi Steam Guard 2FA kodlarınız 30 saniyelik aralıklarla anında üretilir.
- 🚀 **Toplu Takas & Pazar Onayları (Bulk Confirmations):**  
  Steam'deki tüm takas tekliflerini (`Trade`), pazar listelemelerini (`Market`) ve mobil giriş onaylarını (`AuthSession`) tek ekranda görün. **300+ eşyayı tek tıkla topluca onaylayın** veya reddedin.
- 🔑 **Otomatik Steam Girişi & Çerez Alma (`steamLoginSecure`):**  
  F12 / DevTools / Application / Cookies ile uğraşmaya son! Steam kullanıcı adı ve şifrenizi girin; uygulama şifrenizi yerel RSA ile şifreler, 2FA kodunu anında otomatik çözüp Steam'e iletir ve oturum çerezinizi hesabınıza kaydeder.
- 🔄 **RefreshToken ile Tek Tıkla Oturum Yenileme:**  
  Steam'in resmi `GenerateAccessTokenForApp` Web API'si kullanılarak, şifre girmeden sadece RefreshToken ile oturum çerezinizi (`steamLoginSecure`) dilediğiniz zaman tek tıkla yenileyebilirsiniz.
- 📦 **Tek Dosya Taşınabilir HTML (`Single-File Bundle`):**  
  Derleme sonucu tüm CSS, JavaScript ve ikonlar tek bir [`frontend/dist/index.html`](frontend/dist/index.html) (456 KB) dosyasında birleştirilir. İndirip USB bellekte taşıyabilir veya tarayıcınızdan çift tıklayıp açabilirsiniz.
- ☁️ **Ücretsiz Cloudflare Worker CORS Proxy:**  
  Tarayıcıların CORS engeline takılmadan takas onaylarını çekebilmeniz için hazır bir Cloudflare Worker şablonu içerir (Cloudflare'in ücretsiz planında günde 100.000 istek hakkı vardır).
- 📁 **SDA (.maFile) Tam Uyumluluğu:**  
  Steam Desktop Authenticator (SDA) `.maFile` formatındaki hesapları tekli veya çoklu olarak sürükle-bırak yöntemiyle içe aktarabilir, yedeklerinizi dışa aktarabilirsiniz.
- 🌑 **AMOLED Dark Mode & Mobil Uyum:**  
  OLED ekranlar için özel tasarlanmış True Black (#000000) AMOLED arayüz, mobilde yerel uygulama hissi veren alt navigasyon barı ve Türkçe / İngilizce / Rusça dil desteği.

---

## 🚀 Hızlı Başlangıç

### Gereksinimler
- [Node.js](https://nodejs.org/) (v18 veya üzeri)
- [pnpm](https://pnpm.io/) (Önerilen) veya `npm`

### 1. Geliştirme Ortamı (Development)
```bash
# Bağımlılıkları yükleyin
pnpm install

# Geliştirme sunucusunu başlatın
pnpm dev
```
Tarayıcınızda `http://localhost:3000` adresini açın.

### 2. Tek Dosya Üretim Derlemesi (Build)
```bash
pnpm build
```
Derleme tamamlandığında `frontend/dist/index.html` dosyası oluşturulur. Bu dosyayı tarayıcınızda doğrudan açıp kullanabilirsiniz!

### 3. Testleri Çalıştırma
```bash
pnpm test
```
Tüm kriptografi, oturum yönetimi ve biçimlendirme birim testleri Vitest ile çalıştırılır.

---

## 🌐 GitHub Pages'e Dağıtım (Deploy to GitHub Pages)

Bu proje, göreli yol desteği (`base: './'`) ve istemci taraflı hash yönlendirmesi (`HashRouter`) ile GitHub Pages alt dizinlerinde (ör. `https://kullanici.github.io/steamweb/`) sıfır yapılandırmayla çalışır.

### Otomatik GitHub Actions ile Dağıtım

1. Projeyi GitHub reponuza pushlayın.
2. Reponuzda **Settings** > **Pages** menüsüne gidin.
3. **Build and deployment** > **Source** kısmını **GitHub Actions** olarak seçin.
4. `.github/workflows/pages.yml` adında bir dosya oluşturup aşağıdaki içeriği ekleyin:

```yaml
name: Deploy to GitHub Pages

on:
  push:
    branches: [ main ]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v4
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'pnpm'
          cache-dependency-path: frontend/pnpm-lock.yaml
      - name: Install dependencies
        run: pnpm --dir frontend install
      - name: Build Single-File App
        run: pnpm --dir frontend build
      - name: Upload Pages artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: frontend/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

---

## ☁️ Cloudflare Worker (CORS Proxy) Kurulumu

Tarayıcıların güvenlik politikaları (CORS) gereği, web sitelerinin Steam Community API'lerine doğrudan arka planda istek atması engellenebilir. Bunu çözmek için 2 dakikada ücretsiz kendi Cloudflare Worker'ınızı kurabilirsiniz:

1. [dash.cloudflare.com](https://dash.cloudflare.com) adresine gidin.
2. **Compute (Workers & Pages)** > **Create Application** > **Create Worker** adımlarını izleyin.
3. Açılan sayfada **Edit Code** butonuna tıklayın.
4. [`cloudflare-worker/worker.js`](cloudflare-worker/worker.js) dosyasındaki kodun tamamını yapıştırıp **Save and Deploy** deyin.
5. Size verilen adresi (ör. `https://steam-proxy.kullaniciadi.workers.dev`) kopyalayın.
6. Web uygulamasındaki **Ayarlar** sayfasından **CORS Proxy** kutusuna bu adresi yapıştırıp kaydedin.

> Detaylı rehber ve `PROXY_SECRET` şifreleme ayarları için [cloudflare-worker/README.md](cloudflare-worker/README.md) dosyasına göz atın.

---

## 🔒 Güvenlik & Gizlilik Mimarisi

- **Sıfır Sunucu İletimi:** Steam hesap bilgileriniz, `shared_secret`, `identity_secret`, şifreleriniz ve oturum çerezleriniz **asla** harici bir sunucuya iletilmez.
- **Yerel Tarayıcı İzolasyonu:** Tüm hesap ve oturum verileri tarayıcınızın güvenli yerel deposu olan `IndexedDB` içinde barınır. Başka bir sekme veya kullanıcı bu verilere erişemez.
- **Doğrudan İletişim:** Uygulama yalnızca resmi Steam sunucuları (`api.steampowered.com`, `steamcommunity.com`, `login.steampowered.com`) ve sizin kurduğunuz kişisel Cloudflare Worker ile haberleşir.
- **Git Koruma Kuralları:** `.gitignore` dosyası `.maFile`, `.env` ve kişisel veri kalıntılarını engelleyecek şekilde sıkılaştırılmıştır.

---

## 👏 Teşekkür & Referans (Credits)

Bu proje, [feskolech/steamwebauthenticator](https://github.com/feskolech/steamwebauthenticator/) projesi temel alınarak geliştirilmiştir. Orijinal projedeki Docker, harici backend ve veritabanı bağımlılıkları tamamen kaldırılarak, %100 istemci taraflı (serverless), bağımsız ve taşınabilir bir PWA web uygulaması olarak yeniden tasarlanmıştır. Açık kaynak katkıları için [feskolech](https://github.com/feskolech)'e teşekkür ederiz.

---

## 📄 Lisans

Bu proje [MIT Lisansı](LICENSE) kapsamında açık kaynak olarak sunulmaktadır.
