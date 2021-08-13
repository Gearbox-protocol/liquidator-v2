import { Container } from "typedi";
import { createExpressServer } from "routing-controllers";
import { TokenController } from "./controllers/tokens";
import config from "./config";
import winston, { format, transports } from "winston";
import { TerminatorService } from "./services/terminatorService";

export const createApp = async () => {
  winston.configure({
    transports: [
      new transports.Console({
        level: "debug",
        handleExceptions: true,
        format:
          process.env.NODE_ENV !== "development"
            ? format.combine(format.json(), format.timestamp())
            : format.combine(
                format.colorize(),
                format.simple(),
                format.timestamp(),
                format.printf(({ label, message, timestamp, level }) => {
                  return `${timestamp} ${level}: ${label} ${message}`;
                })
              ),
      }),
    ],
  });

  const log = winston.child({ label: "[App]" });

  log.info("Starting server...");

  const app = createExpressServer({
    cors: true,
    controllers: [TokenController],
  });

  app.listen(config.port);

  const terminatorService = Container.get(TerminatorService);
  await terminatorService.launch();
  console.log("Bot started");
};
