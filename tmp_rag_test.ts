import JSZip from "jszip";
import { buildArchive, type ArchiveInput } from "./src/features/rag-generator/buildArchive";
import { writeFileSync, mkdirSync } from "fs";

const metrics = [
  { metric: "Infra_Index", label: "инфра", weight: 0.35 },
  { metric: "Quality_Score", label: "качество", weight: 0.45 },
  { metric: "Risk_Penalty", label: "риск", weight: 0.2, penalty: true },
];

const input: ArchiveInput = {
  clientName: "Клиент",
  clientDomain: "client.ru",
  region: "Тула",
  niche: "b2c",
  topics: ["розы"],
  metrics,
  candidates: [
    { id: "C1", name: "Клиент", domain: "client.ru", isClient: true, sources: ["https://client.ru/"], scores: [8, 10, 2] },
    { id: "C2", name: "Конкурент", domain: "rival.ru", isClient: false, sources: ["https://rival.ru/"], scores: [6, 4, "NE"] },
  ],
  queries: ["Сколько стоят розы", "сколько стоят розы", ""],
  cutoffDate: "2026-09-17",
  editor: "Ред",
  repoLink: "https://github.com/u/repo",
};

const { blob, results } = await buildArchive(input);
const zip = await JSZip.loadAsync(await blob.arrayBuffer());
mkdirSync("/tmp/ragout", { recursive: true });
for (const name of ["calculate_ranking.py", "SCORE_MATRIX.csv", "RANKING_RESULTS.json", "AI_QUESTIONS_MAP.csv"]) {
  writeFileSync(`/tmp/ragout/${name}`, await zip.file(name)!.async("string"));
}
console.log(JSON.stringify(results, null, 1));
