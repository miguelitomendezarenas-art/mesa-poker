# Mesa de póker — Texas Hold'em (6 asientos)

## Requisitos
Node.js 18 o superior (https://nodejs.org)

## Ejecutar
    npm install
    npm start

La consola muestra dos direcciones:
- `http://localhost:3000` → para ti
- `http://192.168.x.x:3000` → para amigos en tu misma red Wi-Fi

## Jugar online (amigos en otras casas)
Opción más simple, sin configurar el router:
    npx localtunnel --port 3000      (o)   ngrok http 3000
Comparte el enlace https que te den. Después de entrar, copia el enlace de la mesa con el botón «Copiar enlace».

## Estructura
- server/cards.js          baraja y mezcla
- server/handEvaluator.js  mejor mano de 5 entre 7 cartas
- server/game.js           reglas: ciegas, apuestas, botes laterales, showdown
- server/index.js          servidor HTTP + WebSocket, salas por código
- server/test.js           pruebas (npm test)
- public/                  interfaz web

## Ajustes
Ciegas y fichas iniciales: server/index.js (`new Table({ smallBlind, bigBlind, buyIn })`).
Tiempo por turno: `TURN_MS` en server/game.js.
