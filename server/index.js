import { createApp } from './app.js';
import { config } from './config.js';
import { startTelegramImprovementMonitor, startTelegramTopAutopostMonitor } from './services/telegram.js';

const app = createApp();

app.listen(config.port, () => {
  console.log(`✅ Servidor escuchando en http://localhost:${config.port}`);
  const topMonitor = startTelegramTopAutopostMonitor();
  console.log('🤖 Estado monitor Telegram /top:', topMonitor);
  const improvementMonitor = startTelegramImprovementMonitor();
  console.log('⏱️ Estado monitor Telegram de mejoras:', improvementMonitor);
});
