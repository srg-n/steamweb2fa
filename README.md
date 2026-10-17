# 🛡️ SteamWeb Authenticator

<div align="center">

[![Live Demo](https://img.shields.io/badge/Live%20Demo-GitHub%20Pages-00d2ff?style=for-the-badge&logo=github)](https://srg-n.github.io/steamweb2fa/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg?style=for-the-badge)](LICENSE)
[![PWA Ready](https://img.shields.io/badge/PWA-Ready-10b981?style=for-the-badge&logo=pwa)](https://srg-n.github.io/steamweb2fa/)

🌐 **Live Application:** [https://srg-n.github.io/steamweb2fa/](https://srg-n.github.io/steamweb2fa/)

#### (Choose language / Dil seçin)
[🇬🇧 English Version](#-english-version) &nbsp;•&nbsp; [🇹🇷 Türkçe Versiyon](#-türkçe-versiyon)

---
</div>

## 🇬🇧 English Version

> **Serverless (Zero-Backend), 100% In-Browser Steam Guard 2FA Authenticator & Bulk Confirmation Manager.**  
> No Docker, external database, or Node.js backend required. Run it locally as a standalone HTML file or directly on GitHub Pages!

### 🌟 Key Features

- 🔐 **100% Client-Side & Serverless (Zero-Backend):**  
  All cryptographic operations (RSA encryption, HMAC-SHA1 TOTP generation, HMAC-SHA256 session signatures) run directly inside your browser via native `Web Crypto API` and `BigInt`. No private keys or passwords ever touch any backend server.
- ⚡ **Offline Steam Guard 2FA Codes:**  
  Steam's proprietary 5-character TOTP algorithm runs purely locally. Even without internet access, your 2FA codes are generated instantly every 30 seconds.
- 🚀 **Bulk Trade & Market Confirmations:**  
  View all incoming trade offers (`Trade`), market listings (`Market`), and login requests (`AuthSession`) in a unified feed. **Accept or decline 300+ items with a single click**.
- 🔑 **Automated Steam Login & Cookie Acquisition (`steamLoginSecure`):**  
  No need to inspect browser DevTools (F12) to copy cookies manually! Enter your Steam credentials, and the app encrypts your password via local RSA, solves the 2FA prompt automatically, and secures your `steamLoginSecure` session cookie.
- 🔄 **One-Click Session Refresh via RefreshToken:**  
  Refreshes your `steamLoginSecure` session cookie seamlessly without re-entering passwords using official Steam Web OAuth renewal endpoints (`login.steampowered.com/jwt/finalizelogin`).
- 📦 **Single-File Portable HTML Bundle:**  
  The production build bundles all CSS, JS, and icons into a single [`frontend/dist/index.html`](frontend/dist/index.html) file (~450 KB). Download it to a USB drive or open it directly in any browser offline.
- ☁️ **Free Cloudflare Worker CORS Proxy:**  
  Includes a ready-to-deploy Cloudflare Worker template to bypass browser CORS restrictions when fetching confirmations (free tier includes 100,000 requests/day).
- 📁 **Full Steam Desktop Authenticator (SDA) Compatibility:**  
  Import and export `.maFile` backups individually or in bulk via drag-and-drop.
- 🌑 **AMOLED Dark Mode & Mobile PWA:**  
  True Black (#000000) interface tailored for OLED displays, a mobile-first bottom navigation bar, and full multi-language support (English, Turkish, Russian).

---

### 🚀 Quick Start

#### Prerequisites
- [Node.js](https://nodejs.org/) (v18 or higher)
- [pnpm](https://pnpm.io/) (Recommended) or `npm`

#### 1. Development Mode
```bash
# Install dependencies
pnpm install

# Start development server
pnpm dev
```
Open `http://localhost:3000` in your browser.

#### 2. Single-File Production Build
```bash
pnpm build
```
The compiled single-file bundle will be placed at `frontend/dist/index.html`. You can open this file in any browser directly!

#### 3. Running Unit Tests
```bash
pnpm test
```
Executes all unit tests for cryptography, session management, and formatting using Vitest.

---

### 🌐 Deploying to GitHub Pages

This project uses relative paths (`base: './'`) and client-side hash routing (`HashRouter`), allowing zero-configuration deployment to any GitHub Pages subfolder (e.g., `https://username.github.io/steamweb2fa/`).

#### Automatic Deployment via GitHub Actions

1. Push this repository to GitHub.
2. In your repo, go to **Settings** > **Pages**.
3. Under **Build and deployment** > **Source**, select **GitHub Actions**.
4. Create `.github/workflows/pages.yml` with the following content:

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

### ☁️ Cloudflare Worker (CORS Proxy) Setup

Browsers enforce CORS policies that restrict client-side scripts from reading responses from `steamcommunity.com`. To fetch and accept confirmations inside the app, deploy your own free Cloudflare Worker in under 2 minutes:

1. Log in to [dash.cloudflare.com](https://dash.cloudflare.com).
2. Go to **Compute (Workers & Pages)** > **Create Application** > **Create Worker**.
3. Click **Edit Code**.
4. Paste the entire contents of [`cloudflare-worker/worker.js`](cloudflare-worker/worker.js) and click **Save and Deploy**.
5. Copy your assigned Worker URL (e.g., `https://steam-proxy.username.workers.dev`).
6. In SteamWeb's **Settings** tab, paste this address into the **CORS Proxy** field and save.

> See [cloudflare-worker/README.md](cloudflare-worker/README.md) for full instructions and `PROXY_SECRET` security configuration.

---

### 🔒 Security & Privacy Architecture

- **Zero External Server Transmission:** Your Steam secrets, `shared_secret`, `identity_secret`, passwords, and session cookies are **never** transmitted to any third-party backend.
- **Isolated Browser Storage:** All data is persisted in your local browser sandbox via `IndexedDB`. No other website or tab can access it.
- **No Plain-Text Fallback:** Accounts (which contain your Steam secrets) live **only** in IndexedDB. Older versions mirrored them into `localStorage` as plain text; those copies are now deleted automatically on startup. If IndexedDB is unavailable (private windows, blocked storage), the app shows a warning and refuses to persist secrets instead of silently downgrading. Only non-sensitive data (folders, tags, logs, UI settings) keeps a `localStorage` mirror.
- **Encrypted Vault:** Your Steam secrets can be encrypted with AES-GCM. Each value gets its own random one-time code, and the encryption also stamps the account id and field name into the data, so an encrypted value copied from one account into another no longer opens. One randomly generated key encrypts everything and is never written to disk: only locked copies of it are stored, and the key comes either from a **passkey on your device (WebAuthn PRF)** — which never exposes the key to the app's JavaScript — or from a **recovery passphrase** you type yourself (stretched with PBKDF2-SHA-256, 600,000 rounds). The vault locks itself after a period of inactivity and immediately when you switch to another tab. Turning it on re-encrypts the accounts you already added. You can start it under **Settings → Encrypted Vault**.
- **Content Security Policy:** The production build ships a strict policy: the only scripts allowed to run are the exact copies inlined into the page, matched by their SHA-256 fingerprint. No `'unsafe-inline'`, no `'unsafe-eval'`, plus `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` and a tight `connect-src`.
- **Trusted Types:** `require-trusted-types-for 'script'` is enabled, so an injected DOM node cannot be turned into executable script or a script URL. The only allowed policy is `steamguard-url`, used for the service worker URL.
- **Direct Communication:** The app communicates solely with official Valve endpoints (`api.steampowered.com`, `steamcommunity.com`, `login.steampowered.com`) and your personal Cloudflare Worker.

#### Hardening knobs

| Knob | How |
|---|---|
| Restrict network access | Build with `CSP_CONNECT_ORIGINS="https://proxy.yoursite.com"` and the app is only allowed to reach that address. Without this value any HTTPS address is allowed, so a self-hosted CORS proxy keeps working. |
| Server headers | `frontend/public/_headers` is applied automatically by Cloudflare Pages and Netlify; copy the same headers into other hosts manually. |
| CSP check | `pnpm build` fails if one of the bundled scripts is not on the allow list or if a Steam address is missing from it. |

If you host the app yourself, add these **HTTP headers** (a `<meta>` CSP cannot set them):

```
Content-Security-Policy: frame-ancestors 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

These are already bundled in `frontend/public/_headers`; the snippet is here for other hosts.

> **Backup files contain decrypted secrets by design.** A JSON export is your portable
> copy (.maFile style). It is also the only recovery path if you lose both the passkey and
> the recovery passphrase, so treat that file like a password file.

> **Passkey not working? Two usual causes.**
>
> 1. **Where the passkey was saved.** Chrome's own profile does not support the PRF
>    extension. When Chrome asks where to keep the passkey, pick Google Password
>    Manager (or 1Password / Bitwarden) instead.
> 2. **Operating system age.** On Windows, Windows Hello only returns a PRF key after
>    the February 2026 update on Windows 11 24H2 / 25H2, and Chrome/Edge needs 147+
>    (Firefox 148+). macOS 15+ and Android work through iCloud Keychain / Google
>    Password Manager.
>
> Neither blocks the vault: the recovery passphrase gives the same protection, and a
> passkey can be added later under Settings.

---

### 👏 Credits & Attribution

This project was inspired by and builds upon the concepts in [feskolech/steamwebauthenticator](https://github.com/feskolech/steamwebauthenticator/). The Docker container, external backend, and server database dependencies were eliminated and redesigned into a 100% client-side, portable PWA. Special thanks to [feskolech](https://github.com/feskolech) for the open-source inspiration.

---

### 📄 License

This project is licensed under the [MIT License](LICENSE).

<div align="right">
  <a href="#-steamweb-authenticator">⬆ Back to top</a>
</div>

---

## 🇹🇷 Türkçe Versiyon

> **Sunucusuz (Zero-Backend), Tarayıcı İçi Steam Guard 2FA Kod Üretici & Toplu Takas/Pazar Onay Yöneticisi.**  
> Docker, harici veritabanı veya Node.js backend sunucusu gerektirmez. İster tek bir HTML dosyası olarak bilgisayarınızda çift tıklayarak açın, ister doğrudan GitHub Pages üzerinden kullanın!

### 🌟 Öne Çıkan Özellikler

- 🔐 **%100 İstemci Taraflı & Sunucusuz (Zero-Backend / Serverless):**  
  Tüm kriptografik hesaplamalar (RSA şifreleme, HMAC-SHA1 TOTP üretimi, HMAC-SHA256 oturum imzaları) doğrudan tarayıcınızın içinde `Web Crypto API` ve yerel `BigInt` ile gerçekleşir. Hiçbir veriniz üçüncü taraf sunuculara gitmez.
- ⚡ **Çevrimdışı (Offline) Steam Guard 2FA Kodları:**  
  Steam'in 5 karakterlik özel TOTP algoritması tamamen yerel olarak çalışır. İnternet bağlantınız olmasa dahi Steam Guard 2FA kodlarınız 30 saniyelik aralıklarla anında üretilir.
- 🚀 **Toplu Takas & Pazar Onayları (Bulk Confirmations):**  
  Steam'deki tüm takas tekliflerini (`Trade`), pazar listelemelerini (`Market`) ve mobil giriş onaylarını (`AuthSession`) tek ekranda görün. **300+ eşyayı tek tıkla topluca onaylayın** veya reddedin.
- 🔑 **Otomatik Steam Girişi & Çerez Alma (`steamLoginSecure`):**  
  F12 / DevTools / Application / Cookies ile uğraşmaya son! Steam kullanıcı adı ve şifrenizi girin; uygulama şifrenizi yerel RSA ile şifreler, 2FA kodunu anında otomatik çözüp Steam'e iletir ve oturum çerezinizi hesabınıza kaydeder.
- 🔄 **RefreshToken ile Tek Tıkla Oturum Yenileme:**  
  Steam'in resmi OAuth yenileme akışı (`login.steampowered.com/jwt/finalizelogin`) kullanılarak, şifre girmeden sadece RefreshToken ile oturum çerezinizi (`steamLoginSecure`) dilediğiniz zaman tek tıkla yenileyebilirsiniz.
- 📦 **Tek Dosya Taşınabilir HTML (`Single-File Bundle`):**  
  Derleme sonucu tüm CSS, JavaScript ve ikonlar tek bir [`frontend/dist/index.html`](frontend/dist/index.html) (450 KB) dosyasında birleştirilir. İndirip USB bellekte taşıyabilir veya tarayıcınızdan çift tıklayıp açabilirsiniz.
- ☁️ **Ücretsiz Cloudflare Worker CORS Proxy:**  
  Tarayıcıların CORS engeline takılmadan takas onaylarını çekebilmeniz için hazır bir Cloudflare Worker şablonu içerir (Cloudflare'in ücretsiz planında günde 100.000 istek hakkı vardır).
- 📁 **SDA (.maFile) Tam Uyumluluğu:**  
  Steam Desktop Authenticator (SDA) `.maFile` formatındaki hesapları tekli veya çoklu olarak sürükle-bırak yöntemiyle içe aktarabilir, yedeklerinizi dışa aktarabilirsiniz.
- 🌑 **AMOLED Dark Mode & Mobil Uyum:**  
  OLED ekranlar için özel tasarlanmış True Black (#000000) AMOLED arayüz, mobilde yerel uygulama hissi veren alt navigasyon barı ve Türkçe / İngilizce / Rusça dil desteği.

---

### 🚀 Hızlı Başlangıç

#### Gereksinimler
- [Node.js](https://nodejs.org/) (v18 veya üzeri)
- [pnpm](https://pnpm.io/) (Önerilen) veya `npm`

#### 1. Geliştirme Ortamı (Development)
```bash
# Bağımlılıkları yükleyin
pnpm install

# Geliştirme sunucusunu başlatın
pnpm dev
```
Tarayıcınızda `http://localhost:3000` adresini açın.

#### 2. Tek Dosya Üretim Derlemesi (Build)
```bash
pnpm build
```
Derleme tamamlandığında `frontend/dist/index.html` dosyası oluşturulur. Bu dosyayı tarayıcınızda doğrudan açıp kullanabilirsiniz!

#### 3. Testleri Çalıştırma
```bash
pnpm test
```
Tüm kriptografi, oturum yönetimi ve biçimlendirme birim testleri Vitest ile çalıştırılır.

---

### 🌐 GitHub Pages'e Dağıtım (Deploy to GitHub Pages)

Bu proje, göreli yol desteği (`base: './'`) ve istemci taraflı hash yönlendirmesi (`HashRouter`) ile GitHub Pages alt dizinlerinde (ör. `https://kullanici.github.io/steamweb2fa/`) sıfır yapılandırmayla çalışır.

#### Otomatik GitHub Actions ile Dağıtım

1. Projeyi GitHub reponuza pushlayın.
2. Reponuzda **Settings** > **Pages** menüsüne gidin.
3. **Build and deployment** > **Source** kısmını **GitHub Actions** olarak seçin.
4. `.github/workflows/pages.yml` adında bir dosya oluşturup workflow'u ekleyin.

---

### ☁️ Cloudflare Worker (CORS Proxy) Kurulumu

Tarayıcıların güvenlik politikaları (CORS) gereği, web sitelerinin Steam Community API'lerine doğrudan arka planda istek atması engellenebilir. Bunu çözmek için 2 dakikada ücretsiz kendi Cloudflare Worker'ınızı kurabilirsiniz:

1. [dash.cloudflare.com](https://dash.cloudflare.com) adresine gidin.
2. **Compute (Workers & Pages)** > **Create Application** > **Create Worker** adımlarını izleyin.
3. Açılan sayfada **Edit Code** butonuna tıklayın.
4. [`cloudflare-worker/worker.js`](cloudflare-worker/worker.js) dosyasındaki kodun tamamını yapıştırıp **Save and Deploy** deyin.
5. Size verilen adresi (ör. `https://steam-proxy.kullaniciadi.workers.dev`) kopyalayın.
6. Web uygulamasındaki **Ayarlar** sayfasından **CORS Proxy** kutusuna bu adresi yapıştırıp kaydedin.

> Detaylı rehber ve `PROXY_SECRET` şifreleme ayarları için [cloudflare-worker/README.md](cloudflare-worker/README.md) dosyasına göz atın.

---

### 🔒 Güvenlik & Gizlilik Mimarisi

- **Sıfır Sunucu İletimi:** Steam hesap bilgileriniz, `shared_secret`, `identity_secret`, şifreleriniz ve oturum çerezleriniz **asla** harici bir sunucuya iletilmez.
- **Yerel Tarayıcı İzolasyonu:** Tüm hesap ve oturum verileri tarayıcınızın güvenli yerel deposu olan `IndexedDB` içinde barınır. Başka bir sekme veya kullanıcı bu verilere erişemez.
- **Düz Metin Yedek Yok:** Steam sırlarını içeren hesaplar **yalnızca** IndexedDB'de tutulur. Eski sürümler bu verileri `localStorage` içine düz metin olarak kopyalıyordu; bu kopyalar artık uygulama açılışında otomatik silinir. IndexedDB kullanılamıyorsa (gizli sekme, engellenmiş depolama) uygulama bir uyarı gösterir ve sırları sessizce düz metne düşürmek yerine kaydetmez. Yalnızca hassas olmayan veriler (klasörler, etiketler, kayıtlar, arayüz ayarları) `localStorage` aynasını korur.
- **Şifreli Kasa:** Steam sırlarınız AES-GCM ile şifreleyebilirsiniz. Her değer kendine özel tek kullanımlık bir kodla şifrelenir ve şifreleme sırasında hesap kimliği ile alan adı da verinin içine yazılır; böylece bir hesaptan alınan şifreli veri başka bir hesaba kopyalansa bile açılmaz. Her şeyi rastgele üretilmiş tek bir anahtar şifreler ve bu anahtar hiçbir zaman diske yazılmaz: yalnızca kilitli kopyaları saklanır. Anahtar ya **cihazınızdaki bir passkey'den** (WebAuthn PRF — bu durumda anahtar uygulamanın JavaScript'ine hiç bırakılmaz) ya da sizin belirlediğiniz **bir kurtarma parolasından** gelir (PBKDF2-SHA-256 ile 600.000 turdan geçirilerek zorla kırılması zorlaştırılır). Kasa, bir süre hareketsiz kaldığınızda ve başka sekmeye geçtiğiniz anda kendini kilitler. Kasa'yı açtığınızda daha önce eklediğiniz hesaplar da yeniden şifrelenir. **Ayarlar → Şifreli Kasa** bölümünden başlatabilirsiniz.
- **Content Security Policy:** Üretim sürümü katı bir güvenlik politikasıyla çalışır: çalışmasına izin verilen scriptler yalnızca sayfaya gömülü o olanlardır ve SHA-256 parmak izleriyle eşleştirilir. Ne `'unsafe-inline'` ne `'unsafe-eval'` kullanılır; ayrıca `object-src 'none'`, `base-uri 'none'`, `form-action 'none'` ve sıkı bir `connect-src` uygulanır.
- **Trusted Types:** `require-trusted-types-for 'script'` etkindir; enjekte edilmiş bir DOM düğümü çalıştırılabilir script'e veya script URL'sine dönüştürülemez. Tek izin verilen politika, servis worker URL'si için kullanılan `steamguard-url` politikasıdır.
- **Doğrudan İletişim:** Uygulama yalnızca resmi Steam sunucuları (`api.steampowered.com`, `steamcommunity.com`, `login.steampowered.com`) ve sizin kurduğunuz kişisel Cloudflare Worker ile haberleşir.
- **Git Koruma Kuralları:** `.gitignore` dosyası `.maFile`, `.env` ve kişisel veri kalıntılarını engelleyecek şekilde yapılandırılmıştır.

Kendi sunucunuzda barındırıyorsanız şu **HTTP başlıklarını** da ekleyin (`<meta>` CSP ile ayarlanamazlar):

```
Content-Security-Policy: frame-ancestors 'none'
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
Referrer-Policy: no-referrer
```

Bu başlıklar `frontend/public/_headers` dosyasında hazır gelir; Cloudflare Pages ve Netlify bunları otomatik uygular, GitHub Pages başlık gönderemediği için derleme ayrıca CSP `<meta>` etiketi gömer.

#### Sıkılaştırma ayarları

| Ayar | Nasıl |
|---|---|
| Ağ iznini daraltma | Derlerken `CSP_CONNECT_ORIGINS="https://proxy.sizinsite.com"` yazarsanız uygulama sadece bu adrese bağlanabilir. Bu değeri yazmazsanız kendi CORS proxy'niz çalışabilsin diye tüm HTTPS adreslerine izin verilir. |
| Sunucu başlıkları | `frontend/public/_headers` dosyası. Cloudflare Pages ve Netlify bunu otomatik uygular; başka sunucularda aynı başlıkları elle ekleyebilirsiniz. |
| CSP kontrolü | `pnpm build` çalıştırınca, uygulamanın gömülü script'lerinden biri izin listesinde yoksa ya da Steam adreslerinden biri eksikse derleme hata verir. |

> **Yedek dosyaları bilerek şifresizdir.** JSON dışa aktarım sizin taşınabilir kopyanızdır (.maFile mantığı) ve passkey ile kurtarma parolasını ikisini birden kaybederseniz kurtarma yolunuzdur. Bu dosyayı bir parola dosyası gibi saklayın.

> **Passkey çalışmıyorsa: iki olası sebep.**
>
> 1. **Passkey nereye kaydedildi?** Chrome'un kendi profili bu özelliği
>    desteklemez. Chrome "passkey nereye kaydedilsin?" diye sorduğunda Google
>    Password Manager (ya da 1Password / Bitwarden) seçin.
> 2. **İşletim sistemi çok eski.** Windows'ta Windows Hello yalnızca Windows 11
>    24H2 / 25H2 üzerinde Şubat 2026 güncellemesinden sonra bu anahtarı
>    verebiliyor; Chrome/Edge 147+ (Firefox 148+) gerekiyor. macOS 15+ ve
>    Android'de iCloud Keychain / Google Password Manager ile çalışıyor.
>
> Bunların hiçbiri kasayı engellemez: kurtarma parolası aynı korumayı sağlar ve
> passkey'i sonra Ayarlar bölümünden ekleyebilirsiniz.

---

### 👏 Teşekkür & Referans (Credits)

Bu proje, [feskolech/steamwebauthenticator](https://github.com/feskolech/steamwebauthenticator/) projesi temel alınarak geliştirilmiştir. Orijinal projedeki Docker, harici backend ve veritabanı bağımlılıkları tamamen kaldırılarak, %100 istemci taraflı (serverless), bağımsız ve taşınabilir bir PWA web uygulaması olarak yeniden tasarlanmıştır. Açık kaynak katkıları için [feskolech](https://github.com/feskolech)'e teşekkür ederiz.

---

### 📄 Lisans

Bu proje [MIT Lisansı](LICENSE) kapsamında açık kaynak olarak sunulmaktadır.

<div align="right">
  <a href="#-steamweb-authenticator">⬆ Başa dön</a>
</div>
