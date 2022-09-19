import { Container } from "typedi";

import { LiquidatorService } from "./services/liquidatorService";

export const createApp = async () => {
  await Container.get(LiquidatorService).launch();
};
