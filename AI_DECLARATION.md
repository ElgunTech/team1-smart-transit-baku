# AI İstifadəsi Haqqında Bəyannamə

**Müsabiqə:** Digital Challenge Azerbaijan 2026 – Yarımfinal
**Tarix:** 31 oktyabr 2026
**Komanda:** Team 1
**Komanda üzvləri:** Şükürov Elgün Ramin oğlu, Mehdiyev İsgəndər Azər oğlu, Məlikova Fatimə Xəyal qızı
**Layihə:** SmartTransit Bakı — Smart Transit & Crowdsourcing Engine

---

## 1. Yanaşmamız

Komandamız AI alətindən **köməkçi mühəndis** kimi istifadə etdi. AI kodu yazdı, testləri işə saldı və variantları təklif etdi. Tələbləri, prioritetləri, texnologiya seçimini və məhsul qərarlarını isə komanda verdi. Hər mərhələdə nəticəni brauzerdə və testlərlə yoxladıq. Aşkarlanan problemləri düzəltdirdik (bax: 5-ci bölmə).

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
| 2 | *“Frontend… peşəkar olsun, React-da et, qəşəng səliqəli dizayn, animasiya və effektlərlə”* | Frontend-i React 18 + Vite + react-leaflet + framer-motion ilə qurdu. Kompüterdə Node.js olmadığı üçün onu quraşdırdı. |
| 3 | *“Hamısı bir paneldə görünməsin, login / register olsun, sərnişin qeydiyyatdan keçə bilsin”* | Rol əsaslı autentifikasiya əlavə etdi: PBKDF2 ilə şifrə hash-i, bearer token sessiyaları, sərnişin və operator rolları. Operator API-ləri sərnişinə 403 qaytarır. Sıxlıq bildirişi hesaba bağlandı, bu da spamın qarşısını alır. |
| 4 | *“opendata.az portalından götürülmüş məlumatlardır, sistemə əlavə et, hər şey reala uyğun olsun”* (`buslines.kmz`, `dayanacaqlar.csv`) | İdxal skripti yazdı: 233 xətt və 3490 dayanacaq. CSV-də dayanacaq və xətt əlaqəsi olmadığı üçün həndəsi yaxınlıqla (≤ 25 m) bağlama təklif etdi. Backend-i 233 xətt və təxminən 980 avtobus üçün optimallaşdırdı. |
| 5 | *“Hər hansı peyk API-si ya başqa API vasitəsi ilə hal-hazırda avtobuslar haradadır, onu görək”* | Peyk məlumatının real vaxt izləmə üçün yararsız olduğunu, Bakı üçün açıq real vaxt GPS API-si tapılmadığını izah etdi. Alternativ olaraq crowdsourcing GPS təklif etdi: “Mən bu avtobusdayam” düyməsi ilə sərnişinin telefonu avtobusun GPS-i olur. Komanda bunu qəbul etdi. |
| 6 | *“Mobil görünüş… qarışıqdır… eyni avtobus nömrələrini qruplaşdır… GPS tapılması üçün 30 saniyə çoxdur”* | Mobil interfeysi yenidən qurdu: sabit xəritə, öz daxilində sürüşən panel, nömrə şəbəkəsi və variantların qruplaşdırılması, eyni adlı dayanacaqların birləşdirilməsi. GPS üçün əvvəlcədən isitmə və son nəticənin dərhal istifadəsi tətbiq edildi, gözləmə 10 saniyəyə endirildi. |
| 7 | *“Anomaliya feedback-ına görə sərnişinlər point qazansın… gündə maksimum 3 feedback… saxta olmadığı yoxlanılsın… BakuBus MMC əməkdaşlığı təsdiqlənərsə işə düşəcəyi bildirilsin”* | Xal sistemi qurdu. Gündəlik 3 bildiriş limiti və iki yoxlama üsulu (GPS ilə yer sübutu və ya müstəqil sərnişin təsdiqi) var. Xal yalnız təsdiqlənmiş bildirişə verilir. Xalla gediş almaq BakuBus MMC əməkdaşlığına qədər bağlıdır. |
| 8 | *“Paneldə avtobusun harada olduğu göstərilmir… sıxlıq xəritəsi qarışıqdır… bütün xəbərdarlıqları qəbul et düyməsi olsun… qəşəng logo… xəritəni rəngli et”* | Xəritənin görünən sahəsindəki avtobusları göstərdi. Operator xəritəsinə filtr (Problemli / Yüksək+Orta / Hamısı) və cədvəldən xəttə fokus əlavə etdi. “Hamısını qəbul et” düyməsini yaratdı, orijinal SVG loqo və favicon çəkdi, xəritəni rəngli etdi. |
| 9 | *“Bütün sənədləri nəzərdən keçir… GitHub-dakı təlimatla sıfırdan açmağa çalış”* | Layihəni GitHub-dan təmiz qovluğa klonladı və README təlimatı ilə ayrıca virtual mühitdə quraşdırdı. 57 testin hamısı keçdi, bütün səhifələr və API işlədi. Sənədlərdəki rəqəmləri koda qarşı yoxlayıb yenilədi. |

## 4. AI-ın mərhələlər üzrə rolu və insan nəzarəti

| Mərhələ | AI nə etdi | Komanda nə etdi |
|---|---|---|
| Tələblərin analizi | Tapşırığı modullara və ölçülə bilən qaydalara böldü | Əlavə tələblər qoydu: React, giriş/qeydiyyat, real məlumat |
| Arxitektura | Qatlı struktur təklif etdi: API → servis → engine → store | Təsdiqlədi. Frontend texnologiyasını özü seçdi (React). |
| Anomaliya qaydası | “10 dəqiqə ərzində yüksək” şərtini konkret qaydaya çevirdi: ≥ 3 yüksək bildiriş və ≥ 60% pay | Qaydanı qəbul etdi. Hədlər mühit dəyişənləri ilə dəyişdirilə bilir. |
| Kod | Komandanın tələbləri və təsdiqlədiyi arxitektura əsasında kodu yazdı | Hər mərhələdən sonra nəticəni brauzerdə yoxladı, düzəliş və yeni funksiyalar tələb etdi |
| Testlər | 57 avtomatik test yazdı və işə saldı | Hamısının keçdiyini yoxladı, sistemi brauzerdə və telefonda sınaqdan keçirdi |
| Dizayn və mobil görünüş | Komandanın rəyi əsasında interfeysi dəfələrlə təkmilləşdirdi | Telefonda sınaqdan keçirdi, qarışıq yerləri göstərdi, sadələşdirmə tələb etdi |
| Məlumat | KMZ/CSV formatını təhlil etdi, idxal skriptini yazdı | Real məlumatı tapıb təqdim etdi (opendata.az) |

## 5. Yoxlama zamanı aşkarlanan və düzəldilən problemlər

Hər problem test və ya real sınaq zamanı aşkarlandı və yarış müddətində həll edildi. Bu, nəticəni yoxlamadan qəbul etmədiyimizi göstərir.

| Problem | Necə aşkarlandı | Düzəliş |
|---|---|---|
| Xəritə servisi (CARTO) API açarı tələb etdi, xəritədə “API KEY REQUIRED” göründü | Brauzerdə yoxlama zamanı | Açar tələb etməyən OpenStreetMap-a keçildi |
| Operator girişindən sonra boş səhifə | Brauzerdə yoxlama zamanı | Səbəb səhifə keçid animasiyasının yönləndirmə ilə toqquşması idi. Çıxış animasiyası silindi. |
| İdxal 239 xəttdən yalnız 27-ni saxladı | Skriptin statistikası | Səbəb: qapalı xətlərdə başlanğıc və son nöqtə eynidir, sadələşdirmə alqoritmi bütün nöqtələri silirdi. Düzəliş edildi, nəticə 233 xətt oldu. |
| İki test 429 qaytardı | Test nəticəsi | Kod yox, testin özü səhv idi: eyni sərnişin ID-si təkrar istifadə olunurdu, spam qoruması isə düzgün işləyirdi. Testə unikal ID verildi. |
| Kompüterdə GPS çipi olmadığı üçün yer ±50 km dəqiqliklə gəlirdi | Komandanın kompüterdə sınağı | Aydın izah mesajı və nümayiş üçün işarələnmiş “test rejimi” əlavə edildi |
| Telefonda GPS gec tapılırdı | Komandanın Chrome Telefon Artırması sınağı | GPS xətt açılan kimi fonda hazırlanır, son nəticə dərhal istifadə olunur, gözləmə 10 saniyəyə endirildi |
| Mobil görünüşdə uzun siyahılar və təkrarlanan adlar | Komandanın Chrome Telefon Artırması sınağı | Nömrə şəbəkəsi, variant və dayanacaq qrupları, yığcam panel tətbiq edildi |
| Xəritədəki “yaxınlaşdırın” düyməsi reaksiya vermirdi | Brauzerdə yoxlama zamanı | Xəritə kitabxanasının klik kilidi düymənin hadisəsini bloklayırdı, kilid çıxarıldı |

## 6. AI çıxışının yoxlanması

- **Avtomatik testlər:** 57 test, hamısı keçir (`python -m pytest -q`). Testlər anomaliya qaydasını, 10 dəqiqəlik pəncərəni, dairəvi xətlərdə ETA-nı, GPS-in marşruta bağlanmasını, rolları, şifrə hash-ini, real şəbəkədə simulyasiyanı, telefondan canlı GPS-i, gündəlik limiti, bildirişlərin təsdiqini və xalları yoxlayır.
- **Brauzerdə əl ilə yoxlama:** qeydiyyat → xətt seçimi → ETA → sıxlıq bildirişi → operator girişi → pik saat simulyasiyası → avtomatik xəbərdarlıq → ehtiyat avtobusun ayrılması.
- **Chrome Telefon Artırmasında real sınaq:** tətbiq HTTPS ilə açıldı, mobil görünüş və telefonun GPS-i komanda tərəfindən sınaqdan keçirildi.
- **Sıfırdan quraşdırma:** layihə GitHub-dan təmiz qovluğa klonlandı və README təlimatı ilə quraşdırıldı. Hər şey ilk cəhddə işlədi.
- **Təhlükəsizlik:** şifrələr açıq saxlanılmır (PBKDF2-SHA256, 200 000 iterasiya). Bütün inputlar Pydantic ilə yoxlanılır. Spam qoruması var. Operator endpoint-ləri qorunur.

## 7. Komanda üzvlərinin töhfəsi

| Üzv | Rol | Əsas iş |
|---|---|---|
| Şükürov Elgün Ramin oğlu (Səbət 1) | Backend / API | AI-a promptların göndərilməsi və tələblərin qoyulması; kodun AI ilə yazılması və sistemə inteqrasiyası; testlərin yaradılması və sistemin sınaqdan keçirilməsi |
| Mehdiyev İsgəndər Azər oğlu (Səbət 2) | Frontend / UI-UX | İnterfeysin və responsivliyin (mobil görünüş) yoxlanılması, bugların aşkarlanması |
| Məlikova Fatimə Xəyal qızı (Səbət 3) | AI inteqrasiyası və sənədləşmə | AI ilə vahid (unit) testlərin yazılması, sənədlərin hazırlanması, yeni funksiyaların araşdırılması |

## 8. Öyrəndiklərimiz və növbəti addımlar
- **Açıq məlumatı tam istifadə etdik.** Mənbədə dayanacaq və xətt əlaqəsi olmasa da, alqoritmlə dayanacaqların 97%-ni xətlərə bağladıq. Rəsmi marşrut cədvəli ilə bu 100%-ə çatdırıla bilər.
- **Növbəti addım: real GPS və tərəfdaşlıq.** Sistem rəsmi GPS axınına (`/api/gps`) və bilet sisteminə qoşulmağa hazırdır. BakuBus MMC ilə əməkdaşlıq olarsa, xalla gediş funksiyası və real avtobus mövqeləri aktivləşəcək.

## 9. Təsdiq

Komandamız təsdiq edir ki, bu bəyannamədə yazılanlar doğrudur, yarış qaydalarına (bənd 5) əməl olunub və üçüncü şəxslərdən kömək alınmayıb.

Şükürov Elgün Ramin oğlu · Mehdiyev İsgəndər Azər oğlu · Məlikova Fatimə Xəyal qızı
