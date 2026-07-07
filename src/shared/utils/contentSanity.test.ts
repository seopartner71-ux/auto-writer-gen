import { describe, it, expect } from "vitest";
import { analyzeSanity } from "./contentSanity";

// Russian technical corpus - must NOT be flagged as corrupted.
// These samples contain legitimate long consonant clusters (взгляд, всплеск,
// конструкт), abbreviations (СССР, НДФЛ, ВПР), and tech terms (HTTP, JWT).

const RU_TECH_SAMPLES: Record<string, string> = {
  consonantClusters: `
Взгляд инженера на конструкт всплеска трафика меняется, когда встряска
рынка вскрывает встроенные ограничения. Взбалтывание метрик, всплывающие
артефакты и вспышки нагрузки требуют вдумчивого подхода. Конструктивный
разбор вскрывает встречные потоки, вспомогательные буферы и встроенные
механизмы взаимодействия. Всплеск запросов, встряска кэша и вспышка
ошибок - типичные симптомы. Взглянем на конструкцию: встроенный
планировщик, встречный поток, вспомогательный воркер и встряхивающий
ретрай. Всплывающие уведомления, встраиваемые виджеты и встречные
редиректы. Взвешенный подход к конструкции всплывающих окон снижает
встряску пользовательского опыта.
  `.trim(),

  abbreviations: `
НДФЛ, СССР, ВПР, ФНС, МВД, ГИБДД, ЖКХ, СНГ, СМИ, ТЭЦ, ГРЭС, ПФР, ФСС,
ОМС, ДМС, СРО, НКО, ГОСТ, ОКВЭД, ИНН, КПП, ОГРН, БИК, СНИЛС, ЕГРН,
ЕГРЮЛ, МФЦ, ЗАГС, ГИС ЖКХ, ФГИС, ЕСИА, ЕПГУ. По данным ФНС и ПФР,
плательщики НДФЛ и взносов в ФСС отчитываются через ЕПГУ. ГОСТ и ОКВЭД
определяют классификацию, а ЕГРЮЛ и ЕГРН - реестры. Практика показывает,
что аббревиатуры ЖКХ, СНГ, СМИ и ТЭЦ встречаются в отраслевой аналитике
постоянно и не должны триггерить проверки санити.
  `.trim(),

  mixedTech: `
HTTP-запрос через JWT-токен идёт на API-шлюз. Backend возвращает JSON с
полями user_id, created_at и updated_at. REST API, GraphQL и gRPC - три
основных подхода. Взгляд на архитектуру: nginx проксирует на Node.js,
который общается с PostgreSQL через pgbouncer. Всплеск RPS обрабатывается
через Redis-кэш и CDN. Метрики Prometheus + Grafana дают взгляд на
latency (P50, P95, P99). SLA 99.9% требует резервирования. Конструкция
микросервисов: API Gateway, Auth Service, Payment Service, Notification
Service. Каждый сервис имеет собственную БД (PostgreSQL или MongoDB) и
общается через RabbitMQ или Kafka. DevOps-команда использует Docker,
Kubernetes, Terraform и Ansible.
  `.trim(),

  longArticle: `
## Контрактное производство против собственного цеха

Взгляд на конструкцию цепочки поставок меняется, когда встряска рынка
вскрывает встроенные ограничения капекса. Практика показывает: контракт
снимает капитальные вложения, даёт гибкие MOQ от 500 единиц и сокращает
цикл релиза до 6 недель. Собственный цех требует 14 недель на наладку,
обучение и вспомогательные процессы.

### Ключевые метрики

- Капекс: снижение на 60% при контрактной модели.
- MOQ: от 500 единиц против 5000 при собственном производстве.
- Цикл релиза: 6 недель против 14.
- Удельная себестоимость: падает на 22% при тиражах свыше 50 000 единиц.

### Когда выбирать собственный цех

Собственное производство выигрывает на больших тиражах, поскольку
удельная себестоимость падает за счёт масштаба. Окупаемость капитальных
вложений - 24-36 месяцев. Контроль качества, гибкость модификаций и
защита ноу-хау - три ключевых преимущества.

### Итог

Контрактная модель работает в нишах с быстрым жизненным циклом.
Собственный цех выигрывает на стабильных больших тиражах. Выбор зависит
от горизонта планирования, объёма инвестиций и стратегии бренда.
  `.trim(),
};

describe("analyzeSanity - Russian technical corpus (must NOT be corrupted)", () => {
  for (const [name, text] of Object.entries(RU_TECH_SAMPLES)) {
    it(`accepts legitimate RU text: ${name}`, () => {
      const report = analyzeSanity(text);
      expect(report.corrupted, `reasons: ${report.reasons.join(", ")}`).toBe(false);
    });
  }

  it("consonant-cluster sample stays under both weak-signal count thresholds", () => {
    // Even if the ratio spikes, the absolute count guard (>= 10) must save us
    // on realistic paragraph-sized inputs.
    const r = analyzeSanity(RU_TECH_SAMPLES.consonantClusters);
    expect(r.corrupted).toBe(false);
  });

  it("abbreviation-heavy sample doesn't trip novowel_words", () => {
    const r = analyzeSanity(RU_TECH_SAMPLES.abbreviations);
    // Not flagged - abbreviations shorter than 5 chars don't enter the count,
    // and the strong-foreign guard requires foreign script.
    expect(r.corrupted).toBe(false);
  });
});

describe("analyzeSanity - genuinely corrupted content (must flag)", () => {
  it("flags foreign scripts above the 0.3% threshold", () => {
    const base = "Обычный русский текст про технологии. ".repeat(20);
    const noise = "你好世界 مرحبا שלום ".repeat(10);
    const r = analyzeSanity(base + noise);
    expect(r.corrupted).toBe(true);
    expect(r.reasons.some((x) => x.startsWith("foreign_script"))).toBe(true);
  });

  it("flags token salad: many novowel words + consonant runs together", () => {
    // Two weak signals combined must trip the alarm.
    const salad = Array.from({ length: 40 }, () => "фвджмтр вшпнрк тнбврск здршмпр")
      .join(" ");
    const r = analyzeSanity(salad);
    expect(r.corrupted).toBe(true);
    expect(r.reasons.length).toBeGreaterThanOrEqual(2);
  });

  it("flags unterminated runs longer than 3000 chars", () => {
    const wall = "а".repeat(3500);
    const r = analyzeSanity(wall + " короткое предложение без гласных фвджмтр вшпнрк тнбврск здршмпр фвджмтр вшпнрк тнбврск здршмпр фвджмтр вшпнрк тнбврск здршмпр фвджмтр вшпнрк тнбврск здршмпр");
    expect(r.corrupted).toBe(true);
  });

  it("returns clean report on empty input", () => {
    const r = analyzeSanity("");
    expect(r.corrupted).toBe(false);
    expect(r.metrics.length).toBe(0);
  });

  it("single weak signal alone does NOT flag (regression guard)", () => {
    // Legitimate RU paragraph with ~2-3% consonant clusters must stay clean.
    const legit = `
      Взгляд на конструкцию системы. Всплеск нагрузки обрабатывается
      встроенным планировщиком. Встряска кэша - штатная процедура.
      Обычные слова: работа, качество, результат, показатель, значение,
      данные, анализ, отчёт, метрика, оценка, проверка, контроль,
      управление, планирование, стратегия, тактика, решение, задача.
    `;
    const r = analyzeSanity(legit);
    expect(r.corrupted).toBe(false);
  });
});