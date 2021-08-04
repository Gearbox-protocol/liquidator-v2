import { Container } from "typedi";
import { SyncService } from "./services/syncService";
import { createExpressServer } from "routing-controllers";
import { TokenController } from "./controllers/tokens";
import config from "./config";
import { createConnection } from "typeorm";
import { ConnectionOptions } from "typeorm/connection/ConnectionOptions";
import * as dbConfig from "./ormconfig";
import { FaucetController } from "./controllers/faucet";

export const createApp = async (): Promise<void> => {
  // Connecting Database
  try {
    // @ts-ignore
    await createConnection(dbConfig as ConnectionOptions);
  } catch (e) {
    console.log("TypeORM connection error: ", e);
    process.abort();
  }

  const syncService = Container.get(SyncService);
  await syncService.launch();
  console.log("Bot started");

  const app = createExpressServer({
    cors: true,
    controllers: [TokenController, FaucetController],
  });

  app.listen(config.port);
};
