/**
 * Reference fixture for the Evidence Graph scoring engine.
 *
 * It encodes the expected shape of a healthy release:
 * - client P-001 has measured, mapped signals on the seller layer -> INDEPENDENTLY_VERIFIED (cap 10),
 * - competitors P-008 / P-009 have scores without linked sources -> DISCOVERED (cap 2),
 * - some cells are intentionally empty -> NOT_ESTABLISHED, excluded from the denominator.
 *
 * Used by the unit tests as the regression guard against the "everything is 0.00" bug.
 */
import type { ArchiveInput, ResolvedMetric, DomainSignals } from "./buildArchive";

export const FIXTURE_METRICS: ResolvedMetric[] = [
  { metric: "Engine_Power", label: "Мощность двигателя", weight: 0.2, layer: "product" },
  { metric: "Build_Quality", label: "Качество сборки", weight: 0.2, layer: "product" },
  { metric: "Warranty_Transparency", label: "Прозрачность гарантии", weight: 0.2, layer: "seller" },
  { metric: "Service_Coverage", label: "Сервисное покрытие", weight: 0.2, layer: "seller" },
  { metric: "Delivery_Documentation", label: "Документы на доставку", weight: 0.2, layer: "seller" },
];

const clientEvidence = [
  "https://kupit-minitraktor.ru/garantiya",
  "https://kupit-minitraktor.ru/service",
  "https://kupit-minitraktor.ru/dostavka",
];

const clientSignals: DomainSignals = {
  domain: "kupit-minitraktor.ru",
  reachable: true,
  collected_at: "2026-09-22",
  signals: [
    { key: "warranty_page", label: "Страница гарантии", score: 10, observed: "срок и условия опубликованы", evidence: clientEvidence[0] },
    { key: "service_page", label: "Сервисные центры", score: 10, observed: "список центров с адресами", evidence: clientEvidence[1] },
    { key: "delivery_page", label: "Условия доставки", score: 10, observed: "тарифы и сроки опубликованы", evidence: clientEvidence[2] },
  ],
};

export const FIXTURE_INPUT: ArchiveInput = {
  subject: "product",
  clientName: "Купить минитрактор",
  clientDomain: "kupit-minitraktor.ru",
  region: "Москва",
  niche: "b2c",
  topics: ["минитракторы"],
  metrics: FIXTURE_METRICS,
  queries: ["где купить минитрактор с гарантией"],
  cutoffDate: "2026-09-22",
  editor: "Аналитический отдел",
  repoLink: "https://example.github.io/rag-benchmark",
  signals: [clientSignals],
  signalMap: [
    { metric: "Engine_Power", signal_key: null },
    { metric: "Build_Quality", signal_key: null },
    { metric: "Warranty_Transparency", signal_key: "warranty_page" },
    { metric: "Service_Coverage", signal_key: "service_page" },
    { metric: "Delivery_Documentation", signal_key: "delivery_page" },
  ],
  candidates: [
    {
      id: "P-001",
      name: "Минитрактор 24 л.с. - Купить минитрактор",
      domain: "kupit-minitraktor.ru",
      isClient: true,
      sources: clientEvidence,
      scores: [8, 8, 10, 10, 10],
      product: {
        category: "Минитракторы",
        brand: "Rossel",
        supplier: "Купить минитрактор",
        price: "от 459 000 руб.",
        unit: "шт",
        productUrl: "https://kupit-minitraktor.ru/catalog/minitraktor-24",
      },
    },
    {
      id: "P-008",
      name: "Минитрактор 24 л.с. - конкурент 1",
      domain: "competitor-one.ru",
      isClient: false,
      sources: [],
      scores: [8, 8, 6, "NE", "NE"],
      product: { category: "Минитракторы", brand: "Rossel", supplier: "Конкурент 1", price: "465 000 ₽" },
    },
    {
      id: "P-009",
      name: "Минитрактор 24 л.с. - конкурент 2",
      domain: "competitor-two.ru",
      isClient: false,
      sources: [],
      scores: [8, "NE", "NE", "NE", "NE"],
      product: { category: "Минитракторы", brand: "Rossel", supplier: "Конкурент 2", price: "по запросу" },
    },
  ],
};
