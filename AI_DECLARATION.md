# AI İstifadəsi Haqqında Bəyannamə

**Müsabiqə:** Digital Challenge Azerbaijan 2026 – Yarımfinal
**Tarix:** 31 oktyabr 2026
**Komanda:** Team 1
**Komanda üzvləri:** Şükürov Elgün, Mehdiyev İsgəndər, Məlikova Fatimə
**Layihə:** SmartTransit Bakı — Smart Transit & Crowdsourcing Engine

---

## 1. Yanaşmamız

Komandamız AI alətindən **köməkçi mühəndis** kimi istifadə etdi. AI kodu yazdı, testləri işə saldı və variantları təklif etdi. Tələbləri, prioritetləri, texnologiya seçimini və məhsul qərarlarını isə komanda verdi. Hər mərhələdə nəticəni brauzerdə və testlərlə yoxladıq. Uyğun olmayan həlləri dəyişdirməyi tələb etdik (bax: 5-ci bölmə).

Bu bəyannamə yalnız yarış müddətində görülən işi əks etdirir. Yarışdan əvvəl hazırlanmış kod və ya şablon istifadə olunmayıb.

## 2. İstifadə olunan AI aləti

| Alət | Model | Nə üçün |
|---|---|---|
| Claude Code (desktop tətbiqi) | Claude Opus 5.5 (Anthropic) | Tapşırığın analizi, arxitektura, backend və frontend kodu, testlər, açıq məlumatın idxalı, brauzerdə yoxlama, sənədləşmə |

## 3. Əsas promptlarımız və nəticələri

Promptlar azərbaycan dilində yazılıb. Aşağıda sıra ilə real promptlarımız və AI-ın onlara cavabı verilir.

| # | Komandanın promptu (qısaldılmış) | AI-ın etdiyi |
|---|---|---|
| 1 | Tapşırığın mətni: *“Smart Transit və Crowdsourcing Engine… sərnişin modulu… operator modulu… 10 dəqiqə ərzində yüksək sıxlıq olarsa əlavə avtobus tövsiyəsi”* | Tələbləri iki moduldan və bir anomaliya qaydasından ibarət plana çevirdi. Stek təklif etdi: FastAPI + SQLite + xəritə. Backend, analitika engine-i və simulyatoru yazdı. |
| 2 | *“Frontend… peşəkar olsun, React-da et, qəşəng səliqəli dizayn, animasiya və effektlərlə”* | İlk sadə HTML/JS frontend-i React 18 + Vite + react-leaflet + framer-motion ilə yenidən qurdu. Kompüterdə Node.js olmadığı üçün onu quraşdırdı. |
| 3 | *“Hamısı bir paneldə görünməsin, login / register olsun, sərnişin qeydiyyatdan keçə bilsin”* | Rol əsaslı autentifikasiya əlavə etdi: PBKDF2 ilə şifrə hash-i, bearer token sessiyaları, sərnişin və operator rolları. Operator API-ləri sərnişinə 403 qaytarır. Sıxlıq bildirişi hesaba bağlandı, bu da spamın qarşısını alır. |
| 4 | *“opendata.az portalından götürülmüş məlumatlardır, sistemə əlavə et, hər şey reala uyğun olsun”* (`buslines.kmz`, `dayanacaqlar.csv`) | İdxal skripti yazdı: 233 xətt və 3490 dayanacaq. CSV-də dayanacaq və xətt əlaqəsi olmadığı üçün həndəsi yaxınlıqla (≤ 25 m) bağlama təklif etdi. Backend-i 233 xətt və təxminən 980 avtobus üçün optimallaşdırdı. |

## 4. AI-ın mərhələlər üzrə rolu və insan nəzarəti

| Mərhələ | AI nə etdi | Komanda nə etdi |
|---|---|---|
| Tələblərin analizi | Tapşırığı modullara və ölçülə bilən qaydalara böldü | Əlavə tələblər qoydu: React, giriş/qeydiyyat, real məlumat |
| Arxitektura | Qatlı struktur təklif etdi: API → servis → engine → store | Təsdiqlədi. Frontend texnologiyasını özü seçdi (React). |
| Anomaliya qaydası | “10 dəqiqə ərzində yüksək” şərtini konkret qaydaya çevirdi: ≥ 3 yüksək bildiriş və ≥ 60% pay | Qaydanı qəbul etdi. Hədlər mühit dəyişənləri ilə dəyişdirilə bilir. |
| Kod | Bütün modulların kodunu yazdı | Nəticəni brauzerdə yoxladı, problemləri göstərdi |
| Testlər | 45 avtomatik test yazdı və işə saldı | Hamısının keçdiyini yoxladı |
| Məlumat | KMZ/CSV formatını təhlil etdi, idxal skriptini yazdı | Real məlumatı tapıb təqdim etdi (opendata.az) |

## 5. Düzəliş edilən və ya rədd edilən həllər

Bu bölmə prosesdə tapılan real problemləri və onlara verilən qərarları göstərir.

| Problem və ya ilkin həll | Necə aşkarlandı | Qərar |
|---|---|---|
| İlk frontend sadə HTML/CSS/JS idi | Komanda peşəkar görünüş tələb etdi | React + Vite ilə yenidən quruldu |
| İlk versiyada xətlər əl ilə yazılmış demo məlumat idi | Komanda real açıq məlumat gətirdi | opendata.az məlumatına keçildi. Demo şəbəkə yalnız testlərdə qaldı. |
| Bütün panellər hamıya açıq idi | Komandanın tələbi | Giriş/qeydiyyat və rollara görə ayrılma əlavə edildi |
| Xəritə servisi (CARTO) API açarı tələb etdi, xəritədə “API KEY REQUIRED” göründü | Brauzerdə yoxlama zamanı | OpenStreetMap-a keçildi və yumşaq boz filtr əlavə edildi |
| Operator girişindən sonra boş səhifə | Brauzerdə yoxlama zamanı | Səbəb səhifə keçid animasiyasının yönləndirmə ilə toqquşması idi. Çıxış animasiyası silindi. |
| İdxal 239 xəttdən yalnız 27-ni saxladı | Skriptin statistikası | Səbəb: qapalı xətlərdə başlanğıc və son nöqtə eynidir, sadələşdirmə alqoritmi bütün nöqtələri silirdi. Düzəliş edildi, nəticə 233 xətt oldu. |
| İki test 429 qaytardı | Test nəticəsi | Kod yox, testin özü səhv idi: eyni sərnişin ID-si təkrar istifadə olunurdu, spam qoruması isə düzgün işləyirdi. Testə unikal ID verildi. |

## 6. AI çıxışının yoxlanması

- **Avtomatik testlər:** 45 test, hamısı keçir (`python -m pytest -q`). Testlər anomaliya qaydasını, 10 dəqiqəlik pəncərəni, dairəvi xətlərdə ETA-nı, GPS-in marşruta bağlanmasını, rolları, şifrə hash-ini və real şəbəkədə simulyasiyanı yoxlayır.
- **Brauzerdə əl ilə yoxlama:** qeydiyyat → xətt seçimi → ETA → sıxlıq bildirişi → operator girişi → pik saat simulyasiyası → avtomatik xəbərdarlıq → ehtiyat avtobusun ayrılması.
- **Təhlükəsizlik:** şifrələr açıq saxlanılmır (PBKDF2-SHA256, 200 000 iterasiya). Bütün inputlar Pydantic ilə yoxlanılır. Spam qoruması var. Operator endpoint-ləri qorunur.

## 7. Komanda üzvlərinin töhfəsi

| Üzv | Rol | Əsas iş |
|---|---|---|
| Şükürov Elgün (Səbət 1) | Texniki lider, arxitektura | [ ] |
| Mehdiyev İsgəndər (Səbət 2) | Backend və testlər | [ ] |
| Məlikova Fatimə (Səbət 3) | UI yoxlaması və sənədləşmə | [ ] |

## 8. Məhdudiyyətlər və öyrəndiklərimiz

- AI kodu sürətlə yazdı, amma bəzi səhvləri yalnız real istifadə üzə çıxardı: boş səhifə, xəritə açarı, qapalı xətlər. Brauzerdə və testlərlə yoxlama vacibdir.
- Açıq məlumatda dayanacaq və xətt əlaqəsi yoxdur. Həndəsi yaxınlıq yaxşı yaxınlaşmadır (97% dayanacaq bağlandı), amma rəsmi marşrut cədvəli ilə daha dəqiq olardı.
- Real istifadə üçün əlavə olaraq real GPS axını (Bakı Nəqliyyat Agentliyi) və mobil tətbiq lazımdır.

## 9. Təsdiq

Komandamız təsdiq edir ki, bu bəyannamədə yazılanlar doğrudur, yarış qaydalarına (bənd 5) əməl olunub və üçüncü şəxslərdən kömək alınmayıb.

Şükürov Elgün · Mehdiyev İsgəndər · Məlikova Fatimə
