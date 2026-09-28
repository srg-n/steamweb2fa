# 🚀 Cloudflare Worker - Steam CORS & Mobil Proxy Rehberi

Bu Cloudflare Worker, **SteamGuard Web Authenticator**'ın iPhone, Android ve bilgisayar tarayıcılarında Steam'in CORS kısıtlamalarına takılmadan **300+ pazar ve takas onayını tek tıkla otomatik onaylamasını** ve **otomatik oturum açmasını** sağlayan %100 ücretsiz, sunucusuz (serverless) bir ters vekil sunucudur (reverse proxy).

---

### ⏱️ 2 Dakikada Kurulum (Tamamen Ücretsiz)

1. [dash.cloudflare.com](https://dash.cloudflare.com) adresine gidin (Ücretsiz hesap açın veya giriş yapın).
2. Sol menüden **Compute (Workers & Pages)** sekmesine tıklayın.
3. **Create Application** butonuna, ardından **Create Worker** butonuna basın.
4. Worker'a bir isim verin (örneğin: `steam-proxy`) ve **Deploy** butonuna tıklayın.
5. Sayfa açılınca sağ üstteki **Edit Code** butonuna tıklayın.
6. Soldaki editörün içindeki tüm kodu silin ve bu klasördeki [`worker.js`](worker.js) dosyasının içeriğini kopyalayıp editöre yapıştırın.
7. Sağ üstteki **Save and Deploy** butonuna basın.
8. Size verilen Worker bağlantısını kopyalayın (Örn: `https://steam-proxy.kullaniciadi.workers.dev`).

---

### 📲 Uygulamaya Bağlama

1. SteamGuard Web uygulamasında **Ayarlar** (`#/settings`) sekmesine gidin.
2. **CORS Proxy** kartındaki kutuya kopyaladığınız linki yapıştırın:
   ```
   https://steam-proxy.kullaniciadi.workers.dev/
   ```
3. Artık **ister iPhone Safari, ister Android Chrome, ister masaüstü tarayıcınızdan**:
   - Tüm pazar ve takas onaylarınız anında listelenecektir.
   - **"Tümünü Onayla"** veya **"Otomatik Onaylama"** ile yüzlerce eşyayı saniyeler içinde onaylayabilirsiniz.
   - Hesap detayından tek tıkla **"Otomatik Giriş Yap & Çerezi Al"** diyerek şifrenizle giriş yapıp oturum çerezinizi otomatik yenileyebilirsiniz.

---

### 🔐 İsteğe Bağlı: Proxy Şifresi Koruması (PROXY_SECRET)

Başkalarının sizin Cloudflare Worker kotanızı kullanmasını engellemek için:
1. Cloudflare Dashboard -> Worker'ınız -> **Settings** -> **Variables and Secrets**.
2. **Add** diyerek `PROXY_SECRET` adında bir değişken ekleyin ve rastgele bir parola yazıp kaydedin (Örn: `benimGizliAnahtarim123`).
3. Web uygulamasında **Ayarlar** -> **Proxy Secret** alanına bu parolayı yazın.
4. Artık şifreyi bilmeyen hiç kimse proxy üzerinden istek atamaz.

---

### 🔒 Güvenlik & Gizlilik
- Bu worker **yalnızca Steam alan adlarına** (`steamcommunity.com`, `steampowered.com`, `steam.tv`) yönlendirme yapar; yabancı sitelere istek atamaz.
- Worker doğrudan kendi Cloudflare hesabınızda barındığı için oturum çerezleriniz (`steamLoginSecure`) sadece sizinle Valve arasında iletilir; hiçbir üçüncü taraf sunucuya gitmez.
- Cloudflare Free planında günde **100.000 istek tamamen ücretsizdir**.
