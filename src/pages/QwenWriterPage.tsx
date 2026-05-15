import { Bot, Download, ExternalLink, Chrome } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

export default function QwenWriterPage() {
  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Bot className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Qwen Writer Mini</h1>
          <p className="text-sm text-muted-foreground">
            Бесплатная автоматизация написания SEO-статей через Qwen прямо в браузере
          </p>
        </div>
      </div>

      <Card className="p-6 space-y-4">
        <h2 className="text-lg font-semibold">Что это</h2>
        <p className="text-sm text-muted-foreground leading-relaxed">
          Tampermonkey-скрипт превращает стандартный бесплатный интерфейс Qwen в фабрику контента.
          Загружаете список тем - на выходе получаете готовые статьи с H1, структурой, гэпами и чистой
          HTML-разметкой, которые можно сразу заливать на сайт. Без платных API и подписок.
        </p>
        <div className="flex flex-wrap gap-3 pt-2">
          <Button asChild className="gap-2">
            <a href="/qwen-writer-mini.user.js" download>
              <Download className="h-4 w-4" />
              Скачать скрипт (.user.js)
            </a>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <a href="https://www.tampermonkey.net/" target="_blank" rel="noreferrer">
              <Chrome className="h-4 w-4" />
              Установить Tampermonkey
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
          <Button asChild variant="outline" className="gap-2">
            <a href="https://chat.qwen.ai/" target="_blank" rel="noreferrer">
              Открыть Qwen
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </Button>
        </div>
      </Card>

      <Card className="p-6 space-y-5">
        <h2 className="text-lg font-semibold">Краткий мануал: как запустить генерацию</h2>

        <div className="space-y-5 text-sm leading-relaxed">
          <Step n={1} title="Подготовка браузера">
            Установите расширение Tampermonkey для вашего браузера (работает в Chrome, Edge, Firefox).
          </Step>

          <Step n={2} title="Установка скрипта">
            Скачайте файл <code className="px-1.5 py-0.5 rounded bg-muted text-xs">qwen-writer-mini.user.js</code>{" "}
            и откройте его двойным кликом - Tampermonkey сам предложит установить. Либо добавьте вручную через
            дашборд Tampermonkey: Создать новый скрипт - Вставить код - Сохранить.
          </Step>

          <Step n={3} title="Активация и перехват токенов">
            <p>
              Перейдите на <a className="text-primary hover:underline" href="https://chat.qwen.ai/" target="_blank" rel="noreferrer">chat.qwen.ai</a>.
              Скрипт не требует ввода паролей, но ему нужно перехватить ваши текущие токены сессии:
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1.5 text-muted-foreground">
              <li>Включите тумблер «Поиск в сети» (чтобы нейросеть собирала инфу из топа выдачи).</li>
              <li>Отправьте в чат любое сообщение вручную (например, слово «тест»).</li>
              <li>
                Откройте панель скрипта (фиолетовая кнопка <span className="font-mono">Q</span> в правом
                нижнем углу). Убедитесь, что загорелся статус «Захвачено».
              </li>
              <li>Уберите «Поиск в сети» и отправьте ещё одно сообщение (например, «тест2»), чтобы захватить второй токен.</li>
            </ul>
          </Step>

          <Step n={4} title="Массовый запуск">
            <ul className="list-disc pl-5 space-y-1.5 text-muted-foreground">
              <li>В панели скрипта выберите тип страницы «Инфо-статья».</li>
              <li>Включите чекбокс «Список запросов = список тем».</li>
              <li>Скопируйте и вставьте список тем - строго каждую с новой строки.</li>
              <li>В блоке экспорта выберите формат HTML, поставьте галочки «Без обертки» и «Каждый чат - отдельным файлом».</li>
              <li>Жмите Старт.</li>
            </ul>
          </Step>
        </div>

        <div className="pt-2 border-t border-border">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Дальше скрипт всё сделает сам: создаст новые чаты под каждую тему, скормит системный промпт,
            составит план и автоматически распишет каждый пункт до нужного объёма. Вам остаётся дождаться
            окончания процесса, нажать «Экспорт» и забрать архив с готовыми статьями.
          </p>
        </div>
      </Card>

      <Card className="p-6 space-y-3">
        <h2 className="text-lg font-semibold">Видео-демо</h2>
        <div className="aspect-video bg-muted/30 border border-dashed border-border rounded-lg flex items-center justify-center text-sm text-muted-foreground">
          Сюда можно встроить видео (YouTube/Rutube iframe)
        </div>
      </Card>
    </div>
  );
}

function Step({ n, title, children }: { n: number; title: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 w-7 h-7 rounded-full bg-primary/15 text-primary flex items-center justify-center font-semibold text-sm">
        {n}
      </div>
      <div className="flex-1 space-y-1">
        <h3 className="font-medium text-foreground">{title}</h3>
        <div className="text-muted-foreground">{children}</div>
      </div>
    </div>
  );
}