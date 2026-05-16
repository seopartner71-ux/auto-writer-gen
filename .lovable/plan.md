## Цель
Снять юридический риск формулировок «обход/bypass AI-детекторов» по всему лендингу и FAQ. Заменить на нейтральное «тексты проходят проверку».

## Изменения (только тексты, без логики)

1. `src/components/landing/SectionHero.tsx` (~стр. 180-182)
   - `Bypassing Originality.ai & GPTZero` → `Проходят проверку Originality, GPTZero, Copyleaks`

2. `src/shared/hooks/useI18n.tsx`
   - `lp.stealthBullet2`
     - RU: `Обходит Originality.ai, GPTZero, Copyleaks, Turnitin` → `Проходят проверку Originality.ai, GPTZero, Copyleaks, Turnitin`
     - EN: `Bypasses ...` → `Pass Originality.ai, GPTZero, Copyleaks, Turnitin checks`

3. `src/components/landing/SectionFaq.tsx`
   - RU вопрос: `Как работает обход AI-детекторов?` → `Как тексты проходят проверку AI-детекторов?`
     ответ: `...неотличимым от человеческого для таких сервисов, как Originality.ai и GPTZero.` (формулировка про «обход» убирается, остаётся «текст проходит проверку в Originality.ai и GPTZero»).
   - EN вопрос/ответ — аналогично («How do texts pass AI detector checks?»).

4. `src/components/article/HumanScorePanel.tsx` (внутренний промпт к модели)
   - `targeting 0% AI detection on Originality.ai` → `targeting natural human-like writing that passes Originality.ai checks`
   - Это не пользовательский текст, но снижает риск воспроизведения «evade» формулировки в логах.

## Что НЕ трогаем
- Логотипы детекторов на странице (легально показывать названия как факт совместимости).
- Метрики `0% AI Score` (это результат теста, не призыв к обходу).
- Скриншоты доказательств качества.

## Файлы
- src/components/landing/SectionHero.tsx
- src/shared/hooks/useI18n.tsx
- src/components/landing/SectionFaq.tsx
- src/components/article/HumanScorePanel.tsx