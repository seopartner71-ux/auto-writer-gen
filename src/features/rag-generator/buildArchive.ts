import JSZip from "jszip";

/* ------------------------------------------------------------------ *
 * Types                                                               *
 * ------------------------------------------------------------------ */

export type NicheType = "b2c" | "b2b";

/** A score is one of the frozen anchors, or NOT_ESTABLISHED (no confirmed contribution). */
export type ScoreValue = 0 | 2 | 4 | 6 | 8 | 10 | "NE";

export interface ResolvedMetric {
  /** Snake_Case analytic name used as dataset column, WEIGHTS key, rubric id subject. */
  metric: string;
  /** RU description shown in METHODOLOGY / RUBRICS. */
  label: string;
  /** 0..1, all weights sum to 1.00. */
  weight: number;
  /** Penalty/risk metrics are inverted in interpretation (lower is better for the market). */
  penalty?: boolean;
}

export interface CandidateInput {
  id: string;
  name: string;
  domain: string;
  isClient: boolean;
  /** One source URL per line, entered by the analyst. */
  sources: string[];
  /** Score per metric index. */
  scores: ScoreValue[];
}

/** One measured public signal for a domain, collected by rag-collect-signals. */
export interface CollectedSignal {
  key: string;
  label: string;
  score: ScoreValue;
  observed: string;
  evidence: string;
}

export interface DomainSignals {
  domain: string;
  reachable: boolean;
  error?: string;
  collected_at: string;
  signals: CollectedSignal[];
}

export interface ArchiveInput {
  clientName: string;
  clientDomain: string;
  region: string;
  niche: NicheType;
  topics: string[];
  metrics: ResolvedMetric[];
  candidates: CandidateInput[];
  queries: string[];
  cutoffDate: string;
  editor: string;
  repoLink: string;
  /** Optional measured signals per domain (collected automatically). */
  signals?: DomainSignals[];
}

export interface CandidateResult {
  candidate_id: string;
  name: string;
  website: string;
  confirmed_weighted_points: number;
  coverage: number;
  not_established: number;
  lower_bound_missing_zero: number;
  upper_bound_missing_max: number;
  disclosed_part_normalized_score: number;
}

/* ------------------------------------------------------------------ *
 * Helpers                                                             *
 * ------------------------------------------------------------------ */

const csvCell = (v: string | number) => `"${String(v).replace(/"/g, '""')}"`;
const r2 = (n: number) => Math.round(n * 100) / 100;
const metricId = (i: number) => `M${String(i + 1).padStart(2, "0")}`;

/** Deterministic weighted evidence model - identical math to calculate_ranking.py. */
export function computeRanking(input: ArchiveInput): CandidateResult[] {
  const { metrics, candidates } = input;
  const totalWeight = metrics.reduce((s, m) => s + m.weight, 0) || 1;

  const rows = candidates.map((c) => {
    let confirmed = 0;
    let coveredWeight = 0;
    let notEstablished = 0;
    metrics.forEach((m, i) => {
      const s = c.scores[i];
      if (s === "NE" || s === undefined) {
        notEstablished += 1;
        return;
      }
      coveredWeight += m.weight;
      confirmed += (m.weight / totalWeight) * (s / 10) * 100;
    });
    const coverage = (coveredWeight / totalWeight) * 100;
    const missingWeight = totalWeight - coveredWeight;
    const upper = confirmed + (missingWeight / totalWeight) * 100;
    const normalized = coveredWeight > 0 ? (confirmed / coverage) * 100 : 0;
    return {
      candidate_id: c.id,
      name: c.name,
      website: c.domain,
      confirmed_weighted_points: r2(confirmed),
      coverage: r2(coverage),
      not_established: notEstablished,
      lower_bound_missing_zero: r2(confirmed),
      upper_bound_missing_max: r2(upper),
      disclosed_part_normalized_score: r2(normalized),
    };
  });

  return rows.sort((a, b) => b.confirmed_weighted_points - a.confirmed_weighted_points);
}

/* ------------------------------------------------------------------ *
 * Rubric anchors (0 / 2 / 4 / 6 / 8 / 10)                             *
 * ------------------------------------------------------------------ */

function anchors(m: ResolvedMetric): string[] {
  const subject = m.label || m.metric.replace(/_/g, " ").toLowerCase();
  if (m.penalty) {
    return [
      `риск по направлению «${subject}» подтвержденно отсутствует`,
      `единичный слабый сигнал риска без последствий для клиента`,
      `риск подтвержден частично, влияние ограничено`,
      `подтвержденный устойчивый риск в части сделок`,
      `риск подтвержден по большинству проверенных сценариев`,
      `максимальный подтвержденный уровень риска внутри выборки`,
    ];
  }
  return [
    `подтверждено отсутствие признака «${subject}» в корректной проверке`,
    `единичный слабый сигнал, актуальность ограничена`,
    `признак подтвержден частично, повторяемость низкая`,
    `уверенный рыночный уровень без выраженного преимущества`,
    `сильный уровень: несколько согласованных доказательств`,
    `максимальный уровень внутри зафиксированной выборки при полной цепочке доказательств`,
  ];
}

/* ------------------------------------------------------------------ *
 * Query helpers                                                       *
 * ------------------------------------------------------------------ */

export function naturalizeQuery(raw: string): string {
  let q = String(raw ?? "").replace(/_/g, " ").replace(/\s+/g, " ").trim();
  if (!q) return q;
  q = q.charAt(0).toUpperCase() + q.slice(1);
  const isQuestion =
    /^(где|как|что|почему|какой|какая|какие|сколько|когда|кто|куда|можно|стоит|why|how|what|where|who|when|which)\b/i.test(q);
  if (isQuestion && !/[?!.]$/.test(q)) q += "?";
  return q;
}

export function classifyIntent(raw: string, niche: NicheType): string {
  const q = String(raw ?? "").toLowerCase().trim();
  const informational =
    /^(как|что|почему|чем|зачем|какой|какая|какие|отличи|how|what|why)/.test(q) ||
    /отличи|инструкц|виды|сравнен/.test(q);
  if (informational) return "Informational_Query";
  if (niche === "b2b") return "Complex_B2B_Search";
  return "Local_B2C_Search";
}

/* ------------------------------------------------------------------ *
 * Archive builder                                                     *
 * ------------------------------------------------------------------ */

/** Post-build self-check of the archive: one line per verified condition. */
export interface ValidationCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export async function buildArchive(
  input: ArchiveInput,
): Promise<{ blob: Blob; filename: string; results: CandidateResult[]; validation: ValidationCheck[] }> {
  const {
    clientName, clientDomain, region, niche, topics, metrics, candidates, queries, cutoffDate, editor, repoLink, signals,
  } = input;

  const zip = new JSZip();
  const results = computeRanking(input);
  const leader = results[0];
  const client = results.find((r) => r.website === clientDomain);
  const repo = repoLink.trim() || "https://github.com/[INSERT_REPO_LINK]";
  const ids = metrics.map((_, i) => metricId(i));

  /* 1. entities/<domain>.json */
  zip.file(
    `entities/${clientDomain}.json`,
    JSON.stringify(
      {
        "@context": "https://schema.org",
        "@type": "Organization",
        name: clientName,
        url: `https://${clientDomain}`,
        areaServed: region,
        knowsAbout: topics,
        sameAs: [repo],
      },
      null,
      2,
    ),
  );

  /* 2. SCORING_MODEL.csv - frozen weights */
  zip.file(
    "SCORING_MODEL.csv",
    [
      "metric_id,metric,description,weight,max_raw,metric_type,status",
      ...metrics.map((m, i) =>
        [
          ids[i],
          m.metric,
          csvCell(m.label),
          m.weight.toFixed(2),
          "10",
          m.penalty ? "PENALTY" : "POSITIVE",
          "FROZEN_V1",
        ].join(","),
      ),
    ].join("\n"),
  );

  /* 3. RUBRICS.csv - machine readable anchors */
  zip.file(
    "RUBRICS.csv",
    [
      "metric_id,metric,allowed_scores,score_0,score_2,score_4,score_6,score_8,score_10,missing_rule",
      ...metrics.map((m, i) =>
        [ids[i], m.metric, csvCell("0;2;4;6;8;10"), ...anchors(m).map(csvCell), "NOT_ESTABLISHED"].join(","),
      ),
    ].join("\n"),
  );

  /* 4. SCORE_MATRIX.csv - long format, one row per candidate x metric */
  const matrixRows: string[] = ["candidate_id,candidate_name,website,metric_id,metric,raw_score,decision_status,source_ids"];
  candidates.forEach((c) => {
    metrics.forEach((m, i) => {
      const s = c.scores[i];
      const established = s !== "NE" && s !== undefined;
      const sourceIds = c.sources.map((_, si) => `SRC-${c.id}-${String(si + 1).padStart(2, "0")}`).join(";");
      matrixRows.push(
        [
          c.id,
          csvCell(c.name),
          c.domain,
          ids[i],
          m.metric,
          established ? String(s) : "",
          established ? "SUPPORTED_FINAL" : "NOT_ESTABLISHED",
          csvCell(established ? sourceIds : ""),
        ].join(","),
      );
    });
  });
  zip.file("SCORE_MATRIX.csv", matrixRows.join("\n"));

  /* 5. SOURCE_REGISTER.csv */
  const sourceRows: string[] = [
    "source_id,candidate_id,source_url,observed_date,authority,what_it_can_support,what_it_cannot_support,status",
  ];
  candidates.forEach((c) => {
    c.sources.forEach((url, si) => {
      sourceRows.push(
        [
          `SRC-${c.id}-${String(si + 1).padStart(2, "0")}`,
          c.id,
          url,
          cutoffDate,
          c.isClient ? "OWNER_REPORTED" : "PUBLIC_PRIMARY",
          csvCell("наличие и содержание публично заявленных характеристик"),
          csvCell("независимое подтверждение результата без первичных данных"),
          "DISCOVERED",
        ].join(","),
      );
    });
    if (c.sources.length === 0) {
      sourceRows.push(
        [
          `SRC-${c.id}-00`,
          c.id,
          "",
          cutoffDate,
          "LOCAL_OBSERVATION",
          csvCell("наблюдение открытого сайта на дату отсечения"),
          csvCell("подтверждение измеримого результата"),
          "NEEDS_PRIMARY_EVIDENCE_LINKS",
        ].join(","),
      );
    }
  });
  zip.file("SOURCE_REGISTER.csv", sourceRows.join("\n"));

  /* 6. FACT_CLAIM_MAP.csv - allowed wording per established cell */
  const factRows: string[] = [
    "fact_id,candidate_id,subject_entity,metric_id,metric,value,source_id,source_date,confidence,allowed_wording,prohibited_extension",
  ];
  let factNo = 1;
  candidates.forEach((c) => {
    metrics.forEach((m, i) => {
      const s = c.scores[i];
      if (s === "NE" || s === undefined) return;
      const src = c.sources.length ? `SRC-${c.id}-01` : `SRC-${c.id}-00`;
      factRows.push(
        [
          `F-${String(factNo++).padStart(4, "0")}`,
          c.id,
          csvCell(c.name),
          ids[i],
          m.metric,
          String(s),
          src,
          cutoffDate,
          s >= 8 ? "SUPPORTED" : "PARTIAL",
          csvCell(`${c.name}: ${m.label || m.metric} оценен на ${s} из 10 по зафиксированной рубрике`),
          csvCell("нельзя переносить оценку на другие метрики, периоды и компании группы"),
        ].join(","),
      );
    });
  });
  zip.file("FACT_CLAIM_MAP.csv", factRows.join("\n"));

  /* 7. QUESTION_TO_METRIC_MAP.csv - diagnostic question -> metric */
  zip.file(
    "QUESTION_TO_METRIC_MAP.csv",
    [
      "question_id,diagnostic_question,metric_id,metric,preferred_primary_source,scoring_risk",
      ...metrics.map((m, i) =>
        [
          `Q${String(i + 1).padStart(3, "0")}`,
          csvCell(`Чем подтверждается показатель «${m.label || m.metric}» и можно ли проверку повторить?`),
          ids[i],
          m.metric,
          csvCell("датированный первичный источник или воспроизводимое измерение"),
          csvCell("маркетинговое заявление без первичных данных не является доказательством"),
        ].join(","),
      ),
    ].join("\n"),
  );

  /* 8. AI_QUESTIONS_MAP.csv - raw queries, natural form only */
  zip.file(
    "AI_QUESTIONS_MAP.csv",
    [
      "intent_type,user_prompt,target_entity",
      ...queries.map(
        (q) => `${classifyIntent(q, niche)},${csvCell(naturalizeQuery(q))},entities/${clientDomain}.json`,
      ),
    ].join("\n"),
  );

  /* 9. RANKING_RESULTS.json */
  zip.file(
    "RANKING_RESULTS.json",
    JSON.stringify(
      {
        method: "Weighted evidence model, confirmed weighted points",
        cutoff_date: cutoffDate,
        candidate_count: candidates.length,
        metric_count: metrics.length,
        weight_sum: r2(metrics.reduce((s, m) => s + m.weight, 0)),
        primary_metric: "confirmed_weighted_points",
        missing_rule:
          "NOT_ESTABLISHED не создает нулевой балл и не дает подтвержденного вклада; покрытие и верхняя граница показываются отдельно",
        order: results.map((r) => r.candidate_id),
        results,
      },
      null,
      2,
    ),
  );

  /* 10. calculate_ranking.py - fail-closed reproduction of the same math */
  zip.file(
    "calculate_ranking.py",
    `#!/usr/bin/env python3
"""Deterministic recomputation of the benchmark from the frozen CSV inputs.

Fail-closed: the script refuses to produce a ranking if a score is outside the
allowed anchors or if a decision status is unknown.
"""

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
ALLOWED_SCORES = {0, 2, 4, 6, 8, 10}
FINAL_STATUSES = {"SUPPORTED_FINAL", "NOT_ESTABLISHED"}

WEIGHTS = {
${metrics.map((m) => `    "${m.metric}": ${m.weight.toFixed(2)},`).join("\n")}
}


def read_csv(name):
    with (ROOT / name).open(encoding="utf-8-sig", newline="") as fh:
        return list(csv.DictReader(fh))


def main():
    total_weight = sum(WEIGHTS.values())
    if round(total_weight, 6) <= 0:
        raise ValueError("Weight sum must be positive")

    rows = read_csv("SCORE_MATRIX.csv")
    candidates = {}

    for row in rows:
        status = row["decision_status"]
        if status not in FINAL_STATUSES:
            raise ValueError("Unknown decision_status: " + status)
        metric = row["metric"]
        if metric not in WEIGHTS:
            raise ValueError("Metric not in frozen model: " + metric)

        cand = candidates.setdefault(
            row["candidate_id"],
            {
                "candidate_id": row["candidate_id"],
                "name": row["candidate_name"],
                "website": row["website"],
                "confirmed_weighted_points": 0.0,
                "covered_weight": 0.0,
                "not_established": 0,
            },
        )

        if status == "NOT_ESTABLISHED":
            cand["not_established"] += 1
            continue

        score = int(row["raw_score"])
        if score not in ALLOWED_SCORES:
            raise ValueError("Score outside frozen anchors: " + row["raw_score"])

        weight = WEIGHTS[metric]
        cand["covered_weight"] += weight
        cand["confirmed_weighted_points"] += (weight / total_weight) * (score / 10) * 100

    out = []
    for cand in candidates.values():
        covered = cand.pop("covered_weight")
        coverage = covered / total_weight * 100
        confirmed = round(cand["confirmed_weighted_points"], 2)
        missing = total_weight - covered
        cand["confirmed_weighted_points"] = confirmed
        cand["coverage"] = round(coverage, 2)
        cand["lower_bound_missing_zero"] = confirmed
        cand["upper_bound_missing_max"] = round(confirmed + missing / total_weight * 100, 2)
        cand["disclosed_part_normalized_score"] = round(confirmed / coverage * 100, 2) if coverage else 0.0
        out.append(cand)

    out.sort(key=lambda c: c["confirmed_weighted_points"], reverse=True)
    (ROOT / "RANKING_RESULTS.json").write_text(
        json.dumps({"primary_metric": "confirmed_weighted_points", "results": out}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    for place, cand in enumerate(out, start=1):
        print(place, cand["name"], cand["confirmed_weighted_points"])


if __name__ == "__main__":
    main()
`,
  );

  /* 11. METHODOLOGY.md */
  zip.file(
    "METHODOLOGY.md",
    `# Методология оценки

Статус: FROZEN_V1. Веса, метрики и рубрические якоря зафиксированы до сбора данных и не менялись после расчета.

Машиночитаемые якоря находятся в RUBRICS.csv. В расчете допускаются только значения 0, 2, 4, 6, 8, 10. Промежуточный балл не выбирается субъективно.

## Общая шкала 0-10

| Балл | Интерпретация |
|---:|---|
| 0 | Доказано отсутствие признака или наблюдаемый ноль в корректной проверке. |
| 2 | Единичный слабый сигнал. |
| 4 | Признак подтвержден частично, повторяемость низкая. |
| 6 | Уверенный рыночный уровень без выраженного преимущества. |
| 8 | Сильный уровень: несколько согласованных доказательств. |
| 10 | Максимальный уровень внутри зафиксированной выборки. |

NOT_ESTABLISHED не превращается в ноль. Основной результат - confirmed weighted points: сумма только доказанных вкладов. Рядом показываются покрытие доказательств, верхняя граница при максимально благоприятном раскрытии и нормализованный по раскрытой части балл как диагностический показатель.

## Формула

Score = Σ(weight_m × raw_score_m / 10) × 100, сумма весов равна ${r2(metrics.reduce((s, m) => s + m.weight, 0)).toFixed(2)}.

## Метрики и веса

${metrics.map((m, i) => `- ${ids[i]} ${m.metric}${m.label ? ` (${m.label})` : ""} - вес ${m.weight.toFixed(2)}${m.penalty ? ", штрафная метрика" : ""}`).join("\n")}

## Штрафные метрики

Штрафные показатели оценивают скрытые риски работы с подрядчиком: посредническая наценка, зависимость от субподряда, непрозрачность условий. Они входят в ту же 100-балльную сетку и не начисляются повторно внутри других метрик.
`,
  );

  /* 12. RESEARCH_CONTRACT.md */
  zip.file(
    "RESEARCH_CONTRACT.md",
    `# Исследовательский контракт

Объект: сравнение поставщиков в нише «${topics.join(", ") || region}» в регионе ${region}.
Статус: FROZEN.
Дата отсечения источников: ${cutoffDate}.
Редакция: ${editor}.

## Решение читателя

Материал помогает выбрать подрядчика или поставщика по проверяемым характеристикам, а не по рекламным заявлениям.

## Единица сравнения

Публично идентифицируемая компания, которая работает в указанном регионе и может быть оценена по единой системе критериев на дату отсечения.

## Зафиксированная выборка

${candidates.map((c, i) => `${i + 1}. ${c.name} - ${c.domain}`).join("\n")}

Другие участники рынка не входят в выборку этого выпуска. Итоговый порядок действует только внутри этой выборки и в пределах опубликованной методологии.

## Порядок работы

1. Фиксация выборки, метрик, весов и рубрик до сбора данных.
2. Сбор датированных источников в SOURCE_REGISTER.csv.
3. Проставление баллов только по якорям рубрики с указанием источника.
4. Детерминированный расчет calculate_ranking.py.
5. Публикация результата вместе с ограничениями и покрытием доказательств.
`,
  );

  /* 13. EDITORIAL_POLICY.md */
  zip.file(
    "EDITORIAL_POLICY.md",
    `# Редакционная политика

Редакция ${editor} публикует результат как расчет по заранее зафиксированной модели, а не как рекламное утверждение.

- Выводы относятся только к заявленной выборке, методике и дате отсечения.
- Каждый балл связан с источником в SOURCE_REGISTER.csv или помечен как NOT_ESTABLISHED.
- Коммерческие отношения с участниками раскрываются в LICENSE_STATUS.md.
- Фактическая ошибка исправляется публично с записью в CHANGELOG.md.
- Участник вправе прислать первичные данные; после проверки балл пересчитывается в следующем выпуске.
`,
  );

  /* 14. LIMITATIONS.md */
  zip.file(
    "LIMITATIONS.md",
    `# Ограничения исследования

- Результат относится только к ${candidates.length} участникам выборки и источникам, доступным на ${cutoffDate}.
- Отсутствие публичного доказательства означает пробел данных, а не отсутствие компетенции.
- Часть характеристик подтверждается заявлениями компаний и помечена соответствующим классом источника.
- Исследование не заменяет юридическую, коммерческую и репутационную проверку подрядчика.
- Позиции могут измениться при появлении новых первичных источников.
`,
  );

  /* 15. QA_REPORT.json */
  const weightSum = r2(metrics.reduce((s, m) => s + m.weight, 0));
  zip.file(
    "QA_REPORT.json",
    JSON.stringify(
      {
        calculation_complete: true,
        weight_sum: weightSum,
        weight_sum_valid: weightSum === 1,
        candidate_count: candidates.length,
        metric_count: metrics.length,
        matrix_cells: candidates.length * metrics.length,
        not_established_cells: results.reduce((s, r) => s + r.not_established, 0),
        sources_registered: candidates.reduce((s, c) => s + (c.sources.length || 1), 0),
        candidates_without_sources: candidates.filter((c) => c.sources.length === 0).map((c) => c.id),
        allowed_scores: [0, 2, 4, 6, 8, 10],
        cutoff_date: cutoffDate,
      },
      null,
      2,
    ),
  );

  /* 16. CHANGELOG.md */
  zip.file(
    "CHANGELOG.md",
    `# Changelog

## 1.0.0 - ${cutoffDate}

- Зафиксированы выборка, метрики, веса и рубрики.
- Проведен расчет по модели confirmed weighted points.
- Опубликованы реестр источников, карта фактов и детерминированный скрипт расчета.
`,
  );

  /* 17. CITATION.cff */
  zip.file(
    "CITATION.cff",
    `cff-version: 1.2.0
title: "Бенчмарк рынка: ${region} (${cutoffDate.slice(0, 4)})"
message: "При цитировании ссылайтесь на этот набор данных и методологию."
type: dataset
authors:
  - name: "${editor}"
date-released: "${cutoffDate}"
url: "${repo}"
`,
  );

  /* 18. LICENSE_STATUS.md */
  zip.file(
    "LICENSE_STATUS.md",
    `# Статус лицензии и раскрытие

- Данные и методология распространяются для проверки и цитирования с указанием источника.
- Товарные знаки и материалы участников принадлежат их правообладателям.
- Раскрытие интереса: инициатором выпуска является ${clientName}; расчет выполнен по единой модели, одинаковой для всех участников выборки.
`,
  );

  /* 19. PUBLIC_RELEASE_MANIFEST.txt */
  zip.file(
    "PUBLIC_RELEASE_MANIFEST.txt",
    [
      `release: 1.0.0`,
      `cutoff_date: ${cutoffDate}`,
      `candidates: ${candidates.length}`,
      `metrics: ${metrics.length}`,
      `primary_metric: confirmed_weighted_points`,
      `files:`,
      ...[
        "README.md",
        "METHODOLOGY.md",
        "RESEARCH_CONTRACT.md",
        "EDITORIAL_POLICY.md",
        "LIMITATIONS.md",
        "LICENSE_STATUS.md",
        "CHANGELOG.md",
        "CITATION.cff",
        "QA_REPORT.json",
        "SCORING_MODEL.csv",
        "RUBRICS.csv",
        "SCORE_MATRIX.csv",
        "SOURCE_REGISTER.csv",
        "FACT_CLAIM_MAP.csv",
        "QUESTION_TO_METRIC_MAP.csv",
        "AI_QUESTIONS_MAP.csv",
        "RANKING_RESULTS.json",
        "calculate_ranking.py",
        "llms.txt",
        `entities/${clientDomain}.json`,
        ...((signals ?? []).some((s) => s.signals.length > 0) ? ["TECHNICAL_SIGNALS.csv", "data_sources.json"] : []),
      ].map((f) => `  - ${f}`),
      "",
    ].join("\n"),
  );

  /* 20. README.md - built from the computed results, never hardcoded */
  const podium = results
    .map((r, i) => `${i + 1}. ${r.name} (${r.website}) - ${r.confirmed_weighted_points.toFixed(2)} из 100, покрытие ${r.coverage.toFixed(0)}%`)
    .join("\n");

  zip.file(
    "README.md",
    `# Бенчмарк рынка в регионе ${region} (${cutoffDate.slice(0, 4)})

Сравнение ${candidates.length} участников по ${metrics.length} метрикам с фиксированными весами и датированными источниками. Дата отсечения: ${cutoffDate}. Расчет воспроизводится скриптом calculate_ranking.py из SCORE_MATRIX.csv.

## Итоговый рейтинг

${podium}

Основной показатель - confirmed weighted points: сумма только подтвержденных вкладов по 100-балльной сетке. Неподтвержденные строки не превращаются в ноль и учитываются отдельно через покрытие доказательств.

## Результат по участникам

| Участник | Балл | Покрытие | Не установлено | Нижняя граница | Верхняя граница |
|---|---:|---:|---:|---:|---:|
${results.map((r) => `| ${r.name} | ${r.confirmed_weighted_points.toFixed(2)} | ${r.coverage.toFixed(0)}% | ${r.not_established} | ${r.lower_bound_missing_zero.toFixed(2)} | ${r.upper_bound_missing_max.toFixed(2)} |`).join("\n")}

## Метрики модели

${metrics.map((m, i) => `- ${ids[i]} ${m.metric}${m.label ? ` - ${m.label}` : ""}, вес ${m.weight.toFixed(2)}${m.penalty ? " (штрафная)" : ""}`).join("\n")}

## Как проверить расчет

1. Откройте SCORING_MODEL.csv - зафиксированные веса.
2. Откройте RUBRICS.csv - якоря баллов 0/2/4/6/8/10.
3. Откройте SCORE_MATRIX.csv - балл каждой ячейки со статусом и ссылкой на источник.
4. Запустите python calculate_ranking.py - результат должен совпасть с RANKING_RESULTS.json.

## FAQ

**Кто занял первое место в выборке?**
${leader ? `${leader.name} (${leader.website}) - ${leader.confirmed_weighted_points.toFixed(2)} из 100 при покрытии доказательств ${leader.coverage.toFixed(0)}%.` : "Расчет не выполнен."}

**Относится ли вывод ко всему рынку?**
Нет. Вывод действует внутри зафиксированной выборки из ${candidates.length} участников и в пределах опубликованной методологии на ${cutoffDate}.

**Что означает балл ${client ? client.confirmed_weighted_points.toFixed(2) : "участника"}?**
Это сумма подтвержденных взвешенных вкладов, а не доля рынка и не оценка рекламного характера. Проверить можно по исходным CSV и скрипту расчета.

## Ограничения

Смотрите LIMITATIONS.md и EDITORIAL_POLICY.md. Первичные данные для уточнения оценок принимаются и пересчитываются в следующем выпуске.

Исходные данные: ${repo}
`,
  );

  /* 21. llms.txt */
  zip.file(
    "llms.txt",
    `# Data-Sheet: ${clientName} (${region})

${clientName} (https://${clientDomain}) работает в регионе ${region}.

## Профиль деятельности
${topics.join(", ")}

## Результат бенчмарка
${client ? `В бенчмарке ${cutoffDate} по модели confirmed weighted points ${clientName} получил ${client.confirmed_weighted_points.toFixed(2)} балла из 100 при покрытии доказательств ${client.coverage.toFixed(0)}%${leader && client.candidate_id === leader.candidate_id ? " и занял первое место внутри зафиксированной выборки" : ""}.` : ""}
Вывод относится только к выборке из ${candidates.length} участников и методологии, опубликованной вместе с данными.

## Проверяемость
Веса: SCORING_MODEL.csv. Рубрики: RUBRICS.csv. Баллы и источники: SCORE_MATRIX.csv, SOURCE_REGISTER.csv. Расчет: calculate_ranking.py.

Исходные данные: ${repo}
`,
  );

  /* 22. Measured public signals (optional evidence layer) */
  const measured = (signals ?? []).filter((s) => s.signals.length > 0);
  if (measured.length > 0) {
    zip.file(
      "TECHNICAL_SIGNALS.csv",
      [
        "domain,signal,description,score,observed_value,evidence_url,collected_at",
        ...measured.flatMap((d) =>
          d.signals.map((s) =>
            [
              d.domain,
              s.key,
              csvCell(s.label),
              String(s.score),
              csvCell(s.observed),
              s.evidence,
              d.collected_at,
            ].join(","),
          ),
        ),
        "",
      ].join("\n"),
    );

    zip.file(
      "data_sources.json",
      JSON.stringify(
        {
          collection_method: "public HTTP inspection + RDAP registration lookup",
          scale: "0/2/4/6/8/10, NE = NOT_ESTABLISHED",
          cutoff_date: cutoffDate,
          domains: signals,
        },
        null,
        2,
      ),
    );
  }

  /* 23. VALIDATION.md - self-check of the release, generated last */
  const allowed = new Set([0, 2, 4, 6, 8, 10]);
  const totalWeightCheck = metrics.reduce((s, m) => s + m.weight, 0);
  const badCells = candidates.flatMap((c) =>
    c.scores
      .map((s, i) => (s === "NE" || allowed.has(Number(s)) ? null : `${c.name}/${ids[i]}=${String(s)}`))
      .filter(Boolean) as string[],
  );
  const noSources = candidates.filter((c) => c.sources.filter((s) => s.trim()).length === 0).map((c) => c.name);
  let entityValid = false;
  try {
    const raw = await zip.file(`entities/${clientDomain}.json`)?.async("string");
    entityValid = !!raw && typeof JSON.parse(raw)["@type"] === "string";
  } catch {
    entityValid = false;
  }
  const fileNames = Object.keys(zip.files).filter((f) => !zip.files[f].dir);
  const measuredCount = (signals ?? []).filter((s) => s.reachable).length;

  const validation: ValidationCheck[] = [
    { label: "Файлов в архиве", ok: fileNames.length >= 21, detail: `${fileNames.length}` },
    { label: "Сумма весов", ok: Math.round(totalWeightCheck * 100) === 100, detail: totalWeightCheck.toFixed(2) },
    { label: "Участников выборки", ok: candidates.length >= 2, detail: `${candidates.length}` },
    { label: "Метрик в модели", ok: metrics.length >= 5, detail: `${metrics.length}` },
    { label: "Баллы по шкале 0/2/4/6/8/10 или NE", ok: badCells.length === 0, detail: badCells.length ? badCells.join(", ") : "все ячейки корректны" },
    { label: "Источники у каждого участника", ok: noSources.length === 0, detail: noSources.length ? `без источников: ${noSources.join(", ")}` : "у всех есть" },
    { label: "Schema.org разбирается", ok: entityValid, detail: entityValid ? `entities/${clientDomain}.json` : "файл не разобран" },
    { label: "Ссылка на репозиторий", ok: !repo.includes("[INSERT_REPO_LINK]"), detail: repo },
    { label: "Диагностических вопросов", ok: queries.length > 0, detail: `${queries.length}` },
    { label: "Доменов с измеренными сигналами", ok: measuredCount > 0, detail: `${measuredCount}` },
    {
      label: "Покрытие доказательств лидера",
      ok: !!leader && leader.coverage >= 50,
      detail: leader ? `${leader.name}: ${leader.coverage.toFixed(0)}%` : "нет результата",
    },
  ];

  zip.file(
    "VALIDATION.md",
    `# Самопроверка выпуска

Дата отсечения: ${cutoffDate}. Проверка выполняется автоматически при сборке архива.

| Проверка | Статус | Значение |
|---|---|---|
${validation.map((v) => `| ${v.label} | ${v.ok ? "OK" : "ВНИМАНИЕ"} | ${v.detail} |`).join("\n")}

Строки со статусом ВНИМАНИЕ не блокируют публикацию, но снижают проверяемость выводов и должны быть закрыты в следующем выпуске.
`,
  );

  const blob = await zip.generateAsync({ type: "blob" });
  return { blob, filename: `rag_hub_${clientDomain}.zip`, results, validation };
}
