# Establish Proxy & Deep Scan — T-Embed كوكيل تنفيذ للكالي

## الهدف

الكالي (على PC خارج الشبكة) يرسل أوامر فحص عميق عبر MQTT → T-Embed (داخل الشبكة المستهدفة) ينفذ الفحص فعلياً → النتائج ترجع للكالي والتطبيق لحظة بلحظة.

## البنية الفعلية

```mermaid
graph TB
    subgraph "الشبكة المستهدفة (192.168.x.x)"
        TE["🔧 T-Embed<br/>وكيل التنفيذ<br/>WiFi + TCP Probe"]
        TGT1["💻 جهاز 1<br/>192.168.1.10"]
        TGT2["🖨️ جهاز 2<br/>192.168.1.20"]
        TGT3["📹 جهاز 3<br/>192.168.1.30"]
        TE ---|"TCP Connect"| TGT1
        TE ---|"TCP Connect"| TGT2
        TE ---|"TCP Connect"| TGT3
    end

    subgraph "السحابة"
        HMQ["☁️ HiveMQ Cloud<br/>وسيط MQTT"]
    end

    subgraph "أجهزتك (خارج الشبكة المستهدفة)"
        KA["🐧 Kali Agent<br/>PC — المنسق والمحلل"]
        BE["⚙️ Backend<br/>Node.js — محلي"]
        FA["📱 Flutter App<br/>لوحة التحكم"]
    end

    TE <-->|"MQTT (TLS 8883)"| HMQ
    KA <-->|"MQTT (TLS 8883)"| HMQ
    BE <-->|"MQTT (TLS 8883)"| HMQ
    FA <-->|"MQTT (TLS 8883)"| HMQ
```

> [!NOTE]
> **لا يوجد Railway أو VPS أو سيرفرات سحابية.** كل شيء يمر عبر HiveMQ فقط.
> الـ Backend يشتغل محلي على جهازك. الكالي على PC منفصل. التطبيق على جوالك.

---

## كيف يعمل النظام

```mermaid
sequenceDiagram
    participant App as 📱 Flutter App
    participant HMQ as ☁️ HiveMQ
    participant TE as 🔧 T-Embed<br/>(داخل الشبكة)
    participant KA as 🐧 Kali Agent<br/>(PC خارجي)
    participant TGT as 💻 أهداف<br/>(192.168.1.x)

    Note over App: المستخدم يضغط<br/>"Establish Proxy & Scan"
    
    App->>HMQ: ① establish_proxy
    HMQ->>TE: ① تفعيل وضع الفحص
    TE->>HMQ: ② proxy_status: ready + معلومات الشبكة
    HMQ->>App: ② ✅ الوكيل جاهز
    HMQ->>KA: ② ✅ الوكيل جاهز
    
    Note over App: المستخدم يختار الأهداف<br/>ويضغط "Start Scan"
    
    App->>HMQ: ③ proxy_scan (أهداف + profile + customPorts)
    HMQ->>KA: ③ الكالي يستقبل أمر الفحص
    
    loop لكل IP:Port
        KA->>HMQ: ④ tcp_probe (192.168.1.10:80)
        HMQ->>TE: ④ T-Embed يستقبل الأمر (عبر FreeRTOS task)
        TE->>TGT: ⑤ TCP SYN فعلي
        TGT->>TE: ⑤ SYN-ACK ✅ أو RST ❌
        TE->>HMQ: ⑥ tcp_result: open/closed
        HMQ->>KA: ⑥ الكالي يجمع النتيجة
        HMQ->>App: ⑥ التطبيق يعرضها مباشرة
    end
    
    KA->>HMQ: ⑦ التقرير الكامل (nmap-style)
    HMQ->>App: ⑦ ✅ عرض التقرير النهائي
    HMQ->>BE: ⑦ حفظ في قاعدة البيانات
```

### المراحل ببساطة:
1. **التفعيل**: التطبيق يرسل أمر → T-Embed يُفعّل وضع الفحص ويرد "جاهز"
2. **الفحص**: الكالي ينسق → T-Embed يفحص البورتات فعلياً (TCP Connect) في خلفية النظام (Anti-Blocking) → النتائج ترجع لحظة بلحظة
3. **التقرير**: الكالي يجمع كل النتائج ويكتب تقرير → يظهر في التطبيق + يُحفظ في DB

---

## MQTT Topics الحالية والمستخدمة

| Topic | المُرسل | المُستقبل | الوصف |
|-------|---------|-----------|-------|
| `mwfa/commands/tembed01` | App/Kali | T-Embed | أوامر: `establish_proxy`, `tcp_probe`, `port_scan`, `stop_proxy` |
| `mwfa/commands/kali01` | App | Kali | أوامر: `scan` (Direct), `proxy_scan` (Deep Scan) |
| `mwfa/tembed01/proxy_status` | T-Embed | App, Kali, Backend | حالة الوكيل: `ready` / `scanning` / `stopped` |
| `mwfa/tembed01/tcp_result` | T-Embed | Kali, App, Backend | نتيجة فحص بورت واحد |
| `mwfa/kali01/status` | Kali | App | حالة وكيل كالي (LWT/online) |
| `mwfa/results/proxy_scan/<taskId>` | Kali | App, Backend | التقرير الكامل المجمع |

---

## المكونات التي تم تنفيذها ودمجها (v0.1-beta)

### 1. Bruce Firmware — T-Embed (ESP32)
* محرك `mwfa_deep_scan` متكامل يدعم الفحص الفردي (TCP Probe) ونطاق البورتات.
* توافق كامل مع `FreeRTOS` لاستقبال أوامر الـ MQTT في الخلفية دون تجميد النظام (Anti-Blocking).
* نظام `Keep-Alive` سريع (15 ثانية) لاكتشاف الانقطاعات فوراً عبر إضافة `mwfaBridge.loop()` في حلقات واجهة المستخدم المغلقة.
* Last Will and Testament (LWT) لضمان معرفة حالة اتصال الجهاز فوراً.

### 2. Kali Agent (Python)
* دور **المنسق والمحلل الأساسي (Orchestrator)** لعمليات الـ Proxy Scan.
* إدارة المهام (Tasks) وقوائم الانتظار.
* دعم فحص النطاقات القياسية (Fast, Default, Top100) بالإضافة إلى منافذ مخصصة (Custom Ports e.g. 80,443,8080-8090).
* تجميع تقارير شبيهة بـ Nmap ونشرها مرة واحدة للتطبيق والـ Backend.
* نظام LWT و `Keep-Alive` سريع (15 ثانية).

### 3. Flutter App (موبايل)
* واجهة مستخدم (UI) احترافية تعرض مؤشرات حقيقية ومنفصلة (Real-Time) للـ Broker، والكالي، والجهاز.
* منع ظهور الحالات الوهمية (Fake Status) إذا انقطع الإنترنت عن التطبيق.
* دمج ميزات الـ Direct Scan والـ Proxy Scan بخانات منفصلة.
* إضافة خيار "Custom Ports" لواجهة المستخدم لزيادة المرونة في الفحص العميق.
* تصحيح مسارات (Topics) إرسال الأوامر لتصل إلى الكالي الصحيح.

### 4. Backend (Node.js/Prisma)
* استقبال النتائج وحفظها في قاعدة البيانات.
* جاهز للربط المستقبلي للاستعلامات.
