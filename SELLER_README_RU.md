# CoreBox — пакет для передачи и продажи

## Статус

CoreBox — рабочий прототип cyberpunk command idle strategy. В проект входят Rust/WASM-ядро симуляции, локальный SQLite HTTP backend, offline-прогресс, операции, heat секторов, флот, PvP-контракты, мобильный UI и долгосрочные retention-механики.

Это пакет технического прототипа, а не заявление о доказанной выручке, живой аудитории или production-масштабе multiplayer.

## Быстрый запуск

Требования: Node.js 22+, Rust toolchain, `wasm-pack` и современный Chromium/Edge.

```bash
npm install
npm run check
npm run start:local
```

Откройте `http://localhost:3000` или порт, который напечатает локальный сервер. Runtime SQLite создаёт базу `data/local.db`. В чистой копии покупателя база должна создаваться заново и не должна содержать данные продавца.

## Команды проверки

```bash
npm run check:js
npm run audit:static
npm run test:local-db
npm run test:retention-1000h
npm run audit:balance
npm run test:quest-contract
npm run test:save-integrity
npm run check
```

Команда `test:retention-1000h` симулирует 1000 ускоренных игровых часов и проверяет операции, отчёты, инциденты, проекты, цели, NPC-конвои, heat, пределы ресурсов и открытие нового цикла.

## Включённые системы

Expedition Contracts, Welcome-back reports, Safe Automation, Recon Reports, sector heat, mastery, Support Order, Sector Control, NPC convoy, инфраструктурные sinks, Codex/Archive, local PvP и Rust/WASM state simulation. Главная точка управления — Operations Deck в Command Center.

## Важные условия передачи

В репозитории есть Supabase-совместимый адаптер, потому что локальный backend повторяет бывший API-контракт. Перед эксклюзивной передачей покупатель должен проверить пути в `game.js`, `fleet.js`, `save.js`, `space-module.js` и `multiplayer_combat.js` относительно выбранного local или production adapter. Не обещайте полностью cloud-free multiplayer без этой проверки.

В пакет не входят база продавца, credentials, личные аккаунты, токены, browser sessions или приватные тестовые данные. GitHub-аккаунт и личную почту нельзя передавать вместе с проектом.

## Рекомендуемые условия сделки

Передача исходников и исключительных коммерческих прав должна выполняться по письменному договору и после защищённой оплаты или подтверждения escrow. Права на сторонние библиотеки, шрифты, музыку и изображения необходимо проверить отдельно.
