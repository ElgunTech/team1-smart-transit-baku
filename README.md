# SmartTransit Bakı — Smart Transit & Crowdsourcing Engine

**Team 1** · Digital Challenge Azerbaijan 2026 · Yarımfinal
Şükürov Elgün · Mehdiyev İsgəndər · Məlikova Fatimə

Bakıda pik saatlarda bəzi avtobus xətləri həddindən artıq dolu olur, bəziləri isə boş gedir. SmartTransit bu problemi həll edən mikrosistemin işlək prototipidir. Sistem iki moduldan ibarətdir:

| Modul | Kim üçün | Nə edir |
|---|---|---|
| **Sərnişin modulu** | Qeydiyyatdan keçmiş sərnişin | Xətt və ya dayanacaq seçir, yaxınlığından keçən xətləri tapır. Avtobusların real vaxt mövqeyini və gəliş vaxtını (ETA) görür. Avtobusun sıxlığını (Aşağı / Orta / Yüksək) bildirir. **“Mən bu avtobusdayam”** düyməsi ilə telefonunun GPS-ini avtobusun canlı mövqeyi kimi paylaşır. |
| **Operator modulu + analitika** | Operator / dövlət qurumu | Sərnişin bildirişləri və GPS əsasında sıxlıq xəritəsi və cədvəli görür. Anomaliya olduqda avtomatik **əlavə avtobus tövsiyəsi** alır və bir kliklə ehtiyat avtobus ayırır. |

**Real məlumat:** sistem [opendata.az](https://opendata.az) portalından götürülmüş Bakı avtobus şəbəkəsi ilə işləyir: **233 xətt** (real küçə həndəsəsi, `buslines.kmz`) və **3490 dayanacaq** (`dayanacaqlar.csv`). Xətlərdə ümumilikdə təxminən 980 avtobus simulyasiya olunur.

---

## 1. Tez başlanğıc

### Variant A — Lokal (yalnız Python 3.11+)

Frontend artıq build edilib (`static/` qovluğu), Node.js lazım deyil.

```bash
pip install -r requirements.txt
python -m uvicorn app.main:create_app --factory --port 8000
```

Brauzerdə açın: **http://localhost:8000**

### Variant B — Docker

```bash
docker compose up --build
```

Ünvan: **http://localhost:8000**

### Demo hesablar

| Rol | Necə daxil olmaq |
|---|---|
| Sərnişin | Giriş səhifəsində **“Qeydiyyat”** bölməsindən yeni hesab yaradın |
| Operator | `operator@smarttransit.az` / `operator123` (`OPERATOR_EMAIL` və `OPERATOR_PASSWORD` mühit dəyişənləri ilə dəyişdirilir) |

### Demo ssenari (2 dəqiqə)

1. Sərnişin kimi qeydiyyatdan keçin, **1 nömrəli** xətti seçin, avtobusların hərəkətinə və dayanacaqlar üzrə gəliş vaxtına baxın.
2. “Avtobusda sıxlıq necədir?” bölməsində **Yüksək** düyməsini basın.
3. Çıxış edin və operator kimi daxil olun.
4. **Demo ssenari** bölməsində xətti seçib **“Pik saatı simulyasiya et”** düyməsini basın. Xəbərdarlıq avtomatik yaranır.
5. **“1 avtobus ayır”** düyməsini basın. Avtobus aşağı yüklənmiş xətdən sıx xəttə keçir və xəritədə görünür.

### Frontend-in inkişaf rejimi (istəyə bağlı)

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173 (API :8000-ə proxy olunur)
npm run build      # build-i ../static qovluğuna yazır
```

### Testlər

```bash
python -m pytest -q
```

50 avtomatik test var. Onlar analitika engine-ini, anomaliya qaydasını, ETA hesablamasını (dairəvi xətlər daxil), GPS-in marşruta bağlanmasını, autentifikasiyanı, rolları, bütün API axınlarını və real opendata şəbəkəsinin yüklənib simulyasiya olunmasını yoxlayır. API testləri kiçik demo şəbəkəsində işləyir və saat saxta saatla (fake clock) idarə olunur, ona görə nəticə deterministikdir.

### Açıq məlumatın yenidən idxalı

`app/data/network.json` faylı opendata.az fayllarından skriptlə hazırlanıb:

```bash
python scripts/import_opendata.py data/opendata/buslines.kmz data/opendata/dayanacaqlar.csv
```

Skript belə işləyir:
1. KMZ-dən hər xəttin həndəsəsini oxuyur və çox hissəli xətləri birləşdirir.
2. Həndəsəni Douglas–Peucker alqoritmi ilə sadələşdirir (8 m dəqiqlik).
3. CSV-də dayanacaq və xətt əlaqəsi olmadığı üçün dayanacağı marşrut xəttinə **≤ 25 m** məsafədə olduqda həmin xəttə bağlayır. Bu axtarış məkan şəbəkəsi indeksi ilə aparılır.
4. Dayanacaqları xətt üzrə sıraya düzür və bir-birinə 60 m-dən yaxın təkrarları birləşdirir.
5. Başlanğıcı və sonu üst-üstə düşən xətləri **dairəvi** kimi işarələyir. Belə xətlərdə avtobus irəli hərəkət edərək dövr edir.

---

## 2. Arxitektura

```
┌──────────────────────────── Brauzer ────────────────────────────┐
│  React 18 + Vite SPA                                             │
│  /login  →  Giriş / Qeydiyyat                                     │
│  /        →  Sərnişin modulu  (yalnız role = passenger)          │
│  /operator → Operator paneli  (yalnız role = operator)            │
│  react-leaflet xəritə · framer-motion animasiyalar · 3 s polling  │
└───────────────┬──────────────────────────────────────────────────┘
                │  REST / JSON   (Authorization: Bearer <token>)
┌───────────────▼──────────────────────────────────────────────────┐
│  FastAPI (app/main.py)        — HTTP qatı, validasiya, rollar     │
│  ├─ auth.py                   — qeydiyyat, giriş, PBKDF2, sessiya │
│  ├─ services.py               — biznes məntiqi (TransitService)   │
│  ├─ engine.py                 — sıxlıq, anomaliya, ETA (təmiz f-lar)│
│  ├─ geo.py / network.py       — marşrut həndəsəsi, dayanacaqlar    │
│  └─ simulator.py              — demo GPS axını + sərnişin bildirişi │
└───────────────┬──────────────────────────────────────────────────┘
                │  sqlite3
┌───────────────▼──────────────────────────────────────────────────┐
│  SQLite: buses · gps_pings · reports · alerts · users · sessions  │
└──────────────────────────────────────────────────────────────────┘
```

**Məlumat axını:**

1. **GPS** (`POST /api/gps` və ya simulyator) → koordinat marşrut xəttinə proyeksiya olunur (*snap*) → avtobusun mövqeyi (metr), istiqaməti və sürəti yenilənir.
2. **Sərnişin bildirişi** (`POST /api/reports`) → validasiya və spam qoruması → bazaya yazılır → engine xəttin sıxlığını yenidən hesablayır → anomaliya qaydası yoxlanılır.
3. **Operator paneli** hər 3 saniyədən bir `overview`, `alerts`, `reports`, `buses` endpoint-lərini sorğulayır.

### Analitika qaydaları

| Qayda | Məntiq |
|---|---|
| **Xəttin sıxlığı** | Son 10 dəqiqənin bildirişləri: Aşağı=1, Orta=2, Yüksək=3. Yeni bildirişin çəkisi köhnəsindən 2 dəfəyə qədər çoxdur. Orta bal < 1.67 → Aşağı, < 2.34 → Orta, qalanı → Yüksək. |
| **Anomaliya** | 10 dəqiqəlik pəncərədə **≥ 3 “Yüksək” bildiriş** var və onlar bütün bildirişlərin **≥ 60%-ni** təşkil edir. Belə olduqda avtomatik xəbərdarlıq yaranır. Bir xətt üçün eyni anda yalnız bir açıq xəbərdarlıq olur. |
| **Tövsiyə** | Adətən 1 əlavə avtobus. Bildirişlərin ≥ 80%-i yüksəkdirsə və sayı ≥ 6-dırsa, 2 avtobus. Avtobusun mənbəyi: sıxlığı **Aşağı** olan və ən azı 2 avtobusu olan xətt. Belə xətt yoxdursa, depo ehtiyatı. |
| **Soyuma müddəti** | Operator qərar verdikdən sonra tədbirin təsir etməsi üçün 10 dəqiqə ərzində həmin xəttə yeni xəbərdarlıq yaradılmır. |
| **ETA** | Avtobusun marşrut üzrə dayanacağa qalan məsafəsi / cari sürət + aralıqdakı hər dayanacaq üçün 25 s. Avtobus dayanacaqdan uzaqlaşırsa, son dayanacaqda dönməsi nəzərə alınır. |
| **Spam qoruması** | Bir hesab eyni xətt üçün 2 dəqiqədə yalnız 1 bildiriş göndərə bilər (`429 Too Many Requests`). |

Bütün hədlər mühit dəyişənləri ilə dəyişdirilir: `WINDOW_MINUTES`, `HIGH_MIN_REPORTS`, `HIGH_SHARE`, `REPORT_COOLDOWN_SEC`, `MAX_GPS_OFFSET_M`, `SIMULATE`. Bax: `app/config.py`.

---

### Canlı GPS (crowdsourcing)

Bakı avtobusları üçün açıq real vaxt GPS API-si yoxdur. Peyk məlumatı isə real vaxt izləmə üçün yararsızdır. Ona görə sistem avtobusun GPS-ini sərnişinin özündən alır.

1. Sərnişin **“Mən bu avtobusdayam”** düyməsini basır. Telefonun yeri hər 5 saniyədən bir göndərilir.
2. Backend nöqtəni yoxlayır: dəqiqlik ≤ 200 m, xətdən məsafə ≤ 400 m, avtobus həmin xəttə aid olmalıdır.
3. Nöqtə marşrut xəttinə bağlanır və avtobus 30 saniyəlik **canlı** kimi işarələnir. Canlı avtobusu simulyator hərəkət etdirmir.
4. Xəritədə canlı avtobus yaşıl halqa ilə göstərilir. Operator panelində canlı GPS ilə izlənən avtobusların sayı görünür.

Eyni mexanizm rəsmi GPS axını (`/api/gps`) üçün də işləyir. Qeyd: brauzer GPS-i yalnız təhlükəsiz kontekstdə (HTTPS və ya localhost) verir. Telefonda sınamaq üçün tətbiq HTTPS ilə açılmalıdır.

## 3. API

Ətraflı interaktiv sənəd (Swagger) server işləyərkən buradadır: **http://localhost:8000/docs**

| Metod | Yol | Giriş | Təsvir |
|---|---|---|---|
| POST | `/api/auth/register` | — | Sərnişin qeydiyyatı |
| POST | `/api/auth/login` | — | Giriş, token qaytarır |
| GET | `/api/auth/me` · POST `/api/auth/logout` | istifadəçi | Profil / çıxış |
| GET | `/api/network` | istifadəçi | Xətlər, dayanacaqlar, marşrut xətləri |
| GET | `/api/buses?route_id=` | istifadəçi | Avtobusların canlı mövqeyi və sıxlığı |
| GET | `/api/routes/{id}/live` | istifadəçi | Xəttin sıxlığı, avtobuslar, dayanacaqlar üzrə ETA |
| GET | `/api/stops/{id}/arrivals` | istifadəçi | Dayanacağa yaxınlaşan avtobuslar və ETA |
| POST | `/api/reports` | istifadəçi | Sıxlıq bildirişi `{route_id, level, bus_id?, stop_id?}` |
| POST | `/api/tracking` | istifadəçi | Canlı GPS: sərnişinin telefonu avtobusun mövqeyini göndərir `{route_id, bus_id, lat, lon, accuracy_m?, speed_kmh?}` |
| POST | `/api/gps` | cihaz | GPS nöqtəsi `{bus_id, lat, lon, speed_kmh?}` |
| GET | `/api/operator/overview` | operator | KPI-lar və xətlər üzrə analitika |
| GET | `/api/operator/alerts?status=` | operator | Xəbərdarlıqlar |
| POST | `/api/operator/alerts/{id}/dispatch` · `/dismiss` | operator | Ehtiyat ayır / rədd et |
| GET | `/api/operator/reports` | operator | Son bildirişlər |
| POST | `/api/demo/rush/{route_id}` | operator | Demo: pik saat simulyasiyası |

---

## 4. Layihənin strukturu

```
app/            FastAPI backend (auth, services, engine, geo, network, store, simulator)
app/data/       network.json — opendata.az-dan idxal olunmuş şəbəkə
data/opendata/  mənbə fayllar (buslines.kmz, dayanacaqlar.csv)
scripts/        import_opendata.py — KMZ + CSV → network.json
frontend/       React + Vite mənbə kodu
static/         Frontend-in build nəticəsi (FastAPI tərəfindən verilir)
tests/          pytest testləri (engine + API)
Dockerfile, docker-compose.yml
AI_DECLARATION.md   AI istifadəsi haqqında bəyannamə
Texniki_Izah.docx   Texniki izah sənədi
```

## 5. Məhdudiyyətlər

- Xətlər və dayanacaqlar realdır (opendata.az). Avtobusların mövqeyi və sərnişin bildirişləri isə simulyasiya olunur, çünki açıq real vaxt GPS axını yoxdur. Real cihazlar eyni `/api/gps` endpoint-indən istifadə edə bilər. Prodakşnda bu endpoint cihaz açarı ilə qorunmalıdır.
- Dayanacaqların xətlərə bağlanması həndəsi yaxınlığa əsaslanır, çünki mənbədə bu əlaqə yoxdur. 110 dayanacaq (3%) heç bir xəttə 25 m-dən yaxın deyil və istifadə olunmur. 239 xəttdən 6-sı həndəsəsi qısa olduğu və ya dayanacağı tapılmadığı üçün çıxarılıb.
- Xəttin istiqaməti mənbədə göstərilməyib. Dairəvi xətlərdə hərəkət istiqaməti həndəsənin sırası ilə götürülür.
