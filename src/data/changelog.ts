// Публичный changelog. Чтобы добавить новую версию - добавь запись сверху массива.
// Формат дат: YYYY-MM-DD. Пишем короткими человеческими формулировками
// без внутренней терминологии.

export type ChangelogType = "new" | "improvement" | "fix" | "breaking";

export type ChangelogItem = {
  type: ChangelogType;
  text: string;
};

export type ChangelogRelease = {
  version: string;
  date: string;
  title: string;
  items: ChangelogItem[];
};

export const CHANGELOG: ChangelogRelease[] = [
  {
    version: "2.4",
    date: "2026-07-07",
    title: "Стабильное улучшение и понятные оценки",
    items: [
      { type: "new",         text: "Улучшение текста теперь работает на сервере: обновление или закрытие страницы больше не прерывает процесс." },
      { type: "new",         text: "Появилась кнопка \"Остановить\" для цикла улучшения - лучший результат при этом сохраняется." },
      { type: "new",         text: "Таймер выполнения и подсказки, если процесс идет дольше обычного." },
      { type: "improvement", text: "Единая шкала оценки: \"Человечность X/100\" вместо путающих процентов AI." },
      { type: "improvement", text: "Защита от поврежденного текста: битые генерации не сохраняются, показывается причина." },
      { type: "improvement", text: "Тексты стали живее: убраны канцелярские клише, обрывки фраз и неестественные вставки ключевых слов." },
      { type: "fix",         text: "Проверка Тургенева теперь корректно работает для всех русских статей." },
      { type: "fix",         text: "Исправлена уязвимость безопасности и десятки внутренних ошибок конвейера." },
    ],
  },
];

export const LATEST_VERSION = CHANGELOG[0]?.version ?? "";