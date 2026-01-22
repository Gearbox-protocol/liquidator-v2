import { NotificationConfig } from "@gearbox-protocol/cli-utils";
import type { Curator } from "@gearbox-protocol/sdk";
import { z } from "zod/v4";

const extendedOptions = NotificationConfig.options.map(o =>
  o.extend({
    /**
     * When undefined, defaults to all curators together (aka Gearbox internal)
     */
    curator: z.custom<Curator>(s => typeof s === "string").optional(),
  }),
);

export const NotificationsConfig = z.object({
  notifications: z.array(
    z.discriminatedUnion(
      NotificationConfig.def.discriminator,
      extendedOptions as [
        (typeof extendedOptions)[0],
        ...(typeof extendedOptions)[number][],
      ],
    ),
  ),
});
