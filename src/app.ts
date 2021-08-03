import { Container } from "typedi";
import { SyncService } from "./services/syncService";
import { createExpressServer } from "routing-controllers";
import { TokenController } from "./controllers/tokens";
import config from "./config";

export const createApp = async (): Promise<void> => {
  const syncService = Container.get(SyncService);
  await syncService.launch();
  console.log("Bot started");

  const app = createExpressServer({
    cors: true,
    controllers: [TokenController],
  });

  app.listen(config.port);
};
